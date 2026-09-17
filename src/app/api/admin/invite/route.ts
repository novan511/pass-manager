import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgAdmin, isSuperadmin } from "@/lib/auth";
import {
  db,
  newId,
  nowIso,
  findUserById,
  createUser,
  updateUser,
} from "@/lib/supabase/db";
import { handleApiError } from "@/lib/api";

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(256),
});

export async function POST(req: NextRequest) {
  try {
    const actor = await requireOrgAdmin();
    const body = schema.parse(await req.json());
    const email = body.email.trim().toLowerCase();

    if (!actor.organization_id && !isSuperadmin(actor)) {
      return NextResponse.json({ error: "You are not in an organization." }, { status: 400 });
    }
    if (!actor.organization_id) {
      return NextResponse.json(
        { error: "Platform accounts must create a project first (Platform → New project)." },
        { status: 400 },
      );
    }

    const { data: org, error: orgErr } = await db()
      .from("organizations")
      .select("*")
      .eq("id", actor.organization_id)
      .maybeSingle();
    if (orgErr) throw new Error(orgErr.message);
    if (!org || org.status !== "active") {
      return NextResponse.json({ error: "Organization is not active." }, { status: 403 });
    }

    const { data: existing, error: exErr } = await db()
      .from("users")
      .select("*")
      .eq("email", email)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);

    if (existing) {
      if (existing.organization_id === org.id) {
        return NextResponse.json({ error: "This email is already in your project." }, { status: 409 });
      }
      if (existing.platform_role === "superadmin") {
        return NextResponse.json({ error: "Cannot invite a platform owner." }, { status: 400 });
      }
      const user = await updateUser(existing.id, {
        organization_id: org.id,
        org_role: "member",
        role: "member",
        status: "active",
        allowed_categories: "personal",
      });
      return NextResponse.json({
        user: { id: user.id, email: user.email, orgRole: user.org_role },
        moved: true,
      });
    }

    const user = await createUser({
      email,
      platform_role: "user",
      org_role: "member",
      role: "member",
      status: "active",
      organization_id: org.id,
      allowed_categories: "personal",
    });
    // Note: invite does not create Supabase Auth user — owner should also create
    // the auth account, or user signs up with same email after being moved.
    // For password-based invite, create Supabase auth user too:
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    await admin.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
    });

    return NextResponse.json(
      {
        user: { id: user.id, email: user.email, orgRole: user.org_role },
        note: "Share the temporary password with them out-of-band.",
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
