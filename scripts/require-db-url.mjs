// Fail the Vercel build early with a clear message if DATABASE_URL is missing.
const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error(
    [
      "",
      "✖ DATABASE_URL is empty.",
      "  Use ONE Supabase project for Auth + Postgres.",
      "  Supabase → Settings → Database → Connection string → Pooler (Transaction)",
      "  Set DATABASE_URL in Vercel Environment Variables, then redeploy.",
      "",
      "  See SUPABASE.md",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
if (url.startsWith("file:")) {
  console.error("✖ DATABASE_URL is SQLite (file:). For Supabase use postgresql://…");
  process.exit(1);
}
console.log("✓ DATABASE_URL present (" + url.split("@")[1]?.slice(0, 40) + "…)");
