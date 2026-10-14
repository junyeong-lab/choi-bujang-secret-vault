-- Peer-inspired Stage 11 server-issued opaque browser handle.
-- The earlier approved WebAuthn credentials remain intact for rollback.
create table if not exists public.step11_device_handles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  handle_sha256 text not null unique check (handle_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','approved','revoked')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists step11_device_handles_owner_state_idx
  on public.step11_device_handles(owner_id,status);
alter table public.step11_device_handles enable row level security;
revoke all on public.step11_device_handles from public,anon,authenticated;
grant select,insert on public.step11_device_handles to service_role;
