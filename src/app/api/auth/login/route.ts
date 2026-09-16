import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const email = body.email.trim().toLowerCase();

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: body.password,
    });
    if (error || !data.user) {
      return NextResponse.json(
        { error: "Email or password is incorrect." },
        { status: 401 },
      );
    }

    // Link / load Prisma profile (also enforces status + org suspended).
    const user = await getSessionUser();
    if (!user) {
      await supabase.auth.signOut();
      return NextResponse.json(
        { error: "Your access has been revoked or this project is suspended." },
        { status: 403 },
      );
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        orgRole: user.orgRole,
        platformRole: user.platformRole,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
