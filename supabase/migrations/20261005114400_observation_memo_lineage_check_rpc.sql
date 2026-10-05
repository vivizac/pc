create or replace function private.olli_note_draft_lineage_check_impl(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_note_type text,
  p_local_content text,
  p_remote_content text,
  p_local_revision bigint,
  p_remote_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_note_type text := btrim(coalesce(p_note_type, ''));
  v_local_hash text := md5(coalesce(p_local_content, ''));
  v_remote_hash text := md5(coalesce(p_remote_content, ''));
  v_local_revision bigint := greatest(coalesce(p_local_revision, 0), 0);
  v_remote_revision bigint := greatest(coalesce(p_remote_revision, 0), 0);
  v_local_seen_revision bigint := 0;
  v_remote_prior_revision bigint := 0;
  v_local_exact_revision boolean := false;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null or not exists (
    select 1 from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and m.role in ('owner','manager','teacher')
  ) then
    return jsonb_build_object('ok', false, 'code', 'PERMISSION_DENIED');
  end if;

  if p_student_id is null or v_note_type = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  select coalesce(max(l.revision), 0)
    into v_local_seen_revision
  from private.olli_note_draft_lineage l
  where l.academy_id = p_academy_id
    and l.student_id = p_student_id
    and l.note_type = v_note_type
    and l.content_hash = v_local_hash;

  select exists (
    select 1
    from private.olli_note_draft_lineage l
    where l.academy_id = p_academy_id
      and l.student_id = p_student_id
      and l.note_type = v_note_type
      and l.revision = v_local_revision
      and l.content_hash = v_local_hash
  ) into v_local_exact_revision;

  select coalesce(max(l.revision), 0)
    into v_remote_prior_revision
  from private.olli_note_draft_lineage l
  where l.academy_id = p_academy_id
    and l.student_id = p_student_id
    and l.note_type = v_note_type
    and l.revision < v_remote_revision
    and l.content_hash = v_remote_hash;

  return jsonb_build_object(
    'ok', true,
    'local_known', v_local_exact_revision or v_local_seen_revision > 0,
    'local_exact_revision', v_local_exact_revision,
    'local_seen_revision', v_local_seen_revision,
    'remote_prior_revision', v_remote_prior_revision,
    'remote_is_historical_reversion',
      v_remote_prior_revision > 0 and v_local_seen_revision > v_remote_prior_revision
  );
end;
$$;

revoke all on function private.olli_note_draft_lineage_check_impl(text, uuid, uuid, text, text, text, bigint, bigint) from public;
grant execute on function private.olli_note_draft_lineage_check_impl(text, uuid, uuid, text, text, text, bigint, bigint) to anon, authenticated;

create or replace function public.olli_note_draft_lineage_check(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_note_type text,
  p_local_content text,
  p_remote_content text,
  p_local_revision bigint,
  p_remote_revision bigint
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.olli_note_draft_lineage_check_impl(
    p_session_token, p_academy_id, p_student_id, p_note_type,
    p_local_content, p_remote_content, p_local_revision, p_remote_revision
  );
$$;

revoke all on function public.olli_note_draft_lineage_check(text, uuid, uuid, text, text, text, bigint, bigint) from public;
grant execute on function public.olli_note_draft_lineage_check(text, uuid, uuid, text, text, text, bigint, bigint) to anon, authenticated;
