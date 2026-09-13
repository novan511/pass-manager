import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";
import { KeyRound } from "lucide-react";
import Link from "next/link";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
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
        <div className="card p-6">
          <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 mb-6 text-sm" style={{ color: "var(--muted)" }}>
            Sign in with your email, or use a passkey.
          </p>
          <AuthForm mode="login" />
        </div>
      </div>
    </div>
  );
}
