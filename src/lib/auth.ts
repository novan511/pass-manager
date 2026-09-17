import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { headers } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureAppUser, type UserRow } from "@/lib/supabase/db";

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

export async function createSession(_userId: string, _userAgent?: string) {
  return "supabase";
}

export async function destroySession() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}

/**
 * Resolve Supabase user from:
 * - Authorization: Bearer <access_token>  (iOS / mobile apps)
 * - Session cookies                       (web)
 */
async function getSupabaseAuthUser() {
  const h = await headers();
  const auth = h.get("authorization") ?? "";

  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (!token) return null;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return null;
    const client = createSupabaseClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const {
      data: { user },
    } = await client.auth.getUser();
    return user;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Supabase Auth → app users row (auto-link / create). */
export async function getSessionUser(): Promise<UserRow | null> {
  const sbUser = await getSupabaseAuthUser();
  if (!sbUser?.id || !sbUser.email) return null;
  return ensureAppUser(sbUser);
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new AuthError(401, "Sign in required.");
  return user;
}

export async function requireOrgAdmin() {
  const user = await requireUser();
  const isOwner = user.org_role === "owner" || user.role === "admin";
  const isPlatform = user.platform_role === "superadmin";
  if (!isOwner && !isPlatform) {
    throw new AuthError(403, "Organization owner access required.");
  }
  return user;
}

export async function requireSuperadmin() {
  const user = await requireUser();
  if (user.platform_role !== "superadmin") {
    throw new AuthError(403, "Platform owner access required.");
  }
  return user;
}

export function isOrgOwner(user: {
  org_role?: string | null;
  role: string;
  platform_role: string;
}): boolean {
  return (
    user.org_role === "owner" ||
    user.role === "admin" ||
    user.platform_role === "superadmin"
  );
}

export function isSuperadmin(user: { platform_role: string }): boolean {
  return user.platform_role === "superadmin";
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
