import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * PKCE callback for Supabase recovery links.
 * Exchanges ?code= and copies session cookies onto the redirect response.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/reset-password";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/reset-password";

  if (code) {
    let supabaseResponse = NextResponse.next({ request });
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value),
            );
            supabaseResponse = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options),
            );
          },
        },
      },
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("auth/callback exchange", error.message);
      return NextResponse.redirect(
        `${origin}/reset-password?error=${encodeURIComponent(error.message)}`,
      );
    }

    // Redirect but keep Set-Cookie from the exchange.
    const redirect = NextResponse.redirect(`${origin}${safeNext}`);
    supabaseResponse.cookies.getAll().forEach((c) => {
      redirect.cookies.set(c);
    });
    return redirect;
  }

  return NextResponse.redirect(`${origin}${safeNext}`);
}
