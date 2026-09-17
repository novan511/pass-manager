import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db, nowIso } from "@/lib/supabase/db";
import { handleApiError } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireUser();
    const { data, error } = await db()
      .from("user_key_pairs")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return NextResponse.json({
      hasKeyPair: !!data,
      publicKey: data?.public_key ?? null,
      encryptedPrivateKey: data?.encrypted_private_key ?? null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const putSchema = z.object({
  publicKey: z.string().min(64),
  encryptedPrivateKey: z.string().min(16),
});

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = putSchema.parse(await req.json());
    const { data, error } = await db()
      .from("user_key_pairs")
      .upsert(
        {
          user_id: user.id,
          public_key: body.publicKey,
          encrypted_private_key: body.encryptedPrivateKey,
          updated_at: nowIso(),
          created_at: nowIso(),
        },
        { onConflict: "user_id" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ hasKeyPair: true, publicKey: data.public_key });
  } catch (err) {
    return handleApiError(err);
  }
}
