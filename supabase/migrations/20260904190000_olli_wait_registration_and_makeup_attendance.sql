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

create or replace function public.olli_schedule_add_waitlist(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_target_weekday integer,
  p_target_time_slot integer,
  p_effective_date date,
  p_target_class_group text default 'A'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, p_target_weekday, p_target_time_slot) then
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
$$;

revoke all on function public.olli_schedule_add_waitlist(text, uuid, uuid, integer, integer, date, text) from public, anon, authenticated;

create or replace function public.olli_schedule_attendance_month(
  p_session_token text,
  p_academy_id uuid,
  p_month date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_end date;
  v_rows jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '출석부를 볼 권한이 없습니다.');
  end if;
  v_end := (v_start + interval '1 month - 1 day')::date;
  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.session_date, row_data.student_id, row_data.time_slot), '[]'::jsonb)
    into v_rows
    from (
      select a.student_id, a.session_date, a.time_slot, a.class_group, a.session_kind,
             a.marked_at, true as attended
      from public.olli_schedule_attendance a
      where a.academy_id = p_academy_id
        and a.session_date between v_start and v_end
        and a.session_kind = 'regular'
      union all
      select o.student_id, o.session_date, o.time_slot, o.class_group, 'makeup'::text as session_kind,
             a.marked_at, (a.id is not null) as attended
      from public.olli_schedule_one_time_sessions o
      left join public.olli_schedule_attendance a
        on a.academy_id = o.academy_id
       and a.student_id = o.student_id
       and a.session_date = o.session_date
       and a.time_slot = o.time_slot
       and a.class_group = o.class_group
       and a.session_kind = 'makeup'
      where o.academy_id = p_academy_id
        and o.session_date between v_start and v_end
        and o.status <> 'cancelled'
    ) row_data;
  return jsonb_build_object('ok', true, 'month_start', v_start, 'month_end', v_end, 'attendance', v_rows);
end;
$$;

create or replace function public.olli_schedule_toggle_attendance(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_session_date date,
  p_time_slot integer,
  p_class_group text,
  p_session_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_division text;
  v_weekday integer;
  v_class_group text := upper(coalesce(nullif(btrim(p_class_group), ''), 'A'));
  v_mark_id uuid;
  v_marked_at timestamptz;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '출석을 변경할 권한이 없습니다.');
  end if;
  if p_session_date is null or p_session_date > current_date or p_session_kind not in ('regular', 'makeup') then
    return jsonb_build_object('ok', false, 'message', '출석 날짜와 수업 정보를 확인해 주세요.');
  end if;
  v_account_id := public.olli_account_id_from_session(p_session_token);
  v_weekday := extract(isodow from p_session_date)::integer;
  select s.division into v_division
  from public.students s
  where s.id = p_student_id and s.academy_id = p_academy_id and s.status = 'active';
  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;
  if (v_division = 'elementary' and v_weekday = 6 and p_time_slot not in (10, 11, 12))
     or (v_division = 'elementary' and v_weekday <> 6 and p_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_time_slot not in (4, 5)) then
    return jsonb_build_object('ok', false, 'message', '출석 날짜와 수업 시간을 확인해 주세요.');
  end if;
  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, v_weekday, p_time_slot) then
    v_class_group := 'A';
  end if;
  if v_class_group not in ('A', 'B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 확인해 주세요.');
  end if;
  if p_session_kind = 'regular' and not exists (
    select 1 from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id and e.student_id = p_student_id
      and e.weekday = v_weekday and e.time_slot = p_time_slot and e.class_group = v_class_group and e.status = 'active'
      and e.effective_from <= p_session_date and (e.effective_to is null or e.effective_to >= p_session_date)
  ) then
    return jsonb_build_object('ok', false, 'message', '해당 날짜의 정규 수업을 찾을 수 없습니다.');
  end if;
  if p_session_kind = 'makeup' and not exists (
    select 1 from public.olli_schedule_one_time_sessions o
    where o.academy_id = p_academy_id and o.student_id = p_student_id
      and o.session_date = p_session_date and o.time_slot = p_time_slot
      and o.class_group = v_class_group and o.status <> 'cancelled'
  ) then
    return jsonb_build_object('ok', false, 'message', '해당 날짜의 보강 수업을 찾을 수 없습니다.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':attendance:' || p_student_id::text || ':' || p_session_date::text || ':' || p_time_slot::text || ':' || v_class_group || ':' || p_session_kind,
    0
  ));
  select a.id into v_mark_id
  from public.olli_schedule_attendance a
  where a.academy_id = p_academy_id and a.student_id = p_student_id
    and a.session_date = p_session_date and a.time_slot = p_time_slot
    and a.class_group = v_class_group and a.session_kind = p_session_kind;
  if v_mark_id is not null then
    delete from public.olli_schedule_attendance where id = v_mark_id;
    return jsonb_build_object('ok', true, 'attended', false);
  end if;
  insert into public.olli_schedule_attendance (
    academy_id, student_id, session_date, time_slot, class_group, session_kind, marked_by_account_id
  ) values (
    p_academy_id, p_student_id, p_session_date, p_time_slot, v_class_group, p_session_kind, v_account_id
  ) returning marked_at into v_marked_at;
  return jsonb_build_object('ok', true, 'attended', true, 'marked_at', v_marked_at);
end;
$$;

create or replace function public.olli_schedule_execute(
  p_session_token text,
  p_academy_id uuid,
  p_action text,
  p_params jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_result jsonb;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_params jsonb := coalesce(p_params, '{}'::jsonb);
  v_semantic_action text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null or not exists (
    select 1 from public.academy_members m
    where m.academy_id = p_academy_id and m.account_id = v_account_id
      and m.status = 'active' and m.role in ('owner', 'manager', 'teacher')
  ) then
    return jsonb_build_object('ok', false, 'message', '시간표를 변경할 권한이 없습니다.');
  end if;
  v_semantic_action := case v_action
    when 'change' then case when v_params->>'change_type' = 'move' then 'move' else 'add' end
    when 'add_waitlist' then 'wait_add'
    when 'resolve_waitlist' then case when v_params->>'action' = 'accept' then 'wait_accept' else 'wait_cancel' end
    when 'add_one_time' then 'makeup_add'
    when 'cancel_one_time' then 'makeup_cancel'
    when 'cancel_change' then 'scheduled_cancel'
    when 'remove_enrollment' then 'remove'
    when 'toggle_attendance' then 'attendance_toggle'
    when 'save_pickup' then 'pickup_add'
    when 'remove_pickup' then 'pickup_remove'
    when 'split_class' then 'class_split'
    when 'merge_class' then 'class_merge'
    else null
  end;
  if v_semantic_action is null then
    return jsonb_build_object('ok', false, 'message', '지원하지 않는 시간표 변경입니다.');
  end if;
  perform set_config('olli.actor_account_id', v_account_id::text, true);
  perform set_config('olli.schedule_action', v_semantic_action, true);

  if v_action = 'merge_class' then
    return public.olli_schedule_merge_class(p_session_token, p_academy_id, (v_params->>'weekday')::integer, (v_params->>'time_slot')::integer);
  elsif v_action = 'split_class' then
    return public.olli_schedule_split_class(p_session_token, p_academy_id, (v_params->>'weekday')::integer, (v_params->>'time_slot')::integer);
  elsif v_action = 'change' then
    v_result := public.olli_schedule_change(p_session_token, p_academy_id, nullif(v_params->>'student_id', '')::uuid, nullif(v_params->>'source_enrollment_id', '')::uuid, (v_params->>'target_weekday')::integer, (v_params->>'target_time_slot')::integer, nullif(v_params->>'effective_date', '')::date, v_params->>'change_type', coalesce((v_params->>'allow_wait')::boolean, true), coalesce(nullif(v_params->>'target_class_group', ''), 'A'));
  elsif v_action = 'add_waitlist' then
    v_result := public.olli_schedule_add_waitlist(p_session_token, p_academy_id, nullif(v_params->>'student_id', '')::uuid, (v_params->>'target_weekday')::integer, (v_params->>'target_time_slot')::integer, nullif(v_params->>'effective_date', '')::date, coalesce(nullif(v_params->>'target_class_group', ''), 'A'));
  elsif v_action = 'resolve_waitlist' then
    v_result := public.olli_schedule_resolve_waitlist(p_session_token, p_academy_id, nullif(v_params->>'waitlist_id', '')::uuid, v_params->>'action', coalesce(nullif(v_params->>'effective_date', '')::date, current_date));
  elsif v_action = 'add_one_time' then
    v_result := public.olli_schedule_add_one_time(p_session_token, p_academy_id, nullif(v_params->>'student_id', '')::uuid, nullif(v_params->>'session_date', '')::date, (v_params->>'time_slot')::integer, coalesce(v_params->>'note', ''), coalesce(nullif(v_params->>'class_group', ''), 'A'));
  elsif v_action = 'cancel_one_time' then
    v_result := public.olli_schedule_cancel_one_time(p_session_token, p_academy_id, nullif(v_params->>'one_time_session_id', '')::uuid);
  elsif v_action = 'cancel_change' then
    v_result := public.olli_schedule_cancel_change(p_session_token, p_academy_id, nullif(v_params->>'change_id', '')::uuid);
  elsif v_action = 'remove_enrollment' then
    v_result := public.olli_schedule_remove_enrollment(p_session_token, p_academy_id, nullif(v_params->>'student_id', '')::uuid, nullif(v_params->>'enrollment_id', '')::uuid, nullif(v_params->>'effective_date', '')::date);
  elsif v_action = 'toggle_attendance' then
    v_result := public.olli_schedule_toggle_attendance(p_session_token, p_academy_id, nullif(v_params->>'student_id', '')::uuid, nullif(v_params->>'session_date', '')::date, (v_params->>'time_slot')::integer, coalesce(nullif(v_params->>'class_group', ''), 'A'), v_params->>'session_kind');
  elsif v_action = 'save_pickup' then
    v_result := public.olli_schedule_save_pickup(p_session_token, p_academy_id, nullif(v_params->>'student_id', '')::uuid, (v_params->>'weekday')::integer, (v_params->>'class_time')::integer, v_params->>'pickup_label', nullif(v_params->>'pickup_time', '')::time, nullif(v_params->>'effective_date', '')::date);
  else
    v_result := public.olli_schedule_remove_pickup(p_session_token, p_academy_id, nullif(v_params->>'pickup_id', '')::uuid, nullif(v_params->>'effective_date', '')::date);
  end if;
  return v_result;
exception
  when invalid_text_representation or invalid_datetime_format or numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'message', '시간표 변경 값을 확인해 주세요.');
end;
$$;

commit;

