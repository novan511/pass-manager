import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperadmin } from "@/lib/auth";
import { db, newId, nowIso, createOrganization, createUser, updateUser, findUserByEmail, findOrgBySlug } from "@/lib/supabase/db";
import { handleApiError } from "@/lib/api";

export async function GET() {
  try {
    await requireSuperadmin();

    const { data: orgs, error } = await db()
      .from("organizations")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const result = await Promise.all(
      (orgs ?? []).map(async (org) => {
        const { data: users } = await db()
          .from("users")
          .select("id, email, org_role, platform_role, status, created_at")
          .eq("organization_id", org.id);

        const owners: unknown[] = [];
        const members: unknown[] = [];
        let itemCount = 0;
        let passkeyCount = 0;

        for (const u of users ?? []) {
          const { count: ic } = await db()
            .from("vault_items")
            .select("id", { count: "exact", head: true })
            .eq("user_id", u.id);
          const { count: pc } = await db()
            .from("credentials")
            .select("id", { count: "exact", head: true })
            .eq("user_id", u.id);
          itemCount += ic ?? 0;
          passkeyCount += pc ?? 0;
          const row = {
            id: u.id,
            email: u.email,
            status: u.status,
            itemCount: ic ?? 0,
            passkeyCount: pc ?? 0,
            createdAt: u.created_at,
          };
          if (u.org_role === "owner") owners.push(row);
          else members.push(row);
        }

        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          status: org.status,
          createdAt: org.created_at,
          itemCount,
          passkeyCount,
          owners,
          members,
        };
      }),
    );

    return NextResponse.json({
      zeroKnowledge: true,
      note: "Platform sees structure only. Passwords stay encrypted on user devices.",
      organizations: result,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const createSchema = z.object({
  name: z.string().min(2).max(80),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(10).max(256).optional(),
});

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "org"
  );
}

export async function POST(req: NextRequest) {
  try {
    await requireSuperadmin();
    const body = createSchema.parse(await req.json());
    const ownerEmail = body.ownerEmail.trim().toLowerCase();

    let slug = slugify(body.name);
    if (await findOrgBySlug(slug)) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    const existingOwner = await findUserByEmail(ownerEmail);
    if (existingOwner && !body.ownerPassword) {
      if (existingOwner.platform_role === "superadmin") {
        return NextResponse.json(
          { error: "Use a different email for the project owner." },
          { status: 400 },
        );
      }
      const org = await createOrganization(body.name.trim(), slug);
      await updateUser(existingOwner.id, {
        organization_id: org.id,
        org_role: "owner",
        role: "admin",
        status: "active",
      });
      return NextResponse.json(
        { organization: org, owner: { id: existingOwner.id, email: ownerEmail } },
        { status: 201 },
      );
    }

    if (!body.ownerPassword) {
      return NextResponse.json(
        { error: "ownerPassword is required for a new owner email." },
        { status: 400 },
      );
    }
    if (existingOwner) {
      return NextResponse.json(
        { error: "Email already exists. Use attach mode without a password, or pick another email." },
        { status: 409 },
      );
    }

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: body.ownerPassword,
      email_confirm: true,
    });
    if (createErr || !created.user) {
      return NextResponse.json(
        { error: createErr?.message || "Could not create owner auth user." },
        { status: 400 },
      );
    }

    const org = await createOrganization(body.name.trim(), slug);
    const owner = await createUser({
      supabase_id: created.user.id,
      email: ownerEmail,
      platform_role: "user",
      org_role: "owner",
      role: "admin",
      status: "active",
      organization_id: org.id,
      allowed_categories: "work,personal,finance,social,other",
    });

    return NextResponse.json(
      {
        organization: org,
        owner: { id: owner.id, email: owner.email },
        note: "Share the owner password with your customer out-of-band.",
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}

const patchSchema = z.object({
  organizationId: z.string().min(1),
  status: z.enum(["active", "suspended"]).optional(),
  name: z.string().min(2).max(80).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    await requireSuperadmin();
    const body = patchSchema.parse(await req.json());
    const patch: Record<string, string> = { updated_at: nowIso() };
    if (body.status) patch.status = body.status;
    if (body.name) patch.name = body.name.trim();

    const { data: org, error } = await db()
      .from("organizations")
      .update(patch)
      .eq("id", body.organizationId)
      .select()
      .single();
    if (error) throw new Error(error.message);

    if (body.status === "suspended") {
      const { data: users } = await db()
        .from("users")
        .select("id")
        .eq("organization_id", org.id);
      // Sessions are Supabase Auth — nothing to delete in our tables.
      void users;
    }
    return NextResponse.json({ organization: { id: org.id, name: org.name, status: org.status } });
  } catch (err) {
    return handleApiError(err);
  }
}

const deleteSchema = z.object({
  organizationId: z.string().min(1),
  confirmName: z.string().min(1),
});

export async function DELETE(req: NextRequest) {
  try {
    await requireSuperadmin();
    const body = deleteSchema.parse(await req.json());

    const { data: org } = await db()
      .from("organizations")
      .select("*")
      .eq("id", body.organizationId)
      .maybeSingle();
    if (!org) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    if (org.name.trim() !== body.confirmName.trim()) {
      return NextResponse.json(
        { error: "Type the project name exactly to confirm deletion." },
        { status: 400 },
      );
    }

    const { data: users } = await db()
      .from("users")
      .select("id, platform_role")
      .eq("organization_id", org.id);
    if ((users ?? []).some((u) => u.platform_role === "superadmin")) {
      return NextResponse.json(
        { error: "Cannot delete a project that contains a platform owner." },
        { status: 400 },
      );
    }

    // Delete dependents then org (FK order).
    for (const u of users ?? []) {
      await db().from("credentials").delete().eq("user_id", u.id);
      await db().from("vault_items").delete().eq("user_id", u.id);
      await db().from("vault_profiles").delete().eq("user_id", u.id);
      await db().from("user_key_pairs").delete().eq("user_id", u.id);
      await db().from("extension_tokens").delete().eq("user_id", u.id);
    }
    await db().from("org_member_keys").delete().eq("organization_id", org.id);
    await db().from("org_vault_items").delete().eq("organization_id", org.id);
    await db().from("users").delete().eq("organization_id", org.id);
    await db().from("organizations").delete().eq("id", org.id);

    return NextResponse.json({
      ok: true,
      deleted: { organizationId: org.id, name: org.name, users: (users ?? []).length },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
