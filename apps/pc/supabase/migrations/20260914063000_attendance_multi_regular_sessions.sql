create or replace function public.olli_schedule_set_attendance_session_status_v2(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_session_date date,
  p_session_kind text,
  p_time_slot integer,
  p_class_group text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account_id uuid;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_kind text := lower(btrim(coalesce(p_session_kind, '')));
  v_group text := upper(btrim(coalesce(p_class_group, 'A')));
  v_weekday integer;
  v_found boolean := false;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '출석부를 변경할 권한이 없습니다.');
  end if;

  if p_student_id is null or p_session_date is null or v_kind not in ('regular','makeup') then
    return jsonb_build_object('ok', false, 'message', '출석 수업 유형을 확인해 주세요.');
  end if;
  if coalesce(p_time_slot, 0) < 1 or coalesce(p_time_slot, 0) > 12 or v_group not in ('A','B') then
    return jsonb_build_object('ok', false, 'message', '출석 수업 시간 정보를 확인해 주세요.');
  end if;
  if (v_kind = 'regular' and v_status not in ('present','absent','blank'))
     or (v_kind = 'makeup' and v_status not in ('makeup','blank')) then
    return jsonb_build_object('ok', false, 'message', '출석부 변경 값을 확인해 주세요.');
  end if;

  if not exists (
    select 1 from public.students s
    where s.id = p_student_id and s.academy_id = p_academy_id
      and s.status = 'active' and coalesce(s.is_deleted, false) = false
  ) then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;

  v_weekday := extract(isodow from p_session_date)::integer;
  if v_kind = 'regular' then
    select true into v_found
    from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id
      and e.student_id = p_student_id
      and e.weekday = v_weekday
      and e.time_slot = p_time_slot
      and coalesce(nullif(e.class_group,''),'A') = v_group
      and e.status = 'active'
      and e.effective_from <= p_session_date
      and (e.effective_to is null or e.effective_to >= p_session_date)
    limit 1;
  else
    select true into v_found
    from public.olli_schedule_one_time_sessions o
    where o.academy_id = p_academy_id
      and o.student_id = p_student_id
      and o.session_date = p_session_date
      and o.time_slot = p_time_slot
      and coalesce(nullif(o.class_group,''),'A') = v_group
      and o.status <> 'cancelled'
    limit 1;
  end if;

  if not coalesce(v_found, false) then
    return jsonb_build_object('ok', false, 'message', case when v_kind='regular' then '해당 날짜의 정규 수업을 찾을 수 없습니다.' else '해당 날짜의 보강 수업을 찾을 수 없습니다.' end);
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':attendance-session-v2:' || p_student_id::text || ':' || p_session_date::text || ':' || v_kind || ':' || p_time_slot::text || ':' || v_group,
    0
  ));

  if p_session_date <= current_date then
    perform private.olli_schedule_apply_attendance_state(
      p_academy_id, p_student_id, p_session_date, p_time_slot, v_group, v_kind, false, v_account_id
    );
    if (v_kind = 'regular' and v_status = 'present') or (v_kind = 'makeup' and v_status = 'makeup') then
      perform private.olli_schedule_apply_attendance_state(
        p_academy_id, p_student_id, p_session_date, p_time_slot, v_group, v_kind, true, v_account_id
      );
    end if;
  end if;

  insert into private.olli_schedule_attendance_session_overrides (
    academy_id, student_id, session_date, time_slot, class_group, session_kind, status, updated_by_account_id, updated_at
  ) values (
    p_academy_id, p_student_id, p_session_date, p_time_slot, v_group, v_kind, v_status, v_account_id, now()
  )
  on conflict (academy_id, student_id, session_date, time_slot, class_group, session_kind)
  do update set
    status = excluded.status,
    updated_by_account_id = excluded.updated_by_account_id,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'status', v_status,
    'session_kind', v_kind,
    'session_date', p_session_date,
    'time_slot', p_time_slot,
    'class_group', v_group
  );
end;
$function$;

revoke all on function public.olli_schedule_set_attendance_session_status_v2(text,uuid,uuid,date,text,integer,text,text) from public;
grant execute on function public.olli_schedule_set_attendance_session_status_v2(text,uuid,uuid,date,text,integer,text,text) to anon, authenticated;
