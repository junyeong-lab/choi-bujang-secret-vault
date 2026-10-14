-- Expand the existing restore-only audit outcome to real lifecycle events.
-- No DELETE/UPDATE/TRUNCATE of audit rows is performed. Existing rows remain intact.
-- The append-only trigger remains active.
ALTER TABLE public.step10_restore_audit
  DROP CONSTRAINT IF EXISTS step10_restore_audit_outcome_check;
ALTER TABLE public.step10_restore_audit
  ADD CONSTRAINT step10_restore_audit_outcome_check
  CHECK (outcome IN ('started','restored','failed','denied'));
