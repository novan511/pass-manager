import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * OAuth / PKCE callback (used by Supabase recovery emails).
 * Exchanges ?code= for a session cookie, then continues to /reset-password.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/reset-password";
  const safeNext = next.startsWith("/") ? next : "/reset-password";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("auth/callback exchange", error.message);
      return NextResponse.redirect(
        `${origin}/reset-password?error=${encodeURIComponent(error.message)}`,
      );
    }
  }

  return NextResponse.redirect(`${origin}${safeNext}`);
}
