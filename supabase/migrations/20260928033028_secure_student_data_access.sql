create or replace function public.olli_student_data_access(
  p_session_token text,
  p_academy_id uuid,
  p_action text,
  p_operation text,
  p_identity jsonb default '{}'::jsonb,
  p_payload jsonb default '{}'::jsonb,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_role text;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_operation text := lower(btrim(coalesce(p_operation, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 5000);
  v_student_id uuid;
  v_student_id_text text := btrim(coalesce(p_identity->>'id', p_payload->>'id', ''));
  v_payload_academy_id uuid;
  v_rows jsonb := '[]'::jsonb;
  v_row public.students%rowtype;
  v_name text;
  v_division text;
  v_status text;
begin
  if p_academy_id is null then
    return jsonb_build_object('ok', false, 'code', 'ACADEMY_ID_MISSING', 'message', '학원 정보를 확인할 수 없습니다.');
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'code', 'SESSION_INVALID', 'message', '계정 세션이 만료되었거나 올바르지 않습니다.');
  end if;

  select m.role
    into v_role
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and m.role in ('owner', 'manager', 'teacher', 'super_admin')
    and a.status = 'active'
    and a.deleted_at is null
  limit 1;

  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'PERMISSION_DENIED', 'message', '현재 학원의 학생 데이터에 접근할 권한이 없습니다.');
  end if;

  if nullif(btrim(coalesce(p_payload->>'academy_id', '')), '') is not null then
    begin
      v_payload_academy_id := (p_payload->>'academy_id')::uuid;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ACADEMY_ID', 'message', '학생 저장 학원 ID가 올바르지 않습니다.');
    end;
    if v_payload_academy_id is distinct from p_academy_id then
      return jsonb_build_object('ok', false, 'code', 'ACADEMY_MISMATCH', 'message', '다른 학원의 학생 데이터는 처리할 수 없습니다.');
    end if;
  end if;

  if v_student_id_text <> '' then
    begin
      v_student_id := v_student_id_text::uuid;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'INVALID_STUDENT_ID', 'message', '학생 ID가 올바르지 않습니다.');
    end;
  end if;

  if v_action = 'read' then
    if v_student_id is not null then
      select s.*
        into v_row
      from public.students s
      where s.academy_id = p_academy_id
        and s.id = v_student_id
      limit 1;

      if not found then
        return jsonb_build_object('ok', true, 'rows', '[]'::jsonb);
      end if;

      return jsonb_build_object('ok', true, 'rows', jsonb_build_array(to_jsonb(v_row)));
    end if;

    select coalesce(jsonb_agg(to_jsonb(q) order by q.name, q.id), '[]'::jsonb)
      into v_rows
    from (
      select s.*
      from public.students s
      where s.academy_id = p_academy_id
      order by s.name, s.id
      limit v_limit
    ) q;

    return jsonb_build_object('ok', true, 'rows', v_rows);
  end if;

  if v_action not in ('write', 'remove') then
    return jsonb_build_object('ok', false, 'code', 'ACTION_NOT_ALLOWED', 'message', '지원하지 않는 학생 데이터 작업입니다.');
  end if;

  if v_student_id is null then
    return jsonb_build_object('ok', false, 'code', 'STUDENT_ID_MISSING', 'message', '학생 ID가 없습니다.');
  end if;

  if v_operation in ('upsert', 'insert', 'post') then
    v_name := btrim(coalesce(p_payload->>'name', ''));
    if v_name = '' then
      return jsonb_build_object('ok', false, 'code', 'STUDENT_NAME_MISSING', 'message', '학생 이름이 없습니다.');
    end if;

    v_division := lower(btrim(coalesce(p_payload->>'division', 'elementary')));
    if v_division not in ('elementary', 'kinder') then
      return jsonb_build_object('ok', false, 'code', 'INVALID_DIVISION', 'message', '학생 소속 구분이 올바르지 않습니다.');
    end if;

    v_status := lower(btrim(coalesce(p_payload->>'status', 'active')));
    if v_status not in ('active', 'paused', 'withdrawn', 'inactive') then
      return jsonb_build_object('ok', false, 'code', 'INVALID_STUDENT_STATUS', 'message', '학생 상태가 올바르지 않습니다.');
    end if;

    insert into public.students as s (
      id, academy_id, academy_name, academy_region, name, division, enrolled_at,
      kindergarten, age, birth_year, school_entry_year, previous_division,
      division_changed_at, lesson_day, lesson_time, group_no, group_months,
      feedback_months, personality, school, grade, class_no, status,
      withdrawn_at, paused_at, status_changed_at, updated_at
    ) values (
      v_student_id,
      p_academy_id,
      nullif(p_payload->>'academy_name', ''),
      nullif(p_payload->>'academy_region', ''),
      v_name,
      v_division,
      nullif(p_payload->>'enrolled_at', '')::date,
      nullif(p_payload->>'kindergarten', ''),
      nullif(p_payload->>'age', ''),
      nullif(p_payload->>'birth_year', '')::integer,
      nullif(p_payload->>'school_entry_year', '')::integer,
      nullif(p_payload->>'previous_division', ''),
      nullif(p_payload->>'division_changed_at', '')::timestamptz,
      nullif(p_payload->>'lesson_day', ''),
      nullif(p_payload->>'lesson_time', ''),
      nullif(p_payload->>'group_no', ''),
      nullif(p_payload->>'group_months', ''),
      nullif(p_payload->>'feedback_months', ''),
      nullif(p_payload->>'personality', ''),
      nullif(p_payload->>'school', ''),
      nullif(p_payload->>'grade', ''),
      nullif(p_payload->>'class_no', ''),
      v_status,
      nullif(p_payload->>'withdrawn_at', '')::timestamptz,
      nullif(p_payload->>'paused_at', '')::timestamptz,
      nullif(p_payload->>'status_changed_at', '')::timestamptz,
      now()
    )
    on conflict (id) do update set
      academy_name = excluded.academy_name,
      academy_region = excluded.academy_region,
      name = excluded.name,
      division = excluded.division,
      enrolled_at = excluded.enrolled_at,
      kindergarten = excluded.kindergarten,
      age = excluded.age,
      birth_year = excluded.birth_year,
      school_entry_year = excluded.school_entry_year,
      previous_division = excluded.previous_division,
      division_changed_at = excluded.division_changed_at,
      lesson_day = excluded.lesson_day,
      lesson_time = excluded.lesson_time,
      group_no = excluded.group_no,
      group_months = excluded.group_months,
      feedback_months = excluded.feedback_months,
      personality = excluded.personality,
      school = excluded.school,
      grade = excluded.grade,
      class_no = excluded.class_no,
      status = excluded.status,
      withdrawn_at = excluded.withdrawn_at,
      paused_at = excluded.paused_at,
      status_changed_at = excluded.status_changed_at,
      updated_at = now()
    where s.academy_id = p_academy_id
    returning s.* into v_row;

    if not found then
      return jsonb_build_object('ok', false, 'code', 'STUDENT_ACADEMY_MISMATCH', 'message', '다른 학원에 속한 학생 ID는 수정할 수 없습니다.');
    end if;

    return jsonb_build_object('ok', true, 'rows', jsonb_build_array(to_jsonb(v_row)));
  end if;

  if v_operation in ('patch', 'update') then
    if p_payload ? 'is_deleted' then
      return jsonb_build_object('ok', false, 'code', 'SOFT_DELETE_OPERATION_REQUIRED', 'message', '학생 삭제는 soft_delete 작업으로만 처리할 수 있습니다.');
    end if;

    if p_payload ? 'status' then
      v_status := lower(btrim(coalesce(p_payload->>'status', '')));
      if v_status not in ('active', 'paused', 'withdrawn', 'inactive') then
        return jsonb_build_object('ok', false, 'code', 'INVALID_STUDENT_STATUS', 'message', '학생 상태가 올바르지 않습니다.');
      end if;
    end if;

    update public.students s
       set status = case when p_payload ? 'status' then v_status else s.status end,
           withdrawn_at = case when p_payload ? 'withdrawn_at' then nullif(p_payload->>'withdrawn_at', '')::timestamptz else s.withdrawn_at end,
           paused_at = case when p_payload ? 'paused_at' then nullif(p_payload->>'paused_at', '')::timestamptz else s.paused_at end,
           status_changed_at = case when p_payload ? 'status_changed_at' then nullif(p_payload->>'status_changed_at', '')::timestamptz else s.status_changed_at end,
           updated_at = now()
     where s.academy_id = p_academy_id
       and s.id = v_student_id
     returning s.* into v_row;

    if not found then
      return jsonb_build_object('ok', false, 'code', 'STUDENT_NOT_FOUND', 'message', '현재 학원에서 학생을 찾을 수 없습니다.');
    end if;

    return jsonb_build_object('ok', true, 'rows', jsonb_build_array(to_jsonb(v_row)));
  end if;

  if v_operation = 'soft_delete' then
    if coalesce((p_payload->>'is_deleted')::boolean, true) is not true then
      return jsonb_build_object('ok', false, 'code', 'INVALID_SOFT_DELETE', 'message', '학생 삭제 상태값이 올바르지 않습니다.');
    end if;

    update public.students s
       set is_deleted = true,
           deleted_at = coalesce(nullif(p_payload->>'deleted_at', '')::timestamptz, now()),
           deleted_by = nullif(p_payload->>'deleted_by', ''),
           delete_reason = coalesce(nullif(p_payload->>'delete_reason', ''), 'student_deleted'),
           updated_at = now()
     where s.academy_id = p_academy_id
       and s.id = v_student_id
     returning s.* into v_row;

    if not found then
      return jsonb_build_object('ok', false, 'code', 'STUDENT_NOT_FOUND', 'message', '현재 학원에서 학생을 찾을 수 없습니다.');
    end if;

    return jsonb_build_object('ok', true, 'rows', jsonb_build_array(to_jsonb(v_row)));
  end if;

  return jsonb_build_object('ok', false, 'code', 'OPERATION_NOT_ALLOWED', 'message', '지원하지 않는 학생 데이터 저장 방식입니다.');
end;
$function$;

revoke all on function public.olli_student_data_access(text, uuid, text, text, jsonb, jsonb, integer) from public;
revoke all on function public.olli_student_data_access(text, uuid, text, text, jsonb, jsonb, integer) from anon, authenticated;
grant execute on function public.olli_student_data_access(text, uuid, text, text, jsonb, jsonb, integer) to anon, authenticated;
