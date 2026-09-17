/**
 * Sanity-check Supabase Auth env.
 * Usage: node scripts/check-supabase.mjs
 */
import { readFileSync } from "fs";

try {
  readFileSync(".env", "utf8")
    .split("\n")
    .forEach((l) => {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    });
} catch {
  /* no .env */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("NEXT_PUBLIC_SUPABASE_URL :", url ? "✓" : "✗ missing");
console.log("ANON key                 :", anon ? "✓" : "✗ missing");
console.log("SERVICE_ROLE key         :", service ? "✓" : "✗ missing");
console.log("APP_URL                  :", process.env.APP_URL || "✗ missing");

if (url && service) {
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 5 });
  if (error) console.log("Auth listUsers          :", "✗", error.message);
  else {
    console.log("Auth listUsers          : ✓ total=" + data.total);
    for (const u of data.users.slice(0, 5)) console.log("  -", u.email);
  }

  const { data: orgs, error: orgErr } = await admin
    .from("organizations")
    .select("id, name, slug")
    .limit(5);
  if (orgErr) console.log("organizations table     :", "✗", orgErr.message);
  else console.log("organizations table     : ✓ rows=" + (orgs?.length ?? 0));

  const { data: users, error: uErr } = await admin
    .from("users")
    .select("id, email")
    .limit(5);
  if (uErr) console.log("users table             :", "✗", uErr.message);
  else console.log("users table             : ✓ rows=" + (users?.length ?? 0));
}
