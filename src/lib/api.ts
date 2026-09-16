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

  if (msg.includes("DATABASE_URL") || msg.includes("nonempty URL")) {
    return jsonError(
      500,
      "Server database is not configured. Set DATABASE_URL (Supabase Postgres Pooler URI) in environment variables.",
    );
  }
  if (msg.includes("Supabase admin client is not configured")) {
    return jsonError(
      500,
      "SUPABASE_SERVICE_ROLE_KEY is missing on the server. Set it in environment variables.",
    );
  }
  if (msg.toLowerCase().includes("can't reach database")) {
    return jsonError(
      500,
      "Cannot reach the database. Check DATABASE_URL / Supabase status.",
    );
  }

  console.error(err);
  // Include a short hint in production logs; keep client message specific when we can.
  return jsonError(500, "Something went wrong. Try again.");
}
