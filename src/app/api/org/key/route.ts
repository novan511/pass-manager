import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db, newId, nowIso, findUserById } from "@/lib/supabase/db";
import { handleApiError } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireUser();
    if (!user.organization_id) {
      return NextResponse.json({ hasOrgKey: false });
    }
    const { data, error } = await db()
      .from("org_member_keys")
      .select("*")
      .eq("organization_id", user.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return NextResponse.json({
      hasOrgKey: !!data,
      encryptedOrgKey: data?.encrypted_org_key ?? null,
      organizationId: user.organization_id,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const putSchema = z.object({
  encryptedOrgKey: z.string().min(32),
  targetUserId: z.string().optional(),
});

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = putSchema.parse(await req.json());
    if (!user.organization_id) {
      return NextResponse.json({ error: "You are not in an organization." }, { status: 400 });
    }

    const targetId = body.targetUserId ?? user.id;
    const isSelf = targetId === user.id;
    const isOwner = user.org_role === "owner" || user.role === "admin";
    const isPlatform = user.platform_role === "superadmin";
    if (!isSelf && !isOwner && !isPlatform) {
      return NextResponse.json(
        { error: "Only org owners can share the vault key." },
        { status: 403 },
      );
    }

    if (!isSelf) {
      const target = await findUserById(targetId);
      if (!target || target.organization_id !== user.organization_id) {
        return NextResponse.json({ error: "Target user not in your organization." }, { status: 404 });
      }
    }

    const now = nowIso();
    const { data, error } = await db()
      .from("org_member_keys")
      .upsert(
        {
          id: newId(),
          organization_id: user.organization_id,
          user_id: targetId,
          encrypted_org_key: body.encryptedOrgKey,
          created_at: now,
          updated_at: now,
        },
        { onConflict: "organization_id,user_id" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, id: data.id });
  } catch (err) {
    return handleApiError(err);
  }
}
