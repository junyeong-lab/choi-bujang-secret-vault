-- ALEPH step 10: current verified restore RPC definition, captured after the title-only fix.
-- This preserves existing owner checks, snapshot integrity, optimistic locking,
-- single-memo restore and audit insert. Does not insert/edit/delete memo data by itself.
-- Execute only after the stage10 snapshot and audit tables are installed.

CREATE OR REPLACE FUNCTION public.step10_restore_one_memo(p_id text, p_owner_id uuid, p_expected_current_hash text, p_snapshot_hash text, p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_snapshot public.step10_memo_snapshots%rowtype;
  v_current public.vault_memos%rowtype;
  v_found boolean;
  v_current_hash text;
  v_actual_snapshot_hash text;
  v_do_apply boolean := coalesce(p_apply,false);
begin
  if p_id is null or length(p_id) > 128 or p_id !~ '^[a-zA-Z0-9_-]+$'
    or p_owner_id is null
    or (p_snapshot_hash is not null and p_snapshot_hash !~ '^[0-9a-f]{64}$')
    or (p_expected_current_hash is not null and p_expected_current_hash <> 'absent' and
        p_expected_current_hash !~ '^[0-9a-f]{64}$')
    or (v_do_apply and (p_snapshot_hash is null or p_expected_current_hash is null))
  then
    return jsonb_build_object('status','invalid_request');
  end if;

  select * into v_snapshot
    from public.step10_memo_snapshots
    where memo_id=p_id and owner_id=p_owner_id
    for share;
  if not found then return jsonb_build_object('status','backup_not_found'); end if;

  v_actual_snapshot_hash := encode(sha256(convert_to(v_snapshot.content,'UTF8')),'hex');
  if v_actual_snapshot_hash <> v_snapshot.content_sha256
    or (p_snapshot_hash is not null and v_actual_snapshot_hash <> p_snapshot_hash)
  then return jsonb_build_object('status','backup_invalid'); end if;

  select * into v_current from public.vault_memos where id=p_id for update;
  v_found := found;
  if v_found and v_current.owner_id <> p_owner_id
    then return jsonb_build_object('status','owner_mismatch'); end if;

  v_current_hash := case when v_found
    then encode(sha256(convert_to(v_current.content,'UTF8')),'hex') else 'absent' end;
  if p_expected_current_hash is not null and v_current_hash <> p_expected_current_hash then
    return jsonb_build_object('status','current_changed');
  end if;

  if not v_do_apply then
    return jsonb_build_object(
      'status','preview','memoId',p_id,'ownerMatched',true,
      'currentSha256',v_current_hash,'backupSha256',v_actual_snapshot_hash,
      'wouldChange',(v_current_hash <> v_actual_snapshot_hash OR v_current.title IS DISTINCT FROM v_snapshot.title)
    );
  end if;

  if v_found then
    update public.vault_memos
      set title = v_snapshot.title, content = v_snapshot.content
      where id = p_id and owner_id = p_owner_id;
  else
    insert into public.vault_memos (id,owner_id,title,content)
    values (v_snapshot.memo_id,v_snapshot.owner_id,v_snapshot.title,v_snapshot.content);
  end if;
  if not exists (
    select 1 from public.vault_memos
    where id=p_id and owner_id=p_owner_id and
    encode(sha256(convert_to(content,'UTF8')),'hex')=v_actual_snapshot_hash
  ) then raise exception 'restoration_validation_failed'; end if;

  insert into public.step10_restore_audit (memo_id,owner_id,before_sha256,after_sha256,outcome)
    values (p_id,p_owner_id,v_current_hash,v_actual_snapshot_hash,'restored');
  return jsonb_build_object('status','restored','memoId',p_id,'ownerMatched',true,
    'contentSha256',v_actual_snapshot_hash);
end $function$
;
