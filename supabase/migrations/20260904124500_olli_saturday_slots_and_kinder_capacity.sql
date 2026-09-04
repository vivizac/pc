begin;

alter table public.olli_schedule_enrollments drop constraint if exists olli_schedule_enrollments_time_slot_check;
alter table public.olli_schedule_enrollments add constraint olli_schedule_enrollments_time_slot_check check (time_slot between 1 and 12);
alter table public.olli_schedule_waitlist drop constraint if exists olli_schedule_waitlist_target_time_slot_check;
alter table public.olli_schedule_waitlist add constraint olli_schedule_waitlist_target_time_slot_check check (target_time_slot between 1 and 12);
alter table public.olli_schedule_one_time_sessions drop constraint if exists olli_schedule_one_time_sessions_time_slot_check;
alter table public.olli_schedule_one_time_sessions add constraint olli_schedule_one_time_sessions_time_slot_check check (time_slot between 1 and 12);
alter table public.olli_schedule_attendance drop constraint if exists olli_schedule_attendance_time_slot_check;
alter table public.olli_schedule_attendance add constraint olli_schedule_attendance_time_slot_check check (time_slot between 1 and 12);
alter table public.olli_schedule_class_splits drop constraint if exists olli_schedule_class_splits_time_slot_check;
alter table public.olli_schedule_class_splits add constraint olli_schedule_class_splits_time_slot_check check (time_slot between 1 and 12);

-- Saturday elementary classes use their real clock times while remaining in the existing 1–3pm display rows.
update public.olli_schedule_enrollments
set time_slot = case time_slot when 1 then 10 when 2 then 11 when 3 then 12 end,
    updated_at = now()
where weekday = 6 and time_slot in (1, 2, 3);

update public.olli_schedule_waitlist
set target_time_slot = case target_time_slot when 1 then 10 when 2 then 11 when 3 then 12 end,
    updated_at = now()
where target_weekday = 6 and target_time_slot in (1, 2, 3);

update public.olli_schedule_one_time_sessions
set time_slot = case time_slot when 1 then 10 when 2 then 11 when 3 then 12 end,
    updated_at = now()
where extract(isodow from session_date)::integer = 6 and time_slot in (1, 2, 3);

update public.olli_schedule_attendance
set time_slot = case time_slot when 1 then 10 when 2 then 11 when 3 then 12 end
where extract(isodow from session_date)::integer = 6 and time_slot in (1, 2, 3);

update public.olli_schedule_class_splits
set time_slot = case time_slot when 1 then 10 when 2 then 11 when 3 then 12 end
where weekday = 6 and time_slot in (1, 2, 3);

do $$
declare
  v_student_id uuid;
begin
  for v_student_id in
    select distinct student_id
    from public.olli_schedule_enrollments
    where weekday = 6 and time_slot in (10, 11, 12) and status = 'active'
  loop
    perform private.olli_schedule_sync_student(v_student_id, current_date);
  end loop;
end;
$$;

create or replace function private.olli_schedule_capacity(p_academy_id uuid, p_division text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_division, 'elementary') = 'kinder' then 5
    else coalesce(
      (select s.elementary_capacity from public.olli_schedule_settings s where s.academy_id = p_academy_id),
      5
    )
  end;
$$;

create or replace function public.olli_schedule_change(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_source_enrollment_id uuid,
  p_target_weekday integer,
  p_target_time_slot integer,
  p_effective_date date,
  p_change_type text,
  p_allow_wait boolean,
  p_target_class_group text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_effective date := coalesce(p_effective_date, current_date);
  v_division text;
  v_target_class_group text := upper(coalesce(nullif(btrim(p_target_class_group), ''), 'A'));
  v_capacity integer;
  v_occupancy integer;
  v_target_id uuid;
  v_change_id uuid;
  v_wait_id uuid;
  v_source public.olli_schedule_enrollments%rowtype;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then return jsonb_build_object('ok', false, 'message', '시간표를 변경할 권한이 없습니다.'); end if;
  if p_target_weekday not between 1 and 6 then return jsonb_build_object('ok', false, 'message', '요일을 확인해 주세요.'); end if;
  if p_change_type not in ('move','add') then return jsonb_build_object('ok', false, 'message', '수업 변경 유형을 확인해 주세요.'); end if;
  if v_effective < current_date then return jsonb_build_object('ok', false, 'message', '지난 날짜로는 변경할 수 없습니다.'); end if;

  select s.division into v_division from public.students s
  where s.id = p_student_id and s.academy_id = p_academy_id and s.status = 'active';
  if v_division is null then return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.'); end if;

  if (v_division = 'elementary' and p_target_weekday = 6 and p_target_time_slot not in (10, 11, 12))
     or (v_division = 'elementary' and p_target_weekday <> 6 and p_target_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_target_time_slot not in (4, 5)) then
    return jsonb_build_object('ok', false, 'message', '선택한 요일의 수업 시간을 확인해 주세요.');
  end if;

  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, p_target_weekday, p_target_time_slot) then
    v_target_class_group := 'A';
  elsif v_target_class_group not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  if p_change_type = 'move' then
    select * into v_source from public.olli_schedule_enrollments e
    where e.id = p_source_enrollment_id and e.academy_id = p_academy_id and e.student_id = p_student_id and e.status = 'active';
    if not found then return jsonb_build_object('ok', false, 'message', '이동할 기존 수업을 선택해 주세요.'); end if;
    if v_source.weekday = p_target_weekday and v_source.time_slot = p_target_time_slot and coalesce(v_source.class_group, 'A') = v_target_class_group then
      return jsonb_build_object('ok', true, 'result', 'unchanged', 'message', '현재 수업과 같은 시간입니다.');
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_academy_id::text || ':' || p_target_weekday::text || ':' || p_target_time_slot::text || ':' || v_target_class_group, 0));
  if exists (
    select 1 from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id and e.student_id = p_student_id and e.weekday = p_target_weekday
      and e.time_slot = p_target_time_slot and e.status = 'active' and e.effective_from <= v_effective
      and (e.effective_to is null or e.effective_to >= v_effective)
      and (p_change_type <> 'move' or e.id <> p_source_enrollment_id)
  ) then return jsonb_build_object('ok', false, 'message', '이미 같은 요일과 시간에 등록되어 있습니다.'); end if;

  v_capacity := private.olli_schedule_capacity(p_academy_id, v_division);
  select
    (select count(*) from public.olli_schedule_enrollments e join public.students s on s.id = e.student_id
     where e.academy_id = p_academy_id and s.division = v_division and e.weekday = p_target_weekday
       and e.time_slot = p_target_time_slot and e.class_group = v_target_class_group and e.status = 'active'
       and e.effective_from <= v_effective and (e.effective_to is null or e.effective_to >= v_effective)
       and (p_change_type <> 'move' or e.id <> p_source_enrollment_id))
    +
    (select count(*) from public.olli_schedule_one_time_sessions o join public.students s on s.id = o.student_id
     where o.academy_id = p_academy_id and s.division = v_division and o.session_date = v_effective
       and o.time_slot = p_target_time_slot and o.class_group = v_target_class_group and o.status <> 'cancelled')
  into v_occupancy;

  if v_occupancy >= v_capacity then
    if not coalesce(p_allow_wait, true) then
      return jsonb_build_object('ok', false, 'message', '선택한 시간의 정원이 가득 찼습니다.', 'full', true);
    end if;
    if exists (
      select 1 from public.olli_schedule_waitlist w where w.academy_id = p_academy_id
        and w.target_weekday = p_target_weekday and w.target_time_slot = p_target_time_slot
        and w.target_class_group = v_target_class_group and w.status in ('waiting','offered')
    ) then return jsonb_build_object('ok', false, 'message', '이 시간에는 이미 대기 학생이 있습니다.', 'waitlist_full', true); end if;
    insert into public.olli_schedule_waitlist (
      academy_id, student_id, target_weekday, target_time_slot, target_class_group,
      request_type, source_enrollment_id, desired_effective_date
    ) values (
      p_academy_id, p_student_id, p_target_weekday, p_target_time_slot, v_target_class_group,
      p_change_type, case when p_change_type = 'move' then p_source_enrollment_id else null end, v_effective
    ) returning id into v_wait_id;
    return jsonb_build_object('ok', true, 'result', 'waitlisted', 'waitlist_id', v_wait_id);
  end if;

  if p_change_type = 'move' then
    if v_effective <= v_source.effective_from then update public.olli_schedule_enrollments set status = 'cancelled', updated_at = now() where id = v_source.id;
    else update public.olli_schedule_enrollments set effective_to = v_effective - 1, updated_at = now() where id = v_source.id; end if;
  end if;

  insert into public.olli_schedule_enrollments (academy_id, student_id, weekday, time_slot, class_group, effective_from, source)
  values (p_academy_id, p_student_id, p_target_weekday, p_target_time_slot, v_target_class_group, v_effective, case when p_change_type = 'move' then 'move' else 'add' end)
  returning id into v_target_id;
  insert into public.olli_schedule_changes (
    academy_id, student_id, change_type, source_enrollment_id, target_enrollment_id, target_class_group, effective_date, status
  ) values (
    p_academy_id, p_student_id, p_change_type, case when p_change_type = 'move' then p_source_enrollment_id else null end,
    v_target_id, v_target_class_group, v_effective, case when v_effective <= current_date then 'applied' else 'scheduled' end
  ) returning id into v_change_id;
  if v_effective <= current_date then perform private.olli_schedule_sync_student(p_student_id, current_date); end if;
  return jsonb_build_object('ok', true, 'result', case when v_effective <= current_date then 'applied' else 'scheduled' end, 'change_id', v_change_id, 'target_enrollment_id', v_target_id);
end;
$$;

create or replace function public.olli_schedule_add_one_time(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_session_date date,
  p_time_slot integer,
  p_note text,
  p_class_group text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_division text;
  v_class_group text := upper(coalesce(nullif(btrim(p_class_group), ''), 'A'));
  v_capacity integer;
  v_weekday integer;
  v_occupancy integer;
  v_id uuid;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then return jsonb_build_object('ok', false, 'message', '보강을 등록할 권한이 없습니다.'); end if;
  if p_session_date is null or p_session_date < current_date then return jsonb_build_object('ok', false, 'message', '보강 날짜를 확인해 주세요.'); end if;
  v_weekday := extract(isodow from p_session_date)::integer;
  if v_weekday not between 1 and 6 then return jsonb_build_object('ok', false, 'message', '일요일에는 보강을 등록할 수 없습니다.'); end if;

  select s.division into v_division from public.students s where s.id = p_student_id and s.academy_id = p_academy_id and s.status = 'active';
  if v_division is null then return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.'); end if;
  if (v_division = 'elementary' and v_weekday = 6 and p_time_slot not in (10, 11, 12))
     or (v_division = 'elementary' and v_weekday <> 6 and p_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_time_slot not in (4, 5)) then
    return jsonb_build_object('ok', false, 'message', '선택한 날짜의 수업 시간을 확인해 주세요.');
  end if;

  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, v_weekday, p_time_slot) then
    v_class_group := 'A';
  elsif v_class_group not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_academy_id::text || ':' || p_session_date::text || ':' || p_time_slot::text || ':' || v_class_group, 0));
  v_capacity := private.olli_schedule_capacity(p_academy_id, v_division);
  select
    (select count(*) from public.olli_schedule_enrollments e join public.students s on s.id = e.student_id
     where e.academy_id = p_academy_id and s.division = v_division and e.weekday = v_weekday and e.time_slot = p_time_slot
       and e.class_group = v_class_group and e.status = 'active' and e.effective_from <= p_session_date and (e.effective_to is null or e.effective_to >= p_session_date))
    +
    (select count(*) from public.olli_schedule_one_time_sessions o join public.students s on s.id = o.student_id
     where o.academy_id = p_academy_id and s.division = v_division and o.session_date = p_session_date and o.time_slot = p_time_slot
       and o.class_group = v_class_group and o.status <> 'cancelled') into v_occupancy;
  if v_occupancy >= v_capacity then return jsonb_build_object('ok', false, 'message', '선택한 날짜와 시간의 정원이 가득 찼습니다.', 'full', true); end if;
  if exists (select 1 from public.olli_schedule_one_time_sessions o where o.academy_id = p_academy_id and o.student_id = p_student_id and o.session_date = p_session_date and o.time_slot = p_time_slot and o.status <> 'cancelled') then
    return jsonb_build_object('ok', false, 'message', '이미 같은 날짜와 시간에 보강이 등록되어 있습니다.');
  end if;
  insert into public.olli_schedule_one_time_sessions (academy_id, student_id, session_date, time_slot, class_group, note)
  values (p_academy_id, p_student_id, p_session_date, p_time_slot, v_class_group, left(coalesce(p_note, ''), 500)) returning id into v_id;
  return jsonb_build_object('ok', true, 'result', 'scheduled', 'one_time_session_id', v_id);
end;
$$;

commit;

