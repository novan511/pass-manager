import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import {
  ShieldCheck,
  Fingerprint,
  KeyRound,
  ScanLine,
  ArrowRight,
} from "lucide-react";

export default async function Home() {
  const user = await getSessionUser();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b hairline" style={{ background: "var(--surface)" }}>
        <div
          className="mx-auto max-w-5xl px-5 h-14 flex items-center justify-between"
        >
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
            >
              <KeyRound size={15} />
            </span>
            Keyring
          </div>
          <nav className="flex items-center gap-2">
            {user ? (
              <Link href="/vault" className="btn btn-primary btn-sm">
                Open vault <ArrowRight size={14} />
              </Link>
            ) : (
              <>
                <Link href="/login" className="btn btn-ghost btn-sm">
                  Sign in
                </Link>
                <Link href="/signup" className="btn btn-primary btn-sm">
                  Create account
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-5 pt-16 pb-14">
          <p
            className="text-xs font-semibold tracking-[0.14em] uppercase mb-4"
            style={{ color: "var(--accent)" }}
          >
            Zero-knowledge vault
          </p>
          <h1
            className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.1] max-w-2xl"
            style={{ color: "var(--ink)" }}
          >
            Passwords your server can&rsquo;t read.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed" style={{ color: "var(--muted)" }}>
            Keyring encrypts every secret on your device before it leaves the
            browser. Share access by email, unlock with Face&nbsp;ID,
            fingerprint, or your master password — and fill logins anywhere with
            the browser extension.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={user ? "/vault" : "/signup"} className="btn btn-primary">
              {user ? "Go to your vault" : "Set up your vault"}
              <ArrowRight size={16} />
            </Link>
            <Link href={user ? "/vault" : "/login"} className="btn btn-secondary">
              {user ? "Open app" : "Sign in"}
            </Link>
          </div>
        </section>

        <section className="border-t hairline" style={{ background: "var(--surface)" }}>
          <div className="mx-auto max-w-5xl px-5 py-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              {
                icon: ShieldCheck,
                title: "Client-side encryption",
                body: "AES-256-GCM with a key derived from your master password. The server only stores ciphertext.",
              },
              {
                icon: Fingerprint,
                title: "Passkey unlock",
                body: "Register Face ID or a fingerprint passkey. A hardware PRF secret wraps your vault key — never the password itself.",
              },
              {
                icon: ScanLine,
                title: "Built-in TOTP",
                body: "Store authenticator codes next to each login. Codes are generated on-device from the encrypted secret.",
              },
              {
                icon: KeyRound,
                title: "Generator & autofill",
                body: "Strong passwords and passphrases on demand, plus a Chrome extension that fills forms straight from your vault.",
              },
            ].map((f) => (
              <div key={f.title} className="card p-5">
                <f.icon size={18} style={{ color: "var(--accent)" }} />
                <h3 className="mt-3 font-semibold text-[0.95rem]">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t hairline">
        <div
          className="mx-auto max-w-5xl px-5 py-6 text-sm flex flex-wrap items-center justify-between gap-2"
          style={{ color: "var(--faint)" }}
        >
          <span>Keyring — encrypted for people you trust, opaque to everyone else.</span>
          <span className="mono text-xs">AES-256-GCM · PBKDF2 · WebAuthn</span>
        </div>
      </footer>
    </div>
  );
}
