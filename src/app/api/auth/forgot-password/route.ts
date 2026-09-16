import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { handleApiError } from "@/lib/api";

const schema = z.object({ email: z.string().email() });

/** Supabase Auth password reset email (account login only). */
export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const email = body.email.trim().toLowerCase();
    const supabase = await createSupabaseServerClient();

    const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl}/reset-password`,
    });

    // Always return ok — do not reveal whether the email exists.
    if (error) {
      console.error("resetPasswordForEmail", error.message);
    }

    return NextResponse.json({
      ok: true,
      message:
        "If that email has an account, a reset link was sent (check spam). The vault master password is separate and cannot be reset here.",
    });
  } catch (err) {
    return handleApiError(err);
  }
}
