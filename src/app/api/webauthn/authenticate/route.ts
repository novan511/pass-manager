import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, rpId, origin, createSession } from "@/lib/auth";
import { handleApiError } from "@/lib/api";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * Two uses:
 * 1. Unlock: { email } — options for an existing user's passkeys (vault unlock / login).
 * 2. After assertion, client derives KEK from PRF and unwraps DEK locally.
 */
const optionsSchema = z.object({
  email: z.string().email().optional(),
  credentialId: z.string().optional(),
  /** base64 salt for WebAuthn PRF eval — required for vault unlock via passkey */
  prfSaltB64: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = optionsSchema.parse(await req.json());
    let userId: string | undefined;

    if (body.email) {
      const user = await prisma.user.findUnique({
        where: { email: body.email.trim().toLowerCase() },
      });
      if (!user || user.status !== "active") {
        return NextResponse.json({ error: "No active account for this email." }, { status: 404 });
      }
      userId = user.id;
    } else {
      const sessionUser = await getSessionUser();
      if (!sessionUser) {
        return NextResponse.json({ error: "Sign in required." }, { status: 401 });
      }
      userId = sessionUser.id;
    }

    const credentials = await prisma.credential.findMany({ where: { userId } });
    if (credentials.length === 0) {
      return NextResponse.json({ error: "No passkeys registered." }, { status: 404 });
    }

    // PRF results are only returned when `eval` is supplied at assertion time.
    const prfExt = body.prfSaltB64
      ? {
          prf: {
            eval: {
              first: Buffer.from(body.prfSaltB64, "base64"),
            },
          },
        }
      : { prf: {} };

    const options = await generateAuthenticationOptions({
      rpID: rpId(),
      userVerification: "preferred",
      allowCredentials: credentials.map((c) => ({
        id: c.credentialId,
        transports: (c.transports?.split(",").filter(Boolean) ?? []) as AuthenticatorTransport[],
      })),
      extensions: prfExt,
    });

    await prisma.webAuthnChallenge.create({
      data: {
        userId,
        challenge: options.challenge,
        type: "authentication",
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
    });

    return NextResponse.json({ options, userId });
  } catch (err) {
    return handleApiError(err);
  }
}

const verifySchema = z.object({
  response: z.any(),
});

export async function PUT(req: NextRequest) {
  try {
    const body = verifySchema.parse(await req.json());
    const record = await prisma.webAuthnChallenge.findFirst({
      where: {
        challenge: body.response?.challenge,
        type: "authentication",
        expiresAt: { gte: new Date() },
      },
    });
    if (!record || !record.userId) {
      return NextResponse.json({ error: "Challenge expired. Try again." }, { status: 400 });
    }

    const cred = await prisma.credential.findFirst({
      where: { userId: record.userId, credentialId: body.response?.id },
    });
    if (!cred) {
      return NextResponse.json({ error: "Unknown passkey." }, { status: 400 });
    }

    const verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: record.challenge,
      expectedOrigin: origin(),
      expectedRPID: rpId(),
      requireUserVerification: false,
      credential: {
        id: cred.credentialId,
        publicKey: Buffer.from(cred.publicKey, "base64url"),
        counter: cred.counter,
        transports: (cred.transports?.split(",").filter(Boolean) ?? []) as string[],
      },
    });

    if (!verification.verified) {
      return NextResponse.json({ error: "Passkey verification failed." }, { status: 400 });
    }

    await prisma.credential.update({
      where: { id: cred.id },
      data: { counter: verification.authenticationInfo.newCounter },
    });
    await prisma.webAuthnChallenge.delete({ where: { id: record.id } }).catch(() => {});

    const account = await prisma.user.findUnique({ where: { id: record.userId } });
    if (!account || account.status !== "active") {
      return NextResponse.json({ error: "Your access has been revoked." }, { status: 403 });
    }

    // Establish a web session so the user stays signed in after passkey login.
    await createSession(account.id, req.headers.get("user-agent") ?? undefined);

    return NextResponse.json({
      verified: true,
      userId: record.userId,
      user: { id: account.id, email: account.email, role: account.role },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
