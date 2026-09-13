import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession, verifyPassword } from "@/lib/auth";
import { handleApiError } from "@/lib/api";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const email = body.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email },
      include: { organization: true },
    });
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    if (user.status !== "active") {
      return NextResponse.json(
        { error: "Your access has been revoked. Contact the project owner." },
        { status: 403 },
      );
    }
    if (user.organization && user.organization.status === "suspended") {
      return NextResponse.json(
        { error: "This project is suspended. Contact the platform owner." },
        { status: 403 },
      );
    }
    await createSession(user.id, req.headers.get("user-agent") ?? undefined);
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        orgRole: user.orgRole,
        platformRole: user.platformRole,
        organization: user.organization
          ? { id: user.organization.id, name: user.organization.name, slug: user.organization.slug }
          : null,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
