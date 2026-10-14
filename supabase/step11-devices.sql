-- ALEPH step 11. Separate device approval from login and PWA installation.
-- No existing memo, snapshot, policy, restore or audit rows are modified.
create table if not exists public.step11_device_credentials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  credential_id text not null unique,
  public_key_jwk jsonb not null,
  sign_count bigint not null default 0 check (sign_count >= 0),
  status text not null default 'pending' check (status in ('pending','approved','revoked')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  last_verified_at timestamptz
);
create index if not exists step11_devices_owner_status_idx
  on public.step11_device_credentials(owner_id,status);
create table if not exists public.step11_device_challenges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  challenge_sha256 text not null check (challenge_sha256 ~ '^[0-9a-f]{64}$'),
  purpose text not null check (purpose in ('register','verify')),
  expires_at timestamptz not null default (now()+ interval '5 minutes'),
  created_at timestamptz not null default now()
);
create index if not exists step11_challenges_owner_idx
  on public.step11_device_challenges(owner_id,purpose,expires_at);
create table if not exists public.step11_device_sessions (
  session_sha256 text primary key check (session_sha256 ~ '^[0-9a-f]{64}$'),
  owner_id uuid not null,
  credential_row_id uuid not null references public.step11_device_credentials(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists step11_sessions_owner_idx
  on public.step11_device_sessions(owner_id,expires_at);
alter table public.step11_device_credentials enable row level security;
alter table public.step11_device_challenges enable row level security;
alter table public.step11_device_sessions enable row level security;
revoke all on public.step11_device_credentials from public,anon,authenticated;
revoke all on public.step11_device_challenges from public,anon,authenticated;
revoke all on public.step11_device_sessions from public,anon,authenticated;
grant select,insert,update,delete on public.step11_device_credentials to service_role;
grant select,insert,update,delete on public.step11_device_challenges to service_role;
grant select,insert,update,delete on public.step11_device_sessions to service_role;
-- Atomic, single-use challenge consumption; service role only.
create or replace function public.step11_consume_challenge(
  p_id uuid, p_owner_id uuid, p_purpose text
) returns text
language plpgsql security definer set search_path = pg_catalog,public
as $$
declare v_hash text;
begin
  if p_id is null or p_owner_id is null
     or p_purpose not in ('register','verify') then return null; end if;
  delete from public.step11_device_challenges
  where id=p_id and owner_id=p_owner_id and purpose=p_purpose
    and expires_at > now()
  returning challenge_sha256 into v_hash;
  return v_hash;
end $$;
revoke all on function public.step11_consume_challenge(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.step11_consume_challenge(uuid,uuid,text) to service_role;
