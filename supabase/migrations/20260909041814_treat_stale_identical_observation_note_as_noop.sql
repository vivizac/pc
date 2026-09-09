create or replace function public.olli_note_draft_save_cas(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_note_type text,
  p_content text,
  p_expected_revision bigint default null,
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
  v_current public.student_note_drafts%rowtype;
  v_note_type text := btrim(coalesce(p_note_type, ''));
  v_content text := coalesce(p_content, '');
  v_mutation_id text := nullif(btrim(coalesce(p_mutation_id, '')), '');
  v_device_id text := nullif(btrim(coalesce(p_device_id, '')), '');
  v_expected bigint := coalesce(p_expected_revision, 0);
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null or not exists (
    select 1 from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and m.role in ('owner','manager','teacher')
  ) then
    return jsonb_build_object('ok', false, 'code', 'PERMISSION_DENIED', 'message', '관찰노트를 저장할 권한이 없습니다.');
  end if;

  if p_student_id is null or v_note_type = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', '관찰노트 저장 정보를 확인해 주세요.');
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
    and d.note_type = v_note_type
  for update;

  if found then
    if v_mutation_id is not null and v_current.last_mutation_id = v_mutation_id then
      return jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'no_change', coalesce(v_current.content, '') = v_content,
        'revision', v_current.revision,
        'updated_at', v_current.updated_at,
        'content', coalesce(v_current.content, ''),
        'student_id', v_current.student_id,
        'note_type', v_current.note_type
      );
    end if;

    if coalesce(v_current.content, '') = v_content then
      return jsonb_build_object(
        'ok', true,
        'idempotent', false,
        'no_change', true,
        'revision', v_current.revision,
        'updated_at', v_current.updated_at,
        'content', coalesce(v_current.content, ''),
        'student_id', v_current.student_id,
        'note_type', v_current.note_type
      );
    end if;

    if v_current.revision <> v_expected then
      insert into private.olli_data_conflicts (
        academy_id, feature, student_id, entity_key,
        base_revision, server_revision, rejected_payload,
        mutation_id, account_id, device_id
      ) values (
        p_academy_id, 'student_note_draft', p_student_id,
        p_student_id::text || ':' || v_note_type,
        v_expected, v_current.revision,
        jsonb_build_object('note_type', v_note_type, 'content', v_content),
        v_mutation_id, v_account_id, v_device_id
      ) on conflict do nothing;

      return jsonb_build_object(
        'ok', false,
        'code', 'REVISION_CONFLICT',
        'message', '다른 기기에서 더 최신 관찰노트가 저장되었습니다.',
        'expected_revision', v_expected,
        'server_revision', v_current.revision,
        'server_content', coalesce(v_current.content, ''),
        'server_updated_at', v_current.updated_at
      );
    end if;

    update public.student_note_drafts
       set content = v_content,
           revision = v_current.revision + 1,
           updated_at = now(),
           last_mutation_id = v_mutation_id,
           updated_by_account_id = v_account_id,
           updated_by_device_id = v_device_id,
           student_name = coalesce((select s.name from public.students s where s.id = p_student_id), v_current.student_name)
     where id = v_current.id
     returning * into v_current;
  else
    if v_expected <> 0 then
      insert into private.olli_data_conflicts (
        academy_id, feature, student_id, entity_key,
        base_revision, server_revision, rejected_payload,
        mutation_id, account_id, device_id
      ) values (
        p_academy_id, 'student_note_draft', p_student_id,
        p_student_id::text || ':' || v_note_type,
        v_expected, 0,
        jsonb_build_object('note_type', v_note_type, 'content', v_content),
        v_mutation_id, v_account_id, v_device_id
      ) on conflict do nothing;

      return jsonb_build_object(
        'ok', false,
        'code', 'REVISION_CONFLICT',
        'message', '관찰노트 서버 버전이 예상과 다릅니다.',
        'expected_revision', v_expected,
        'server_revision', 0,
        'server_content', '',
        'server_updated_at', null
      );
    end if;

    insert into public.student_note_drafts (
      academy_id, student_id, student_name, note_type, content,
      revision, updated_at, last_mutation_id,
      updated_by_account_id, updated_by_device_id
    )
    select p_academy_id, p_student_id, s.name, v_note_type, v_content,
           1, now(), v_mutation_id, v_account_id, v_device_id
      from public.students s
     where s.id = p_student_id and s.academy_id = p_academy_id
    returning * into v_current;
  end if;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'no_change', false,
    'revision', v_current.revision,
    'updated_at', v_current.updated_at,
    'content', coalesce(v_current.content, ''),
    'student_id', v_current.student_id,
    'note_type', v_current.note_type
  );
end;
$$;
