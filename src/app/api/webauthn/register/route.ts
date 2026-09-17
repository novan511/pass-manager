import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireUser,
  allowedOrigins,
  expectedRpId,
} from "@/lib/auth";
import { db, newId, nowIso } from "@/lib/supabase/db";
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

    const { data: existing } = await db()
      .from("credentials")
      .select("*")
      .eq("user_id", user.id);

    const options = await generateRegistrationOptions({
      rpName: "Keyring Vault",
      rpID,
      userName: user.email,
      userID: new TextEncoder().encode(user.id),
      attestationType: "none",
      excludeCredentials: (existing ?? []).map((c) => ({
        id: c.credential_id,
        transports: (c.transports?.split(",").filter(Boolean) ?? []) as AuthenticatorTransport[],
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      extensions: { credProps: true, prf: {} },
    });

    await db().from("webauthn_challenges").insert({
      id: newId(),
      user_id: user.id,
      email: user.email,
      challenge: options.challenge,
      type: "registration",
      expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
      created_at: nowIso(),
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

    const { data: record } = await db()
      .from("webauthn_challenges")
      .select("*")
      .eq("challenge", body.response?.challenge)
      .eq("user_id", user.id)
      .eq("type", "registration")
      .gte("expires_at", nowIso())
      .maybeSingle();
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

    const { credential } = verification.registrationInfo;
    await db().from("credentials").insert({
      id: newId(),
      user_id: user.id,
      credential_id: credential.id,
      public_key: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      device_name: body.deviceName?.trim() || "Passkey",
      transports: (credential.transports ?? []).join(","),
      created_at: nowIso(),
    });

    await db().from("webauthn_challenges").delete().eq("id", record.id);

    return NextResponse.json({
      verified: true,
      credentialId: credential.id,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    const { data: creds } = await db()
      .from("credentials")
      .select("id, credential_id, device_name, created_at, transports")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    return NextResponse.json({
      passkeys: (creds ?? []).map((c) => ({
        id: c.id,
        credentialId: c.credential_id,
        deviceName: c.device_name,
        createdAt: c.created_at,
        transports: c.transports,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
