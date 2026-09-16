import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { handleApiError } from "@/lib/api";
import { requestOrigin } from "@/lib/auth";

const schema = z.object({ email: z.string().email() });

/** Supabase Auth password reset email (account login only). */
export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const email = body.email.trim().toLowerCase();
    const supabase = await createSupabaseServerClient();

    // Prefer live request origin so localhost dev links hit localhost,
    // and production hits the Vercel domain. Use /auth/callback for PKCE exchange.
    const origin = requestOrigin(req).replace(/\/$/, "");
    const redirectTo = `${origin}/auth/callback?next=/reset-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
      captchaToken: undefined,
    });

    if (error) {
      console.error("resetPasswordForEmail", error.message);
      // Surface Supabase config/rate-limit issues — not whether the email exists.
      const msg = error.message.toLowerCase();
      if (msg.includes("rate") || msg.includes("too many")) {
        return NextResponse.json(
          { error: "Too many reset requests. Wait a minute and try again." },
          { status: 429 },
        );
      }
      if (msg.includes("redirect") || msg.includes("url")) {
        return NextResponse.json(
          {
            error:
              "Reset email blocked: this URL is not allowed in Supabase Auth → URL Configuration. Add it to Redirect URLs.",
          },
          { status: 400 },
        );
      }
      // Still generic success path for unknown errors so we don't leak accounts.
    }

    return NextResponse.json({
      ok: true,
      message:
        "If that email has an account, a reset link was sent (check spam). Link is valid ~1 hour and must be opened on this same site.",
      redirectTo,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
