"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { KeyRound, Loader2, Eye, EyeOff } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function ResetForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Checking reset link…");
  const started = useRef(false);

  const finish = useCallback(() => {
    setReady(true);
    setStatus("");
    setError(null);
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (cancelled) return;
        if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
          if (session) finish();
        }
      },
    );

    async function boot() {
      try {
        // A) Already have a recovery session.
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          if (!cancelled) finish();
          return;
        }

        // B) PKCE code in query (…/reset-password?code=...)
        const code = new URLSearchParams(window.location.search).get("code");
        if (code) {
          setStatus("Activating recovery session…");
          const { error: exchangeErr } =
            await supabase.auth.exchangeCodeForSession(window.location.href);
          if (exchangeErr) {
            console.error("exchangeCodeForSession", exchangeErr);
            if (!cancelled) {
              setError(
                "Reset link could not be activated (expired or already used). Request a new one.",
              );
              setReady(true);
            }
            return;
          }
        } else {
          // C) Implicit hash tokens (#access_token=...&type=recovery)
          const hash = window.location.hash.replace(/^#/, "");
          if (hash.includes("access_token") || hash.includes("refresh_token")) {
            setStatus("Reading recovery token…");
            const params = new URLSearchParams(hash);
            const access_token = params.get("access_token");
            const refresh_token = params.get("refresh_token");
            const type = params.get("type");
            if (access_token && refresh_token) {
              const { error: setErr } = await supabase.auth.setSession({
                access_token,
                refresh_token,
              });
              if (setErr) {
                console.error("setSession", setErr);
              } else if (!type || type === "recovery") {
                if (!cancelled) finish();
                return;
              }
            }
          } else {
            // Wait a beat for detectSessionInUrl to parse if any.
            await new Promise((r) => setTimeout(r, 500));
          }
        }

        const { data: { session: finalSession } } = await supabase.auth.getSession();
        if (cancelled) return;
        if (finalSession) finish();
        else {
          setError(
            "No valid reset session. Open the latest email link again in this browser, or request a new link.",
          );
          setReady(true);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setError("Could not start recovery. Request a new reset link.");
          setReady(true);
        }
      }
    }

    boot();
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [finish]);

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
      const { data, error: updateErr } = await supabase.auth.updateUser({
        password,
      });
      if (updateErr) {
        if (updateErr.message.toLowerCase().includes("session")) {
          throw new Error(
            "Auth session missing — open the reset email link again (same browser), then set the password immediately.",
          );
        }
        throw new Error(updateErr.message);
      }
      if (!data.user) throw new Error("No recovery session. Open the email link again.");
      await supabase.auth.signOut();
      setOk(true);
      setTimeout(() => router.push("/login"), 1200);
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
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="animate-spin" size={20} style={{ color: "var(--muted)" }} />
              <p className="text-xs text-center" style={{ color: "var(--faint)" }}>{status}</p>
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
                <p
                  className="text-sm rounded-lg px-3 py-2"
                  style={{ color: "var(--danger)", background: "var(--danger-soft)" }}
                  role="alert"
                >
                  {error}
                </p>
              )}
              <button type="submit" className="btn btn-primary w-full" disabled={busy}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                Update password
              </button>
            </form>
          )}

          {error && ready && !ok && (
            <p className="text-sm text-center" style={{ color: "var(--muted)" }}>
              <Link href="/forgot-password" style={{ color: "var(--accent)" }}>
                Request a new reset link
              </Link>
            </p>
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
