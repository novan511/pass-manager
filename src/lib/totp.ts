/** Client-side TOTP (RFC 6238) using Web Crypto HMAC-SHA1. */

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Uint8Array {
  const clean = input.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 character.");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Accepts raw base32 or otpauth://totp/... URIs. */
export function extractTotpSecret(input: string): string {
  const trimmed = input.trim();
  if (trimmed.toLowerCase().startsWith("otpauth://")) {
    try {
      const url = new URL(trimmed);
      const secret = url.searchParams.get("secret");
      if (!secret) throw new Error("otpauth URI missing secret.");
      return secret.toUpperCase().replace(/=+$/g, "");
    } catch {
      throw new Error("Invalid otpauth URI.");
    }
  }
  return trimmed.toUpperCase().replace(/=+$/g, "");
}

export async function generateTotp(
  secretB32: string,
  timeStepSeconds = 30,
  digits = 6,
  timestamp = Date.now(),
): Promise<{ code: string; secondsRemaining: number }> {
  const keyBytes = base32Decode(secretB32);
  const counter = Math.floor(timestamp / 1000 / timeStepSeconds);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, msg as BufferSource),
  );

  const offset = sig[sig.length - 1] & 0x0f;
  const binCode =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  const code = (binCode % 10 ** digits)
    .toString()
    .padStart(digits, "0");

  const elapsed = (timestamp / 1000) % timeStepSeconds;
  return {
    code,
    secondsRemaining: Math.ceil(timeStepSeconds - elapsed),
  };
}
