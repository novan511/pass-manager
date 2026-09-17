import { createClient, type SupabaseClient, type User as SbUser } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

/** Server-only Supabase client with service_role (bypasses RLS). */
export function db(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service role is not configured.");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/* ——— row types (snake_case columns) ——— */

export type OrgRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type UserRow = {
  id: string;
  supabase_id: string | null;
  email: string;
  display_name: string | null;
  avatar: string | null;
  platform_role: string;
  org_role: string | null;
  role: string;
  status: string;
  allowed_categories: string;
  organization_id: string | null;
  created_at: string;
  updated_at: string;
};

export type VaultProfileRow = {
  user_id: string;
  kdf_salt: string;
  wrapped_dek: string;
  verifier: string;
  wrapped_dek_passkey: string | null;
  passkey_prf_salt: string | null;
  kdf_iterations: number;
  created_at: string;
  updated_at: string;
};

export type CredentialRow = {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  device_name: string;
  transports: string | null;
  created_at: string;
};

export type WebAuthnChallengeRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  challenge: string;
  type: string;
  expires_at: string;
  created_at: string;
};

export type VaultItemRow = {
  id: string;
  user_id: string;
  category: string;
  ciphertext: string;
  iv: string;
  created_at: string;
  updated_at: string;
};

export type ExtensionTokenRow = {
  id: string;
  user_id: string;
  token_hash: string;
  label: string;
  expires_at: string;
  last_used_at: string | null;
  created_at: string;
};

export type UserKeyPairRow = {
  user_id: string;
  public_key: string;
  encrypted_private_key: string;
  created_at: string;
  updated_at: string;
};

export type OrgMemberKeyRow = {
  id: string;
  organization_id: string;
  user_id: string;
  encrypted_org_key: string;
  created_at: string;
  updated_at: string;
};

export type OrgVaultItemRow = {
  id: string;
  organization_id: string;
  category: string;
  ciphertext: string;
  iv: string;
  created_at: string;
  updated_at: string;
};

export type OrgMemberRow = {
  id: string;
  organization_id: string;
  user_id: string;
  org_role: string;
  allowed_categories: string;
  status: string;
  created_at: string;
  updated_at: string;
};

/** Project list item for switcher + role in that project. */
export type MembershipSummary = {
  organizationId: string;
  name: string;
  slug: string;
  status: string;
  orgRole: string;
  allowedCategories: string;
  isCurrent: boolean;
};

export async function must<T>(
  promise: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  label = "query",
): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data as T;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { data, error } = await db()
    .from("users")
    .select("*")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as UserRow | null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const { data, error } = await db()
    .from("users")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as UserRow | null;
}

export async function findUserBySupabaseId(supabaseId: string): Promise<UserRow | null> {
  const { data, error } = await db()
    .from("users")
    .select("*")
    .eq("supabase_id", supabaseId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as UserRow | null;
}

export async function countUsers(): Promise<number> {
  const { count, error } = await db()
    .from("users")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function createUser(input: Partial<UserRow> & { email: string }): Promise<UserRow> {
  const row = {
    id: input.id ?? newId(),
    supabase_id: input.supabase_id ?? null,
    email: input.email.toLowerCase(),
    display_name: input.display_name ?? null,
    avatar: input.avatar ?? null,
    platform_role: input.platform_role ?? "user",
    org_role: input.org_role ?? null,
    role: input.role ?? "member",
    status: input.status ?? "active",
    allowed_categories: input.allowed_categories ?? "personal",
    organization_id: input.organization_id ?? null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const { data, error } = await db()
    .from("users")
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as UserRow;
}

export async function updateUser(
  id: string,
  patch: Partial<UserRow>,
): Promise<UserRow> {
  const { data, error } = await db()
    .from("users")
    .update({ ...patch, updated_at: nowIso() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as UserRow;
}

export async function createOrganization(name: string, slug: string): Promise<OrgRow> {
  const row = {
    id: newId(),
    name,
    slug,
    status: "active",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const { data, error } = await db()
    .from("organizations")
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as OrgRow;
}

export async function findOrgBySlug(slug: string): Promise<OrgRow | null> {
  const { data, error } = await db()
    .from("organizations")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as OrgRow | null;
}

export async function findOrgById(id: string): Promise<OrgRow | null> {
  const { data, error } = await db()
    .from("organizations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as OrgRow | null;
}

export async function addMembership(input: {
  organizationId: string;
  userId: string;
  orgRole: "owner" | "member";
  allowedCategories: string;
  status?: string;
}): Promise<OrgMemberRow> {
  const now = nowIso();
  const { data, error } = await db()
    .from("organization_members")
    .upsert(
      {
        organization_id: input.organizationId,
        user_id: input.userId,
        org_role: input.orgRole,
        allowed_categories: input.allowedCategories,
        status: input.status ?? "active",
        created_at: now,
        updated_at: now,
      },
      { onConflict: "organization_id,user_id" },
    )
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as OrgMemberRow;
}

export async function listMemberships(userId: string): Promise<MembershipSummary[]> {
  const { data: memberships, error } = await db()
    .from("organization_members")
    .select(
      "organization_id, org_role, allowed_categories, status, organizations(id, name, slug, status)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const { data: user } = await db()
    .from("users")
    .select("organization_id")
    .eq("id", userId)
    .maybeSingle();

  return (memberships ?? []).map((m) => {
    const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
    return {
      organizationId: m.organization_id,
      name: org?.name ?? "Project",
      slug: org?.slug ?? "",
      status: org?.status ?? m.status,
      orgRole: m.org_role,
      allowedCategories: m.allowed_categories,
      isCurrent: user?.organization_id === m.organization_id,
    };
  });
}

export async function switchMembership(userId: string, organizationId: string): Promise<UserRow | null> {
  const { data: membership } = await db()
    .from("organization_members")
    .select("*")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();
  if (!membership) return null;

  return updateUser(userId, {
    organization_id: organizationId,
    org_role: membership.org_role,
    role: membership.org_role === "owner" ? "admin" : "member",
    allowed_categories: membership.allowed_categories,
  });
}

export async function updateMembership(
  organizationId: string,
  userId: string,
  patch: Partial<Pick<OrgMemberRow, "org_role" | "allowed_categories" | "status">>,
): Promise<OrgMemberRow> {
  const { data, error } = await db()
    .from("organization_members")
    .update({ ...patch, updated_at: nowIso() })
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as OrgMemberRow;
}

/** Map Supabase auth user → app user (create/link + membership as needed). */
export async function ensureAppUser(sbUser: SbUser): Promise<UserRow | null> {
  if (!sbUser.id || !sbUser.email) return null;
  const email = sbUser.email.toLowerCase();

  let appUser = await findUserBySupabaseId(sbUser.id);
  if (!appUser) {
    const byEmail = await findUserByEmail(email);
    if (byEmail) {
      appUser = await updateUser(byEmail.id, { supabase_id: sbUser.id });
    }
  }

  if (appUser) {
    if (appUser.status !== "active") return null;

    // Ensure at least one membership exists (legacy users / first login).
    const { data: memberRows } = await db()
      .from("organization_members")
      .select("id, status")
      .eq("user_id", appUser.id)
      .limit(1);
    const hasMembership = (memberRows ?? []).length > 0;

    if (!hasMembership) {
      if (appUser.organization_id) {
        await addMembership({
          organizationId: appUser.organization_id,
          userId: appUser.id,
          orgRole: (appUser.org_role as "owner" | "member") || "member",
          allowedCategories: appUser.allowed_categories || "personal",
          status: appUser.status,
        });
      } else {
        // No org yet — create personal project + owner membership.
        const count = await countUsers();
        const orgName = `${email.split("@")[0].replace(/[._]+/g, " ")} vault`;
        let slug =
          orgName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "org";
        if (await findOrgBySlug(slug)) {
          slug = `${slug}-${Date.now().toString(36)}`;
        }
        const org = await createOrganization(orgName, slug);
        appUser = await updateUser(appUser.id, {
          organization_id: org.id,
          org_role: "owner",
          role: "admin",
          allowed_categories: ALL_CATEGORIES_CSV_LOCAL,
          platform_role: count === 0 ? "superadmin" : appUser.platform_role,
        });
        await addMembership({
          organizationId: org.id,
          userId: appUser.id,
          orgRole: "owner",
          allowedCategories: ALL_CATEGORIES_CSV_LOCAL,
        });
        return appUser;
      }
    }

    // Suspended current project blocks access.
    if (appUser.organization_id) {
      const org = await findOrgById(appUser.organization_id);
      if (org && org.status === "suspended") return null;
    }
    return appUser;
  }

  // Brand new user
  const count = await countUsers();
  const orgName = `${email.split("@")[0].replace(/[._]+/g, " ")} vault`;
  let slug =
    orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "org";
  if (await findOrgBySlug(slug)) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }
  const org = await createOrganization(orgName, slug);
  appUser = await createUser({
    supabase_id: sbUser.id,
    email,
    platform_role: count === 0 ? "superadmin" : "user",
    org_role: "owner",
    role: "admin",
    status: "active",
    allowed_categories: ALL_CATEGORIES_CSV_LOCAL,
    organization_id: org.id,
  });
  await addMembership({
    organizationId: org.id,
    userId: appUser.id,
    orgRole: "owner",
    allowedCategories: ALL_CATEGORIES_CSV_LOCAL,
  });
  return appUser;
}

const ALL_CATEGORIES_CSV_LOCAL = "work,personal,finance,social,other";
