-- Pickup dropoff marker + keyboard/search/time-picker UX support.
-- Keeps existing pickup RPCs compatible while adding a v2 create path for is_dropoff.

alter table public.olli_schedule_pickups
  add column if not exists is_dropoff boolean not null default false;

create or replace function public.olli_schedule_save_pickup_v2(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_weekday integer,
  p_class_time integer,
  p_pickup_label text,
  p_pickup_time time without time zone,
  p_effective_date date,
  p_is_dropoff boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_effective date := coalesce(p_effective_date, current_date);
  v_id uuid;
  v_count integer;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '픽업 시간표를 변경할 권한이 없습니다.');
  end if;

  if p_weekday not between 1 and 6
     or p_class_time not in (4, 5)
     or p_pickup_time is null
     or char_length(btrim(coalesce(p_pickup_label, ''))) not between 1 and 80 then
    return jsonb_build_object('ok', false, 'message', '픽업 요일, 장소와 시간을 확인해 주세요.');
  end if;

  if not exists (
    select 1
    from public.students s
    where s.id = p_student_id
      and s.academy_id = p_academy_id
      and s.status = 'active'
      and s.division = 'kinder'
      and coalesce(s.is_deleted, false) = false
  ) then
    return jsonb_build_object('ok', false, 'message', '유치부 학생을 찾을 수 없습니다.');
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  perform set_config('olli.actor_account_id', coalesce(v_account_id::text, ''), true);
  perform set_config('olli.schedule_action', 'pickup_add', true);

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':pickup:' || p_weekday::text || ':' || p_class_time::text,
    0
  ));

  if exists (
    select 1
    from public.olli_schedule_pickups p
    where p.academy_id = p_academy_id
      and p.student_id = p_student_id
      and p.weekday = p_weekday
      and p.class_time = p_class_time
      and p.status = 'active'
      and p.effective_from <= v_effective
      and (p.effective_to is null or p.effective_to >= v_effective)
  ) then
    return jsonb_build_object('ok', false, 'message', '이 학생은 이미 같은 수업의 픽업 명단에 있습니다.');
  end if;

  select count(*) into v_count
  from public.olli_schedule_pickups p
  where p.academy_id = p_academy_id
    and p.weekday = p_weekday
    and p.class_time = p_class_time
    and p.status = 'active'
    and p.effective_from <= v_effective
    and (p.effective_to is null or p.effective_to >= v_effective);

  if v_count >= 6 then
    return jsonb_build_object('ok', false, 'message', '이 픽업 시간은 최대 6명까지 등록할 수 있습니다.', 'full', true);
  end if;

  insert into public.olli_schedule_pickups (
    academy_id,
    student_id,
    weekday,
    class_time,
    pickup_label,
    pickup_time,
    is_dropoff,
    effective_from,
    created_by_account_id
  ) values (
    p_academy_id,
    p_student_id,
    p_weekday,
    p_class_time,
    btrim(p_pickup_label),
    p_pickup_time,
    coalesce(p_is_dropoff, false),
    v_effective,
    v_account_id
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'result', 'saved',
    'pickup_id', v_id,
    'effective_date', v_effective,
    'is_dropoff', coalesce(p_is_dropoff, false)
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
      jsonb_build_object('id', p.id, 'is_dropoff', p.is_dropoff)
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
    academy_id, student_id, weekday, class_time, pickup_label, pickup_time, is_dropoff,
    effective_from, effective_to, status, created_by_account_id
  ) values (
    v_pickup.academy_id, v_pickup.student_id, v_pickup.weekday, v_pickup.class_time,
    v_pickup.pickup_label, p_pickup_time, v_pickup.is_dropoff,
    v_effective, v_old_end, 'active', v_account_id
  )
  returning id into v_new_id;

  return jsonb_build_object('ok', true, 'result', 'scheduled', 'pickup_id', v_new_id, 'effective_date', v_effective);
end;
$function$;

revoke all on function public.olli_schedule_save_pickup_v2(text, uuid, uuid, integer, integer, text, time without time zone, date, boolean) from public, anon, authenticated;
grant execute on function public.olli_schedule_save_pickup_v2(text, uuid, uuid, integer, integer, text, time without time zone, date, boolean) to anon, authenticated;

revoke all on function public.olli_schedule_pickup_dropoff_flags(text, uuid, date, date) from public, anon, authenticated;
grant execute on function public.olli_schedule_pickup_dropoff_flags(text, uuid, date, date) to anon, authenticated;
