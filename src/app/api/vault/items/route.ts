import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db, newId, nowIso } from "@/lib/supabase/db";
import { handleApiError } from "@/lib/api";
import { effectiveCategories, canAccessCategory } from "@/lib/categories";

const createSchema = z.object({
  ciphertext: z.string().min(8),
  iv: z.string().min(8),
  category: z.string().min(1).max(40),
});

export async function GET() {
  try {
    const user = await requireUser();
    const allowed = effectiveCategories(user.role, user.allowed_categories, {
      orgRole: user.org_role,
      platformRole: user.platform_role,
    });
    if (allowed.length === 0) {
      return NextResponse.json({ items: [], allowedCategories: allowed, role: user.role });
    }
    const { data, error } = await db()
      .from("vault_items")
      .select("*")
      .eq("user_id", user.id)
      .in("category", allowed)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({
      items: (data ?? []).map((r) => ({
        id: r.id,
        ciphertext: r.ciphertext,
        iv: r.iv,
        category: r.category,
        updatedAt: r.updated_at,
        createdAt: r.created_at,
      })),
      allowedCategories: allowed,
      role: user.role,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = createSchema.parse(await req.json());
    if (
      !canAccessCategory(user.role, user.allowed_categories, body.category, {
        orgRole: user.org_role,
        platformRole: user.platform_role,
      })
    ) {
      return NextResponse.json(
        {
          error: `You do not have access to the “${body.category}” category yet. Ask the vault admin to grant it in Admin → Access control.`,
        },
        { status: 403 },
      );
    }
    const now = nowIso();
    const { data, error } = await db()
      .from("vault_items")
      .insert({
        id: newId(),
        user_id: user.id,
        ciphertext: body.ciphertext,
        iv: body.iv,
        category: body.category.toLowerCase(),
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json(
      {
        item: {
          id: data.id,
          ciphertext: data.ciphertext,
          iv: data.iv,
          category: data.category,
          updatedAt: data.updated_at,
          createdAt: data.created_at,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
