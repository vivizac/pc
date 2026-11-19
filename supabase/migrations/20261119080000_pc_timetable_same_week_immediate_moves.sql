-- PC timetable recurring moves: this week applies immediately, following weeks reserve.
-- Keep signatures, authentication, locks, history, and all legacy scheduled rows.
-- A migration (not runtime SQL-only editing) is the single source of truth.

CREATE OR REPLACE FUNCTION public.olli_schedule_change(p_session_token text, p_academy_id uuid, p_student_id uuid, p_source_enrollment_id uuid, p_target_weekday integer, p_target_time_slot integer, p_effective_date date, p_change_type text, p_allow_wait boolean, p_target_class_group text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_effective date := coalesce(p_effective_date, current_date);
  v_target_session_date date;
  v_division text;
  v_class_group text := upper(coalesce(nullif(btrim(p_target_class_group), ''), 'A'));
  v_capacity integer;
  v_occupancy integer;
  v_target_id uuid;
  v_change_id uuid;
  v_wait_id uuid;
  v_source public.olli_schedule_enrollments%rowtype;
  v_target_order smallint;
  v_existing_count integer;
  v_existing_id uuid;
  v_existing_order smallint;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표를 변경할 권한이 없습니다.');
  end if;
  if p_target_weekday not between 1 and 6 or p_change_type not in ('move','add') or v_effective < current_date then
    return jsonb_build_object('ok', false, 'message', '수업 변경 값을 확인해 주세요.');
  end if;
  -- Only same-week recurring moves apply now; adds/future-week moves are unchanged.
  if p_change_type = 'move'
     and v_effective < (date_trunc('week', current_date)::date + 7) then
    v_effective := current_date;
  end if;
  -- Check one-time capacity on the destination weekday, never on an unrelated day.
  v_target_session_date := private.olli_schedule_first_occurrence_on_or_after(
    v_effective, p_target_weekday
  );

  select s.division into v_division
  from public.students s
  where s.id = p_student_id and s.academy_id = p_academy_id and s.status = 'active'
    and coalesce(s.is_deleted, false) = false;
  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;
  if not private.olli_schedule_slot_is_valid(p_academy_id, v_division, p_target_weekday, p_target_time_slot) then
    return jsonb_build_object('ok', false, 'message', '선택한 요일의 수업 시간을 확인해 주세요.');
  end if;
  if not private.olli_schedule_group_is_enabled(p_academy_id, v_division, p_target_weekday, p_target_time_slot, private.olli_schedule_first_occurrence_on_or_after(v_effective, p_target_weekday)) then
    v_class_group := 'A';
  elsif v_class_group not in ('A','B') then
    return jsonb_build_object('ok', false, 'message', '수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  if p_change_type = 'move' then
    select * into v_source
    from public.olli_schedule_enrollments e
    where e.id = p_source_enrollment_id
      and e.academy_id = p_academy_id
      and e.student_id = p_student_id
      and e.status = 'active';
    if not found then
      return jsonb_build_object('ok', false, 'message', '이동할 기존 수업을 선택해 주세요.');
    end if;
    if v_source.weekday = p_target_weekday
       and v_source.time_slot = p_target_time_slot
       and coalesce(v_source.class_group,'A') = v_class_group then
      return jsonb_build_object('ok', true, 'result', 'unchanged', 'message', '현재 수업과 같은 시간입니다.');
    end if;
    v_target_order := v_source.session_order;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':' || p_target_weekday::text || ':' || p_target_time_slot::text || ':' || v_class_group,
    0
  ));

  if exists (
    select 1 from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id
      and e.student_id = p_student_id
      and e.weekday = p_target_weekday
      and e.time_slot = p_target_time_slot
      and e.status = 'active'
      and e.effective_from <= v_effective
      and (e.effective_to is null or e.effective_to >= v_effective)
      and (p_change_type <> 'move' or e.id <> p_source_enrollment_id)
  ) then
    return jsonb_build_object('ok', false, 'message', '이미 같은 요일과 시간에 등록되어 있습니다.');
  end if;

  v_capacity := private.olli_schedule_capacity(p_academy_id, v_division);
  select
    (select count(*)
       from public.olli_schedule_enrollments e
       join public.students s on s.id=e.student_id
      where e.academy_id=p_academy_id and s.division=v_division
      and s.status = 'active'
      and coalesce(s.is_deleted, false) = false
        and e.weekday=p_target_weekday and e.time_slot=p_target_time_slot
        and (private.olli_schedule_timetable_mode(p_academy_id)='half_hour' or e.class_group=v_class_group)
        and e.status='active'
        and e.effective_from<=v_effective and (e.effective_to is null or e.effective_to>=v_effective)
        and (p_change_type<>'move' or e.id<>p_source_enrollment_id))
    +
    (select count(*)
       from public.olli_schedule_one_time_sessions o
       left join public.students s on s.id=o.student_id
      where o.academy_id=p_academy_id
        and coalesce(s.division, o.guest_division)=v_division
        and (o.student_id is null or (s.status = 'active' and coalesce(s.is_deleted, false) = false))
        and o.session_date=v_target_session_date and o.time_slot=p_target_time_slot
        and (private.olli_schedule_timetable_mode(p_academy_id)='half_hour' or o.class_group=v_class_group)
        and o.status<>'cancelled')
  into v_occupancy;

  if v_occupancy >= v_capacity then
    if not coalesce(p_allow_wait,true) then
      return jsonb_build_object('ok',false,'message','선택한 시간의 정원이 가득 찼습니다.','full',true);
    end if;
    if exists (
      select 1 from public.olli_schedule_waitlist w
      where w.academy_id=p_academy_id
        and w.target_division=v_division
        and w.target_weekday=p_target_weekday
        and w.target_time_slot=p_target_time_slot
        and w.target_class_group=v_class_group
        and w.status in('waiting','offered')
    ) then
      return jsonb_build_object('ok',false,'message','이 시간에는 이미 대기 학생이 있습니다.','waitlist_full',true);
    end if;
    insert into public.olli_schedule_waitlist(
      academy_id,student_id,target_division,target_weekday,target_time_slot,target_class_group,
      request_type,source_enrollment_id,desired_effective_date
    ) values (
      p_academy_id,p_student_id,v_division,p_target_weekday,p_target_time_slot,v_class_group,
      p_change_type,case when p_change_type='move' then p_source_enrollment_id else null end,v_effective
    ) returning id into v_wait_id;
    return jsonb_build_object('ok',true,'result','waitlisted','waitlist_id',v_wait_id);
  end if;

  if p_change_type = 'add' then
    select count(*) into v_existing_count
    from public.olli_schedule_enrollments e
    where e.academy_id = p_academy_id
      and e.student_id = p_student_id
      and e.status = 'active'
      and e.effective_from <= v_effective
      and (e.effective_to is null or e.effective_to >= v_effective);

    if v_existing_count = 0 then
      v_target_order := 1;
    elsif v_existing_count = 1 then
      select e.id, e.session_order into v_existing_id, v_existing_order
      from public.olli_schedule_enrollments e
      where e.academy_id = p_academy_id
        and e.student_id = p_student_id
        and e.status = 'active'
        and e.effective_from <= v_effective
        and (e.effective_to is null or e.effective_to >= v_effective)
      limit 1;
      if v_existing_order is null or v_existing_order not in (1,2) then
        v_existing_order := 1;
        update public.olli_schedule_enrollments set session_order = 1, updated_at = now() where id = v_existing_id;
      end if;
      v_target_order := (3 - v_existing_order)::smallint;
    else
      v_target_order := null;
    end if;
  end if;

  if p_change_type = 'move' then
    if v_effective <= v_source.effective_from then
      update public.olli_schedule_enrollments set status='cancelled', updated_at=now() where id=v_source.id;
    else
      update public.olli_schedule_enrollments set effective_to=v_effective - 1, updated_at=now() where id=v_source.id;
    end if;
  end if;

  insert into public.olli_schedule_enrollments(
    academy_id,student_id,weekday,time_slot,class_group,session_order,effective_from,source
  ) values (
    p_academy_id,p_student_id,p_target_weekday,p_target_time_slot,v_class_group,v_target_order,v_effective,
    case when p_change_type='move' then 'move' else 'add' end
  ) returning id into v_target_id;

  insert into public.olli_schedule_changes(
    academy_id,student_id,change_type,source_enrollment_id,target_enrollment_id,
    target_class_group,effective_date,status
  ) values (
    p_academy_id,p_student_id,p_change_type,
    case when p_change_type='move' then p_source_enrollment_id else null end,
    v_target_id,v_class_group,v_effective,
    case when v_effective<=current_date then 'applied' else 'scheduled' end
  ) returning id into v_change_id;

  if v_effective <= current_date then
    perform private.olli_schedule_sync_student(p_student_id,current_date);
  end if;
  return jsonb_build_object(
    'ok',true,
    'result',case when v_effective<=current_date then 'applied' else 'scheduled' end,
    'change_id',v_change_id,
    'target_enrollment_id',v_target_id,
    'effective_date',v_effective
  );
end;
$function$;


-- PC timetable drag-and-drop: atomic pickup relocation without deleting history.
-- Keep attendance, other schedule domains, and existing pickup RPCs unchanged.
create or replace function public.olli_schedule_move_pickup_v1(
  p_session_token text,
  p_academy_id uuid,
  p_pickup_id uuid,
  p_source_date date,
  p_target_date date,
  p_target_class_time integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pickup public.olli_schedule_pickups%rowtype;
  v_account_id uuid;
  v_target_weekday integer;
  v_count integer;
  v_new_id uuid;
  v_new_until date;
  v_apply_date date;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '픽업 시간표를 변경할 권한이 없습니다.');
  end if;

  if p_source_date is null or p_target_date is null or p_target_date < current_date then
    return jsonb_build_object('ok', false, 'message', '오늘 이후의 이동 날짜를 선택해 주세요.');
  end if;

  v_target_weekday := extract(isodow from p_target_date)::integer;
  if v_target_weekday not between 1 and 6
     or not private.olli_schedule_slot_is_valid(p_academy_id, 'kinder', v_target_weekday, p_target_class_time) then
    return jsonb_build_object('ok', false, 'message', '이동할 유치부 픽업 시간을 확인해 주세요.');
  end if;

  select * into v_pickup
  from public.olli_schedule_pickups p
  where p.id = p_pickup_id and p.academy_id = p_academy_id and p.status = 'active'
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', '픽업카드를 찾을 수 없습니다. 시간표를 새로고침해 주세요.');
  end if;

  if extract(isodow from p_source_date)::integer <> v_pickup.weekday
     or p_source_date < v_pickup.effective_from
     or (v_pickup.effective_to is not null and p_source_date > v_pickup.effective_to)
     or (v_pickup.pickup_scope = 'daily' and p_source_date <> v_pickup.effective_from) then
    return jsonb_build_object('ok', false, 'message', '픽업카드의 원래 일정이 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
  end if;

  if v_pickup.weekday = v_target_weekday and v_pickup.class_time = p_target_class_time
     and (v_pickup.pickup_scope = 'weekly' or p_source_date = p_target_date) then
    return jsonb_build_object('ok', true, 'result', 'unchanged', 'pickup_id', p_pickup_id);
  end if;

  -- Weekly pickups moved within the current week start now; daily stays date-only.
  v_apply_date := case
    when v_pickup.pickup_scope = 'weekly'
      and p_target_date < (date_trunc('week', current_date)::date + 7)
    then current_date
    else p_target_date
  end;

  if v_pickup.pickup_scope = 'daily' and p_source_date < current_date then
    return jsonb_build_object('ok', false, 'message', '지난 당일 픽업은 이동할 수 없습니다.');
  end if;
  if v_pickup.pickup_scope = 'weekly'
     and v_pickup.effective_to is not null and p_target_date > v_pickup.effective_to then
    return jsonb_build_object('ok', false, 'message', '픽업 종료 날짜 이후로는 이동할 수 없습니다.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':pickup:' || v_target_weekday::text || ':' ||
      p_target_class_time::text || ':' || p_target_date::text, 0
  ));

  if exists (
    select 1 from public.olli_schedule_pickups p
    where p.academy_id = p_academy_id
      and p.id <> p_pickup_id
      and p.student_id = v_pickup.student_id
      and p.weekday = v_target_weekday
      and p.class_time = p_target_class_time
      and p.pickup_scope = v_pickup.pickup_scope
      and p.status = 'active'
      and p.effective_from <= p_target_date
      and (p.effective_to is null or p.effective_to >= p_target_date)
  ) then
    return jsonb_build_object('ok', false, 'message', '해당 시간에는 이미 같은 학생의 픽업이 등록되어 있습니다.');
  end if;

  select count(distinct p.student_id) into v_count
  from public.olli_schedule_pickups p
  where p.academy_id = p_academy_id
    and p.weekday = v_target_weekday
    and p.class_time = p_target_class_time
    and p.student_id <> v_pickup.student_id
    and p.status = 'active'
    and p.effective_from <= p_target_date
    and (p.effective_to is null or p.effective_to >= p_target_date);
  if v_count >= 6 then
    return jsonb_build_object('ok', false, 'message', '이 픽업 시간은 최대 6명까지 등록할 수 있습니다.', 'full', true);
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  perform set_config('olli.actor_account_id', coalesce(v_account_id::text, ''), true);
  perform set_config('olli.schedule_action', 'pickup_drag_move', true);

  v_new_until := case when v_pickup.pickup_scope = 'daily'
                      then p_target_date else v_pickup.effective_to end;

  if v_pickup.pickup_scope = 'weekly' and v_apply_date > v_pickup.effective_from then
    update public.olli_schedule_pickups
    set effective_to = v_apply_date - 1, updated_at = now()
    where id = p_pickup_id;
  else
    update public.olli_schedule_pickups
    set status = 'cancelled', updated_at = now()
    where id = p_pickup_id;
  end if;

  insert into public.olli_schedule_pickups (
    academy_id, student_id, weekday, class_time,
    pickup_label, pickup_time, is_dropoff, dropoff_label, dropoff_time,
    pickup_scope, effective_from, effective_to, created_by_account_id, created_at
  ) values (
    p_academy_id, v_pickup.student_id, v_target_weekday, p_target_class_time,
    v_pickup.pickup_label, v_pickup.pickup_time, v_pickup.is_dropoff,
    v_pickup.dropoff_label, v_pickup.dropoff_time,
    v_pickup.pickup_scope, v_apply_date, v_new_until, v_account_id, v_pickup.created_at
  ) returning id into v_new_id;

  return jsonb_build_object('ok', true, 'result', 'moved',
    'pickup_id', v_new_id, 'previous_pickup_id', p_pickup_id,
    'effective_date', v_apply_date, 'target_date', p_target_date,
    'pickup_scope', v_pickup.pickup_scope);
end;
$function$;

revoke all on function public.olli_schedule_move_pickup_v1(text,uuid,uuid,date,date,integer) from public;
grant execute on function public.olli_schedule_move_pickup_v1(text,uuid,uuid,date,date,integer) to anon, authenticated, service_role;

