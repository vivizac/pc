
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

  if v_pickup.pickup_scope = 'weekly' and p_target_date > v_pickup.effective_from then
    update public.olli_schedule_pickups
    set effective_to = p_target_date - 1, updated_at = now()
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
    v_pickup.pickup_scope, p_target_date, v_new_until, v_account_id, v_pickup.created_at
  ) returning id into v_new_id;

  return jsonb_build_object('ok', true, 'result', 'moved',
    'pickup_id', v_new_id, 'previous_pickup_id', p_pickup_id,
    'effective_date', p_target_date, 'pickup_scope', v_pickup.pickup_scope);
end;
$function$;

revoke all on function public.olli_schedule_move_pickup_v1(text,uuid,uuid,date,date,integer) from public;
grant execute on function public.olli_schedule_move_pickup_v1(text,uuid,uuid,date,date,integer) to anon, authenticated, service_role;
