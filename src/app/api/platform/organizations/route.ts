import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSuperadmin } from "@/lib/auth";
import { handleApiError } from "@/lib/api";

/**
 * Platform (SaaS) view — metadata only.
 * Zero-knowledge: never returns ciphertext, password hashes, or vault keys.
 */
export async function GET() {
  try {
    await requireSuperadmin();

    const orgs = await prisma.organization.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            orgRole: true,
            platformRole: true,
            status: true,
            allowedCategories: true,
            createdAt: true,
            _count: { select: { items: true, credentials: true } },
          },
        },
      },
    });

    return NextResponse.json({
      zeroKnowledge: true,
      note: "Platform sees structure only. Passwords stay encrypted on user devices.",
      organizations: orgs.map((org) => {
        const owners = org.users.filter((u) => u.orgRole === "owner");
        const members = org.users.filter((u) => u.orgRole !== "owner");
        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          status: org.status,
          createdAt: org.createdAt,
          itemCount: org.users.reduce((sum, u) => sum + u._count.items, 0),
          passkeyCount: org.users.reduce((sum, u) => sum + u._count.credentials, 0),
          owners: owners.map((u) => ({
            id: u.id,
            email: u.email,
            status: u.status,
            platformRole: u.platformRole,
            itemCount: u._count.items,
            passkeyCount: u._count.credentials,
            createdAt: u.createdAt,
          })),
          members: members.map((u) => ({
            id: u.id,
            email: u.email,
            status: u.status,
            itemCount: u._count.items,
            passkeyCount: u._count.credentials,
            createdAt: u.createdAt,
          })),
        };
      }),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const createSchema = z.object({
  name: z.string().min(2).max(80),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(10).max(256).optional(),
});

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "org"
  );
}

/** Platform can provision a new customer project. */
export async function POST(req: NextRequest) {
  try {
    await requireSuperadmin();
    const body = createSchema.parse(await req.json());
    const ownerEmail = body.ownerEmail.trim().toLowerCase();

    let slug = slugify(body.name);
    if (await prisma.organization.findUnique({ where: { slug } })) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    const existingOwner = await prisma.user.findUnique({ where: { email: ownerEmail } });
    if (existingOwner && !body.ownerPassword) {
      // Attach existing account as owner of the new org.
      if (existingOwner.platformRole === "superadmin") {
        return NextResponse.json(
          { error: "Use a different email for the project owner." },
          { status: 400 },
        );
      }
      const org = await prisma.organization.create({
        data: { name: body.name.trim(), slug },
      });
      await prisma.user.update({
        where: { id: existingOwner.id },
        data: {
          organizationId: org.id,
          orgRole: "owner",
          role: "admin",
          status: "active",
        },
      });
      return NextResponse.json({ organization: org, owner: { id: existingOwner.id, email: ownerEmail } }, { status: 201 });
    }

    if (!body.ownerPassword) {
      return NextResponse.json(
        { error: "ownerPassword is required for a new owner email." },
        { status: 400 },
      );
    }
    if (existingOwner) {
      return NextResponse.json(
        { error: "Email already exists. Use attach mode without a password, or pick another email." },
        { status: 409 },
      );
    }

    const { hashPassword } = await import("@/lib/auth");
    const org = await prisma.organization.create({
      data: { name: body.name.trim(), slug },
    });
    const owner = await prisma.user.create({
      data: {
        email: ownerEmail,
        passwordHash: hashPassword(body.ownerPassword),
        platformRole: "user",
        orgRole: "owner",
        role: "admin",
        status: "active",
        organizationId: org.id,
        allowedCategories: "work,personal,finance,social,other",
      },
    });

    return NextResponse.json(
      {
        organization: org,
        owner: { id: owner.id, email: owner.email },
        note: "Share the owner password with your customer out-of-band. It is never stored in plaintext.",
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}

const patchSchema = z.object({
  organizationId: z.string().min(1),
  status: z.enum(["active", "suspended"]).optional(),
  name: z.string().min(2).max(80).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    await requireSuperadmin();
    const body = patchSchema.parse(await req.json());
    const org = await prisma.organization.update({
      where: { id: body.organizationId },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.name ? { name: body.name.trim() } : {}),
      },
    });
    if (body.status === "suspended") {
      await prisma.session.deleteMany({
        where: { user: { organizationId: org.id } },
      });
    }
    return NextResponse.json({ organization: org });
  } catch (err) {
    return handleApiError(err);
  }
}

const deleteSchema = z.object({
  organizationId: z.string().min(1),
  /** Must match organization name exactly — type-to-confirm. */
  confirmName: z.string().min(1),
});

/**
 * Permanent delete: removes the org, every user in it, and all vault data.
 * Irreversible. Zero-knowledge: we only delete ciphertext blobs, never plaintext secrets.
 */
export async function DELETE(req: NextRequest) {
  try {
    await requireSuperadmin();
    const body = deleteSchema.parse(await req.json());

    const org = await prisma.organization.findUnique({
      where: { id: body.organizationId },
      include: { users: { select: { id: true, platformRole: true } } },
    });
    if (!org) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    if (org.name.trim() !== body.confirmName.trim()) {
      return NextResponse.json(
        { error: "Type the project name exactly to confirm deletion." },
        { status: 400 },
      );
    }
    if (org.users.some((u) => u.platformRole === "superadmin")) {
      return NextResponse.json(
        { error: "Cannot delete a project that contains a platform owner." },
        { status: 400 },
      );
    }

    // Order matters for SQLite FKs: dependents first.
    await prisma.$transaction([
      prisma.session.deleteMany({ where: { user: { organizationId: org.id } } }),
      prisma.extensionToken.deleteMany({ where: { user: { organizationId: org.id } } }),
      prisma.credential.deleteMany({ where: { user: { organizationId: org.id } } }),
      prisma.vaultItem.deleteMany({ where: { user: { organizationId: org.id } } }),
      prisma.vaultProfile.deleteMany({ where: { user: { organizationId: org.id } } }),
      prisma.userKeyPair.deleteMany({ where: { user: { organizationId: org.id } } }),
      prisma.orgMemberKey.deleteMany({ where: { organizationId: org.id } }),
      prisma.orgVaultItem.deleteMany({ where: { organizationId: org.id } }),
      prisma.user.deleteMany({ where: { organizationId: org.id } }),
      prisma.organization.delete({ where: { id: org.id } }),
    ]);

    return NextResponse.json({
      ok: true,
      deleted: {
        organizationId: org.id,
        name: org.name,
        users: org.users.length,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
