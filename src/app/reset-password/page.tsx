"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { KeyRound, Loader2, Eye, EyeOff } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [ready, setReady] = useState(false);

  // Supabase recovery link puts tokens in the URL hash / query.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        setReady(true);
        return;
      }
      // Exchange recovery tokens from the URL if present.
      const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(
        window.location.href,
      );
      if (exchangeErr) {
        // Hash-based PKCE flow (older links)
        setError(
          "This reset link is invalid or expired. Request a new one from Forgot password.",
        );
      }
      setReady(true);
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateErr } = await supabase.auth.updateUser({
        password,
      });
      if (updateErr) throw new Error(updateErr.message);
      setOk(true);
      setTimeout(() => router.push("/login"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="flex items-center justify-center gap-2 font-semibold tracking-tight mb-8"
        >
          <span
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            <KeyRound size={16} />
          </span>
          Keyring
        </Link>
        <div className="card p-6 space-y-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Set new sign-in password</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              This only changes how you sign in to Keyring. Your vault master password stays the same.
            </p>
          </div>

          {!ready ? (
            <div className="flex justify-center py-6">
              <Loader2 className="animate-spin" size={20} style={{ color: "var(--muted)" }} />
            </div>
          ) : ok ? (
            <p className="text-sm" style={{ color: "var(--ok)" }}>
              Password updated. Redirecting to sign in…
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="label" htmlFor="pw">New password</label>
                <div className="relative">
                  <input
                    id="pw"
                    type={show ? "text" : "password"}
                    className="input pr-11 mono"
                    required
                    minLength={10}
                    autoComplete="new-password"
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
              </div>
              <div>
                <label className="label" htmlFor="cf">Confirm password</label>
                <input
                  id="cf"
                  type={show ? "text" : "password"}
                  className="input mono"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              {error && (
                <p className="text-sm rounded-lg px-3 py-2" style={{ color: "var(--danger)", background: "var(--danger-soft)" }} role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="btn btn-primary w-full" disabled={busy}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Update password
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <ResetForm />
    </Suspense>
  );
}
