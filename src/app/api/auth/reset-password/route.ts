import { createHmac } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { handleApiError } from "@/lib/api";

function secret() {
  return process.env.SESSION_SECRET || "dev-only-session-secret-change-me";
}

function hashToken(raw: string) {
  return createHmac("sha256", secret()).update(raw).digest("hex");
}

const schema = z.object({
  token: z.string().min(16),
  password: z.string().min(10, "Password must be at least 10 characters.").max(256),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const tokenHash = hashToken(body.token.trim());
    const reset = await prisma.passwordReset.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      return NextResponse.json(
        { error: "This reset link is invalid or has expired. Request a new one." },
        { status: 400 },
      );
    }
    if (reset.user.status !== "active") {
      return NextResponse.json({ error: "Account is not active." }, { status: 403 });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: reset.userId },
        data: { passwordHash: hashPassword(body.password) },
      }),
      prisma.passwordReset.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      }),
      // Force re-login on all devices.
      prisma.session.deleteMany({ where: { userId: reset.userId } }),
    ]);

    return NextResponse.json({
      ok: true,
      message: "Sign-in password updated. You can sign in now.",
    });
  } catch (err) {
    return handleApiError(err);
  }
}
