import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createHmac } from "crypto";
import { db, newId, nowIso, findUserById } from "@/lib/supabase/db";
import { effectiveCategories } from "@/lib/categories";

function secret() {
  return process.env.SESSION_SECRET || "dev-only-session-secret-change-me";
}

async function userFromToken(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const raw = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!raw) return null;
  const tokenHash = createHmac("sha256", secret()).update(raw).digest("hex");
  const { data: token, error } = await db()
    .from("extension_tokens")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error || !token) return null;
  if (new Date(token.expires_at) < new Date()) return null;
  const user = await findUserById(token.user_id);
  if (!user || user.status !== "active") return null;
  await db()
    .from("extension_tokens")
    .update({ last_used_at: nowIso() })
    .eq("id", token.id);
  return user;
}

export async function GET(req: NextRequest) {
  const user = await userFromToken(req);
  if (!user) {
    return NextResponse.json({ error: "Invalid or expired extension token." }, { status: 401 });
  }

  const { data: profile } = await db()
    .from("vault_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  const allowed = effectiveCategories(user.role, user.allowed_categories, {
    orgRole: user.org_role,
    platformRole: user.platform_role,
  });

  let items: unknown[] = [];
  if (allowed.length > 0) {
    const { data } = await db()
      .from("vault_items")
      .select("*")
      .eq("user_id", user.id)
      .in("category", allowed)
      .order("updated_at", { ascending: false });
    items = (data ?? []).map((r) => ({
      id: r.id,
      ciphertext: r.ciphertext,
      iv: r.iv,
      category: r.category,
      updatedAt: r.updated_at,
    }));
  }

  return NextResponse.json({
    user: { email: user.email },
    profile: profile
      ? {
          kdfSalt: profile.kdf_salt,
          wrappedDek: profile.wrapped_dek,
          verifier: profile.verifier,
          wrappedDekPasskey: profile.wrapped_dek_passkey,
          passkeyPrfSalt: profile.passkey_prf_salt,
          kdfIterations: profile.kdf_iterations,
        }
      : null,
    items,
  });
}
