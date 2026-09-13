import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession, hashPassword } from "@/lib/auth";
import { handleApiError } from "@/lib/api";
import { ALL_CATEGORIES_CSV } from "@/lib/categories";

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10, "Password must be at least 10 characters.").max(256),
  organizationName: z.string().min(2).max(80).optional(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "org";
}

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const email = body.email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      );
    }

    const isFirstUser = (await prisma.user.count()) === 0;
    const orgName =
      body.organizationName?.trim() ||
      email.split("@")[0].replace(/[._]+/g, " ") +
        (isFirstUser ? "" : "'s vault");

    let slug = slugify(orgName);
    if (await prisma.organization.findUnique({ where: { slug } })) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    const org = await prisma.organization.create({
      data: { name: orgName.trim() || "My vault", slug },
    });

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: hashPassword(body.password),
        platformRole: isFirstUser ? "superadmin" : "user",
        orgRole: "owner",
        role: "admin",
        status: "active",
        allowedCategories: ALL_CATEGORIES_CSV,
        organizationId: org.id,
      },
    });

    await createSession(user.id, req.headers.get("user-agent") ?? undefined);
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        orgRole: user.orgRole,
        platformRole: user.platformRole,
        organization: { id: org.id, name: org.name, slug: org.slug },
      },
      isFirstUser,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
