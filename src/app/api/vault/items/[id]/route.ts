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

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const existing = await prisma.vaultItem.findFirst({ where: { id, userId: user.id } });
    if (!existing) return NextResponse.json({ error: "Item not found." }, { status: 404 });
    const body = updateSchema.parse(await req.json());
    if (
      !canAccessCategory(user.role, user.allowedCategories, body.category, {
        orgRole: user.orgRole,
        platformRole: user.platformRole,
      })
    ) {
      return NextResponse.json(
        {
          error: `You do not have access to the “${body.category}” category yet. Ask the vault admin to grant it in Admin → Access control.`,
        },
        { status: 403 },
      );
    }
    const item = await prisma.vaultItem.update({
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
    const existing = await prisma.vaultItem.findFirst({ where: { id, userId: user.id } });
    if (!existing) return NextResponse.json({ error: "Item not found." }, { status: 404 });
    await prisma.vaultItem.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
