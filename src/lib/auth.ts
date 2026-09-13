import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "keyring_session";
const SESSION_DAYS = 30;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET is not configured.");
    }
    return "dev-only-session-secret-change-me";
  }
  return s;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `s1:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "s1") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function sha256Hex(input: string): string {
  return createHmac("sha256", "").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export async function createSession(userId: string, userAgent?: string) {
  const id = randomToken(24);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await prisma.session.create({
    data: { id, userId, expiresAt, userAgent: userAgent?.slice(0, 255) },
  });
  const payload = `${id}.${expiresAt.getTime()}`;
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return id;
}

export async function destroySession() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (raw) {
    const sessionId = raw.split(".")[0];
    await prisma.session.deleteMany({ where: { id: sessionId } }).catch(() => {});
  }
  cookieStore.delete(COOKIE_NAME);
}

export async function getSessionUser() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [sessionId, expStr, sig] = parts;
  const payload = `${sessionId}.${expStr}`;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expStr) < Date.now()) return null;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  if (session.user.status !== "active") return null;
  return session.user;
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new AuthError(401, "Sign in required.");
  return user;
}

/** Org owner (project master) or platform superadmin. */
export async function requireOrgAdmin() {
  const user = await requireUser();
  const isOwner = user.orgRole === "owner" || user.role === "admin";
  const isPlatform = user.platformRole === "superadmin";
  if (!isOwner && !isPlatform) {
    throw new AuthError(403, "Organization owner access required.");
  }
  return user;
}

/** SaaS platform operator only. Sees metadata — never vault secrets. */
export async function requireSuperadmin() {
  const user = await requireUser();
  if (user.platformRole !== "superadmin") {
    throw new AuthError(403, "Platform owner access required.");
  }
  return user;
}

export function isOrgOwner(user: {
  orgRole?: string | null;
  role: string;
  platformRole: string;
}): boolean {
  return user.orgRole === "owner" || user.role === "admin" || user.platformRole === "superadmin";
}

export function isSuperadmin(user: { platformRole: string }): boolean {
  return user.platformRole === "superadmin";
}

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function rpId(): string {
  const url = process.env.APP_URL || "http://localhost:3000";
  try {
    return new URL(url).hostname;
  } catch {
    return "localhost";
  }
}

export function origin(): string {
  return process.env.APP_URL || "http://localhost:3000";
}
