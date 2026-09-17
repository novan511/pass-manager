import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgAdmin, isSuperadmin } from "@/lib/auth";
import {
  db,
  findUserById,
  createUser,
  updateUser,
  addMembership,
} from "@/lib/supabase/db";
import { handleApiError } from "@/lib/api";
import { categoriesToCsv } from "@/lib/categories";

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(256),
  allowedCategories: z.array(z.string()).optional(),
});

/**
 * Invite adds a membership to the CURRENT project.
 * Does not remove the invitee's other projects/ownerships.
 */
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
            ? "Switch to a project first (project switcher), then invite."
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
      if (existing.platform_role === "superadmin" && existing.id !== actor.id) {
        return NextResponse.json({ error: "Cannot invite a platform owner." }, { status: 400 });
      }

      await addMembership({
        organizationId: org.id,
        userId: existing.id,
        orgRole: "member",
        allowedCategories: cats,
        status: "active",
      });

      let user = existing;
      if (!user.organization_id) {
        user = await updateUser(user.id, {
          organization_id: org.id,
          org_role: "member",
          role: "member",
          status: "active",
          allowed_categories: cats,
        });
      }

      return NextResponse.json({
        user: { id: user.id, email: user.email, orgRole: "member" },
        categories: cats,
        keptOtherProjects: !!existing.organization_id,
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
    await addMembership({
      organizationId: org.id,
      userId: user.id,
      orgRole: "member",
      allowedCategories: cats,
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
        note: "Share the temporary password out-of-band.",
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
