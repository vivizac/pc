create or replace function private.olli_note_draft_checkpoint_create_impl(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_note_type text,
  p_device_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_note_type text := btrim(coalesce(p_note_type, ''));
  v_device_id text := nullif(btrim(coalesce(p_device_id, '')), '');
  v_current public.student_note_drafts%rowtype;
  v_created boolean := false;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null or not exists (
    select 1 from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and m.role in ('owner','manager','teacher')
  ) then
    return jsonb_build_object('ok', false, 'code', 'PERMISSION_DENIED', 'message', '관찰노트 복구 지점을 저장할 권한이 없습니다.');
  end if;

  if p_student_id is null or v_note_type = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', '관찰노트 복구 지점 정보를 확인해 주세요.');
  end if;

  if not exists (
    select 1 from public.students s
    where s.id = p_student_id
      and s.academy_id = p_academy_id
      and coalesce(s.is_deleted, false) = false
  ) then
    return jsonb_build_object('ok', false, 'code', 'STUDENT_NOT_FOUND', 'message', '학생 정보를 찾을 수 없습니다.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':note-draft:' || p_student_id::text || ':' || v_note_type, 0
  ));

  select * into v_current
  from public.student_note_drafts d
  where d.academy_id = p_academy_id
    and d.student_id = p_student_id
    and d.note_type = v_note_type;

  if not found then
    perform private.olli_prune_note_checkpoint_history();
    return jsonb_build_object('ok', true, 'created', false, 'no_draft', true, 'revision', 0);
  end if;

  insert into private.olli_note_draft_checkpoints (
    academy_id, student_id, note_type, revision, content,
    saved_at, account_id, device_id, source
  ) values (
    v_current.academy_id,
    v_current.student_id,
    v_current.note_type,
    v_current.revision,
    coalesce(v_current.content, ''),
    now(),
    coalesce(v_current.updated_by_account_id, v_account_id),
    coalesce(v_device_id, v_current.updated_by_device_id),
    'memo_exit'
  )
  on conflict (academy_id, student_id, note_type, revision) do nothing;

  get diagnostics v_created = row_count;
  perform private.olli_prune_note_checkpoint_history();

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'revision', v_current.revision,
    'saved_at', now()
  );
end;
$$;

revoke all on function private.olli_note_draft_checkpoint_create_impl(text, uuid, uuid, text, text) from public;
grant execute on function private.olli_note_draft_checkpoint_create_impl(text, uuid, uuid, text, text) to anon, authenticated;

create or replace function public.olli_note_draft_checkpoint_create(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_note_type text,
  p_device_id text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.olli_note_draft_checkpoint_create_impl(
    p_session_token, p_academy_id, p_student_id, p_note_type, p_device_id
  );
$$;

revoke all on function public.olli_note_draft_checkpoint_create(text, uuid, uuid, text, text) from public;
grant execute on function public.olli_note_draft_checkpoint_create(text, uuid, uuid, text, text) to anon, authenticated;
