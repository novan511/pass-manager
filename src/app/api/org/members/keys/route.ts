import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrgAdmin } from "@/lib/auth";
import { handleApiError } from "@/lib/api";

/**
 * Org owners: public keys of members (for wrapping the shared org DEK).
 * Public keys are not secret. Private keys never leave the client.
 */
export async function GET() {
  try {
    const actor = await requireOrgAdmin();
    if (!actor.organizationId) {
      return NextResponse.json({ members: [] });
    }
    const users = await prisma.user.findMany({
      where: { organizationId: actor.organizationId, status: "active" },
      select: {
        id: true,
        email: true,
        orgRole: true,
        keyPair: { select: { publicKey: true, createdAt: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({
      members: users.map((u) => ({
        id: u.id,
        email: u.email,
        orgRole: u.orgRole,
        publicKey: u.keyPair?.publicKey ?? null,
        hasVaultKeys: !!u.keyPair,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
