import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api";

/** Current user's key material (private key stays sealed under their KEK). */
export async function GET() {
  try {
    const user = await requireUser();
    const kp = await prisma.userKeyPair.findUnique({ where: { userId: user.id } });
    return NextResponse.json({
      hasKeyPair: !!kp,
      publicKey: kp?.publicKey ?? null,
      // Sealed with the user's master-password KEK — safe to return; server cannot open it.
      encryptedPrivateKey: kp?.encryptedPrivateKey ?? null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const putSchema = z.object({
  publicKey: z.string().min(64),
  encryptedPrivateKey: z.string().min(16),
});

/** Store (or replace) the user's wrapped RSA keypair. */
export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = putSchema.parse(await req.json());
    const kp = await prisma.userKeyPair.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        publicKey: body.publicKey,
        encryptedPrivateKey: body.encryptedPrivateKey,
      },
      update: {
        publicKey: body.publicKey,
        encryptedPrivateKey: body.encryptedPrivateKey,
      },
    });
    return NextResponse.json({ hasKeyPair: true, publicKey: kp.publicKey });
  } catch (err) {
    return handleApiError(err);
  }
}
