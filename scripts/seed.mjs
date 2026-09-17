/**
 * Optional demo data via Supabase service role.
 * Usage: node scripts/seed.mjs   (requires .env with SUPABASE_* keys)
 * Usually you just Signup in the UI — first user becomes platform owner.
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
  /* optional */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !service) {
  console.log("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const { createClient } = await import("@supabase/supabase-js");
const admin = createClient(url, service, { auth: { persistSession: false } });
const { data, error } = await admin.auth.admin.listUsers({ perPage: 5 });
if (error) {
  console.error("Auth error", error.message);
  process.exit(1);
}
console.log("Supabase Auth users:", data.total);
for (const u of data.users) console.log(" -", u.email);

const { data: orgs, error: orgErr } = await admin.from("organizations").select("id, name, slug, status");
if (orgErr) {
  console.log("organizations table not ready — run supabase/schema.sql in SQL Editor");
} else {
  console.log("organizations:", orgs?.length ?? 0);
}
console.log("\nRun supabase/schema.sql in Supabase SQL Editor if tables are missing.");
