-- Canonicalize schedule availability rules before exposing them to Agents SDK.
-- This migration changes function definitions only; it does not update application data rows.

CREATE OR REPLACE FUNCTION private.olli_schedule_group_is_enabled(p_academy_id uuid, p_division text, p_weekday integer, p_time_slot integer, p_target_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when private.olli_schedule_timetable_mode(p_academy_id) = 'half_hour' then false
    when lower(coalesce(p_division, 'elementary')) = 'kinder' then not exists (
      select 1 from public.olli_schedule_kinder_class_merges m
      where m.academy_id = p_academy_id
        and m.weekday = p_weekday
        and m.time_slot = p_time_slot
    )
    when p_target_date is null then false
    else private.olli_schedule_class_split_at(p_academy_id,p_weekday,p_time_slot,p_target_date)
  end;
$function$;
revoke all on function private.olli_schedule_group_is_enabled(uuid,text,integer,integer,date) from public,anon,authenticated;

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
  v_group_enabled boolean;
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

  if not private.olli_schedule_slot_is_valid(p_academy_id, v_division, v_weekday, p_time_slot) then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜의 수업 시간을 확인해 주세요.');
  end if;

  v_group_enabled := private.olli_schedule_group_is_enabled(
    p_academy_id, v_division, v_weekday, p_time_slot, p_session_date
  );
  if not v_group_enabled then
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
        and (not v_group_enabled or upper(coalesce(nullif(btrim(e.class_group), ''), 'A')) = v_class_group)
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
            and (not v_group_enabled or upper(coalesce(nullif(btrim(a.class_group), ''), 'A')) = v_class_group)
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
        and (not v_group_enabled or upper(coalesce(nullif(btrim(o.class_group), ''), 'A')) = v_class_group)
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

CREATE OR REPLACE FUNCTION public.olli_schedule_add_one_time(p_session_token text, p_academy_id uuid, p_student_id uuid, p_session_date date, p_time_slot integer, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.olli_schedule_add_one_time(
    p_session_token,p_academy_id,p_student_id,p_session_date,p_time_slot,p_note,'A'
  );
$function$;

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
  v_group_enabled boolean;
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

  if not private.olli_schedule_slot_is_valid(p_academy_id, v_division, v_weekday, p_time_slot) then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜의 수업 시간을 확인해 주세요.');
  end if;

  v_group_enabled := private.olli_schedule_group_is_enabled(
    p_academy_id, v_division, v_weekday, p_time_slot, p_session_date
  );
  if not v_group_enabled then
    v_class_group := 'A';
  elsif v_class_group not in ('A','B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  perform set_config('olli.actor_account_id', v_account_id::text, true);

  if v_entry_type = 'wait' then
    perform set_config('olli.schedule_action', 'guest_wait_add', true);
    perform pg_advisory_xact_lock(hashtextextended(
      p_academy_id::text || ':wait:' || v_division || ':' || v_weekday::text || ':' || p_time_slot::text || ':' || v_class_group,
      0
    ));

    if exists (
      select 1 from public.olli_schedule_waitlist w
      where w.academy_id = p_academy_id
        and w.target_division = v_division
        and w.target_weekday = v_weekday
        and w.target_time_slot = p_time_slot
        and (not v_group_enabled or upper(coalesce(nullif(btrim(w.target_class_group), ''), 'A')) = v_class_group)
        and w.status in ('waiting','offered')
    ) then
      return jsonb_build_object('ok', false, 'message', '이 시간에는 이미 대기 학생이 있습니다.', 'waitlist_full', true);
    end if;

    insert into public.olli_schedule_waitlist (
      academy_id, student_id, guest_name, guest_division, target_division,
      target_weekday, target_time_slot, target_class_group,
      request_type, source_enrollment_id, desired_effective_date
    ) values (
      p_academy_id, null, v_name, v_division, v_division,
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
        and (not v_group_enabled or upper(coalesce(nullif(btrim(e.class_group), ''), 'A')) = v_class_group)
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
        and (not v_group_enabled or upper(coalesce(nullif(btrim(o.class_group), ''), 'A')) = v_class_group)
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
  v_group_enabled boolean;
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
  if not private.olli_schedule_slot_is_valid(p_academy_id, v_division, p_target_weekday, p_target_time_slot) then
    return jsonb_build_object('ok', false, 'message', '선택한 요일의 수업 시간을 확인해 주세요.');
  end if;
  v_group_enabled := private.olli_schedule_group_is_enabled(
    p_academy_id,
    v_division,
    p_target_weekday,
    p_target_time_slot,
    private.olli_schedule_first_occurrence_on_or_after(v_effective_date, p_target_weekday)
  );
  if not v_group_enabled then
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
    where w.academy_id = p_academy_id
      and w.target_division = v_division
      and w.target_weekday = p_target_weekday
      and w.target_time_slot = p_target_time_slot
      and (not v_group_enabled or upper(coalesce(nullif(btrim(w.target_class_group), ''), 'A')) = v_class_group)
      and w.status in ('waiting', 'offered')
  ) then
    return jsonb_build_object('ok', false, 'message', '이 반에는 이미 대기 학생이 있습니다.', 'waitlist_full', true);
  end if;

  insert into public.olli_schedule_waitlist (
    academy_id, student_id, target_division, target_weekday, target_time_slot, target_class_group,
    request_type, source_enrollment_id, desired_effective_date
  ) values (
    p_academy_id, p_student_id, v_division, p_target_weekday, p_target_time_slot, v_class_group,
    'add', null, v_effective_date
  ) returning id into v_waitlist_id;
  return jsonb_build_object('ok', true, 'result', 'waitlisted', 'waitlist_id', v_waitlist_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_schedule_update_one_time_session(p_session_token text, p_academy_id uuid, p_one_time_session_id uuid, p_session_date date DEFAULT NULL::date, p_time_slot integer DEFAULT NULL::integer, p_class_group text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item public.olli_schedule_one_time_sessions%rowtype;
  v_division text;
  v_target_date date;
  v_target_time integer;
  v_target_group text;
  v_capacity integer;
  v_weekday integer;
  v_group_enabled boolean;
  v_occupancy integer;
  v_account_id uuid;
  v_type_label text;
  v_identity_key text;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '보강·체험 수업을 변경할 권한이 없습니다.');
  end if;

  if p_one_time_session_id is null then
    return jsonb_build_object('ok', false, 'message', '변경할 보강·체험 수업을 확인해 주세요.');
  end if;

  select o.* into v_item
  from public.olli_schedule_one_time_sessions o
  where o.id = p_one_time_session_id
    and o.academy_id = p_academy_id
  for update;

  if not found
     or v_item.session_type not in ('makeup', 'trial')
     or v_item.status = 'cancelled'
     or (v_item.session_type = 'makeup' and v_item.student_id is null)
     or (v_item.session_type = 'trial' and v_item.student_id is null and nullif(btrim(v_item.guest_name), '') is null) then
    return jsonb_build_object('ok', false, 'message', '변경할 보강·체험 수업을 찾을 수 없습니다.');
  end if;

  v_target_date := coalesce(p_session_date, v_item.session_date);
  v_target_time := coalesce(p_time_slot, v_item.time_slot);
  v_target_group := upper(coalesce(nullif(btrim(p_class_group), ''), nullif(btrim(v_item.class_group), ''), 'A'));
  v_type_label := case when v_item.session_type = 'trial' then '체험' else '보강' end;

  if v_target_date is null or v_target_date < current_date then
    return jsonb_build_object('ok', false, 'message', '변경할 날짜를 확인해 주세요.');
  end if;

  if v_item.session_type = 'makeup' and (
    exists (
      select 1
      from public.olli_schedule_attendance a
      where a.academy_id = p_academy_id
        and a.student_id = v_item.student_id
        and a.session_date = v_item.session_date
        and a.time_slot = v_item.time_slot
        and upper(coalesce(nullif(btrim(a.class_group), ''), 'A')) = upper(coalesce(nullif(btrim(v_item.class_group), ''), 'A'))
        and a.session_kind = 'makeup'
    )
    or exists (
      select 1
      from private.olli_schedule_attendance_session_overrides a
      where a.academy_id = p_academy_id
        and a.student_id = v_item.student_id
        and a.session_date = v_item.session_date
        and a.time_slot = v_item.time_slot
        and upper(coalesce(nullif(btrim(a.class_group), ''), 'A')) = upper(coalesce(nullif(btrim(v_item.class_group), ''), 'A'))
        and a.session_kind = 'makeup'
    )
  ) then
    return jsonb_build_object('ok', false, 'message', '출결 정보가 있는 보강은 날짜·시간·반을 변경할 수 없습니다.');
  end if;

  v_weekday := extract(isodow from v_target_date)::integer;
  if v_weekday not between 1 and 6 then
    return jsonb_build_object('ok', false, 'message', '일요일에는 보강·체험 수업을 등록할 수 없습니다.');
  end if;

  if v_item.student_id is not null then
    select s.division into v_division
    from public.students s
    where s.id = v_item.student_id
      and s.academy_id = p_academy_id
      and s.status = 'active'
      and coalesce(s.is_deleted, false) = false;
  else
    v_division := nullif(btrim(v_item.guest_division), '');
  end if;

  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '수업 구분 정보를 찾을 수 없습니다.');
  end if;

  if not private.olli_schedule_slot_is_valid(
    p_academy_id,
    v_division,
    v_weekday,
    v_target_time
  ) then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜와 수업 시간을 확인해 주세요.');
  end if;

  v_group_enabled := private.olli_schedule_group_is_enabled(
    p_academy_id,
    v_division,
    v_weekday,
    v_target_time,
    v_target_date
  );
  if not v_group_enabled then
    v_target_group := 'A';
  elsif v_target_group not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  if v_target_date = v_item.session_date
     and v_target_time = v_item.time_slot
     and v_target_group = upper(coalesce(nullif(btrim(v_item.class_group), ''), 'A')) then
    return jsonb_build_object(
      'ok', true,
      'result', 'unchanged',
      'session_type', v_item.session_type,
      'one_time_session_id', v_item.id,
      'session_date', v_item.session_date,
      'time_slot', v_item.time_slot,
      'class_group', upper(coalesce(nullif(btrim(v_item.class_group), ''), 'A')),
      'unchanged', true
    );
  end if;

  v_identity_key := case
    when v_item.student_id is not null then 'student:' || v_item.student_id::text
    else 'guest:' || lower(btrim(v_item.guest_name))
  end;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':one-time-update:' || v_item.id::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':' || v_item.session_type || ':' || v_identity_key || ':' ||
    v_target_date::text || ':' || v_target_time::text || ':' || v_target_group,
    0
  ));

  if v_item.student_id is not null then
    if exists (
      select 1
      from public.olli_schedule_one_time_sessions o
      where o.academy_id = p_academy_id
        and o.student_id = v_item.student_id
        and o.session_date = v_target_date
        and o.time_slot = v_target_time
        and o.status <> 'cancelled'
        and o.id <> v_item.id
    ) then
      return jsonb_build_object('ok', false, 'message', '같은 날짜와 시간에 이미 등록된 수업이 있습니다.');
    end if;
  else
    if exists (
      select 1
      from public.olli_schedule_one_time_sessions o
      where o.academy_id = p_academy_id
        and o.student_id is null
        and o.session_type = 'trial'
        and lower(btrim(o.guest_name)) = lower(btrim(v_item.guest_name))
        and o.session_date = v_target_date
        and o.time_slot = v_target_time
        and upper(coalesce(nullif(btrim(o.class_group), ''), 'A')) = v_target_group
        and o.status <> 'cancelled'
        and o.id <> v_item.id
    ) then
      return jsonb_build_object('ok', false, 'message', '같은 날짜와 시간에 이미 등록된 체험수업이 있습니다.');
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':' || v_target_date::text || ':' || v_target_time::text || ':' || v_target_group,
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
        and e.time_slot = v_target_time
        and (not v_group_enabled or upper(coalesce(nullif(btrim(e.class_group), ''), 'A')) = v_target_group)
        and e.status = 'active'
        and e.effective_from <= v_target_date
        and (e.effective_to is null or e.effective_to >= v_target_date)
        and (
          v_item.session_type = 'trial'
          or not exists (
            select 1
            from private.olli_schedule_attendance_session_overrides a
            where a.academy_id = p_academy_id
              and a.student_id = e.student_id
              and a.session_date = v_target_date
              and a.time_slot = v_target_time
              and (not v_group_enabled or upper(coalesce(nullif(btrim(a.class_group), ''), 'A')) = v_target_group)
              and a.session_kind = 'regular'
              and a.status = 'absent'
          )
        ))
    +
    (select count(*)
       from public.olli_schedule_one_time_sessions o
       left join public.students s on s.id = o.student_id
      where o.academy_id = p_academy_id
        and coalesce(s.division, o.guest_division) = v_division
        and o.session_date = v_target_date
        and o.time_slot = v_target_time
        and (not v_group_enabled or upper(coalesce(nullif(btrim(o.class_group), ''), 'A')) = v_target_group)
        and o.status <> 'cancelled'
        and o.id <> v_item.id)
  into v_occupancy;

  if v_capacity is not null and v_occupancy >= v_capacity then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜와 시간의 정원이 가득 찼습니다.', 'full', true);
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  perform set_config('olli.actor_account_id', coalesce(v_account_id::text, ''), true);
  perform set_config('olli.schedule_effective_date', v_target_date::text, true);
  perform set_config(
    'olli.schedule_action',
    case when v_item.session_type = 'trial' then 'trial_session_change' else 'makeup_session_change' end,
    true
  );

  update public.olli_schedule_one_time_sessions
  set session_date = v_target_date,
      time_slot = v_target_time,
      class_group = v_target_group,
      updated_at = now()
  where id = v_item.id
    and academy_id = p_academy_id;

  return jsonb_build_object(
    'ok', true,
    'result', 'updated',
    'session_type', v_item.session_type,
    'one_time_session_id', v_item.id,
    'old_session_date', v_item.session_date,
    'old_time_slot', v_item.time_slot,
    'old_class_group', upper(coalesce(nullif(btrim(v_item.class_group), ''), 'A')),
    'session_date', v_target_date,
    'time_slot', v_target_time,
    'class_group', v_target_group,
    'unchanged', false
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'message', '같은 날짜와 시간에 이미 등록된 수업이 있습니다.');
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_schedule_availability_slots(p_session_token text, p_academy_id uuid, p_start_date date, p_end_date date, p_division text, p_purpose text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_start date := coalesce(p_start_date, current_date);
  v_end date := coalesce(p_end_date, p_start_date, current_date);
  v_division text := lower(btrim(coalesce(p_division, '')));
  v_purpose text := lower(btrim(coalesce(p_purpose, 'regular')));
  v_mode text;
  v_capacity integer;
  v_slots jsonb;
  v_closed_dates jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표 가용성을 볼 권한이 없습니다.');
  end if;
  if v_division not in ('elementary', 'kinder') then
    return jsonb_build_object('ok', false, 'message', '초등부 또는 유치부를 확인해 주세요.');
  end if;
  if v_purpose not in ('regular', 'makeup', 'trial', 'wait') then
    return jsonb_build_object('ok', false, 'message', '시간표 가용성 조회 목적을 확인해 주세요.');
  end if;
  if v_start < current_date or v_end < v_start or v_end > v_start + 31 then
    return jsonb_build_object('ok', false, 'message', '시간표 가용성 조회 기간을 확인해 주세요.');
  end if;

  v_mode := private.olli_schedule_timetable_mode(p_academy_id);
  v_capacity := private.olli_schedule_capacity(p_academy_id, v_division);

  with dates as (
    select gs::date as session_date
    from generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') gs
  ),
  base_slots as (
    select d.session_date, extract(isodow from d.session_date)::integer as weekday, t.time_slot
    from dates d cross join generate_series(1, 12) as t(time_slot)
    where extract(isodow from d.session_date)::integer between 1 and 6
      and private.olli_schedule_slot_is_valid(
        p_academy_id,v_division,extract(isodow from d.session_date)::integer,t.time_slot
      )
      and not private.olli_schedule_is_closed_day(p_academy_id, d.session_date)
  ),
  grouped_slots as (
    select b.session_date,b.weekday,b.time_slot,g.class_group,
      private.olli_schedule_group_is_enabled(
        p_academy_id,v_division,b.weekday,b.time_slot,b.session_date
      ) as group_enabled
    from base_slots b cross join (values ('A'::text), ('B'::text)) as g(class_group)
    where g.class_group='A'
       or private.olli_schedule_group_is_enabled(
            p_academy_id,v_division,b.weekday,b.time_slot,b.session_date
          )
  ),
  counted as (
    select g.*,
      (
        select count(*)::integer
        from public.olli_schedule_enrollments e
        join public.students s on s.id=e.student_id
        where e.academy_id=p_academy_id
          and s.division=v_division
          and e.weekday=g.weekday
          and e.time_slot=g.time_slot
          and (not g.group_enabled or upper(coalesce(nullif(btrim(e.class_group),''),'A'))=g.class_group)
          and e.status='active'
          and e.effective_from<=g.session_date
          and (e.effective_to is null or e.effective_to>=g.session_date)
      ) as regular_count,
      case when v_purpose='makeup' then (
        select count(*)::integer
        from public.olli_schedule_enrollments e
        join public.students s on s.id=e.student_id
        where e.academy_id=p_academy_id
          and s.division=v_division
          and e.weekday=g.weekday
          and e.time_slot=g.time_slot
          and (not g.group_enabled or upper(coalesce(nullif(btrim(e.class_group),''),'A'))=g.class_group)
          and e.status='active'
          and e.effective_from<=g.session_date
          and (e.effective_to is null or e.effective_to>=g.session_date)
          and exists (
            select 1
            from private.olli_schedule_attendance_session_overrides a
            where a.academy_id=p_academy_id
              and a.student_id=e.student_id
              and a.session_date=g.session_date
              and a.time_slot=g.time_slot
              and (not g.group_enabled or upper(coalesce(nullif(btrim(a.class_group),''),'A'))=g.class_group)
              and a.session_kind='regular'
              and a.status='absent'
          )
      ) else 0 end as absent_count,
      (
        select count(*)::integer
        from public.olli_schedule_one_time_sessions o
        left join public.students s on s.id=o.student_id
        where o.academy_id=p_academy_id
          and coalesce(s.division,o.guest_division)=v_division
          and o.session_date=g.session_date
          and o.time_slot=g.time_slot
          and (not g.group_enabled or upper(coalesce(nullif(btrim(o.class_group),''),'A'))=g.class_group)
          and o.status<>'cancelled'
          and coalesce(o.session_type,'makeup')<>'trial'
      ) as makeup_count,
      (
        select count(*)::integer
        from public.olli_schedule_one_time_sessions o
        left join public.students s on s.id=o.student_id
        where o.academy_id=p_academy_id
          and coalesce(s.division,o.guest_division)=v_division
          and o.session_date=g.session_date
          and o.time_slot=g.time_slot
          and (not g.group_enabled or upper(coalesce(nullif(btrim(o.class_group),''),'A'))=g.class_group)
          and o.status<>'cancelled'
          and o.session_type='trial'
      ) as trial_count,
      (
        select count(*)::integer
        from public.olli_schedule_waitlist w
        where w.academy_id=p_academy_id
          and w.target_division=v_division
          and w.target_weekday=g.weekday
          and w.target_time_slot=g.time_slot
          and (not g.group_enabled or upper(coalesce(nullif(btrim(w.target_class_group),''),'A'))=g.class_group)
          and w.status in ('waiting','offered')
      ) as waitlist_count,
      exists (
        select 1
        from public.olli_schedule_class_teachers ct
        where ct.academy_id=p_academy_id
          and ct.division=v_division
          and ct.weekday=g.weekday
          and ct.time_slot=g.time_slot
          and (not g.group_enabled or upper(coalesce(nullif(btrim(ct.class_group),''),'A'))=g.class_group)
      ) as teacher_exists
    from grouped_slots g
  ),
  calculated as (
    select c.*,
      greatest(0,c.regular_count-c.absent_count) as effective_regular_count,
      c.makeup_count+c.trial_count as one_time_count
    from counted c
  ),
  final_slots as (
    select c.*,
      c.effective_regular_count+c.one_time_count as occupancy,
      greatest(0,v_capacity-(c.effective_regular_count+c.one_time_count)) as remaining
    from calculated c
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'date',f.session_date,'weekday',f.weekday,'time_slot',f.time_slot,
      'class_group',f.class_group,'grouped',f.group_enabled,'capacity',v_capacity,
      'regular_count',f.regular_count,'absent_count',f.absent_count,
      'effective_regular_count',f.effective_regular_count,
      'makeup_count',f.makeup_count,'trial_count',f.trial_count,
      'one_time_count',f.one_time_count,'occupancy',f.occupancy,'remaining',f.remaining,
      'waitlist_count',f.waitlist_count,'waitlist_open',f.waitlist_count=0,
      'class_full',f.remaining<=0,
      'available',case when v_purpose='wait' then f.waitlist_count=0 else f.remaining>0 end
    ) order by f.session_date,f.time_slot,f.class_group
  ),'[]'::jsonb)
  into v_slots
  from final_slots f
  where f.regular_count+f.one_time_count>0 or f.teacher_exists;

  with dates as (
    select gs::date as session_date
    from generate_series(v_start::timestamp,v_end::timestamp,interval '1 day') gs
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'date',d.session_date,
      'reason',case when extract(isodow from d.session_date)::integer=7 then '일요일' else '휴원일' end
    ) order by d.session_date
  ),'[]'::jsonb)
  into v_closed_dates
  from dates d
  where extract(isodow from d.session_date)::integer=7
     or private.olli_schedule_is_closed_day(p_academy_id,d.session_date);

  return jsonb_build_object(
    'ok',true,'start_date',v_start,'end_date',v_end,'division',v_division,
    'purpose',v_purpose,'timetable_mode',v_mode,'capacity',v_capacity,
    'slots',v_slots,'slot_count',jsonb_array_length(v_slots),'closed_dates',v_closed_dates
  );
end;
$function$;
revoke all on function public.olli_schedule_availability_slots(text,uuid,date,date,text,text) from public;
grant execute on function public.olli_schedule_availability_slots(text,uuid,date,date,text,text) to anon,authenticated;
