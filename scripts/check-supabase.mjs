/**
 * Sanity-check Supabase Auth + optional DATABASE_URL.
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
const db = process.env.DATABASE_URL;

console.log("NEXT_PUBLIC_SUPABASE_URL :", url ? "✓" : "✗ missing");
console.log("ANON key                 :", anon ? "✓" : "✗ missing");
console.log("SERVICE_ROLE key         :", service ? "✓" : "✗ missing");
console.log("DATABASE_URL             :", db ? "✓" : "✗ missing (set Supabase Pooler URI)");
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
}

if (db) {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const p = new PrismaClient();
    await p.$queryRaw`SELECT 1`;
    console.log("Postgres connect        : ✓");
    await p.$disconnect();
  } catch (e) {
    console.log("Postgres connect        : ✗", String(e.message).slice(0, 160));
  }
}
