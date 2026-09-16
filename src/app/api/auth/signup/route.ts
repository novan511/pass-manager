import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { handleApiError } from "@/lib/api";
import { ALL_CATEGORIES_CSV } from "@/lib/categories";

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10, "Password must be at least 10 characters.").max(256),
  organizationName: z.string().min(2).max(80).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const email = body.email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      );
    }

    const isFirstUser = (await prisma.user.count()) === 0;
    const orgName =
      body.organizationName?.trim() ||
      `${email.split("@")[0].replace(/[._]+/g, " ")} vault`;

    let slug = orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "org";
    if (await prisma.organization.findUnique({ where: { slug } })) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    const org = await prisma.organization.create({
      data: { name: orgName.trim(), slug },
    });

    // Create auth user in Supabase (email_confirmed so user can log in immediately).
    const admin = createSupabaseAdminClient();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
    });
    if (createErr || !created.user) {
      await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
      return NextResponse.json(
        { error: createErr?.message || "Could not create Supabase auth user." },
        { status: 400 },
      );
    }

    const user = await prisma.user.create({
      data: {
        supabaseId: created.user.id,
        email,
        platformRole: isFirstUser ? "superadmin" : "user",
        orgRole: "owner",
        role: "admin",
        status: "active",
        allowedCategories: ALL_CATEGORIES_CSV,
        organizationId: org.id,
      },
    });

    // Sign the user in (sets Supabase session cookies).
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
        orgRole: user.orgRole,
        platformRole: user.platformRole,
        organization: { id: org.id, name: org.name, slug: org.slug },
      },
      isFirstUser,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
