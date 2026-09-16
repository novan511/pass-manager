import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { User as PrismaUser } from "@prisma/client";

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
  return createHmac("sha256", secret()).update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Supabase Auth owns sessions. Kept for API shape compatibility. */
export async function createSession(_userId: string, _userAgent?: string) {
  return "supabase";
}

export async function destroySession() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}

/**
 * Supabase Auth session → Prisma User (auto-link / auto-create org owner row).
 */
export async function getSessionUser(): Promise<PrismaUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: sbUser },
  } = await supabase.auth.getUser();
  if (!sbUser?.id || !sbUser.email) return null;

  const email = sbUser.email.toLowerCase();
  let dbUser = await prisma.user.findUnique({ where: { supabaseId: sbUser.id } });

  if (!dbUser) {
    const byEmail = await prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      dbUser = await prisma.user.update({
        where: { id: byEmail.id },
        data: { supabaseId: sbUser.id },
      });
    } else {
      const count = await prisma.user.count();
      const orgName = `${email.split("@")[0].replace(/[._]+/g, " ")} vault`;
      let slug =
        orgName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "org";
      if (await prisma.organization.findUnique({ where: { slug } })) {
        slug = `${slug}-${Date.now().toString(36)}`;
      }
      const org = await prisma.organization.create({
        data: { name: orgName, slug },
      });
      dbUser = await prisma.user.create({
        data: {
          supabaseId: sbUser.id,
          email,
          platformRole: count === 0 ? "superadmin" : "user",
          orgRole: "owner",
          role: "admin",
          status: "active",
          allowedCategories: "work,personal,finance,social,other",
          organizationId: org.id,
        },
      });
    }
  }

  if (dbUser.status !== "active") return null;

  if (dbUser.organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: dbUser.organizationId },
    });
    if (org && org.status === "suspended") return null;
  }

  return dbUser;
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

/** Actual request origin (handles Vercel proxies / www / custom domains). */
export function requestOrigin(req: {
  headers: { get(name: string): string | null };
}): string {
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req.headers.get("host");
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host?.includes("localhost") ? "http" : "https");
  if (host) return `${proto}://${host}`;
  return origin();
}

export function requestRpId(req: {
  headers: { get(name: string): string | null };
}): string {
  try {
    return new URL(requestOrigin(req)).hostname;
  } catch {
    return rpId();
  }
}

/** Accept APP_URL plus the live request origin (and www variant). */
export function allowedOrigins(req: {
  headers: { get(name: string): string | null };
}): string[] {
  const list = new Set<string>([origin(), requestOrigin(req)]);
  const envHost = rpId();
  if (envHost && envHost !== "localhost") {
    list.add(`https://${envHost}`);
    list.add(`https://www.${envHost}`);
  }
  const live = requestOrigin(req);
  try {
    const h = new URL(live).hostname;
    if (h && h !== "localhost") {
      list.add(`https://${h}`);
      list.add(`https://www.${h}`);
    }
  } catch {
    /* ignore */
  }
  return [...list];
}

export function expectedRpId(req: {
  headers: { get(name: string): string | null };
}): string {
  const live = requestRpId(req);
  if (live && live !== "localhost") return live;
  return rpId();
}
