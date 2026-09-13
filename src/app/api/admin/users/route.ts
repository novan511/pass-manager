import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireOrgAdmin, isSuperadmin } from "@/lib/auth";
import { handleApiError } from "@/lib/api";
import { categoriesToCsv, parseCategories, ALL_CATEGORIES_CSV } from "@/lib/categories";

/**
 * Org owner: manage members in their own organization only.
 * Platform superadmin: can patch any non-superadmin user by id.
 * Returns metadata only — never vault ciphertext or password hashes.
 */
export async function GET() {
  try {
    const actor = await requireOrgAdmin();
    const where = isSuperadmin(actor)
      ? {}
      : actor.organizationId
        ? { organizationId: actor.organizationId }
        : { id: "__none__" };

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        role: true,
        orgRole: true,
        platformRole: true,
        status: true,
        allowedCategories: true,
        organizationId: true,
        createdAt: true,
        organization: { select: { id: true, name: true, slug: true } },
        _count: { select: { items: true, credentials: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      scope: isSuperadmin(actor) ? "platform" : "organization",
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        orgRole: u.orgRole,
        platformRole: u.platformRole,
        status: u.status,
        allowedCategories: parseCategories(u.allowedCategories),
        organizationId: u.organizationId,
        organization: u.organization,
        createdAt: u.createdAt,
        itemCount: u._count.items,
        passkeyCount: u._count.credentials,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const patchSchema = z.object({
  userId: z.string().min(1),
  status: z.enum(["active", "revoked"]).optional(),
  orgRole: z.enum(["owner", "member"]).optional(),
  allowedCategories: z.array(z.string().min(1).max(40)).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireOrgAdmin();
    const body = patchSchema.parse(await req.json());

    const target = await prisma.user.findUnique({ where: { id: body.userId } });
    if (!target) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }
    if (target.platformRole === "superadmin" && !isSuperadmin(actor)) {
      return NextResponse.json({ error: "Cannot edit a platform owner." }, { status: 403 });
    }
    if (!isSuperadmin(actor)) {
      if (!actor.organizationId || target.organizationId !== actor.organizationId) {
        return NextResponse.json({ error: "User is not in your organization." }, { status: 403 });
      }
      if (target.id === actor.id && (body.status === "revoked" || body.orgRole === "member")) {
        return NextResponse.json(
          { error: "You cannot revoke or demote yourself." },
          { status: 400 },
        );
      }
      // Only one active owner path: allow multiple owners; demoting last owner is blocked below.
    }

    const nextOrgRole = body.orgRole ?? target.orgRole;
    if (body.orgRole === "member" || body.status === "revoked") {
      const owners = await prisma.user.count({
        where: {
          organizationId: target.organizationId,
          orgRole: "owner",
          status: "active",
          id: { not: target.id },
        },
      });
      if (target.orgRole === "owner" && owners === 0 && target.organizationId) {
        return NextResponse.json(
          { error: "An organization must keep at least one active owner." },
          { status: 400 },
        );
      }
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.orgRole
          ? {
              orgRole: body.orgRole,
              role: body.orgRole === "owner" ? "admin" : "member",
              ...(body.orgRole === "owner" ? { allowedCategories: ALL_CATEGORIES_CSV } : {}),
            }
          : {}),
        ...(body.allowedCategories && nextOrgRole !== "owner"
          ? { allowedCategories: categoriesToCsv(body.allowedCategories) }
          : {}),
      },
      select: {
        id: true,
        email: true,
        role: true,
        orgRole: true,
        platformRole: true,
        status: true,
        allowedCategories: true,
        organizationId: true,
      },
    });

    if (body.status === "revoked") {
      await prisma.session.deleteMany({ where: { userId: target.id } });
    }

    return NextResponse.json({
      user: {
        ...updated,
        allowedCategories: parseCategories(updated.allowedCategories),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const deleteSchema = z.object({ userId: z.string().min(1) });

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireOrgAdmin();
    const body = deleteSchema.parse(await req.json());
    const target = await prisma.user.findUnique({ where: { id: body.userId } });
    if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });
    if (target.platformRole === "superadmin") {
      return NextResponse.json({ error: "Cannot delete a platform owner." }, { status: 400 });
    }
    if (!isSuperadmin(actor)) {
      if (!actor.organizationId || target.organizationId !== actor.organizationId) {
        return NextResponse.json({ error: "User is not in your organization." }, { status: 403 });
      }
      if (target.id === actor.id) {
        return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
      }
    }
    await prisma.user.delete({ where: { id: target.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
