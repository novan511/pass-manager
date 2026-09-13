import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, randomToken, sha256Hex } from "@/lib/auth";
import { handleApiError } from "@/lib/api";
import { createHmac } from "crypto";

function secret() {
  return process.env.SESSION_SECRET || "dev-only-session-secret-change-me";
}

export async function GET() {
  try {
    const user = await requireUser();
    const tokens = await prisma.extensionToken.findMany({
      where: { userId: user.id },
      select: { id: true, label: true, expiresAt: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ tokens });
  } catch (err) {
    return handleApiError(err);
  }
}

const createSchema = z.object({
  label: z.string().max(80).optional(),
  expiresInDays: z.number().int().min(1).max(365).default(30),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const raw = randomToken(32);
    const tokenHash = createHmac("sha256", secret()).update(raw).digest("hex");
    const expiresAt = new Date(Date.now() + body.expiresInDays * 24 * 3600 * 1000);
    const created = await prisma.extensionToken.create({
      data: {
        userId: user.id,
        tokenHash,
        label: body.label?.trim() || "Browser extension",
        expiresAt,
      },
      select: { id: true, label: true, expiresAt: true },
    });
    // Raw token is returned exactly once — store it in the extension now.
    return NextResponse.json({ token: raw, record: created }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

const revokeSchema = z.object({ id: z.string().min(1) });

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = revokeSchema.parse(await req.json());
    await prisma.extensionToken.deleteMany({ where: { id: body.id, userId: user.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

// Re-export for extension API validation
export function hashExtensionToken(raw: string) {
  return createHmac("sha256", secret()).update(raw).digest("hex");
}
export { sha256Hex };
