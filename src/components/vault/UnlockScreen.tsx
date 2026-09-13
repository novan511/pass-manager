"use client";

import { useState } from "react";
import { Eye, EyeOff, Fingerprint, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { passwordStrength } from "@/lib/crypto";

const STRENGTH_LABEL = ["Too weak", "Weak", "Fair", "Good", "Strong"];

export function UnlockScreen({
  mode,
  hasPasskey,
  busy,
  error,
  onPassword,
  onPasskey,
}: {
  mode: "unlock" | "setup";
  hasPasskey: boolean;
  busy: boolean;
  error: string | null;
  onPassword: (password: string) => Promise<void>;
  onPasskey?: () => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (mode === "setup") {
      if (password.length < 10) {
        setLocalError("Use at least 10 characters.");
        return;
      }
      if (password !== confirm) {
        setLocalError("Passwords do not match.");
        return;
      }
    }
    try {
      await onPassword(password);
    } catch {
      /* surfaced via error prop */
    }
  }

  const score = passwordStrength(password);

  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <div className="keyhole" aria-hidden>
          <KeyRound size={26} style={{ color: "var(--accent)" }} />
        </div>
        <div className="card p-6 sm:p-7">
          <h1 className="text-xl font-semibold tracking-tight text-center">
            {mode === "setup" ? "Create your vault" : "Vault locked"}
          </h1>
          <p
            className="mt-1.5 mb-6 text-sm text-center leading-relaxed"
            style={{ color: "var(--muted)" }}
          >
            {mode === "setup"
              ? "This master password encrypts every secret on your device. We never see it — if you lose it, the vault cannot be recovered."
              : "Enter your master password to decrypt this vault on this device."}
          </p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label" htmlFor="master">
                Master password
              </label>
              <div className="relative">
                <input
                  id="master"
                  type={show ? "text" : "password"}
                  className="input pr-11 mono"
                  autoComplete={mode === "setup" ? "new-password" : "current-password"}
                  required
                  minLength={mode === "setup" ? 10 : 1}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  autoFocus
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm absolute right-1 top-1/2 -translate-y-1/2"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {mode === "setup" && password && (
                <>
                  <div className="strength" data-score={score} aria-hidden>
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {STRENGTH_LABEL[score]}
                  </p>
                </>
              )}
            </div>

            {mode === "setup" && (
              <div>
                <label className="label" htmlFor="confirm">
                  Confirm master password
                </label>
                <input
                  id="confirm"
                  type={show ? "text" : "password"}
                  className="input mono"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••••••"
                />
              </div>
            )}

            {(localError || error) && (
              <p
                className="text-sm rounded-lg px-3 py-2"
                style={{ color: "var(--danger)", background: "var(--danger-soft)" }}
                role="alert"
              >
                {localError || error}
              </p>
            )}

            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              {mode === "setup" ? "Encrypt my vault" : "Unlock vault"}
            </button>
          </form>

          {mode === "unlock" && hasPasskey && onPasskey && (
            <>
              <div className="flex items-center gap-3 text-xs my-4" style={{ color: "var(--faint)" }}>
                <span className="flex-1 h-px" style={{ background: "var(--border)" }} />
                or
                <span className="flex-1 h-px" style={{ background: "var(--border)" }} />
              </div>
              <button type="button" className="btn btn-secondary w-full" onClick={onPasskey} disabled={busy}>
                <Fingerprint size={16} />
                Unlock with Face ID / fingerprint
              </button>
            </>
          )}
        </div>
        <p
          className="mt-4 text-xs text-center leading-relaxed"
          style={{ color: "var(--faint)" }}
        >
          Encrypted with AES-256-GCM · Key derived via PBKDF2 (310k iterations)
        </p>
      </div>
    </div>
  );
}
