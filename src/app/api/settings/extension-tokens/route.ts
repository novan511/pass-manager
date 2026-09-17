import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHmac, randomBytes } from "crypto";
import { requireUser } from "@/lib/auth";
import { db, newId, nowIso } from "@/lib/supabase/db";
import { handleApiError } from "@/lib/api";

function secret() {
  return process.env.SESSION_SECRET || "dev-only-session-secret-change-me";
}

export async function GET() {
  try {
    const user = await requireUser();
    const { data, error } = await db()
      .from("extension_tokens")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({
      tokens: (data ?? []).map((t) => ({
        id: t.id,
        label: t.label,
        expiresAt: t.expires_at,
        lastUsedAt: t.last_used_at,
        createdAt: t.created_at,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const createSchema = z.object({
  label: z.string().max(80).optional(),
  expiresInDays: z.number().int().min(1).max(365).default(30),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const raw = randomBytes(32).toString("base64url");
    const tokenHash = createHmac("sha256", secret()).update(raw).digest("hex");
    const expiresAt = new Date(Date.now() + body.expiresInDays * 24 * 3600 * 1000);
    const { data, error } = await db()
      .from("extension_tokens")
      .insert({
        id: newId(),
        user_id: user.id,
        token_hash: tokenHash,
        label: body.label?.trim() || "Browser extension",
        expires_at: expiresAt.toISOString(),
        created_at: nowIso(),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json(
      {
        token: raw,
        record: {
          id: data.id,
          label: data.label,
          expiresAt: data.expires_at,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}

const revokeSchema = z.object({ id: z.string().min(1) });

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = revokeSchema.parse(await req.json());
    const { error } = await db()
      .from("extension_tokens")
      .delete()
      .eq("id", body.id)
      .eq("user_id", user.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
