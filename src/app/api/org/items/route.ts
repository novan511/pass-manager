import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api";
import { effectiveCategories, canAccessCategory } from "@/lib/categories";

const createSchema = z.object({
  ciphertext: z.string().min(8),
  iv: z.string().min(8),
  category: z.string().min(1).max(40),
});

/** Shared org vault items (ciphertext only). Requires org membership. */
export async function GET() {
  try {
    const user = await requireUser();
    if (!user.organizationId) {
      return NextResponse.json({ items: [], allowedCategories: [] });
    }
    const allowed = effectiveCategories(user.role, user.allowedCategories, {
      orgRole: user.orgRole,
      platformRole: user.platformRole,
    });
    if (allowed.length === 0) {
      return NextResponse.json({ items: [], allowedCategories: allowed });
    }
    const items = await prisma.orgVaultItem.findMany({
      where: { organizationId: user.organizationId, category: { in: allowed } },
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
    return NextResponse.json({ items, allowedCategories: allowed });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user.organizationId) {
      return NextResponse.json({ error: "You are not in an organization." }, { status: 400 });
    }
    const body = createSchema.parse(await req.json());
    if (
      !canAccessCategory(user.role, user.allowedCategories, body.category, {
        orgRole: user.orgRole,
        platformRole: user.platformRole,
      })
    ) {
      return NextResponse.json(
        { error: `You do not have access to the “${body.category}” category yet.` },
        { status: 403 },
      );
    }
    const item = await prisma.orgVaultItem.create({
      data: {
        organizationId: user.organizationId,
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
