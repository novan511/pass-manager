/**
 * Zero-knowledge vault cryptography. Runs only in the browser.
 *
 * Hierarchy:
 *   master password --PBKDF2--> KEK --AES-GCM wrap--> DEK (random per vault)
 *   passkey (PRF)   --PRF----> KEK2 --AES-GCM wrap--> DEK (optional second wrap)
 *   DEK encrypts each vault item (AES-GCM, unique IV).
 * The server never sees the master password, KEK, or DEK.
 */

export const PBKDF2_ITERATIONS = 310_000;
const VERIFIER_PLAINTEXT = "keyring-vault-verifier-v1";

export type VaultProfileDTO = {
  kdfSalt: string;
  wrappedDek: string;
  verifier: string;
  wrappedDekPasskey?: string | null;
  passkeyPrfSalt?: string | null;
  kdfIterations?: number;
};

export type VaultItemData = {
  /** Kept for backward compatibility with older payloads; always "login". */
  type?: "login";
  name: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  totp?: string;
  favorite?: boolean;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

function getCrypto(): Crypto {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto API is unavailable. Use HTTPS or localhost.");
  }
  return crypto;
}

async function deriveKek(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await getCrypto().subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return getCrypto().subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt", "unwrapKey"],
  );
}

async function encryptWithKek(
  kek: CryptoKey,
  data: Uint8Array,
): Promise<string> {
  const iv = randomBytes(12);
  const ct = await getCrypto().subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    kek,
    data as BufferSource,
  );
  return `${toB64(iv)}.${toB64(ct)}`;
}

async function decryptWithKek(
  kek: CryptoKey,
  packed: string,
): Promise<Uint8Array> {
  const [ivB64, ctB64] = packed.split(".");
  if (!ivB64 || !ctB64) throw new Error("Corrupt encrypted payload.");
  const pt = await getCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivB64) as BufferSource },
    kek,
    fromB64(ctB64) as BufferSource,
  );
  return new Uint8Array(pt);
}

/** Create a brand-new vault: random DEK, wrapped by KEK derived from master password. */
export async function setupVault(masterPassword: string): Promise<{
  profile: VaultProfileDTO;
  dek: CryptoKey;
}> {
  const salt = randomBytes(16);
  const iterations = PBKDF2_ITERATIONS;
  const kek = await deriveKek(masterPassword, salt, iterations);

  const dekRaw = randomBytes(32);
  const dek = await getCrypto().subtle.importKey(
    "raw",
    dekRaw as BufferSource,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );

  const wrappedDek = await encryptWithKek(kek, dekRaw);
  const verifier = await encryptWithKek(
    kek,
    textEncoder.encode(VERIFIER_PLAINTEXT),
  );

  return {
    profile: {
      kdfSalt: toB64(salt),
      wrappedDek,
      verifier,
      kdfIterations: iterations,
    },
    dek,
  };
}

/** Verify master password and unwrap the DEK. */
export async function unlockWithPassword(
  masterPassword: string,
  profile: VaultProfileDTO,
): Promise<CryptoKey> {
  const salt = fromB64(profile.kdfSalt);
  const iterations = profile.kdfIterations ?? PBKDF2_ITERATIONS;
  const kek = await deriveKek(masterPassword, salt, iterations);

  try {
    const plain = await decryptWithKek(kek, profile.verifier);
    if (textDecoder.decode(plain) !== VERIFIER_PLAINTEXT) {
      throw new Error("mismatch");
    }
  } catch {
    throw new Error("Incorrect master password.");
  }

  const dekRaw = await decryptWithKek(kek, profile.wrappedDek);
  return getCrypto().subtle.importKey(
    "raw",
    dekRaw as BufferSource,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
}

/** Change master password: re-wrap the same DEK under a new KEK. */
export async function changeMasterPassword(
  dek: CryptoKey,
  oldPassword: string,
  newPassword: string,
  oldProfile: VaultProfileDTO,
): Promise<VaultProfileDTO> {
  // Ensure old password is correct first.
  await unlockWithPassword(oldPassword, oldProfile);

  const dekRaw = new Uint8Array(await getCrypto().subtle.exportKey("raw", dek));
  const salt = randomBytes(16);
  const kek = await deriveKek(newPassword, salt, PBKDF2_ITERATIONS);
  return {
    kdfSalt: toB64(salt),
    wrappedDek: await encryptWithKek(kek, dekRaw),
    verifier: await encryptWithKek(
      kek,
      textEncoder.encode(VERIFIER_PLAINTEXT),
    ),
    wrappedDekPasskey: oldProfile.wrappedDekPasskey ?? null,
    passkeyPrfSalt: oldProfile.passkeyPrfSalt ?? null,
    kdfIterations: PBKDF2_ITERATIONS,
  };
}

/** Derive a KEK from raw PRF bytes (WebAuthn hmac-secret extension). */
async function kekFromPrf(prfBytes: Uint8Array): Promise<CryptoKey> {
  // Stretch PRF output with HKDF-ish import via PBKDF2 using prf itself as IKM
  // is overkill; PRF output is already 32 bytes of high-entropy secret material.
  const baseKey = await getCrypto().subtle.importKey(
    "raw",
    prfBytes as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return getCrypto().subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: textEncoder.encode("keyring-prf-kek"),
      info: textEncoder.encode("vault-dek-wrap"),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt", "unwrapKey"],
  );
}

/**
 * After a WebAuthn ceremony whose assertion/registration returned PRF output,
 * wrap (or unwrap) the DEK with a KEK derived from that PRF secret.
 */
export async function wrapDekWithPrf(
  dek: CryptoKey,
  prfFirst: ArrayBuffer,
): Promise<string> {
  const kek = await kekFromPrf(new Uint8Array(prfFirst));
  const dekRaw = new Uint8Array(await getCrypto().subtle.exportKey("raw", dek));
  return encryptWithKek(kek, dekRaw);
}

export async function unwrapDekWithPrf(
  prfFirst: ArrayBuffer,
  wrappedDek: string,
): Promise<CryptoKey> {
  const kek = await kekFromPrf(new Uint8Array(prfFirst));
  const dekRaw = await decryptWithKek(kek, wrappedDek);
  return getCrypto().subtle.importKey(
    "raw",
    dekRaw as BufferSource,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function encryptItem(
  dek: CryptoKey,
  data: VaultItemData,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = randomBytes(12);
  const ct = await getCrypto().subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    dek,
    textEncoder.encode(JSON.stringify(data)),
  );
  return { ciphertext: toB64(ct), iv: toB64(iv) };
}

export async function decryptItem<T = VaultItemData>(
  dek: CryptoKey,
  ciphertext: string,
  iv: string,
): Promise<T> {
  const pt = await getCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(iv) as BufferSource },
    dek,
    fromB64(ciphertext) as BufferSource,
  );
  return JSON.parse(textDecoder.decode(pt)) as T;
}

/** Rough password strength 0–4 for UI meters. */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^\w\s]/.test(pw)) score++;
  if (pw.length < 8) return Math.min(score, 1) as 0 | 1;
  return Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;
}

/* ————— Shared org vault (zero-knowledge) —————
 * Each user has an RSA-OAEP keypair. The private key is wrapped under their
 * personal KEK (master password). The shared org DEK is RSA-encrypted for
 * each member's public key. The server never sees plaintext keys.
 */

export type UserKeyPairDTO = {
  publicKey: string; // SPKI base64
  encryptedPrivateKey: string; // AES-GCM(iv.ct)
};

/** Generate RSA-OAEP keypair; wrap private key under the user's KEK. */
export async function createUserKeyPair(
  masterPassword: string,
  kdfSaltB64: string,
  kdfIterations: number,
): Promise<UserKeyPairDTO> {
  const kp = await getCrypto().subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"],
  );
  const spki = await getCrypto().subtle.exportKey("spki", kp.publicKey);
  const pkcs8 = await getCrypto().subtle.exportKey("pkcs8", kp.privateKey);
  const kek = await deriveKek(masterPassword, fromB64(kdfSaltB64), kdfIterations);
  const encryptedPrivateKey = await encryptWithKek(kek, new Uint8Array(pkcs8));
  return {
    publicKey: toB64(spki),
    encryptedPrivateKey,
  };
}

/** Unlock the user's RSA private key with their master password. */
export async function unlockPrivateKey(
  masterPassword: string,
  kdfSaltB64: string,
  kdfIterations: number,
  encryptedPrivateKey: string,
): Promise<CryptoKey> {
  const kek = await deriveKek(masterPassword, fromB64(kdfSaltB64), kdfIterations);
  const pkcs8 = await decryptWithKek(kek, encryptedPrivateKey);
  return getCrypto().subtle.importKey(
    "pkcs8",
    pkcs8 as BufferSource,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
}

export async function importPublicKeySpki(spkiB64: string): Promise<CryptoKey> {
  return getCrypto().subtle.importKey(
    "spki",
    fromB64(spkiB64) as BufferSource,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
}

/** Create a new random org DEK and return raw bytes + CryptoKey. */
export async function createOrgDek(): Promise<{ dek: CryptoKey; raw: Uint8Array }> {
  const raw = randomBytes(32);
  const dek = await getCrypto().subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
  return { dek, raw };
}

/** RSA-encrypt the org DEK for a member's public key. */
export async function wrapOrgDekForUser(
  orgDekRaw: Uint8Array,
  memberPublicKeyB64: string,
): Promise<string> {
  const pub = await importPublicKeySpki(memberPublicKeyB64);
  const ct = await getCrypto().subtle.encrypt(
    { name: "RSA-OAEP" },
    pub,
    orgDekRaw as BufferSource,
  );
  return toB64(ct);
}

/** RSA-decrypt the org DEK with the user's private key. */
export async function unwrapOrgDek(
  encryptedOrgKeyB64: string,
  privateKey: CryptoKey,
): Promise<CryptoKey> {
  const raw = await getCrypto().subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    fromB64(encryptedOrgKeyB64) as BufferSource,
  );
  return getCrypto().subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
}

/** Import raw org DEK bytes as CryptoKey. */
export async function importOrgDekRaw(raw: Uint8Array): Promise<CryptoKey> {
  return getCrypto().subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
}
