import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import { effectiveCategories } from "@/lib/categories";

function secret() {
  return process.env.SESSION_SECRET || "dev-only-session-secret-change-me";
}

/**
 * Bearer-token API used by the browser extension.
 * Returns encrypted blobs only — the extension decrypts locally with the master password.
 */
async function userFromToken(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const raw = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!raw) return null;
  const tokenHash = createHmac("sha256", secret()).update(raw).digest("hex");
  const token = await prisma.extensionToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!token || token.expiresAt < new Date()) return null;
  if (token.user.status !== "active") return null;
  await prisma.extensionToken.update({
    where: { id: token.id },
    data: { lastUsedAt: new Date() },
  });
  return token.user;
}

export async function GET(req: NextRequest) {
  const user = await userFromToken(req);
  if (!user) {
    return NextResponse.json({ error: "Invalid or expired extension token." }, { status: 401 });
  }
  const profile = await prisma.vaultProfile.findUnique({
    where: { userId: user.id },
    select: {
      kdfSalt: true,
      wrappedDek: true,
      verifier: true,
      wrappedDekPasskey: true,
      passkeyPrfSalt: true,
      kdfIterations: true,
    },
  });
  const allowed = effectiveCategories(user.role, user.allowedCategories, {
    orgRole: user.orgRole,
    platformRole: user.platformRole,
  });
  const items =
    allowed.length === 0
      ? []
      : await prisma.vaultItem.findMany({
          where: { userId: user.id, category: { in: allowed } },
          select: { id: true, ciphertext: true, iv: true, category: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
        });
  return NextResponse.json({
    user: { email: user.email },
    profile,
    items,
  });
}
