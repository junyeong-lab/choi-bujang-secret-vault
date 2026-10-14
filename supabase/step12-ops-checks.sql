-- Stage 12: isolated, redacted server-side HTTP observation log.
-- Never store cookies, bearer tokens, device handles, note text or response bodies.
CREATE TABLE IF NOT EXISTS public.step12_ops_checks (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null,
  request_id uuid not null unique,
  attack_id text not null check (attack_id ~ '^[a-z][a-z0-9_]{2,79}$'),
  label text not null check (char_length(label) between 1 and 120),
  expected text not null check (char_length(expected) between 1 and 120),
  method text not null check (method='GET'),
  path text not null check (char_length(path) between 1 and 160),
  observed_http integer not null check (observed_http between 100 and 599),
  outcome text not null check (outcome in ('matched','mismatched')),
  checked_at timestamptz not null default now(),
  source text not null default 'production_http' check (source = 'production_http')
);
CREATE INDEX IF NOT EXISTS step12_ops_checks_owner_checked
  ON public.step12_ops_checks(owner_id,checked_at desc);
ALTER TABLE public.step12_ops_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.step12_ops_checks FROM public,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.step12_ops_checks TO service_role;
-- Only trusted server functions can query/append. No client update/delete.
