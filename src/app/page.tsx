import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { KeyRound, ArrowRight } from "lucide-react";

export default async function Home() {
  const user = await getSessionUser();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b hairline" style={{ background: "var(--surface)" }}>
        <div className="mx-auto max-w-3xl px-5 h-14 flex items-center justify-between">
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
        <section className="mx-auto max-w-3xl px-5 pt-16 pb-20 sm:pt-24">
          <p
            className="text-xs font-semibold tracking-[0.14em] uppercase mb-4"
            style={{ color: "var(--accent)" }}
          >
            Shared password vault
          </p>
          <h1
            className="text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.12]"
            style={{ color: "var(--ink)" }}
          >
            Your team&rsquo;s logins,
            <br className="hidden sm:block" /> encrypted end to end.
          </h1>
          <p
            className="mt-5 text-base leading-relaxed max-w-lg"
            style={{ color: "var(--muted)" }}
          >
            Keyring is a multi-project password manager. Owners invite members,
            share a team vault, and control which categories each person can use.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <Link href={user ? "/vault" : "/signup"} className="btn btn-primary sm:w-auto">
              {user ? "Go to your vault" : "Create your account"}
              <ArrowRight size={16} />
            </Link>
            <Link href={user ? "/vault" : "/login"} className="btn btn-secondary sm:w-auto">
              {user ? "Open app" : "Sign in"}
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t hairline">
        <div
          className="mx-auto max-w-3xl px-5 py-6 text-sm flex flex-wrap items-center justify-between gap-2"
          style={{ color: "var(--faint)" }}
        >
          <span>Keyring — for teams that need shared access without shared risk.</span>
        </div>
      </footer>
    </div>
  );
}
