# Keyring — 100% Supabase (tanpa Prisma)

Semua di **satu project Supabase**: Auth + tabel app via **Supabase client**.  
Vault tetap **zero-knowledge** (crypto di browser tidak berubah).

## 1) Buat tabel (SQL Editor)

Buka Supabase → **SQL Editor** → jalankan seluruh isi  
[`supabase/schema.sql`](./supabase/schema.sql) → **Run**.

## 2) Auth URL

**Authentication → URL Configuration**

| Field | Value |
| --- | --- |
| Site URL | `https://pass-manager-5l3g.vercel.app` |
| Redirect URLs | `https://pass-manager-5l3g.vercel.app/auth/callback` |
| | `https://pass-manager-5l3g.vercel.app/reset-password` |
| | `http://localhost:3000/auth/callback` |
| | `http://localhost:3000/reset-password` |

**Email provider** ON. Opsional: matikan *Confirm email*.

## 3) Environment (Vercel + .env lokal)

```
NEXT_PUBLIC_SUPABASE_URL=https://azvszagdpakwxaacaacd.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...          # rotate jika pernah dishare
APP_URL=https://pass-manager-5l3g.vercel.app
SESSION_SECRET=<openssl rand -hex 32>
```

**Tidak perlu `DATABASE_URL` / Prisma** — data dibaca lewat Supabase REST (service role).

## 4) Deploy

Push ke GitHub → Vercel rebuild → **Signup**.

## 5) Troubleshooting

| Gejala | Fix |
| --- | --- |
| relation "public.users" does not exist | Jalankan `supabase/schema.sql` |
| Signup error | Cek `SUPABASE_SERVICE_ROLE_KEY` |
| Email reset tidak masuk | URL config + Logs → Auth + Spam |
| Auth session missing | Buka link reset di browser yang sama |
