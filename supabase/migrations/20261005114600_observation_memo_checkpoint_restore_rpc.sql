create or replace function private.olli_note_draft_version_restore_impl(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_note_type text,
  p_target_revision bigint,
  p_expected_revision bigint,
  p_mutation_id text default null,
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
  v_target private.olli_note_draft_checkpoints%rowtype;
  v_current public.student_note_drafts%rowtype;
  v_expected bigint := coalesce(p_expected_revision, 0);
  v_mutation_id text := nullif(btrim(coalesce(p_mutation_id, '')), '');
  v_device_id text := nullif(btrim(coalesce(p_device_id, '')), '');
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null or not exists (
    select 1
    from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and m.role in ('owner','manager','teacher')
  ) then
    return jsonb_build_object('ok', false, 'code', 'PERMISSION_DENIED', 'message', '관찰노트 이전 기록을 복구할 권한이 없습니다.');
  end if;

  if p_student_id is null or v_note_type = '' or p_target_revision is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', '복구할 관찰노트 버전을 확인해 주세요.');
  end if;

  perform private.olli_prune_note_checkpoint_history();

  select * into v_target
  from private.olli_note_draft_checkpoints c
  where c.academy_id = p_academy_id
    and c.student_id = p_student_id
    and c.note_type = v_note_type
    and c.revision = p_target_revision;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'VERSION_NOT_FOUND', 'message', '복구할 이전 기록을 찾지 못했습니다.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':note-draft:' || p_student_id::text || ':' || v_note_type, 0
  ));

  select * into v_current
  from public.student_note_drafts d
  where d.academy_id = p_academy_id
    and d.student_id = p_student_id
    and d.note_type = v_note_type
  for update;

  if found then
    if v_current.revision <> v_expected then
      return jsonb_build_object(
        'ok', false,
        'code', 'REVISION_CONFLICT',
        'message', '이전 기록을 선택한 뒤 다른 기기에서 관찰노트가 변경되었습니다. 최신 내용을 확인해 주세요.',
        'expected_revision', v_expected,
        'server_revision', v_current.revision,
        'server_content', coalesce(v_current.content, ''),
        'server_updated_at', v_current.updated_at
      );
    end if;

    if v_current.revision = v_target.revision and coalesce(v_current.content, '') = v_target.content then
      return jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'result', 'already_current',
        'revision', v_current.revision,
        'content', coalesce(v_current.content, ''),
        'updated_at', v_current.updated_at
      );
    end if;

    insert into private.olli_note_draft_checkpoints (
      academy_id, student_id, note_type, revision, content,
      saved_at, account_id, device_id, source
    ) values (
      v_current.academy_id, v_current.student_id, v_current.note_type, v_current.revision,
      coalesce(v_current.content, ''), now(), v_account_id,
      coalesce(v_device_id, v_current.updated_by_device_id), 'pre_restore'
    )
    on conflict (academy_id, student_id, note_type, revision) do nothing;

    perform set_config('olli.note_version_source', 'history_restore', true);
    perform set_config('olli.note_version_source_revision', v_target.revision::text, true);

    update public.student_note_drafts
       set content = v_target.content,
           revision = v_current.revision + 1,
           updated_at = now(),
           last_mutation_id = v_mutation_id,
           updated_by_account_id = v_account_id,
           updated_by_device_id = v_device_id
     where id = v_current.id
     returning * into v_current;
  else
    if v_expected <> 0 then
      return jsonb_build_object(
        'ok', false,
        'code', 'REVISION_CONFLICT',
        'message', '현재 관찰노트 버전이 예상과 다릅니다. 최신 내용을 확인해 주세요.',
        'expected_revision', v_expected,
        'server_revision', 0,
        'server_content', '',
        'server_updated_at', null
      );
    end if;

    perform set_config('olli.note_version_source', 'history_restore', true);
    perform set_config('olli.note_version_source_revision', v_target.revision::text, true);

    insert into public.student_note_drafts (
      academy_id, student_id, student_name, note_type, content,
      revision, updated_at, last_mutation_id,
      updated_by_account_id, updated_by_device_id
    )
    select p_academy_id, p_student_id, s.name, v_note_type, v_target.content,
           1, now(), v_mutation_id, v_account_id, v_device_id
    from public.students s
    where s.id = p_student_id and s.academy_id = p_academy_id
    returning * into v_current;

    if v_current.id is null then
      return jsonb_build_object('ok', false, 'code', 'STUDENT_NOT_FOUND', 'message', '학생 정보를 찾지 못했습니다.');
    end if;
  end if;

  perform private.olli_prune_note_checkpoint_history();

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'result', 'restored',
    'student_id', p_student_id,
    'note_type', v_note_type,
    'restored_from_revision', v_target.revision,
    'revision', v_current.revision,
    'content', coalesce(v_current.content, ''),
    'updated_at', v_current.updated_at
  );
end;
$$;
