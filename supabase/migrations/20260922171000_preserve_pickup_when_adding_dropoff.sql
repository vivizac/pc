-- Preserve an existing arrival pickup when adding a dropoff place.
-- is_dropoff continues to mean a dropoff-only pickup row.
-- dropoff_label stores the optional return destination attached to a pickup.

alter table public.olli_schedule_pickups
  add column if not exists dropoff_label text;

update public.olli_schedule_pickups
set dropoff_label = pickup_label
where is_dropoff = true
  and nullif(btrim(coalesce(dropoff_label, '')), '') is null;

create or replace function public.olli_schedule_register_pickup_dropoff(
  p_session_token text,
  p_academy_id uuid,
  p_pickup_id uuid,
  p_dropoff_label text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_label text := btrim(coalesce(p_dropoff_label, ''));
  v_pickup public.olli_schedule_pickups%rowtype;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '픽업 시간표를 변경할 권한이 없습니다.');
  end if;

  if char_length(v_label) not between 1 and 80 then
    return jsonb_build_object('ok', false, 'message', '하원 장소를 1~80자로 입력해 주세요.');
  end if;

  select *
    into v_pickup
  from public.olli_schedule_pickups p
  where p.id = p_pickup_id
    and p.academy_id = p_academy_id
    and p.status = 'active'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', '픽업 일정을 찾을 수 없습니다.');
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  perform set_config('olli.actor_account_id', coalesce(v_account_id::text, ''), true);
  perform set_config('olli.schedule_action', 'pickup_dropoff', true);

  if v_pickup.is_dropoff = true then
    update public.olli_schedule_pickups
    set pickup_label = v_label,
        dropoff_label = v_label,
        updated_at = now()
    where id = v_pickup.id;
  else
    update public.olli_schedule_pickups
    set dropoff_label = v_label,
        updated_at = now()
    where id = v_pickup.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'result', 'updated',
    'pickup_id', v_pickup.id,
    'pickup_label', case when v_pickup.is_dropoff then v_label else v_pickup.pickup_label end,
    'pickup_time', v_pickup.pickup_time,
    'dropoff_label', v_label,
    'is_dropoff', v_pickup.is_dropoff
  );
end;
$function$;

create or replace function public.olli_schedule_pickup_dropoff_flags(
  p_session_token text,
  p_academy_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_start date := coalesce(p_start_date, current_date);
  v_end date := coalesce(p_end_date, coalesce(p_start_date, current_date));
  v_flags jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '픽업 시간표를 볼 권한이 없습니다.');
  end if;

  if v_end < v_start then
    return jsonb_build_object('ok', false, 'message', '픽업 조회 날짜를 확인해 주세요.');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'is_dropoff', p.is_dropoff,
        'dropoff_label', p.dropoff_label
      )
      order by p.weekday, p.class_time, p.pickup_time, p.id
    ),
    '[]'::jsonb
  )
  into v_flags
  from public.olli_schedule_pickups p
  where p.academy_id = p_academy_id
    and p.status = 'active'
    and p.effective_from <= v_end
    and (p.effective_to is null or p.effective_to >= v_start);

  return jsonb_build_object('ok', true, 'flags', v_flags);
end;
$function$;

revoke all on function public.olli_schedule_register_pickup_dropoff(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.olli_schedule_register_pickup_dropoff(text, uuid, uuid, text) to anon, authenticated;

revoke all on function public.olli_schedule_pickup_dropoff_flags(text, uuid, date, date) from public, anon, authenticated;
grant execute on function public.olli_schedule_pickup_dropoff_flags(text, uuid, date, date) to anon, authenticated;


-- When a pickup time change is scheduled, carry the separate dropoff place
-- into the new pickup row instead of dropping it.
create or replace function public.olli_schedule_update_pickup(
  p_session_token text,
  p_academy_id uuid,
  p_pickup_id uuid,
  p_pickup_time time without time zone,
  p_effective_date date,
  p_mode text default 'edit'::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_pickup public.olli_schedule_pickups%rowtype;
  v_mode text := lower(btrim(coalesce(p_mode, 'edit')));
  v_effective date := coalesce(p_effective_date, current_date);
  v_new_id uuid;
  v_old_end date;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '픽업 시간표를 변경할 권한이 없습니다.');
  end if;
  if p_pickup_time is null or v_mode not in ('edit','schedule') then
    return jsonb_build_object('ok', false, 'message', '픽업 시간을 확인해 주세요.');
  end if;

  select * into v_pickup
  from public.olli_schedule_pickups p
  where p.id = p_pickup_id and p.academy_id = p_academy_id and p.status = 'active'
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', '픽업 일정을 찾을 수 없습니다.');
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  perform set_config('olli.actor_account_id', coalesce(v_account_id::text, ''), true);
  perform set_config('olli.schedule_action', case when v_mode = 'schedule' then 'pickup_schedule' else 'pickup_edit' end, true);

  if v_mode = 'edit' then
    update public.olli_schedule_pickups
    set pickup_time = p_pickup_time, updated_at = now()
    where id = v_pickup.id;
    return jsonb_build_object('ok', true, 'result', 'updated', 'pickup_id', v_pickup.id);
  end if;

  if v_effective <= current_date then
    return jsonb_build_object('ok', false, 'message', '변경 예약은 내일부터 설정할 수 있습니다.');
  end if;
  if private.olli_schedule_is_closed_day(p_academy_id, v_effective) then
    return jsonb_build_object('ok', false, 'message', '공휴일에는 픽업시간 변경 예약을 설정할 수 없습니다.');
  end if;
  if v_effective < v_pickup.effective_from or (v_pickup.effective_to is not null and v_effective > v_pickup.effective_to) then
    return jsonb_build_object('ok', false, 'message', '선택한 픽업 일정의 적용 범위를 벗어났습니다.');
  end if;
  if v_effective = v_pickup.effective_from then
    update public.olli_schedule_pickups
    set pickup_time = p_pickup_time, updated_at = now()
    where id = v_pickup.id;
    return jsonb_build_object('ok', true, 'result', 'updated', 'pickup_id', v_pickup.id);
  end if;

  v_old_end := v_pickup.effective_to;
  update public.olli_schedule_pickups
  set effective_to = v_effective - 1, updated_at = now()
  where id = v_pickup.id;

  insert into public.olli_schedule_pickups (
    academy_id, student_id, weekday, class_time, pickup_label, pickup_time, is_dropoff, dropoff_label,
    effective_from, effective_to, status, created_by_account_id
  ) values (
    v_pickup.academy_id, v_pickup.student_id, v_pickup.weekday, v_pickup.class_time,
    v_pickup.pickup_label, p_pickup_time, v_pickup.is_dropoff, v_pickup.dropoff_label,
    v_effective, v_old_end, 'active', v_account_id
  )
  returning id into v_new_id;

  return jsonb_build_object('ok', true, 'result', 'scheduled', 'pickup_id', v_new_id, 'effective_date', v_effective);
end;
$function$;
