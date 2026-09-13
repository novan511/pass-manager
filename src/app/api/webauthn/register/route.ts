import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { rpId, origin } from "@/lib/auth";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function POST(_req: NextRequest) {
  try {
    const user = await requireUser();

    const existing = await prisma.credential.findMany({ where: { userId: user.id } });
    const options = await generateRegistrationOptions({
      rpName: "Keyring Vault",
      rpID: rpId(),
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
      // Ask the authenticator for PRF (hmac-secret) so passkeys can unlock the vault.
      extensions: { credProps: true, prf: {} },
    });

    // Store challenge; also generate PRF salt for this enrollment.
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
    // Encode salt into challenge metadata via separate cookie-less approach:
    // stash in challenge table email field? Better: return salt to client and
    // re-send it at verification time (salt is not secret by itself; PRF output is).
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
      expectedOrigin: origin(),
      expectedRPID: rpId(),
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
