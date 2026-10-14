-- Stage 10: prevent modification or erasure of existing restoration audit history.
-- The trigger makes the audit table append-only. It does not create audit rows,
-- change memo content or owners, modify backups, or alter access policies.
-- Review and apply as a schema migration; never rerun with production data deletion.
create or replace function public.step10_restore_audit_append_only()
returns trigger
language plpgsql
set search_path = 'pg_catalog', 'public'
as $$
begin
  raise exception 'step10_restore_audit is append-only';
end;
$$;

drop trigger if exists step10_restore_audit_immutable on public.step10_restore_audit;
create trigger step10_restore_audit_immutable
before update or delete or truncate on public.step10_restore_audit
for each statement execute function public.step10_restore_audit_append_only();

revoke all on function public.step10_restore_audit_append_only()
from public, anon, authenticated;
