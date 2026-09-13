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
    return jsonError(400, first ? `${first.path.join(".")}: ${first.message}` : "Invalid input.");
  }
  console.error(err);
  return jsonError(500, "Something went wrong. Try again.");
}
