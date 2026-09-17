import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { listMemberships, switchMembership } from "@/lib/supabase/db";
import { handleApiError } from "@/lib/api";

/** List projects this user belongs to (multi-membership). */
export async function GET() {
  try {
    const user = await requireUser();
    const memberships = await listMemberships(user.id);
    return NextResponse.json({
      memberships,
      currentOrganizationId: user.organization_id,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const switchSchema = z.object({ organizationId: z.string().min(1) });

/** Switch active project. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = switchSchema.parse(await req.json());
    const updated = await switchMembership(user.id, body.organizationId);
    if (!updated) {
      return NextResponse.json(
        { error: "You are not a member of that project." },
        { status: 403 },
      );
    }
    return NextResponse.json({
      user: {
        id: updated.id,
        organizationId: updated.organization_id,
        orgRole: updated.org_role,
        role: updated.role,
        allowedCategories: updated.allowed_categories.split(",").filter(Boolean),
      },
      memberships: await listMemberships(user.id),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
