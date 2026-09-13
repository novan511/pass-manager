import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api";

const profileSchema = z.object({
  kdfSalt: z.string().min(16),
  wrappedDek: z.string().min(16),
  verifier: z.string().min(16),
  wrappedDekPasskey: z.string().nullish(),
  passkeyPrfSalt: z.string().nullish(),
  kdfIterations: z.number().int().min(100_000).max(2_000_000).optional(),
});

/** Fetch the (encrypted) vault profile for the signed-in user. */
export async function GET() {
  try {
    const user = await requireUser();
    const profile = await prisma.vaultProfile.findUnique({ where: { userId: user.id } });
    return NextResponse.json({ profile });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Create the vault profile the first time, or update wraps (e.g. after passkey enroll). */
export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = profileSchema.parse(await req.json());
    const profile = await prisma.vaultProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        kdfSalt: body.kdfSalt,
        wrappedDek: body.wrappedDek,
        verifier: body.verifier,
        wrappedDekPasskey: body.wrappedDekPasskey ?? null,
        passkeyPrfSalt: body.passkeyPrfSalt ?? null,
        kdfIterations: body.kdfIterations ?? 310000,
      },
      update: {
        kdfSalt: body.kdfSalt,
        wrappedDek: body.wrappedDek,
        verifier: body.verifier,
        wrappedDekPasskey: body.wrappedDekPasskey ?? null,
        passkeyPrfSalt: body.passkeyPrfSalt ?? null,
        kdfIterations: body.kdfIterations ?? 310000,
      },
    });
    return NextResponse.json({ profile });
  } catch (err) {
    return handleApiError(err);
  }
}
