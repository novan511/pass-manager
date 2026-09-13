import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api";

/** This user's RSA-wrapped org DEK (if shared with them). */
export async function GET() {
  try {
    const user = await requireUser();
    if (!user.organizationId) {
      return NextResponse.json({ hasOrgKey: false });
    }
    const wrap = await prisma.orgMemberKey.findUnique({
      where: {
        organizationId_userId: {
          organizationId: user.organizationId,
          userId: user.id,
        },
      },
    });
    return NextResponse.json({
      hasOrgKey: !!wrap,
      encryptedOrgKey: wrap?.encryptedOrgKey ?? null,
      organizationId: user.organizationId,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const putSchema = z.object({
  /** Used when owner grants themselves on org create / re-share */
  encryptedOrgKey: z.string().min(32),
  targetUserId: z.string().optional(),
});

/**
 * PUT body:
 * - { encryptedOrgKey } → save wrap for current user
 * - org owners can also pass targetUserId to grant another member
 *   (they must already have encrypted that member's public key client-side)
 */
export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = putSchema.parse(await req.json());
    if (!user.organizationId) {
      return NextResponse.json({ error: "You are not in an organization." }, { status: 400 });
    }

    const targetId = body.targetUserId ?? user.id;
    const isSelf = targetId === user.id;
    const isOwner = user.orgRole === "owner" || user.role === "admin";
    const isPlatform = user.platformRole === "superadmin";
    if (!isSelf && !isOwner && !isPlatform) {
      return NextResponse.json(
        { error: "Only org owners can share the vault key." },
        { status: 403 },
      );
    }

    if (!isSelf) {
      const target = await prisma.user.findFirst({
        where: { id: targetId, organizationId: user.organizationId },
      });
      if (!target) {
        return NextResponse.json({ error: "Target user not in your organization." }, { status: 404 });
      }
    }

    const wrap = await prisma.orgMemberKey.upsert({
      where: {
        organizationId_userId: {
          organizationId: user.organizationId,
          userId: targetId,
        },
      },
      create: {
        organizationId: user.organizationId,
        userId: targetId,
        encryptedOrgKey: body.encryptedOrgKey,
      },
      update: { encryptedOrgKey: body.encryptedOrgKey },
    });

    return NextResponse.json({ ok: true, id: wrap.id });
  } catch (err) {
    return handleApiError(err);
  }
}
