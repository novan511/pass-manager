import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  db,
  newId,
  nowIso,
  type VaultProfileRow,
} from "@/lib/supabase/db";
import { handleApiError } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireUser();
    const { data, error } = await db()
      .from("vault_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const p = data as VaultProfileRow | null;
    return NextResponse.json({
      profile: p
        ? {
            kdfSalt: p.kdf_salt,
            wrappedDek: p.wrapped_dek,
            verifier: p.verifier,
            wrappedDekPasskey: p.wrapped_dek_passkey,
            passkeyPrfSalt: p.passkey_prf_salt,
            kdfIterations: p.kdf_iterations,
          }
        : null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const putSchema = z.object({
  kdfSalt: z.string().min(16),
  wrappedDek: z.string().min(16),
  verifier: z.string().min(16),
  wrappedDekPasskey: z.string().nullish(),
  passkeyPrfSalt: z.string().nullish(),
  kdfIterations: z.number().int().min(100_000).max(2_000_000).optional(),
});

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = putSchema.parse(await req.json());
    const row = {
      user_id: user.id,
      kdf_salt: body.kdfSalt,
      wrapped_dek: body.wrappedDek,
      verifier: body.verifier,
      wrapped_dek_passkey: body.wrappedDekPasskey ?? null,
      passkey_prf_salt: body.passkeyPrfSalt ?? null,
      kdf_iterations: body.kdfIterations ?? 310000,
      updated_at: nowIso(),
    };
    const { data, error } = await db()
      .from("vault_profiles")
      .upsert(row, { onConflict: "user_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const p = data as VaultProfileRow;
    return NextResponse.json({
      profile: {
        kdfSalt: p.kdf_salt,
        wrappedDek: p.wrapped_dek,
        verifier: p.verifier,
        wrappedDekPasskey: p.wrapped_dek_passkey,
        passkeyPrfSalt: p.passkey_prf_salt,
        kdfIterations: p.kdf_iterations,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
