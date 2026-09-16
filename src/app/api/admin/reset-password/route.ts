import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireOrgAdmin, isSuperadmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { handleApiError } from "@/lib/api";

const schema = z.object({
  userId: z.string().min(1),
  newPassword: z.string().min(10).max(256).optional(),
});

function tempPassword(): string {
  const a = randomBytes(6).toString("base64url");
  const b = randomBytes(4).toString("base64url");
  return `Tmp-${a}-${b}`;
}

/**
 * Org owner / platform: reset a user's *account* login password via Supabase Auth.
 * Does not touch the vault master password.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireOrgAdmin();
    const body = schema.parse(await req.json());
    const target = await prisma.user.findUnique({ where: { id: body.userId } });
    if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });
    if (target.platformRole === "superadmin" && !isSuperadmin(actor)) {
      return NextResponse.json({ error: "Cannot reset a platform owner." }, { status: 403 });
    }
    if (!isSuperadmin(actor)) {
      if (!actor.organizationId || target.organizationId !== actor.organizationId) {
        return NextResponse.json({ error: "User is not in your organization." }, { status: 403 });
      }
    }
    if (!target.supabaseId) {
      return NextResponse.json(
        { error: "This user has not signed in with Supabase yet." },
        { status: 400 },
      );
    }

    const plain = body.newPassword || tempPassword();
    const admin = createSupabaseAdminClient();
    const { error } = await admin.auth.admin.updateUserById(target.supabaseId, {
      password: plain,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await prisma.session.deleteMany({ where: { userId: target.id } }).catch(() => {});
    await prisma.passwordReset.deleteMany({ where: { userId: target.id } }).catch(() => {});

    return NextResponse.json({
      ok: true,
      email: target.email,
      temporaryPassword: plain,
      note: "Share this sign-in password out-of-band. It does not change their vault master password.",
    });
  } catch (err) {
    return handleApiError(err);
  }
}
