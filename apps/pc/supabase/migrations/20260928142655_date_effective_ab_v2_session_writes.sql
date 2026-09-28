CREATE OR REPLACE FUNCTION public.olli_schedule_add_guest_entry(p_session_token text, p_academy_id uuid, p_guest_name text, p_division text, p_entry_type text, p_session_date date, p_time_slot integer, p_class_group text DEFAULT 'A'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_name text := left(btrim(coalesce(p_guest_name, '')), 60);
  v_division text := lower(btrim(coalesce(p_division, '')));
  v_entry_type text := lower(btrim(coalesce(p_entry_type, '')));
  v_class_group text := upper(coalesce(nullif(btrim(p_class_group), ''), 'A'));
  v_weekday integer;
  v_capacity integer;
  v_occupancy integer;
  v_id uuid;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null or not exists (
    select 1 from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and m.role in ('owner','manager','teacher')
  ) then
    return jsonb_build_object('ok', false, 'message', '시간표를 변경할 권한이 없습니다.');
  end if;

  if v_name = '' then
    return jsonb_build_object('ok', false, 'message', '학생 이름을 입력해 주세요.');
  end if;
  if v_division not in ('elementary','kinder') then
    return jsonb_build_object('ok', false, 'message', '초등부 또는 유치부를 확인해 주세요.');
  end if;
  if v_entry_type not in ('wait','trial') then
    return jsonb_build_object('ok', false, 'message', '등록 유형을 확인해 주세요.');
  end if;
  if p_session_date is null or p_session_date < current_date then
    return jsonb_build_object('ok', false, 'message', '등록 날짜를 확인해 주세요.');
  end if;

  v_weekday := extract(isodow from p_session_date)::integer;
  if v_weekday not between 1 and 6 then
    return jsonb_build_object('ok', false, 'message', '일요일에는 등록할 수 없습니다.');
  end if;
  if private.olli_schedule_is_closed_day(p_academy_id, p_session_date) then
    return jsonb_build_object('ok', false, 'message', '공휴일에는 등록할 수 없습니다. 정상수업으로 전환한 뒤 다시 시도해 주세요.');
  end if;

  if (v_division = 'elementary' and v_weekday = 6 and p_time_slot not in (10,11,12))
     or (v_division = 'elementary' and v_weekday <> 6 and p_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_time_slot not in (4,5)) then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜의 수업 시간을 확인해 주세요.');
  end if;

  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, v_weekday, p_time_slot, p_session_date) then
    v_class_group := 'A';
  elsif v_class_group not in ('A','B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  perform set_config('olli.actor_account_id', v_account_id::text, true);

  if v_entry_type = 'wait' then
    perform set_config('olli.schedule_action', 'guest_wait_add', true);
    perform pg_advisory_xact_lock(hashtextextended(
      p_academy_id::text || ':wait:' || v_division || ':' || v_weekday::text || ':' || p_time_slot::text,
      0
    ));

    if exists (
      select 1 from public.olli_schedule_waitlist w
      where w.academy_id = p_academy_id
        and w.target_weekday = v_weekday
        and w.target_time_slot = p_time_slot
        and w.status in ('waiting','offered')
    ) then
      return jsonb_build_object('ok', false, 'message', '이 시간에는 이미 대기 학생이 있습니다.', 'waitlist_full', true);
    end if;

    insert into public.olli_schedule_waitlist (
      academy_id, student_id, guest_name, guest_division,
      target_weekday, target_time_slot, target_class_group,
      request_type, source_enrollment_id, desired_effective_date
    ) values (
      p_academy_id, null, v_name, v_division,
      v_weekday, p_time_slot, v_class_group,
      'add', null, p_session_date
    ) returning id into v_id;

    return jsonb_build_object('ok', true, 'result', 'waitlisted', 'waitlist_id', v_id, 'guest', true);
  end if;

  perform set_config('olli.schedule_action', 'trial_add', true);
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':trial:' || v_division || ':' || p_session_date::text || ':' || p_time_slot::text || ':' || v_class_group,
    0
  ));

  if exists (
    select 1 from public.olli_schedule_one_time_sessions o
    where o.academy_id = p_academy_id
      and o.student_id is null
      and o.session_type = 'trial'
      and lower(btrim(o.guest_name)) = lower(v_name)
      and o.session_date = p_session_date
      and o.time_slot = p_time_slot
      and o.class_group = v_class_group
      and o.status <> 'cancelled'
  ) then
    return jsonb_build_object('ok', false, 'message', '같은 이름의 체험수업이 이미 등록되어 있습니다.');
  end if;

  v_capacity := private.olli_schedule_capacity(p_academy_id, v_division);
  select
    (select count(*)
       from public.olli_schedule_enrollments e
       join public.students s on s.id = e.student_id
      where e.academy_id = p_academy_id
        and s.division = v_division
        and e.weekday = v_weekday
        and e.time_slot = p_time_slot
        and e.class_group = v_class_group
        and e.status = 'active'
        and e.effective_from <= p_session_date
        and (e.effective_to is null or e.effective_to >= p_session_date))
    +
    (select count(*)
       from public.olli_schedule_one_time_sessions o
       left join public.students s on s.id = o.student_id
      where o.academy_id = p_academy_id
        and coalesce(s.division, o.guest_division) = v_division
        and o.session_date = p_session_date
        and o.time_slot = p_time_slot
        and o.class_group = v_class_group
        and o.status <> 'cancelled')
  into v_occupancy;

  if v_occupancy >= v_capacity then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜와 시간의 정원이 가득 찼습니다.', 'full', true);
  end if;

  insert into public.olli_schedule_one_time_sessions (
    academy_id, student_id, guest_name, guest_division,
    session_date, time_slot, class_group, session_type, note
  ) values (
    p_academy_id, null, v_name, v_division,
    p_session_date, p_time_slot, v_class_group, 'trial', ''
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'result', 'scheduled', 'one_time_session_id', v_id, 'guest', true, 'session_type', 'trial');
end;
$function$;


CREATE OR REPLACE FUNCTION public.olli_schedule_add_one_time(p_session_token text, p_academy_id uuid, p_student_id uuid, p_session_date date, p_time_slot integer, p_note text, p_class_group text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_division text;
  v_class_group text := upper(coalesce(nullif(btrim(p_class_group), ''), 'A'));
  v_capacity integer;
  v_weekday integer;
  v_occupancy integer;
  v_id uuid;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '보강을 등록할 권한이 없습니다.');
  end if;

  if p_session_date is null or p_session_date < current_date then
    return jsonb_build_object('ok', false, 'message', '보강 날짜를 확인해 주세요.');
  end if;

  v_weekday := extract(isodow from p_session_date)::integer;
  if v_weekday not between 1 and 6 then
    return jsonb_build_object('ok', false, 'message', '일요일에는 보강을 등록할 수 없습니다.');
  end if;

  select s.division into v_division
  from public.students s
  where s.id = p_student_id
    and s.academy_id = p_academy_id
    and s.status = 'active';

  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;

  if (v_division = 'elementary' and v_weekday = 6 and p_time_slot not in (10, 11, 12))
     or (v_division = 'elementary' and v_weekday <> 6 and p_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_time_slot not in (4, 5)) then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜의 수업 시간을 확인해 주세요.');
  end if;

  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, v_weekday, p_time_slot, p_session_date) then
    v_class_group := 'A';
  elsif v_class_group not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':makeup-student:' || p_student_id::text || ':' || p_session_date::text || ':' || p_time_slot::text,
    0
  ));

  select o.id into v_id
  from public.olli_schedule_one_time_sessions o
  where o.academy_id = p_academy_id
    and o.student_id = p_student_id
    and o.session_date = p_session_date
    and o.time_slot = p_time_slot
    and o.status <> 'cancelled'
  limit 1;

  if v_id is not null then
    return jsonb_build_object('ok', true, 'result', 'scheduled', 'one_time_session_id', v_id, 'unchanged', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':' || p_session_date::text || ':' || p_time_slot::text || ':' || v_class_group,
    0
  ));

  v_capacity := private.olli_schedule_capacity(p_academy_id, v_division);

  select
    (select count(*)
       from public.olli_schedule_enrollments e
       join public.students s on s.id = e.student_id
      where e.academy_id = p_academy_id
        and s.division = v_division
        and e.weekday = v_weekday
        and e.time_slot = p_time_slot
        and e.class_group = v_class_group
        and e.status = 'active'
        and e.effective_from <= p_session_date
        and (e.effective_to is null or e.effective_to >= p_session_date)
        and not exists (
          select 1
          from private.olli_schedule_attendance_session_overrides a
          where a.academy_id = p_academy_id
            and a.student_id = e.student_id
            and a.session_date = p_session_date
            and a.time_slot = p_time_slot
            and upper(coalesce(nullif(btrim(a.class_group), ''), 'A')) = v_class_group
            and a.session_kind = 'regular'
            and a.status = 'absent'
        ))
    +
    (select count(*)
       from public.olli_schedule_one_time_sessions o
       left join public.students s on s.id = o.student_id
      where o.academy_id = p_academy_id
        and coalesce(s.division, o.guest_division) = v_division
        and o.session_date = p_session_date
        and o.time_slot = p_time_slot
        and o.class_group = v_class_group
        and o.status <> 'cancelled')
  into v_occupancy;

  if v_occupancy >= v_capacity then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜와 시간의 정원이 가득 찼습니다.', 'full', true);
  end if;

  begin
    insert into public.olli_schedule_one_time_sessions as ots (
      academy_id, student_id, session_date, time_slot, class_group, note
    ) values (
      p_academy_id, p_student_id, p_session_date, p_time_slot, v_class_group, left(coalesce(p_note, ''), 500)
    ) returning ots.id into v_id;
  exception
    when unique_violation then
      select o.id into v_id
      from public.olli_schedule_one_time_sessions o
      where o.academy_id = p_academy_id
        and o.student_id = p_student_id
        and o.session_date = p_session_date
        and o.time_slot = p_time_slot
        and o.status <> 'cancelled'
      limit 1;
      if v_id is not null then
        return jsonb_build_object('ok', true, 'result', 'scheduled', 'one_time_session_id', v_id, 'unchanged', true);
      end if;
      raise;
  end;

  return jsonb_build_object('ok', true, 'result', 'scheduled', 'one_time_session_id', v_id, 'unchanged', false);
end;
$function$;


CREATE OR REPLACE FUNCTION public.olli_schedule_add_waitlist(p_session_token text, p_academy_id uuid, p_student_id uuid, p_target_weekday integer, p_target_time_slot integer, p_effective_date date, p_target_class_group text DEFAULT 'A'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_effective_date date := coalesce(p_effective_date, current_date);
  v_division text;
  v_class_group text := upper(coalesce(nullif(btrim(p_target_class_group), ''), 'A'));
  v_waitlist_id uuid;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '대기를 등록할 권한이 없습니다.');
  end if;
  if p_target_weekday not between 1 and 6 or v_effective_date < current_date then
    return jsonb_build_object('ok', false, 'message', '대기 등록 날짜와 요일을 확인해 주세요.');
  end if;

  select s.division into v_division
  from public.students s
  where s.id = p_student_id
    and s.academy_id = p_academy_id
    and s.status = 'active';
  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;
  if (v_division = 'elementary' and p_target_weekday = 6 and p_target_time_slot not in (10, 11, 12))
     or (v_division = 'elementary' and p_target_weekday <> 6 and p_target_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_target_time_slot not in (4, 5)) then
    return jsonb_build_object('ok', false, 'message', '선택한 요일의 수업 시간을 확인해 주세요.');
  end if;
  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, p_target_weekday, p_target_time_slot, private.olli_schedule_first_occurrence_on_or_after(v_effective_date, p_target_weekday)) then
    v_class_group := 'A';
  elsif v_class_group not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':wait:' || v_division || ':' || p_target_weekday::text || ':' || p_target_time_slot::text || ':' || v_class_group,
    0
  ));
  if exists (
    select 1
    from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id
      and e.student_id = p_student_id
      and e.weekday = p_target_weekday
      and e.time_slot = p_target_time_slot
      and e.status = 'active'
      and e.effective_from <= v_effective_date
      and (e.effective_to is null or e.effective_to >= v_effective_date)
  ) then
    return jsonb_build_object('ok', false, 'message', '이미 같은 요일과 시간에 등록된 학생입니다.');
  end if;
  if exists (
    select 1
    from public.olli_schedule_waitlist w
    join public.students s on s.id = w.student_id
    where w.academy_id = p_academy_id
      and s.division = v_division
      and w.target_weekday = p_target_weekday
      and w.target_time_slot = p_target_time_slot
      and w.target_class_group = v_class_group
      and w.status in ('waiting', 'offered')
  ) then
    return jsonb_build_object('ok', false, 'message', '이 반에는 이미 대기 학생이 있습니다.', 'waitlist_full', true);
  end if;

  insert into public.olli_schedule_waitlist (
    academy_id, student_id, target_weekday, target_time_slot, target_class_group,
    request_type, source_enrollment_id, desired_effective_date
  ) values (
    p_academy_id, p_student_id, p_target_weekday, p_target_time_slot, v_class_group,
    'add', null, v_effective_date
  ) returning id into v_waitlist_id;
  return jsonb_build_object('ok', true, 'result', 'waitlisted', 'waitlist_id', v_waitlist_id);
end;
$function$;


