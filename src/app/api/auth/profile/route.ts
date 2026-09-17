import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db, updateUser } from "@/lib/supabase/db";
import { handleApiError } from "@/lib/api";

const schema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  avatar: z
    .string()
    .max(280_000, "Avatar too large (max ~200KB).")
    .refine((v) => v === "" || v.startsWith("data:image/"), "Avatar must be an image data URL.")
    .optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({
      displayName: user.display_name,
      avatar: user.avatar,
      email: user.email,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = schema.parse(await req.json());
    const patch: Record<string, string | null> = {};
    if (body.displayName !== undefined) patch.display_name = body.displayName.trim() || null;
    if (body.avatar !== undefined) patch.avatar = body.avatar || null;
    const updated = await updateUser(user.id, patch);
    return NextResponse.json({
      displayName: updated.display_name,
      avatar: updated.avatar,
      email: updated.email,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
