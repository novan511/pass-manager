-- Multi-project membership (run once in Supabase SQL Editor if tables already exist).
create extension if not exists "pgcrypto";

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  org_role text not null default 'member',
  allowed_categories text not null default 'personal',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists organization_members_user_id_idx on public.organization_members(user_id);
create index if not exists organization_members_org_id_idx on public.organization_members(organization_id);

insert into public.organization_members (organization_id, user_id, org_role, allowed_categories, status, created_at, updated_at)
select u.organization_id, u.id, coalesce(u.org_role, 'member'), u.allowed_categories, u.status, now(), now()
from public.users u
where u.organization_id is not null
on conflict (organization_id, user_id) do nothing;

alter table public.organization_members enable row level security;
