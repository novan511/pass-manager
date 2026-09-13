# Keyring — Zero-Knowledge Password Manager (SaaS)

A multi-tenant, end-to-end encrypted password manager for Vercel. Like Telegram for secrets: the **platform owner cannot read anyone’s passwords**. Encryption and decryption happen only in the browser.

## Zero-knowledge guarantee

| Role | What they can see | What they cannot see |
| --- | --- | --- |
| **Platform owner** (you / SaaS) | Project list, owner emails, member emails, item **counts**, active/suspended | Master passwords, vault passwords, ciphertext, DEKs |
| **Org owner** (customer project master) | Members in their project, category grants, item counts | Members’ vault secrets |
| **Member** | Only their own vault (after unlock) | Other users’ vaults |

All vault items are AES-256-GCM ciphertext. The key is derived from the user’s **master password** (PBKDF2 310k) on their device and never sent to the server. Platform APIs return metadata only.

## Multi-tenant structure

```
Platform owner (superadmin)
├── Organization "Acme Studio"     ← one customer / project
│   ├── Owner (master)             ← manages members & categories
│   └── Members…
├── Organization "Beta Corp"
│   ├── Owner
│   └── Members…
```

### Roles

| Role | Scope | Can |
| --- | --- | --- |
| **Platform superadmin** | All orgs | List projects, create projects, suspend/restore, see structure (no secrets) |
| **Org owner** | One org | Invite/revoke members, set roles & login categories |
| **Member** | Own vault | Use granted categories only |

## Features

- **Zero-knowledge vault** — AES-256-GCM; DEK wrapped by KEK from master password (PBKDF2-SHA256, 310k)
- **Passkey unlock** — WebAuthn PRF (Face ID / fingerprint)
- **Login-only vault** — username / password / URL / TOTP / notes / favorites
- **Category ACL** — Work, Personal, Finance, Social, Other — enforced server-side
- **Generator & built-in TOTP** — on-device
- **Chrome extension (MV3)** — encrypted fetch + local unlock + autofill
- **Auto-lock** · dark/light theme

## Stack

Next.js 16 · TypeScript · Tailwind CSS 4 · Prisma · **PostgreSQL** (Neon / Supabase / Vercel Postgres) · SimpleWebAuthn

## Local development (PostgreSQL)

1. Create a free database: [Neon](https://neon.tech) or Supabase.
2. Copy env and fill values:

```bash
cp .env.example .env
```

```env
SESSION_SECRET=<openssl rand -hex 32>
APP_URL=http://localhost:3000
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
```

```bash
npm install
npx prisma migrate deploy   # or: npm run db:migrate
npm run seed                # optional demo tenants
npm run dev
```

Demo logins after `npm run seed`:

| Role | Email | Password |
| --- | --- | --- |
| Platform | `owner@keyring.test` | `platform-owner-pass-1` |
| Org owner | `boss@acme.test` | `acme-owner-pass-1` |
| Member | `staff@acme.test` | `acme-member-pass-1` |

> Passkeys need `localhost` or HTTPS.

## Deploy to Vercel (fixes empty DATABASE_URL)

The build failed with **“DATABASE_URL resolved to an empty string”** because env vars were not set in Vercel (and the project previously pointed at SQLite).

### 1. Create Postgres
Use **Neon** (recommended), Supabase, or Vercel Postgres. Copy the connection string, e.g.:

```
postgresql://user:password@ep-xxx.aws.neon.tech/neondb?sslmode=require
```

### 2. Set Environment Variables (Vercel → Project → Settings → Environment Variables)

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Your Postgres URL (`sslmode=require`) |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `APP_URL` | `https://your-app.vercel.app` (exact production URL) |

### 3. Redeploy
`prisma/schema.prisma` is already `provider = "postgresql"`. Build runs:

```bash
prisma generate && prisma migrate deploy && next build
```

After first successful deploy, open the site and **sign up** (first account = platform superadmin), or run `npm run seed` against the same `DATABASE_URL` from your machine.

### Common errors

| Error | Fix |
| --- | --- |
| `DATABASE_URL resolved to an empty string` | Add `DATABASE_URL` in Vercel env, then redeploy |
| `The URL must start with postgresql://` | Use a real Postgres URL, not `file:./dev.db` |
| `_SSL` / certificate errors | Append `?sslmode=require` to the Neon/Supabase URL |

## Project layout

```
prisma/schema.prisma          Organization + User (platformRole, orgRole)
src/lib/crypto.ts             Client-side vault crypto
src/app/api/platform/**       SaaS owner — orgs metadata only
src/app/api/admin/**          Org owner — members & categories
src/app/api/vault/**          Encrypted item CRUD
scripts/seed.mjs              Demo multi-tenant data
extension/                    Chrome MV3 autofill
```

3. Set environment variables in Vercel:
   - `DATABASE_URL` — your Postgres connection string
   - `SESSION_SECRET` — long random string (`openssl rand -hex 32`)
   - `APP_URL` — e.g. `https://keyring.example.com` (used as the WebAuthn relying-party origin)
4. Add a build step so migrations run on deploy:

   ```json
   "scripts": {
     "build": "prisma migrate deploy && next build"
   }
   ```

5. Deploy. Share the URL with your team; the first visitor to sign up is the admin.

## Browser extension

1. In the web app: **Settings → Browser extension token → Create extension token** (copy it immediately).
2. Load `extension/` as an unpacked extension in `chrome://extensions`.
3. Open the popup, paste the app base URL + token, unlock with your master password.
4. Click a matching login to fill the active tab.

Tokens only authorize download of encrypted blobs and can be revoked at any time.

## Security model

| Layer | What leaves the device |
| --- | --- |
| Master password | Never |
| Vault DEK | Never (stays in memory; cleared on lock) |
| Items | AES-GCM ciphertext + IV |
| Extension token | Authorizes ciphertext download only |

If you lose the master password and have no passkey, the vault cannot be recovered — by design.

## Project layout

```
prisma/schema.prisma     data model
src/lib/crypto.ts        client-side vault crypto
src/lib/totp.ts          TOTP (RFC 6238)
src/lib/password.ts      generators
src/lib/auth.ts          sessions, password hashing (server)
src/app/api/**           REST endpoints
src/components/vault/**  vault UI
extension/               Chrome MV3 autofill extension
```
