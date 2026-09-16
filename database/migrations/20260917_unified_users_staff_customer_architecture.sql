-- OrbitFS unified identity architecture.
-- One users row represents one person/account. Customer and staff capabilities are additive.
-- Supabase Auth is not the application identity store; existing auth_user_id columns remain as
-- compatibility references during the application migration and are not used by new auth flows.

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  username text,
  display_name text,
  first_name text,
  last_name text,
  status text not null default 'active',
  email_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_status_check check (status in ('active','suspended','disabled','pending'))
);

create unique index if not exists users_email_lower_uidx on public.users(lower(email));
create unique index if not exists users_username_lower_uidx on public.users(lower(username)) where username is not null;

create table if not exists public.staff_access (
  user_id uuid primary key references public.users(id) on delete cascade,
  enabled boolean not null default true,
  role text not null default 'staff',
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists staff_access_enabled_idx on public.staff_access(enabled) where enabled=true;

alter table public.customers add column if not exists user_id uuid;
alter table public.user_profiles add column if not exists user_id uuid;
alter table public.customer_credentials add column if not exists canonical_user_id uuid;
alter table public.customer_sessions add column if not exists canonical_user_id uuid;

-- Backfill one canonical user for every existing customer/profile identity. Existing UUIDs are
-- intentionally preserved where possible so existing ownership relationships remain stable.
insert into public.users(id,email,username,display_name,first_name,status,email_verified_at,created_at,updated_at)
select coalesce(c.auth_user_id,p.id,gen_random_uuid()),
       lower(coalesce(c.email,p.email,'unknown+'||coalesce(c.auth_user_id::text,p.id::text,gen_random_uuid()::text)||'@invalid.local')),
       coalesce(c.username),
       coalesce(c.display_name,c.name,p.display_name),
       coalesce(c.first_name,p.first_name),
       case when coalesce(c.status,p.status,'active') in ('active','suspended','disabled','pending') then coalesce(c.status,p.status,'active') else 'active' end,
       coalesce(c.email_verified_at,p.email_verified_at),
       coalesce(c.created_at,p.created_at,now()),
       now()
from public.customers c
full join public.user_profiles p on p.id=c.auth_user_id
where not exists (
  select 1 from public.users u where u.id=coalesce(c.auth_user_id,p.id)
)
  and coalesce(c.email,p.email) is not null;

update public.users u
set email=lower(coalesce(nullif(u.email,''),c.email,p.email,u.email)),
    username=coalesce(u.username,c.username),
    display_name=coalesce(u.display_name,c.display_name,c.name,p.display_name),
    first_name=coalesce(u.first_name,c.first_name,p.first_name),
    email_verified_at=coalesce(u.email_verified_at,c.email_verified_at,p.email_verified_at),
    updated_at=now()
from public.customers c
left join public.user_profiles p on p.id=c.auth_user_id
where u.id=c.auth_user_id;

update public.customers c set user_id=c.auth_user_id where c.user_id is null and c.auth_user_id is not null;
update public.user_profiles p set user_id=p.id where p.user_id is null;
update public.customer_credentials cc
set canonical_user_id=cc.user_id
where cc.canonical_user_id is null
  and exists(select 1 from public.users u where u.id=cc.user_id);
update public.customer_sessions cs
set canonical_user_id=cs.user_id
where cs.canonical_user_id is null
  and exists(select 1 from public.users u where u.id=cs.user_id);

alter table public.customers
  add constraint customers_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;
alter table public.user_profiles
  add constraint user_profiles_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;
alter table public.customer_credentials
  add constraint customer_credentials_canonical_user_id_fkey foreign key (canonical_user_id) references public.users(id) on delete cascade;
alter table public.customer_sessions
  add constraint customer_sessions_canonical_user_id_fkey foreign key (canonical_user_id) references public.users(id) on delete cascade;

create unique index if not exists customers_user_id_uidx on public.customers(user_id);
create unique index if not exists user_profiles_user_id_uidx on public.user_profiles(user_id);
create unique index if not exists customer_credentials_canonical_user_id_uidx on public.customer_credentials(canonical_user_id);

-- Existing staff roles become an additive capability rather than an account type.
insert into public.staff_access(user_id,enabled,role,permissions)
select p.id,true,
       case when lower(coalesce(p.role,'')) in ('owner','system_admin','admin','superadmin','senior_support','staff') then lower(p.role) else 'staff' end,
       '{}'::jsonb
from public.user_profiles p
where lower(coalesce(p.role,'')) in ('owner','system_admin','admin','superadmin','senior_support','staff')
on conflict(user_id) do update set enabled=true, role=excluded.role, updated_at=now();

comment on table public.users is 'Canonical OrbitFS account identity. This is the application user table; Supabase Auth users are not the application identity model.';
comment on table public.staff_access is 'Optional staff capability attached to a normal user account. Staff and customer access are not mutually exclusive.';
comment on column public.customers.user_id is 'Canonical OrbitFS user identity. auth_user_id is legacy compatibility only.';
