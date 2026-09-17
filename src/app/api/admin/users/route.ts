import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgAdmin, isSuperadmin } from "@/lib/auth";
import {
  db,
  findUserById,
  updateUser,
  updateMembership,
  addMembership,
} from "@/lib/supabase/db";
import { handleApiError } from "@/lib/api";
import { categoriesToCsv } from "@/lib/categories";

export async function GET() {
  try {
    const actor = await requireOrgAdmin();

    // Prefer membership table for the ACTIVE project.
    let memberRows: { user_id: string; org_role: string; allowed_categories: string; status: string }[] = [];
    if (actor.organization_id) {
      const { data, error } = await db()
        .from("organization_members")
        .select("user_id, org_role, allowed_categories, status")
        .eq("organization_id", actor.organization_id);
      if (error) throw new Error(error.message);
      memberRows = data ?? [];
    } else if (isSuperadmin(actor)) {
      const { data, error } = await db()
        .from("users")
        .select("id, org_role, allowed_categories, status")
        .eq("platform_role", "user");
      if (error) throw new Error(error.message);
      memberRows = (data ?? []).map((u) => ({
        user_id: u.id,
        org_role: u.org_role,
        allowed_categories: u.allowed_categories,
        status: u.status,
      }));
    }

    const userIds = memberRows.map((m) => m.user_id);
    const usersRes = userIds.length
      ? await db()
          .from("users")
          .select("id, email, role, org_role, platform_role, status, allowed_categories, organization_id, created_at")
          .in("id", userIds)
      : { data: [] as Record<string, unknown>[], error: null };
    if (usersRes.error) throw new Error(usersRes.error.message);

    const mapped = await Promise.all(
      (usersRes.data ?? []).map(async (u) => {
        const mem = memberRows.find((m) => m.user_id === u.id);
        const [{ count: itemCount }, { count: passkeyCount }] = await Promise.all([
          db()
            .from("vault_items")
            .select("id", { count: "exact", head: true })
            .eq("user_id", u.id as string),
          db()
            .from("credentials")
            .select("id", { count: "exact", head: true })
            .eq("user_id", u.id as string),
        ]);
        const cats = mem?.allowed_categories ?? u.allowed_categories ?? "";
        const role = mem?.org_role ?? u.org_role ?? "member";
        return {
          id: u.id as string,
          email: u.email as string,
          role: u.role as string,
          orgRole: role,
          platformRole: u.platform_role as string,
          status: (mem?.status as string) ?? (u.status as string),
          allowedCategories: String(cats)
            .split(",")
            .map((s: string) => s.trim().toLowerCase())
            .filter(Boolean),
          organizationId: u.organization_id as string | null,
          organization: null,
          createdAt: u.created_at as string,
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

    // Target must be a member of actor's active project (or superadmin edits anyone).
    let isMemberOfActorOrg = false;
    if (actor.organization_id) {
      const { data: mem } = await db()
        .from("organization_members")
        .select("id")
        .eq("organization_id", actor.organization_id)
        .eq("user_id", target.id)
        .maybeSingle();
      isMemberOfActorOrg = !!mem;
    }
    if (!isSuperadmin(actor)) {
      if (!actor.organization_id || !isMemberOfActorOrg) {
        return NextResponse.json({ error: "User is not in your organization." }, { status: 403 });
      }
      if (target.id === actor.id && (body.status === "revoked" || body.orgRole === "member")) {
        return NextResponse.json(
          { error: "You cannot revoke or demote yourself." },
          { status: 400 },
        );
      }
    }

    const patch: Record<string, string | null> = {};
    if (body.status) patch.status = body.status;
    if (body.orgRole) {
      patch.org_role = body.orgRole;
      patch.role = body.orgRole === "owner" ? "admin" : "member";
      if (body.orgRole === "owner") {
        patch.allowed_categories = "work,personal,finance,social,other";
      }
    }
    if (body.allowedCategories && body.orgRole !== "owner") {
      patch.allowed_categories = categoriesToCsv(body.allowedCategories) || "personal";
    }

    const updated = await updateUser(target.id, patch);

    // Sync membership row for the active project.
    const memOrgId = actor.organization_id ?? target.organization_id;
    if (memOrgId) {
      try {
        await updateMembership(memOrgId, target.id, {
          ...(body.orgRole ? { org_role: body.orgRole } : {}),
          ...(body.allowedCategories && body.orgRole !== "owner"
            ? { allowed_categories: updated.allowed_categories }
            : {}),
          ...(body.status ? { status: body.status } : {}),
        });
      } catch {
        await addMembership({
          organizationId: memOrgId,
          userId: target.id,
          orgRole: (updated.org_role as "owner" | "member") || "member",
          allowedCategories: updated.allowed_categories,
          status: updated.status,
        }).catch(() => {});
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
        allowedCategories: String(updated.allowed_categories || "")
          .split(",")
          .map((s: string) => s.trim().toLowerCase())
          .filter(Boolean),
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
