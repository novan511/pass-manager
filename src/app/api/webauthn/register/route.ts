import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  requireUser,
  allowedOrigins,
  expectedRpId,
} from "@/lib/auth";
import { handleApiError } from "@/lib/api";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rpID = expectedRpId(req);

    const existing = await prisma.credential.findMany({ where: { userId: user.id } });
    const options = await generateRegistrationOptions({
      rpName: "Keyring Vault",
      rpID,
      userName: user.email,
      userID: new TextEncoder().encode(user.id),
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: (c.transports?.split(",").filter(Boolean) ?? []) as AuthenticatorTransport[],
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      extensions: { credProps: true, prf: {} },
    });

    const challenge = options.challenge;
    await prisma.webAuthnChallenge.create({
      data: {
        userId: user.id,
        email: user.email,
        challenge,
        type: "registration",
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
    });

    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    return NextResponse.json({
      options,
      prfSaltB64: btoa(String.fromCharCode(...prfSalt)),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const verifySchema = z.object({
  response: z.any(),
  prfSaltB64: z.string().min(16),
  deviceName: z.string().max(80).optional(),
});

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = verifySchema.parse(await req.json());

    const record = await prisma.webAuthnChallenge.findFirst({
      where: {
        challenge: body.response?.challenge,
        userId: user.id,
        type: "registration",
        expiresAt: { gte: new Date() },
      },
    });
    if (!record) {
      return NextResponse.json({ error: "Challenge expired. Try again." }, { status: 400 });
    }

    const verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: record.challenge,
      expectedOrigin: allowedOrigins(req),
      expectedRPID: expectedRpId(req),
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: "Passkey registration failed." }, { status: 400 });
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    await prisma.credential.create({
      data: {
        userId: user.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        deviceName: body.deviceName?.trim() || "Passkey",
        transports: (credential.transports ?? []).join(","),
      },
    });

    await prisma.webAuthnChallenge.delete({ where: { id: record.id } }).catch(() => {});

    // PRF results, if the authenticator supports them, come back client-side.
    // The client will wrap the DEK and PUT /api/vault/profile.
    return NextResponse.json({
      verified: true,
      credentialId: credential.id,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    const creds = await prisma.credential.findMany({
      where: { userId: user.id },
      select: { id: true, credentialId: true, deviceName: true, createdAt: true, transports: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ passkeys: creds });
  } catch (err) {
    return handleApiError(err);
  }
}
