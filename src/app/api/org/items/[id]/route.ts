import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api";
import { canAccessCategory } from "@/lib/categories";

const updateSchema = z.object({
  ciphertext: z.string().min(8),
  iv: z.string().min(8),
  category: z.string().min(1).max(40),
});

type Ctx = { params: Promise<{ id: string }> };

async function orgItem(user: { organizationId: string | null }, id: string) {
  if (!user.organizationId) return null;
  return prisma.orgVaultItem.findFirst({
    where: { id, organizationId: user.organizationId },
  });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const existing = await orgItem(user, id);
    if (!existing) return NextResponse.json({ error: "Item not found." }, { status: 404 });
    const body = updateSchema.parse(await req.json());
    if (
      !canAccessCategory(user.role, user.allowedCategories, body.category, {
        orgRole: user.orgRole,
        platformRole: user.platformRole,
      })
    ) {
      return NextResponse.json(
        { error: `You do not have access to the “${body.category}” category.` },
        { status: 403 },
      );
    }
    const item = await prisma.orgVaultItem.update({
      where: { id },
      data: {
        ciphertext: body.ciphertext,
        iv: body.iv,
        category: body.category.toLowerCase(),
      },
      select: {
        id: true,
        ciphertext: true,
        iv: true,
        category: true,
        updatedAt: true,
      },
    });
    return NextResponse.json({ item });
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
    await prisma.orgVaultItem.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
