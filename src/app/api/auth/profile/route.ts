import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api";

const schema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  /** data:image/...;base64,.... — optional; empty string clears avatar */
  avatar: z
    .string()
    .max(280_000, "Avatar too large (max ~200KB).")
    .refine(
      (v) => v === "" || v.startsWith("data:image/"),
      "Avatar must be an image data URL.",
    )
    .optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({
      displayName: user.displayName,
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
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(body.displayName !== undefined ? { displayName: body.displayName.trim() || null } : {}),
        ...(body.avatar !== undefined ? { avatar: body.avatar || null } : {}),
      },
      select: { id: true, displayName: true, avatar: true, email: true },
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
