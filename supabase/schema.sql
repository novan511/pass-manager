-- Run this once in Supabase SQL Editor (or supabase db push).
-- App tables only. Auth users live in auth.users (managed by Supabase Auth).

create extension if not exists "pgcrypto";

-- ========== Organizations ==========
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ========== Users (app profile, linked to auth.users) ==========
-- organization_id = currently SELECTED project (active context).
-- Full multi-project membership lives in organization_members.
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  supabase_id uuid unique,
  email text not null unique,
  display_name text,
  avatar text,
  platform_role text not null default 'user',
  org_role text,
  role text not null default 'member',
  status text not null default 'active',
  allowed_categories text not null default 'personal',
  organization_id uuid references public.organizations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ========== Multi-project membership ==========
-- One user can own many projects and be member of many others.
create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  -- "owner" | "member"
  org_role text not null default 'member',
  -- CSV of login categories this membership can use
  allowed_categories text not null default 'personal',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index if not exists organization_members_user_id_idx on public.organization_members(user_id);
create index if not exists organization_members_org_id_idx on public.organization_members(organization_id);

-- Backfill existing single-org users into organization_members
insert into public.organization_members (organization_id, user_id, org_role, allowed_categories, status, created_at, updated_at)
select u.organization_id, u.id, coalesce(u.org_role, 'member'), u.allowed_categories, u.status, now(), now()
from public.users u
where u.organization_id is not null
on conflict (organization_id, user_id) do nothing;

-- ========== Vault profile (wrapped DEK) ==========
create table if not exists public.vault_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  kdf_salt text not null,
  wrapped_dek text not null,
  verifier text not null,
  wrapped_dek_passkey text,
  passkey_prf_salt text,
  kdf_iterations integer not null default 310000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ========== WebAuthn credentials ==========
create table if not exists public.credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter integer not null default 0,
  device_name text not null default 'Passkey',
  transports text,
  created_at timestamptz not null default now()
);
create index if not exists credentials_user_id_idx on public.credentials(user_id);

-- ========== WebAuthn challenges ==========
create table if not exists public.webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  email text,
  challenge text not null unique,
  type text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists webauthn_challenges_challenge_idx on public.webauthn_challenges(challenge);

-- ========== Personal vault items (ciphertext only) ==========
create table if not exists public.vault_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  category text not null default 'other',
  ciphertext text not null,
  iv text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vault_items_user_id_idx on public.vault_items(user_id);
create index if not exists vault_items_user_category_idx on public.vault_items(user_id, category);

-- ========== Extension tokens ==========
create table if not exists public.extension_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  label text not null default 'Browser extension',
  expires_at timestamptz not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists extension_tokens_user_id_idx on public.extension_tokens(user_id);

-- ========== User RSA keypairs (shared vault) ==========
create table if not exists public.user_key_pairs (
  user_id uuid primary key references public.users(id) on delete cascade,
  public_key text not null,
  encrypted_private_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ========== Org member key wraps ==========
create table if not exists public.org_member_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  encrypted_org_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index if not exists org_member_keys_user_id_idx on public.org_member_keys(user_id);

-- ========== Org shared vault items ==========
create table if not exists public.org_vault_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category text not null default 'other',
  ciphertext text not null,
  iv text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists org_vault_items_org_idx on public.org_vault_items(organization_id);
create index if not exists org_vault_items_org_category_idx on public.org_vault_items(organization_id, category);

-- RLS: deny all to anon/authenticated. App uses service_role from the server only.
alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.organization_members enable row level security;
alter table public.vault_profiles enable row level security;
alter table public.credentials enable row level security;
alter table public.webauthn_challenges enable row level security;
alter table public.vault_items enable row level security;
alter table public.extension_tokens enable row level security;
alter table public.user_key_pairs enable row level security;
alter table public.org_member_keys enable row level security;
alter table public.org_vault_items enable row level security;
