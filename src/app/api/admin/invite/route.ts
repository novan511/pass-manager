import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgAdmin, isSuperadmin } from "@/lib/auth";
import {
  db,
  findUserById,
  createUser,
  updateUser,
} from "@/lib/supabase/db";
import { handleApiError } from "@/lib/api";
import { categoriesToCsv } from "@/lib/categories";

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(256),
  /** Optional login categories to grant immediately (e.g. ["social"]). */
  allowedCategories: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const actor = await requireOrgAdmin();
    const body = schema.parse(await req.json());
    const email = body.email.trim().toLowerCase();
    const cats = categoriesToCsv(body.allowedCategories ?? ["personal"]) || "personal";

    if (!actor.organization_id) {
      return NextResponse.json(
        {
          error: isSuperadmin(actor)
            ? "Platform accounts must create a project first (Platform → New project)."
            : "You are not in an organization.",
        },
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
        // Already in this project — just update categories.
        const user = await updateUser(existing.id, {
          allowed_categories: existing.org_role === "owner" ? existing.allowed_categories : cats,
          status: "active",
        });
        return NextResponse.json({
          user: { id: user.id, email: user.email, orgRole: user.org_role },
          moved: true,
          categories: cats,
        });
      }
      if (existing.platform_role === "superadmin") {
        return NextResponse.json({ error: "Cannot invite a platform owner." }, { status: 400 });
      }
      const user = await updateUser(existing.id, {
        organization_id: org.id,
        org_role: "member",
        role: "member",
        status: "active",
        allowed_categories: cats,
      });
      return NextResponse.json({
        user: { id: user.id, email: user.email, orgRole: user.org_role },
        moved: true,
        categories: cats,
      });
    }

    const user = await createUser({
      email,
      platform_role: "user",
      org_role: "member",
      role: "member",
      status: "active",
      organization_id: org.id,
      allowed_categories: cats,
    });

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { error: authErr } = await admin.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
    });
    if (authErr && !/already/i.test(authErr.message)) {
      await db().from("users").delete().eq("id", user.id);
      return NextResponse.json({ error: authErr.message }, { status: 400 });
    }

    return NextResponse.json(
      {
        user: { id: user.id, email: user.email, orgRole: user.org_role },
        categories: cats,
        note: "Share the temporary password out-of-band. They must also get Team vault access if you stored shared logins there.",
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
