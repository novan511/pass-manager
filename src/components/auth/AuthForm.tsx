"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { KeyRound, Eye, EyeOff, Fingerprint, Loader2 } from "lucide-react";

type Mode = "login" | "signup";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed.");
      router.push("/vault");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function passkeyLogin() {
    setPasskeyBusy(true);
    setError(null);
    try {
      const { startAuthentication, browserSupportsPasskeys } = await import(
        "@simplewebauthn/browser"
      );
      if (!browserSupportsPasskeys()) {
        throw new Error("This browser does not support passkeys.");
      }
      const optRes = await fetch("/api/webauthn/authenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(email ? { email } : {}),
      });
      const optData = await optRes.json();
      if (!optRes.ok) throw new Error(optData.error || "Could not start passkey login.");

      const assertion = await startAuthentication({
        optionsJSON: optData.options,
      });

      const verifyRes = await fetch("/api/webauthn/authenticate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: assertion }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || "Passkey login failed.");

      // Session cookie is set by the verify endpoint. The vault page will offer
      // passkey unlock (PRF) when a passkey wrap exists.
      router.push("/vault?passkey=1");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey login failed.");
    } finally {
      setPasskeyBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          className="input"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          {mode === "signup" ? "Account password" : "Password"}
        </label>
        <div className="relative">
          <input
            id="password"
            type={show ? "text" : "password"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            minLength={mode === "signup" ? 10 : 1}
            className="input pr-11"
            placeholder={mode === "signup" ? "At least 10 characters" : "••••••••"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
        {mode === "signup" && (
          <p className="mt-1.5 text-xs" style={{ color: "var(--faint)" }}>
            This signs you into Keyring. Your vault master password is set separately.
          </p>
        )}
      </div>

      {error && (
        <p
          className="text-sm rounded-lg px-3 py-2"
          style={{ color: "var(--danger)", background: "var(--danger-soft)" }}
          role="alert"
        >
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary w-full" disabled={busy || passkeyBusy}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
        {mode === "signup" ? "Create account" : "Sign in"}
      </button>

      {mode === "login" && (
        <>
          <div className="flex items-center gap-3 text-xs" style={{ color: "var(--faint)" }}>
            <span className="flex-1 h-px" style={{ background: "var(--border)" }} />
            or
            <span className="flex-1 h-px" style={{ background: "var(--border)" }} />
          </div>
          <button
            type="button"
            className="btn btn-secondary w-full"
            onClick={passkeyLogin}
            disabled={busy || passkeyBusy}
          >
            {passkeyBusy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Fingerprint size={16} />
            )}
            Continue with passkey
          </button>
        </>
      )}

      <p className="text-sm text-center pt-1" style={{ color: "var(--muted)" }}>
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" style={{ color: "var(--accent)" }} className="font-medium">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/signup" style={{ color: "var(--accent)" }} className="font-medium">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
