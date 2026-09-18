"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { KeyRound, Eye, EyeOff, Fingerprint, Loader2, Check, X } from "lucide-react";

type Mode = "login" | "signup";

function passwordChecks(pw: string) {
  return {
    length: pw.length >= 8,
    lower: /[a-z]/.test(pw),
    upper: /[A-Z]/.test(pw),
    other: /[^A-Za-z0-9]/.test(pw),
  };
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  const checks = useMemo(() => passwordChecks(password), [password]);
  const signupValid = checks.length && checks.lower && checks.upper && checks.other;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup" && !signupValid) {
        throw new Error("Password does not meet all requirements yet.");
      }
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      let data: { error?: string } = {};
      try {
        data = await res.json();
      } catch {
        /* non-JSON body */
      }
      if (!res.ok) {
        throw new Error(data.error || `Request failed (HTTP ${res.status}).`);
      }
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
        throw new Error(
          "Passkeys need Safari 16+ on iPhone (HTTPS). Or sign in with email + password.",
        );
      }
      if (!email.trim()) {
        throw new Error("Enter your email first, then tap the passkey button.");
      }

      const optRes = await fetch("/api/webauthn/authenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const optData = await optRes.json();
      if (!optRes.ok) throw new Error(optData.error || "Could not start passkey login.");

      const assertion = await startAuthentication({
        optionsJSON: optData.options,
        useBrowserAutofill: false,
      });

      const verifyRes = await fetch("/api/webauthn/authenticate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: assertion }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || "Passkey login failed.");

      router.push("/vault?passkey=1");
      router.refresh();
    } catch (err) {
      const name = (err as { name?: string })?.name || "";
      const msg = err instanceof Error ? err.message : "Passkey login failed.";
      if (name === "NotAllowedError") {
        setError(
          "Passkey was cancelled or timed out. Try again, or use email + password.",
        );
      } else if (name === "AbortError") {
        setError("Passkey prompt was dismissed. Try again.");
      } else if (msg.includes("NotAllowed") || msg.includes("not allowed")) {
        setError(
          "This device refused the passkey. On iPhone: Settings → Face ID & Passcodes, and use Safari on the same HTTPS domain where you registered it.",
        );
      } else {
        setError(msg);
      }
    } finally {
      setPasskeyBusy(false);
    }
  }

  const ruleList = [
    { key: "length", label: "At least 8 characters", ok: checks.length },
    { key: "upper", label: "Uppercase letter (A–Z)", ok: checks.upper },
    { key: "lower", label: "Lowercase letter (a–z)", ok: checks.lower },
    { key: "other", label: "Symbol or number (!@#$…)", ok: checks.other },
  ] as const;

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
            minLength={mode === "signup" ? 8 : 1}
            className="input pr-11"
            placeholder={mode === "signup" ? "Min. 8 characters" : "••••••••"}
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
          <ul className="mt-2.5 space-y-1.5" aria-label="Password requirements">
            {ruleList.map((rule) => (
              <li
                key={rule.key}
                className="flex items-center gap-2 text-xs"
                style={{ color: rule.ok ? "var(--ok)" : "var(--muted)" }}
              >
                <span
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full shrink-0"
                  style={{
                    background: rule.ok
                      ? "color-mix(in srgb, var(--ok) 18%, transparent)"
                      : "var(--surface-2)",
                    color: rule.ok ? "var(--ok)" : "var(--faint)",
                    border: `1px solid ${rule.ok ? "color-mix(in srgb, var(--ok) 40%, transparent)" : "var(--border)"}`,
                  }}
                  aria-hidden
                >
                  {rule.ok ? <Check size={11} strokeWidth={3} /> : <X size={10} strokeWidth={2.5} />}
                </span>
                {rule.label}
              </li>
            ))}
          </ul>
        )}

        {mode === "signup" && (
          <p className="mt-2 text-xs" style={{ color: "var(--faint)" }}>
            Used to sign in to Keyring. Your vault master password is set separately.
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

      <button
        type="submit"
        className="btn btn-primary w-full"
        disabled={busy || passkeyBusy || (mode === "signup" && !signupValid)}
      >
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
          <p className="text-xs text-center" style={{ color: "var(--faint)" }}>
            <Link href="/forgot-password" style={{ color: "var(--muted)" }} className="underline underline-offset-2">
              Forgot sign-in password?
            </Link>
          </p>
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
