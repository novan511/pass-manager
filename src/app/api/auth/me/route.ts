import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { effectiveCategories } from "@/lib/categories";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ user: null });

  const [profile, passkeys, org] = await Promise.all([
    prisma.vaultProfile.findUnique({
      where: { userId: user.id },
      select: { userId: true, createdAt: true },
    }),
    prisma.credential.count({ where: { userId: user.id } }),
    user.organizationId
      ? prisma.organization.findUnique({
          where: { id: user.organizationId },
          select: { id: true, name: true, slug: true, status: true },
        })
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatar: user.avatar,
      role: user.role,
      orgRole: user.orgRole,
      platformRole: user.platformRole,
      organizationId: user.organizationId,
      organization: org,
      allowedCategories: effectiveCategories(user.role, user.allowedCategories, {
        orgRole: user.orgRole,
        platformRole: user.platformRole,
      }),
    },
    hasVault: !!profile,
    passkeyCount: passkeys,
  });
}
