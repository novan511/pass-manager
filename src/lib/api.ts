import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "@/lib/auth";

export function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export function handleApiError(err: unknown) {
  if (err instanceof AuthError) return jsonError(err.status, err.message);
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return jsonError(
      400,
      first ? `${first.path.join(".")}: ${first.message}` : "Invalid input.",
    );
  }

  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes("does not exist") && lower.includes("public.")) {
    return jsonError(
      500,
      "Supabase tables missing. Run supabase/schema.sql in the Supabase SQL Editor, then try again.",
    );
  }
  if (lower.includes("duplicate key") || lower.includes("unique constraint")) {
    return jsonError(409, "That record already exists. Try a different value or sign in instead.");
  }
  if (msg.includes("Supabase admin client is not configured") || lower.includes("service role")) {
    return jsonError(
      500,
      "SUPABASE_SERVICE_ROLE_KEY is missing or invalid on the server.",
    );
  }
  if (lower.includes("jwt") && lower.includes("invalid")) {
    return jsonError(
      500,
      "Supabase API keys are invalid. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  if (lower.includes("fetch failed") || lower.includes("network")) {
    return jsonError(
      500,
      "Cannot reach Supabase. Check your project status and env URLs.",
    );
  }

  console.error(err);
  // Surface a short technical hint so Vercel logs / users can diagnose.
  const hint = msg.length > 180 ? msg.slice(0, 180) + "…" : msg;
  return jsonError(500, `Something went wrong. ${hint}`);
}
