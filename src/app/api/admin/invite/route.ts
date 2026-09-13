import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireOrgAdmin, hashPassword, isSuperadmin } from "@/lib/auth";
import { handleApiError } from "@/lib/api";

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(256),
});

/** Org owner invites a member into their own project. Never returns secrets. */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireOrgAdmin();
    const body = schema.parse(await req.json());
    const email = body.email.trim().toLowerCase();

    if (!actor.organizationId && !isSuperadmin(actor)) {
      return NextResponse.json({ error: "You are not in an organization." }, { status: 400 });
    }
    if (!actor.organizationId) {
      return NextResponse.json(
        { error: "Platform accounts must create a project first (Platform → New project)." },
        { status: 400 },
      );
    }

    const org = await prisma.organization.findUnique({ where: { id: actor.organizationId } });
    if (!org || org.status !== "active") {
      return NextResponse.json({ error: "Organization is not active." }, { status: 403 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.organizationId === org.id) {
        return NextResponse.json({ error: "This email is already in your project." }, { status: 409 });
      }
      if (existing.platformRole === "superadmin") {
        return NextResponse.json({ error: "Cannot invite a platform owner." }, { status: 400 });
      }
      // Move existing account into this org as member.
      const user = await prisma.user.update({
        where: { id: existing.id },
        data: {
          organizationId: org.id,
          orgRole: "member",
          role: "member",
          status: "active",
          allowedCategories: "personal",
        },
      });
      return NextResponse.json({
        user: { id: user.id, email: user.email, orgRole: user.orgRole },
        moved: true,
      });
    }

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: hashPassword(body.password),
        platformRole: "user",
        orgRole: "member",
        role: "member",
        status: "active",
        organizationId: org.id,
        allowedCategories: "personal",
      },
    });

    return NextResponse.json(
      {
        user: { id: user.id, email: user.email, orgRole: user.orgRole },
        note: "Share the temporary password with them out-of-band. Ask them to change it after first login.",
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
