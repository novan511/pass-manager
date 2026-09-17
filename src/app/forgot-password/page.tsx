"use client";

import { useState } from "react";
import Link from "next/link";
import { KeyRound, Loader2, Mail } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // MUST run in the browser so the PKCE code_verifier is stored
      // in THIS browser's cookies. Server-side call → "Auth session missing".
      const supabase = createSupabaseBrowserClient();
      const { error: err } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        {
          redirectTo: `${window.location.origin}/reset-password`,
        },
      );
      if (err) {
        if (err.message.toLowerCase().includes("rate") || err.message.toLowerCase().includes("too many")) {
          throw new Error("Too many attempts. Wait a minute and try again.");
        }
        throw new Error(err.message || "Could not send reset email.");
      }
      setDone(true);
      setMessage(
        "If that email has an account, a reset link was sent. Open it in this same browser within ~1 hour.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
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
            <h1 className="text-xl font-semibold tracking-tight">Forgot password?</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Reset your <strong>sign-in</strong> password. Your vault master password is
              never sent to the server and cannot be reset here.
            </p>
          </div>

          {!done ? (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="label" htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  required
                  className="input"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </div>
              {error && (
                <p className="text-sm rounded-lg px-3 py-2" style={{ color: "var(--danger)", background: "var(--danger-soft)" }} role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="btn btn-primary w-full" disabled={busy}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                Send reset link
              </button>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-sm" style={{ color: "var(--ok)" }}>{message}</p>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                Check <strong>Spam</strong>. Open the link in <strong>this same browser</strong>.
                No email? Ask your project owner: Team → Reset password.
              </p>
            </div>
          )}

          <p className="text-sm text-center pt-1" style={{ color: "var(--muted)" }}>
            <Link href="/login" style={{ color: "var(--accent)" }} className="font-medium">
              Back to sign in
            </Link>
          </p>
        </div>
        <p className="mt-4 text-xs text-center" style={{ color: "var(--faint)" }}>
          Lost master password = vault cannot be recovered (by design).
        </p>
      </div>
    </div>
  );
}
