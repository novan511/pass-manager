import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, createSession, allowedOrigins, expectedRpId } from "@/lib/auth";
import { db, newId, nowIso, findUserById, findUserByEmail } from "@/lib/supabase/db";
import { handleApiError } from "@/lib/api";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const optionsSchema = z.object({
  email: z.string().email().optional(),
  credentialId: z.string().optional(),
  prfSaltB64: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = optionsSchema.parse(await req.json());
    let userId: string | undefined;

    if (body.email) {
      const user = await findUserByEmail(body.email.trim().toLowerCase());
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

    const { data: credentials } = await db()
      .from("credentials")
      .select("*")
      .eq("user_id", userId);
    if (!credentials || credentials.length === 0) {
      return NextResponse.json(
        {
          error:
            "No passkey for this account yet. Sign in with email + password, then add a passkey in Settings.",
        },
        { status: 404 },
      );
    }

    const rpID = expectedRpId(req);
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
      rpID,
      userVerification: "preferred",
      allowCredentials: credentials.map((c) => ({
        id: c.credential_id,
        transports: (c.transports?.split(",").filter(Boolean) ?? []) as AuthenticatorTransport[],
      })),
      extensions: prfExt,
    });

    await db().from("webauthn_challenges").insert({
      id: newId(),
      user_id: userId,
      challenge: options.challenge,
      type: "authentication",
      expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
      created_at: nowIso(),
    });

    return NextResponse.json({ options, userId });
  } catch (err) {
    return handleApiError(err);
  }
}

const verifySchema = z.object({ response: z.any() });

export async function PUT(req: NextRequest) {
  try {
    const body = verifySchema.parse(await req.json());
    const { data: record } = await db()
      .from("webauthn_challenges")
      .select("*")
      .eq("challenge", body.response?.challenge)
      .eq("type", "authentication")
      .gte("expires_at", nowIso())
      .maybeSingle();
    if (!record || !record.user_id) {
      return NextResponse.json({ error: "Challenge expired. Try again." }, { status: 400 });
    }

    const { data: cred } = await db()
      .from("credentials")
      .select("*")
      .eq("user_id", record.user_id)
      .eq("credential_id", body.response?.id)
      .maybeSingle();
    if (!cred) {
      return NextResponse.json({ error: "Unknown passkey." }, { status: 400 });
    }

    const verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: record.challenge,
      expectedOrigin: allowedOrigins(req),
      expectedRPID: expectedRpId(req),
      requireUserVerification: false,
      credential: {
        id: cred.credential_id,
        publicKey: Buffer.from(cred.public_key, "base64url"),
        counter: cred.counter,
        transports: (cred.transports?.split(",").filter(Boolean) ?? []) as string[],
      },
    });

    if (!verification.verified) {
      return NextResponse.json({ error: "Passkey verification failed." }, { status: 400 });
    }

    await db()
      .from("credentials")
      .update({ counter: verification.authenticationInfo.newCounter })
      .eq("id", cred.id);
    await db().from("webauthn_challenges").delete().eq("id", record.id);

    const account = await findUserById(record.user_id);
    if (!account || account.status !== "active") {
      return NextResponse.json({ error: "Your access has been revoked." }, { status: 403 });
    }

    await createSession(account.id, req.headers.get("user-agent") ?? undefined);

    return NextResponse.json({
      verified: true,
      userId: record.user_id,
      user: { id: account.id, email: account.email, role: account.role },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
