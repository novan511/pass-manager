import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db, nowIso } from "@/lib/supabase/db";
import { handleApiError } from "@/lib/api";
import { canAccessCategory } from "@/lib/categories";

const updateSchema = z.object({
  ciphertext: z.string().min(8),
  iv: z.string().min(8),
  category: z.string().min(1).max(40),
});

type Ctx = { params: Promise<{ id: string }> };

async function orgItem(user: { organization_id: string | null }, id: string) {
  if (!user.organization_id) return null;
  const { data, error } = await db()
    .from("org_vault_items")
    .select("*")
    .eq("id", id)
    .eq("organization_id", user.organization_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const existing = await orgItem(user, id);
    if (!existing) return NextResponse.json({ error: "Item not found." }, { status: 404 });
    const body = updateSchema.parse(await req.json());
    if (
      !canAccessCategory(user.role, user.allowed_categories, body.category, {
        orgRole: user.org_role,
        platformRole: user.platform_role,
      })
    ) {
      return NextResponse.json(
        { error: `You do not have access to the “${body.category}” category.` },
        { status: 403 },
      );
    }
    const { data, error } = await db()
      .from("org_vault_items")
      .update({
        ciphertext: body.ciphertext,
        iv: body.iv,
        category: body.category.toLowerCase(),
        updated_at: nowIso(),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({
      item: {
        id: data.id,
        ciphertext: data.ciphertext,
        iv: data.iv,
        category: data.category,
        updatedAt: data.updated_at,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const existing = await orgItem(user, id);
    if (!existing) return NextResponse.json({ error: "Item not found." }, { status: 404 });
    const { error } = await db().from("org_vault_items").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
