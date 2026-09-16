# Keyring — 100% Supabase setup

Semua di **satu project Supabase**: Auth (login/reset) + Postgres (data app).  
Vault tetap **zero-knowledge** (enkripsi di browser — logika crypto tidak berubah).

## 1) Supabase Dashboard

### A. Auth → URL Configuration
| Field | Value |
| --- | --- |
| Site URL | `https://pass-manager-5l3g.vercel.app` (atau `http://localhost:3000` untuk dev) |
| Redirect URLs | `https://pass-manager-5l3g.vercel.app/auth/callback` |
| | `https://pass-manager-5l3g.vercel.app/reset-password` |
| | `http://localhost:3000/auth/callback` |
| | `http://localhost:3000/reset-password` |

### B. Auth → Sign In / Providers → Email
- Provider **Email** = ON  
- **Confirm email** = OFF (biar signup langsung bisa login)

### C. Settings → Database → Connection string
Pilih **Pooler → Transaction**  
Salin URL yang diawali `postgresql://…`  
Ini untuk `DATABASE_URL` (bukan REST, bukan JWT).

### D. Settings → API
- `anon` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`  
- `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (**jangan commit**, rotate kalau pernah dishare)

## 2) Vercel Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=https://azvszagdpakwxaacaacd.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
DATABASE_URL=postgresql://...pooler.supabase.co:5432/postgres?sslmode=require
APP_URL=https://pass-manager-5l3g.vercel.app
SESSION_SECRET=<openssl rand -hex 32>
```

Redeploy. Build: `prisma migrate deploy` membuat tabel app di Postgres Supabase.

## 3) Local

```bash
cp .env.example .env   # isi 6 variabel di atas
npm install
npx prisma migrate deploy
npm run dev
```

## 4) Alur user
1. **Signup** → buat akun Supabase Auth + org  
2. **Login** → vault master password (client-side, tidak dikirim)  
3. **Forgot password** → email Supabase → `/auth/callback` → `/reset-password`

## 5) Yang TIDAK berubah
- AES-GCM vault, PBKDF2, passkey PRF, shared org vault, category ACL  
- Hanya **platform** auth+DB = Supabase  

## Troubleshooting email reset
1. User harus **pernah signup** di Supabase Auth  
2. Link harus dibuka di domain yang sama (whitelist Redirect URL)  
3. Cek **Supabase → Logs → Auth**  
4. Spam folder  

## Owner reset (tanpa email)
Team panel → **Reset password** → temp password sekali tampil.
