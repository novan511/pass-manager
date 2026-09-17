"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VaultItemData, VaultProfileDTO } from "@/lib/crypto";
import {
  changeMasterPassword,
  createUserKeyPair,
  decryptItem,
  encryptItem,
  createOrgDek,
  randomBytes,
  setupVault,
  toB64,
  unlockPrivateKey,
  unlockWithPassword,
  unwrapDekWithPrf,
  unwrapOrgDek,
  wrapDekWithPrf,
  wrapOrgDekForUser,
} from "@/lib/crypto";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { Category } from "@/lib/categories";

export type DecryptedItem = VaultItemData & {
  id: string;
  updatedAt: string;
  favorite: boolean;
  category: string;
  /** Which vault this item lives in. */
  scope?: "personal" | "org";
};

export type VaultScope = "personal" | "org";

export type MembershipInfo = {
  organizationId: string;
  name: string;
  slug: string;
  status: string;
  orgRole: string;
  allowedCategories: string;
  isCurrent: boolean;
};

export type SessionUser = {
  id: string;
  email: string;
  displayName?: string | null;
  avatar?: string | null;
  role: string;
  orgRole?: string | null;
  platformRole?: string;
  organizationId?: string | null;
  organization?: { id: string; name: string; slug: string; status?: string } | null;
  allowedCategories?: string[];
  memberships?: MembershipInfo[];
};

/** PRF result may be ArrayBuffer or base64url string depending on browser JSON serialization. */
export function prfBytesToBuffer(value: unknown): ArrayBuffer | null {
  if (!value) return null;
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  }
  if (typeof value === "string") {
    const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  return null;
}

function isZeroBuffer(buf: ArrayBuffer): boolean {
  const u8 = new Uint8Array(buf);
  return u8.every((b) => b === 0);
}

export function getPrfFirst(ext: unknown): ArrayBuffer | null {
  if (!ext || typeof ext !== "object") return null;
  const prf = (ext as Record<string, unknown>).prf as
    | { results?: { first?: unknown } }
    | undefined;
  const raw = prf?.results?.first;
  const buf = prfBytesToBuffer(raw);
  if (!buf || isZeroBuffer(buf)) return null;
  return buf;
}

const IDLE_LOCK_KEY = "keyring-autolock-minutes";
const THEME_KEY = "keyring-theme";

export function getAutoLockMinutes(): number {
  if (typeof window === "undefined") return 15;
  const v = Number(localStorage.getItem(IDLE_LOCK_KEY) || "15");
  return Number.isFinite(v) && v > 0 ? v : 15;
}

export function setAutoLockMinutes(min: number) {
  localStorage.setItem(IDLE_LOCK_KEY, String(min));
}

export type ThemePref = "system" | "dark" | "light";

export function getThemePref(): ThemePref {
  if (typeof window === "undefined") return "system";
  const v = localStorage.getItem(THEME_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

export function resolveTheme(pref: ThemePref): "dark" | "light" {
  if (pref !== "system") return pref;
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(pref: ThemePref) {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.setAttribute("data-theme-pref", pref);
  localStorage.setItem(THEME_KEY, pref);
}

export function getTheme(): "dark" | "light" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

export function setTheme(theme: ThemePref) {
  applyTheme(theme);
}

/** React to OS preference changes while pref === "system". */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

type UseVaultResult = {
  user: SessionUser | null;
  loading: boolean;
  hasVault: boolean;
  unlocked: boolean;
  profile: VaultProfileDTO | null;
  passkeyCount: number;
  items: DecryptedItem[];
  orgItems: DecryptedItem[];
  hasOrgKey: boolean;
  error: string | null;
  busy: boolean;
  setupNewVault: (masterPassword: string) => Promise<void>;
  unlockPassword: (masterPassword: string) => Promise<void>;
  unlockPasskey: () => Promise<void>;
  lock: () => void;
  saveItem: (
    data: VaultItemData,
    opts?: { id?: string; favorite?: boolean; category?: string; scope?: VaultScope },
  ) => Promise<void>;
  deleteItem: (id: string, scope?: VaultScope) => Promise<void>;
  enrollPasskey: (deviceName?: string) => Promise<void>;
  changeMaster: (oldPw: string, newPw: string) => Promise<void>;
  shareOrgKeyWithMember: (memberId: string) => Promise<void>;
  /** Owner: create team vault if missing, then share with every ready member. */
  enableTeamVault: () => Promise<{ shared: number; skipped: number }>;
  refresh: () => Promise<void>;
  switchProject: (organizationId: string) => Promise<void>;
};

export function useVault(): UseVaultResult {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasVault, setHasVault] = useState(false);
  const [profile, setProfile] = useState<VaultProfileDTO | null>(null);
  const [passkeyCount, setPasskeyCount] = useState(0);
  const [items, setItems] = useState<DecryptedItem[]>([]);
  const [orgItems, setOrgItems] = useState<DecryptedItem[]>([]);
  const [hasOrgKey, setHasOrgKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dekRef = useRef<CryptoKey | null>(null);
  const orgDekRef = useRef<CryptoKey | null>(null);
  /** Kept only in memory while unlocked — needed to wrap org DEK for new members. */
  const masterPwRef = useRef<string | null>(null);
  const orgDekRawRef = useRef<Uint8Array | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lock = useCallback(() => {
    dekRef.current = null;
    orgDekRef.current = null;
    masterPwRef.current = null;
    orgDekRawRef.current = null;
    setUnlocked(false);
    setItems([]);
    setOrgItems([]);
    setHasOrgKey(false);
  }, []);

  const loadMeta = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const meRes = await fetch("/api/auth/me");
      const me = await meRes.json();
      if (!me.user) {
        setUser(null);
        setHasVault(false);
        return;
      }
      setUser(me.user);
      setHasVault(!!me.hasVault);
      setPasskeyCount(me.passkeyCount || 0);
      if (me.hasVault) {
        const pRes = await fetch("/api/vault/profile");
        const pData = await pRes.json();
        if (!pRes.ok) throw new Error(pData.error || "Could not load vault profile.");
        setProfile(pData.profile);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load account.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  // Idle auto-lock
  const touchIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    const mins = getAutoLockMinutes();
    idleTimer.current = setTimeout(() => {
      dekRef.current = null;
      orgDekRef.current = null;
      masterPwRef.current = null;
      orgDekRawRef.current = null;
      setUnlocked(false);
      setItems([]);
      setOrgItems([]);
      setHasOrgKey(false);
    }, mins * 60 * 1000);
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    const events = ["mousedown", "keydown", "mousemove", "touchstart", "scroll"] as const;
    const handler = () => touchIdle();
    touchIdle();
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [unlocked, touchIdle]);

  const decryptAll = useCallback(
    async (
      dek: CryptoKey,
      raw: {
        id: string;
        ciphertext: string;
        iv: string;
        updatedAt: string;
        category?: string;
      }[],
    ) => {
      const decrypted = await Promise.all(
        raw.map(async (row) => {
          const data = await decryptItem<VaultItemData & { favorite?: boolean }>(
            dek,
            row.ciphertext,
            row.iv,
          );
          return {
            ...data,
            type: "login" as const,
            id: row.id,
            updatedAt: row.updatedAt,
            favorite: !!data.favorite,
            category: row.category || "other",
          } as DecryptedItem;
        }),
      );
      return decrypted;
    },
    [],
  );

  const loadItems = useCallback(
    async (dek: CryptoKey) => {
      const res = await fetch("/api/vault/items");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load items.");
      const decrypted = await decryptAll(dek, data.items);
      setItems(decrypted.map((i) => ({ ...i, scope: "personal" as const })));
    },
    [decryptAll],
  );

  const loadOrgItems = useCallback(
    async (orgDek: CryptoKey) => {
      const res = await fetch("/api/org/items");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load shared items.");
      const decrypted = await decryptAll(orgDek, data.items);
      setOrgItems(decrypted.map((i) => ({ ...i, scope: "org" as const })));
    },
    [decryptAll],
  );

  /**
   * Ensure RSA identity key exists, then try to open the shared org DEK.
   * Returns the org DEK if available.
   */
  const unlockOrgVault = useCallback(
    async (masterPassword: string): Promise<{ dek: CryptoKey | null; raw: Uint8Array | null }> => {
      if (!profile) return { dek: null, raw: null };
      const iters = profile.kdfIterations ?? 310000;

      const keysRes = await fetch("/api/vault/keys");
      const keys = await keysRes.json();
      if (!keysRes.ok) throw new Error(keys.error || "Could not load identity keys.");

      let encryptedPrivateKey: string = keys.encryptedPrivateKey;
      if (!keys.hasKeyPair || !encryptedPrivateKey) {
        const kp = await createUserKeyPair(masterPassword, profile.kdfSalt, iters);
        const put = await fetch("/api/vault/keys", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(kp),
        });
        if (!put.ok) {
          const b = await put.json();
          throw new Error(b.error || "Could not save identity key.");
        }
        encryptedPrivateKey = kp.encryptedPrivateKey;
      }

      const privateKey = await unlockPrivateKey(
        masterPassword,
        profile.kdfSalt,
        iters,
        encryptedPrivateKey,
      );

      const wrapRes = await fetch("/api/org/key");
      const wrap = await wrapRes.json();
      if (!wrapRes.ok) throw new Error(wrap.error || "Could not load shared vault key.");
      if (!wrap.hasOrgKey || !wrap.encryptedOrgKey) {
        setHasOrgKey(false);
        return { dek: null, raw: null };
      }

      const orgDek = await unwrapOrgDek(wrap.encryptedOrgKey, privateKey);
      // Re-export raw for re-sharing to new members while unlocked.
      const rawBuf = await crypto.subtle.exportKey("raw", orgDek);
      const raw = new Uint8Array(rawBuf);
      setHasOrgKey(true);
      return { dek: orgDek, raw };
    },
    [profile],
  );

  const setupNewVault = useCallback(
    async (masterPassword: string) => {
      setBusy(true);
      setError(null);
      try {
        const { profile: newProfile, dek } = await setupVault(masterPassword);
        const res = await fetch("/api/vault/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newProfile),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not create vault.");
        setProfile(data.profile);
        setHasVault(true);
        dekRef.current = dek;
        masterPwRef.current = masterPassword;
        setUnlocked(true);
        setItems([]);
        setOrgItems([]);
        setHasOrgKey(false);

        // Enroll identity key + create shared org vault if this user owns an org.
        const iters = data.profile.kdfIterations ?? 310000;
        const kp = await createUserKeyPair(masterPassword, data.profile.kdfSalt, iters);
        await fetch("/api/vault/keys", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(kp),
        });

        const me = await fetch("/api/auth/me").then((r) => r.json());
        const isOwner =
          me?.user?.orgRole === "owner" || me?.user?.role === "admin";
        if (me?.user?.organizationId && isOwner) {
          const { dek: orgDek, raw } = await createOrgDek();
          const encrypted = await wrapOrgDekForUser(raw, kp.publicKey);
          await fetch("/api/org/key", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ encryptedOrgKey: encrypted }),
          });
          orgDekRef.current = orgDek;
          orgDekRawRef.current = raw;
          setHasOrgKey(true);
          setOrgItems([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Vault setup failed.");
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const unlockPassword = useCallback(
    async (masterPassword: string) => {
      if (!profile) throw new Error("No vault profile.");
      setBusy(true);
      setError(null);
      try {
        const dek = await unlockWithPassword(masterPassword, profile);
        dekRef.current = dek;
        masterPwRef.current = masterPassword;
        setUnlocked(true);
        await loadItems(dek);

        try {
          const org = await unlockOrgVault(masterPassword);
          orgDekRef.current = org.dek;
          orgDekRawRef.current = org.raw;
          if (org.dek) await loadOrgItems(org.dek);
          else setOrgItems([]);
        } catch {
          // Shared vault is optional — personal vault still works.
          setHasOrgKey(false);
          setOrgItems([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unlock failed.");
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [profile, loadItems, loadOrgItems, unlockOrgVault],
  );

  const unlockPasskey = useCallback(async () => {
    if (!profile?.passkeyPrfSalt || !profile.wrappedDekPasskey) {
      throw new Error("This vault has no passkey unlock yet.");
    }
    setBusy(true);
    setError(null);
    try {
      const optRes = await fetch("/api/webauthn/authenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prfSaltB64: profile.passkeyPrfSalt }),
      });
      const optData = await optRes.json();
      if (!optRes.ok) throw new Error(optData.error || "Could not start passkey.");

      const assertion = await startAuthentication({ optionsJSON: optData.options });
      const prfFirst = getPrfFirst(assertion.clientExtensionResults);
      if (!prfFirst) {
        throw new Error(
          "This passkey did not return an encryption key (PRF). Unlock with your master password.",
        );
      }

      const verifyRes = await fetch("/api/webauthn/authenticate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: assertion }),
      });
      if (!verifyRes.ok) {
        const v = await verifyRes.json();
        throw new Error(v.error || "Passkey verification failed.");
      }

      const dek = await unwrapDekWithPrf(prfFirst, profile.wrappedDekPasskey);
      dekRef.current = dek;
      setUnlocked(true);
      await loadItems(dek);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey unlock failed.");
      throw err;
    } finally {
      setBusy(false);
    }
  }, [profile, loadItems]);

  const saveItem = useCallback(
    async (
      data: VaultItemData,
      opts: {
        id?: string;
        favorite?: boolean;
        category?: string;
        scope?: VaultScope;
      } = {},
    ) => {
      const scope = opts.scope ?? "personal";
      const dek = scope === "org" ? orgDekRef.current : dekRef.current;
      if (!dek) {
        throw new Error(
          scope === "org"
            ? "Shared vault is locked or not shared with you yet."
            : "Vault is locked.",
        );
      }
      const category = (opts.category || "other").toLowerCase();
      setBusy(true);
      try {
        const payload = { ...data, type: "login" as const, favorite: !!opts.favorite };
        const { ciphertext, iv } = await encryptItem(dek, payload);
        const base = scope === "org" ? "/api/org/items" : "/api/vault/items";
        const res = await fetch(opts.id ? `${base}/${opts.id}` : base, {
          method: opts.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ciphertext, iv, category }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Could not save item.");
        if (scope === "org") await loadOrgItems(dek);
        else await loadItems(dek);
      } finally {
        setBusy(false);
      }
    },
    [loadItems, loadOrgItems],
  );

  const deleteItem = useCallback(
    async (id: string, scope: VaultScope = "personal") => {
      const dek = scope === "org" ? orgDekRef.current : dekRef.current;
      if (!dek) throw new Error("Vault is locked.");
      const base = scope === "org" ? "/api/org/items" : "/api/vault/items";
      const res = await fetch(`${base}/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Could not delete item.");
      }
      if (scope === "org") await loadOrgItems(dek);
      else await loadItems(dek);
    },
    [loadItems, loadOrgItems],
  );

  const enrollPasskey = useCallback(
    async (deviceName?: string) => {
      const dek = dekRef.current;
      if (!dek || !profile) throw new Error("Unlock the vault first.");
      setBusy(true);
      setError(null);
      try {
        const prfSaltB64 = toB64(randomBytes(32));

        // 1) Register the passkey (requests PRF support).
        const optRes = await fetch("/api/webauthn/register", { method: "POST" });
        const optData = await optRes.json();
        if (!optRes.ok) throw new Error(optData.error || "Could not start passkey setup.");

        const attestation = await startRegistration({ optionsJSON: optData.options });
        const verifyRes = await fetch("/api/webauthn/register", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            response: attestation,
            prfSaltB64,
            deviceName,
          }),
        });
        const verifyData = await verifyRes.json();
        if (!verifyRes.ok) throw new Error(verifyData.error || "Passkey registration failed.");

        // 2) Assertion with PRF eval — create() usually only reports `enabled`,
        //    the actual secret comes back from get() with an eval salt.
        const authOptRes = await fetch("/api/webauthn/authenticate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prfSaltB64 }),
        });
        const authOptData = await authOptRes.json();
        if (!authOptRes.ok) {
          throw new Error(authOptData.error || "Could not derive passkey encryption key.");
        }
        const assertion = await startAuthentication({ optionsJSON: authOptData.options });
        const prfFirst = getPrfFirst(assertion.clientExtensionResults);
        const authVerifyRes = await fetch("/api/webauthn/authenticate", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response: assertion }),
        });
        if (!authVerifyRes.ok) {
          const v = await authVerifyRes.json();
          throw new Error(v.error || "Passkey PRF verification failed.");
        }
        if (!prfFirst) {
          throw new Error(
            "This passkey does not support PRF (hmac-secret). Use a platform authenticator (Touch ID / Windows Hello) or a modern security key.",
          );
        }

        const wrapped = await wrapDekWithPrf(dek, prfFirst);
        const saveRes = await fetch("/api/vault/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...profile,
            wrappedDekPasskey: wrapped,
            passkeyPrfSalt: prfSaltB64,
          }),
        });
        const saveData = await saveRes.json();
        if (!saveRes.ok) throw new Error(saveData.error || "Could not save passkey wrap.");
        setProfile(saveData.profile);

        await loadMeta();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Passkey setup failed.");
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [profile, loadMeta],
  );

  const changeMaster = useCallback(
    async (oldPw: string, newPw: string) => {
      const dek = dekRef.current;
      if (!dek || !profile) throw new Error("Unlock the vault first.");
      setBusy(true);
      try {
        const next = await changeMasterPassword(dek, oldPw, newPw, profile);
        const res = await fetch("/api/vault/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not change master password.");
        setProfile(data.profile);
        // Re-seal RSA private key under the new KEK.
        const kp = await createUserKeyPair(newPw, data.profile.kdfSalt, data.profile.kdfIterations ?? 310000);
        await fetch("/api/vault/keys", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(kp),
        });
        masterPwRef.current = newPw;
        // Re-wrap org DEK for self if we still hold it in memory.
        if (orgDekRawRef.current) {
          const encrypted = await wrapOrgDekForUser(orgDekRawRef.current, kp.publicKey);
          await fetch("/api/org/key", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ encryptedOrgKey: encrypted }),
          });
        }
      } finally {
        setBusy(false);
      }
    },
    [profile],
  );

  /** Owner: RSA-wrap the in-memory org DEK for another member's public key. */
  const shareOrgKeyWithMember = useCallback(
    async (memberId: string) => {
      const raw = orgDekRawRef.current;
      const masterPassword = masterPwRef.current;
      if (!raw || !masterPassword || !profile) {
        throw new Error("Unlock the shared vault with your master password first.");
      }
      setBusy(true);
      try {
        const keysRes = await fetch("/api/vault/keys");
        const keys = await keysRes.json();
        if (!keysRes.ok || !keys.encryptedPrivateKey) {
          throw new Error("Your identity key is missing. Unlock again.");
        }
        const membersRes = await fetch("/api/org/members/keys");
        const members = await membersRes.json();
        if (!membersRes.ok) throw new Error(members.error || "Could not load members.");
        const member = (members.members as { id: string; publicKey: string | null }[]).find(
          (m) => m.id === memberId,
        );
        if (!member) throw new Error("Member not found.");
        if (!member.publicKey) {
          throw new Error(
            "This member has not set up their vault yet. Ask them to unlock once with their master password.",
          );
        }
        const encryptedOrgKey = await wrapOrgDekForUser(raw, member.publicKey);
        const put = await fetch("/api/org/key", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ encryptedOrgKey, targetUserId: memberId }),
        });
        const body = await put.json();
        if (!put.ok) throw new Error(body.error || "Could not share vault key.");
      } finally {
        setBusy(false);
      }
    },
    [profile],
  );

  /**
   * One-shot owner flow:
   * 1. Ensure identity key + org DEK exist
   * 2. Wrap DEK for self
   * 3. Share with every member who already has a public key
   */
  const enableTeamVault = useCallback(async () => {
    const masterPassword = masterPwRef.current;
    if (!masterPassword || !profile) {
      throw new Error("Unlock your vault with your master password first.");
    }
    setBusy(true);
    setError(null);
    try {
      const iters = profile.kdfIterations ?? 310000;
      const keysRes = await fetch("/api/vault/keys");
      const keys = await keysRes.json();
      let encryptedPrivateKey: string = keys.encryptedPrivateKey;
      let publicKeyB64: string = keys.publicKey;
      if (!keys.hasKeyPair || !encryptedPrivateKey || !publicKeyB64) {
        const kp = await createUserKeyPair(masterPassword, profile.kdfSalt, iters);
        const put = await fetch("/api/vault/keys", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(kp),
        });
        if (!put.ok) throw new Error("Could not save your identity key.");
        encryptedPrivateKey = kp.encryptedPrivateKey;
        publicKeyB64 = kp.publicKey;
      }

      let raw = orgDekRawRef.current;
      let orgDek = orgDekRef.current;
      if (!raw || !orgDek) {
        const created = await createOrgDek();
        raw = created.raw;
        orgDek = created.dek;
        orgDekRawRef.current = raw;
        orgDekRef.current = orgDek;
      }

      const selfWrap = await wrapOrgDekForUser(raw, publicKeyB64);
      const selfPut = await fetch("/api/org/key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encryptedOrgKey: selfWrap }),
      });
      if (!selfPut.ok) throw new Error("Could not save your team vault key.");
      setHasOrgKey(true);

      const membersRes = await fetch("/api/org/members/keys");
      const membersData = await membersRes.json();
      const members = (membersData.members ?? []) as {
        id: string;
        publicKey: string | null;
      }[];
      const meId = user?.id;
      let shared = 0;
      let skipped = 0;
      for (const m of members) {
        if (m.id === meId) continue;
        if (!m.publicKey) {
          skipped += 1;
          continue;
        }
        const enc = await wrapOrgDekForUser(raw, m.publicKey);
        const res = await fetch("/api/org/key", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ encryptedOrgKey: enc, targetUserId: m.id }),
        });
        if (res.ok) shared += 1;
        else skipped += 1;
      }

      await loadOrgItems(orgDek);
      return { shared, skipped };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enable team vault.");
      throw err;
    } finally {
      setBusy(false);
    }
  }, [profile, user?.id, loadOrgItems]);

  const refresh = useCallback(async () => {
    await loadMeta();
    if (dekRef.current) await loadItems(dekRef.current);
    // Re-try opening team vault (owner may have just shared).
    if (masterPwRef.current) {
      try {
        const org = await unlockOrgVault(masterPwRef.current);
        orgDekRef.current = org.dek;
        orgDekRawRef.current = org.raw;
        if (org.dek) await loadOrgItems(org.dek);
        else setOrgItems([]);
      } catch {
        setHasOrgKey(false);
      }
    }
  }, [loadMeta, loadItems, loadOrgItems, unlockOrgVault]);

  const switchProject = useCallback(
    async (organizationId: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/auth/memberships", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not switch project.");
        // Clear team state for the old project.
        orgDekRef.current = null;
        orgDekRawRef.current = null;
        setHasOrgKey(false);
        setOrgItems([]);
        await loadMeta();
        if (dekRef.current) await loadItems(dekRef.current);
        if (masterPwRef.current) {
          try {
            const org = await unlockOrgVault(masterPwRef.current);
            orgDekRef.current = org.dek;
            orgDekRawRef.current = org.raw;
            if (org.dek) await loadOrgItems(org.dek);
          } catch {
            setHasOrgKey(false);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Switch project failed.");
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [loadMeta, loadItems, loadOrgItems, unlockOrgVault],
  );

  return useMemo(
    () => ({
      user,
      loading,
      hasVault,
      unlocked,
      profile,
      passkeyCount,
      items,
      orgItems,
      hasOrgKey,
      error,
      busy,
      setupNewVault,
      unlockPassword,
      unlockPasskey,
      lock,
      saveItem,
      deleteItem,
      enrollPasskey,
      changeMaster,
      shareOrgKeyWithMember,
      enableTeamVault,
      refresh,
      switchProject,
    }),
    [
      user,
      loading,
      hasVault,
      unlocked,
      profile,
      passkeyCount,
      items,
      orgItems,
      hasOrgKey,
      error,
      busy,
      setupNewVault,
      unlockPassword,
      unlockPasskey,
      lock,
      saveItem,
      deleteItem,
      enrollPasskey,
      changeMaster,
      shareOrgKeyWithMember,
      enableTeamVault,
      refresh,
      switchProject,
    ],
  );
}
