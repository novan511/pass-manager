import { NextResponse } from "next/server";

/**
 * Password reset is handled by Supabase Auth on the client
 * (`/reset-password` + `supabase.auth.updateUser`).
 * This legacy token endpoint is intentionally disabled.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Use the reset link from email (Supabase Auth), or ask your project owner to reset your sign-in password.",
    },
    { status: 410 },
  );
}
