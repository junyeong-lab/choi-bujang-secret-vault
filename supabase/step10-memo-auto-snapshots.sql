-- ALEPH step 10: safely retain the first owner-bound memo baseline.
-- Applied to the project's public.vault_memos and step10_memo_snapshots on 2026-10-13.
-- Existing rows, previously saved snapshots, and audit entries are untouched.
-- Re-running this script replaces only the same-named trigger definitions.
-- This migration does NOT retroactively claim currently existing data was clean before an attack.

CREATE OR REPLACE FUNCTION public.step10_capture_memo_before_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_id text;
  v_owner uuid;
  v_title text;
  v_content text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_id := NEW.id;
    v_owner := NEW.owner_id;
    v_title := NEW.title;
    v_content := NEW.content;
  ELSE
    v_id := OLD.id;
    v_owner := OLD.owner_id;
    v_title := OLD.title;
    v_content := OLD.content;
  END IF;
  IF v_owner IS NOT NULL
     AND v_id ~ '^[A-Za-z0-9_-]{1,128}$'
     AND v_title IS NOT NULL
     AND v_content IS NOT NULL THEN
    INSERT INTO public.step10_memo_snapshots
      (memo_id, owner_id, title, content, content_sha256, source)
    VALUES
      (v_id, v_owner, v_title, v_content,
       encode(sha256(convert_to(v_content,'UTF8')),'hex'),
       'step10_auto_prechange_v1')
    ON CONFLICT (memo_id) DO NOTHING;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.step10_capture_memo_before_change()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS step10_snapshot_first_insert ON public.vault_memos;
DROP TRIGGER IF EXISTS step10_snapshot_before_modify ON public.vault_memos;

CREATE TRIGGER step10_snapshot_first_insert
AFTER INSERT ON public.vault_memos
FOR EACH ROW EXECUTE FUNCTION public.step10_capture_memo_before_change();

CREATE TRIGGER step10_snapshot_before_modify
BEFORE UPDATE OR DELETE ON public.vault_memos
FOR EACH ROW EXECUTE FUNCTION public.step10_capture_memo_before_change();

-- Read-only verification:
SELECT t.tgname, t.tgenabled
FROM pg_trigger t
WHERE t.tgrelid='public.vault_memos'::regclass
  AND t.tgname IN ('step10_snapshot_first_insert','step10_snapshot_before_modify')
  AND NOT t.tgisinternal
ORDER BY t.tgname;
