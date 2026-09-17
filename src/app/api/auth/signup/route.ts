import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  createSupabaseAdminClient,
} from "@/lib/supabase/server";
import {
  db,
  newId,
  nowIso,
  findUserByEmail,
  findOrgBySlug,
  createOrganization,
  createUser,
  type UserRow,
} from "@/lib/supabase/db";
import { handleApiError } from "@/lib/api";
import { ALL_CATEGORIES_CSV } from "@/lib/categories";

const schema = z.object({
  email: z.string().email().max(254),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(256)
    .regex(/[A-Z]/, "Password must include an uppercase letter.")
    .regex(/[a-z]/, "Password must include a lowercase letter.")
    .regex(/[^A-Za-z0-9]/, "Password must include a symbol or number."),
  organizationName: z.string().min(2).max(80).optional(),
});

export async function POST(req: NextRequest) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        {
          error:
            "Supabase env is incomplete. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        },
        { status: 500 },
      );
    }

    const body = schema.parse(await req.json());
    const email = body.email.trim().toLowerCase();

    if (await findUserByEmail(email)) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      );
    }

    const { count } = await db()
      .from("users")
      .select("id", { count: "exact", head: true });
    const isFirstUser = (count ?? 0) === 0;

    const orgName =
      body.organizationName?.trim() || `${email.split("@")[0].replace(/[._]+/g, " ")} vault`;
    let slug =
      orgName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "org";
    if (await findOrgBySlug(slug)) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }
    const org = await createOrganization(orgName.trim(), slug);

    const admin = createSupabaseAdminClient();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
    });
    if (createErr || !created.user) {
      await db().from("organizations").delete().eq("id", org.id);
      return NextResponse.json(
        { error: createErr?.message || "Could not create Supabase auth user." },
        { status: 400 },
      );
    }

    const user = await createUser({
      supabase_id: created.user.id,
      email,
      platform_role: isFirstUser ? "superadmin" : "user",
      org_role: "owner",
      role: "admin",
      status: "active",
      allowed_categories: ALL_CATEGORIES_CSV,
      organization_id: org.id,
    });

    const supabase = await createSupabaseServerClient();
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email,
      password: body.password,
    });
    if (signInErr) {
      return NextResponse.json(
        { error: `Account created but sign-in failed: ${signInErr.message}` },
        { status: 400 },
      );
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        orgRole: user.org_role,
        platformRole: user.platform_role,
        organization: { id: org.id, name: org.name, slug: org.slug },
      },
      isFirstUser,
    });
  } catch (err) {
    console.error("signup", err);
    return handleApiError(err);
  }
}
