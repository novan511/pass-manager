import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api";
import { canAccessCategory, effectiveCategories } from "@/lib/categories";

const createSchema = z.object({
  ciphertext: z.string().min(8),
  iv: z.string().min(8),
  category: z.string().min(1).max(40),
});

/** List encrypted items the user is allowed to access. */
export async function GET() {
  try {
    const user = await requireUser();
    const allowed = effectiveCategories(user.role, user.allowedCategories, {
      orgRole: user.orgRole,
      platformRole: user.platformRole,
    });
    // Avoid Prisma `in: []` (invalid / returns nothing useful).
    if (allowed.length === 0) {
      return NextResponse.json({
        items: [],
        allowedCategories: allowed,
        role: user.role,
      });
    }
    const items = await prisma.vaultItem.findMany({
      where: { userId: user.id, category: { in: allowed } },
      select: {
        id: true,
        ciphertext: true,
        iv: true,
        category: true,
        updatedAt: true,
        createdAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({
      items,
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
    const item = await prisma.vaultItem.create({
      data: {
        userId: user.id,
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
        createdAt: true,
      },
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
