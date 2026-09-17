import { NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase/db";
import { handleApiError } from "@/lib/api";

export async function GET() {
  try {
    const actor = await requireOrgAdmin();
    if (!actor.organization_id) {
      return NextResponse.json({ members: [] });
    }
    const { data: users, error } = await db()
      .from("users")
      .select("id, email, org_role, user_key_pairs(public_key, created_at)")
      .eq("organization_id", actor.organization_id)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    return NextResponse.json({
      members: (users ?? []).map((u) => {
        const kp = Array.isArray(u.user_key_pairs)
          ? u.user_key_pairs[0]
          : u.user_key_pairs;
        return {
          id: u.id,
          email: u.email,
          orgRole: u.org_role,
          publicKey: kp?.public_key ?? null,
          hasVaultKeys: !!kp,
        };
      }),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
