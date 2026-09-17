import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgAdmin, isSuperadmin } from "@/lib/auth";
import { db, findUserById, updateUser, findOrgById } from "@/lib/supabase/db";
import { handleApiError } from "@/lib/api";
import { categoriesToCsv, parseCategories } from "@/lib/categories";

export async function GET() {
  try {
    const actor = await requireOrgAdmin();
    let query = db()
      .from("users")
      .select(
        "id, email, role, org_role, platform_role, status, allowed_categories, organization_id, created_at, organizations(id, name, slug)",
      )
      .order("created_at", { ascending: true });

    if (!isSuperadmin(actor)) {
      query = query.eq("organization_id", actor.organization_id ?? "");
    }

    const { data: users, error } = await query;
    if (error) throw new Error(error.message);

    const mapped = await Promise.all(
      (users ?? []).map(async (u) => {
        const { count: itemCount } = await db()
          .from("vault_items")
          .select("id", { count: "exact", head: true })
          .eq("user_id", u.id);
        const { count: passkeyCount } = await db()
          .from("credentials")
          .select("id", { count: "exact", head: true })
          .eq("user_id", u.id);
        const org = Array.isArray(u.organizations) ? u.organizations[0] : u.organizations;
        return {
          id: u.id,
          email: u.email,
          role: u.role,
          orgRole: u.org_role,
          platformRole: u.platform_role,
          status: u.status,
          allowedCategories: parseCategories(u.allowed_categories),
          organizationId: u.organization_id,
          organization: org ? { id: org.id, name: org.name, slug: org.slug } : null,
          createdAt: u.created_at,
          itemCount: itemCount ?? 0,
          passkeyCount: passkeyCount ?? 0,
        };
      }),
    );

    return NextResponse.json({
      scope: isSuperadmin(actor) ? "platform" : "organization",
      users: mapped,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const patchSchema = z.object({
  userId: z.string().min(1),
  status: z.enum(["active", "revoked"]).optional(),
  orgRole: z.enum(["owner", "member"]).optional(),
  allowedCategories: z.array(z.string().min(1).max(40)).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireOrgAdmin();
    const body = patchSchema.parse(await req.json());
    const target = await findUserById(body.userId);
    if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });
    if (target.platform_role === "superadmin" && !isSuperadmin(actor)) {
      return NextResponse.json({ error: "Cannot edit a platform owner." }, { status: 403 });
    }
    if (!isSuperadmin(actor)) {
      if (!actor.organization_id || target.organization_id !== actor.organization_id) {
        return NextResponse.json({ error: "User is not in your organization." }, { status: 403 });
      }
      if (target.id === actor.id && (body.status === "revoked" || body.orgRole === "member")) {
        return NextResponse.json(
          { error: "You cannot revoke or demote yourself." },
          { status: 400 },
        );
      }
    }

    if (body.orgRole === "member" || body.status === "revoked") {
      const { count: owners } = await db()
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", target.organization_id ?? "")
        .eq("org_role", "owner")
        .eq("status", "active")
        .neq("id", target.id);
      if (target.org_role === "owner" && (owners ?? 0) === 0 && target.organization_id) {
        return NextResponse.json(
          { error: "An organization must keep at least one active owner." },
          { status: 400 },
        );
      }
    }

    const patch: Record<string, string | null> = {};
    if (body.status) patch.status = body.status;
    if (body.orgRole) {
      patch.org_role = body.orgRole;
      patch.role = body.orgRole === "owner" ? "admin" : "member";
      if (body.orgRole === "owner") patch.allowed_categories = "work,personal,finance,social,other";
    }
    if (body.allowedCategories && body.orgRole !== "owner") {
      patch.allowed_categories = categoriesToCsv(body.allowedCategories);
    }

    const updated = await updateUser(target.id, patch);
    if (body.status === "revoked") {
      try {
        await db().from("sessions").delete().eq("user_id", target.id);
      } catch {
        /* ignore */
      }
    }

    return NextResponse.json({
      user: {
        id: updated.id,
        email: updated.email,
        role: updated.role,
        orgRole: updated.org_role,
        platformRole: updated.platform_role,
        status: updated.status,
        allowedCategories: parseCategories(updated.allowed_categories),
        organizationId: updated.organization_id,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const deleteSchema = z.object({ userId: z.string().min(1) });

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireOrgAdmin();
    const body = deleteSchema.parse(await req.json());
    const target = await findUserById(body.userId);
    if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });
    if (target.platform_role === "superadmin") {
      return NextResponse.json({ error: "Cannot delete a platform owner." }, { status: 400 });
    }
    if (!isSuperadmin(actor)) {
      if (!actor.organization_id || target.organization_id !== actor.organization_id) {
        return NextResponse.json({ error: "User is not in your organization." }, { status: 403 });
      }
      if (target.id === actor.id) {
        return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
      }
    }
    const { error } = await db().from("users").delete().eq("id", target.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
