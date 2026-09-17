import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db, findOrgById } from "@/lib/supabase/db";
import { effectiveCategories } from "@/lib/categories";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ user: null });

  const [{ count: passkeyCount }, { data: profile }] = await Promise.all([
    db()
      .from("credentials")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
    db()
      .from("vault_profiles")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const org = user.organization_id ? await findOrgById(user.organization_id) : null;

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      avatar: user.avatar,
      role: user.role,
      orgRole: user.org_role,
      platformRole: user.platform_role,
      organizationId: user.organization_id,
      organization: org
        ? { id: org.id, name: org.name, slug: org.slug, status: org.status }
        : null,
      allowedCategories: effectiveCategories(user.role, user.allowed_categories, {
        orgRole: user.org_role,
        platformRole: user.platform_role,
      }),
    },
    hasVault: !!profile,
    passkeyCount: passkeyCount ?? 0,
  });
}
