-- Unified pickup model: arrival and dropoff can be registered independently or together.

create or replace function public.olli_schedule_save_pickup_v3(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_weekday integer,
  p_class_time integer,
  p_arrival_label text,
  p_pickup_time time without time zone,
  p_dropoff_label text,
  p_effective_date date
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
  v_arrival_label text := btrim(coalesce(p_arrival_label, ''));
  v_dropoff_label text := btrim(coalesce(p_dropoff_label, ''));
  v_has_arrival boolean := false;
  v_has_dropoff boolean := false;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '픽업 시간표를 변경할 권한이 없습니다.');
  end if;

  v_has_arrival := (v_arrival_label <> '' or p_pickup_time is not null);
  v_has_dropoff := (v_dropoff_label <> '');

  if p_weekday not between 1 and 6 or p_class_time not in (4, 5) then
    return jsonb_build_object('ok', false, 'message', '픽업 요일과 수업 시간을 확인해 주세요.');
  end if;
  if v_has_arrival and (v_arrival_label = '' or p_pickup_time is null) then
    return jsonb_build_object('ok', false, 'message', '등원 픽업은 장소와 시간을 모두 입력해 주세요.');
  end if;
  if not v_has_arrival and not v_has_dropoff then
    return jsonb_build_object('ok', false, 'message', '등원 또는 하원 중 하나 이상을 입력해 주세요.');
  end if;
  if char_length(v_arrival_label) > 80 or char_length(v_dropoff_label) > 80 then
    return jsonb_build_object('ok', false, 'message', '픽업 장소는 80자 이내로 입력해 주세요.');
  end if;

  if not exists (
    select 1 from public.students s
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
    p_academy_id::text || ':pickup:' || p_weekday::text || ':' || p_class_time::text, 0
  ));

  if exists (
    select 1 from public.olli_schedule_pickups p
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
    academy_id, student_id, weekday, class_time, pickup_label, pickup_time,
    is_dropoff, dropoff_label, effective_from, created_by_account_id
  ) values (
    p_academy_id, p_student_id, p_weekday, p_class_time,
    case when v_has_arrival then v_arrival_label else v_dropoff_label end,
    case when v_has_arrival then p_pickup_time else null end,
    not v_has_arrival,
    case when v_has_dropoff then v_dropoff_label else null end,
    v_effective, v_account_id
  ) returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'result', 'saved', 'pickup_id', v_id, 'effective_date', v_effective,
    'has_arrival', v_has_arrival, 'has_dropoff', v_has_dropoff, 'is_dropoff', not v_has_arrival
  );
end;
$function$;

create or replace function public.olli_schedule_save_pickup_arrival(
  p_session_token text,
  p_academy_id uuid,
  p_pickup_id uuid,
  p_pickup_label text,
  p_pickup_time time without time zone
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_label text := btrim(coalesce(p_pickup_label, ''));
  v_pickup public.olli_schedule_pickups%rowtype;
  v_dropoff_label text;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '픽업 시간표를 변경할 권한이 없습니다.');
  end if;
  if char_length(v_label) not between 1 and 80 or p_pickup_time is null then
    return jsonb_build_object('ok', false, 'message', '등원 장소와 시간을 모두 입력해 주세요.');
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
  perform set_config('olli.schedule_action', 'pickup_arrival_save', true);

  v_dropoff_label := nullif(btrim(coalesce(v_pickup.dropoff_label, '')), '');
  if v_pickup.is_dropoff = true and v_dropoff_label is null then
    v_dropoff_label := v_pickup.pickup_label;
  end if;

  update public.olli_schedule_pickups
  set pickup_label = v_label,
      pickup_time = p_pickup_time,
      is_dropoff = false,
      dropoff_label = v_dropoff_label,
      updated_at = now()
  where id = v_pickup.id;

  return jsonb_build_object(
    'ok', true, 'result', 'updated', 'pickup_id', v_pickup.id,
    'pickup_label', v_label, 'pickup_time', p_pickup_time,
    'dropoff_label', v_dropoff_label, 'is_dropoff', false
  );
end;
$function$;

create or replace function public.olli_schedule_remove_pickup_dropoff(
  p_session_token text,
  p_academy_id uuid,
  p_pickup_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_pickup public.olli_schedule_pickups%rowtype;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '픽업 시간표를 변경할 권한이 없습니다.');
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
  perform set_config('olli.schedule_action', 'pickup_dropoff_remove', true);

  if v_pickup.is_dropoff = true then
    update public.olli_schedule_pickups
    set status = 'cancelled', updated_at = now()
    where id = v_pickup.id;
  else
    update public.olli_schedule_pickups
    set dropoff_label = null, updated_at = now()
    where id = v_pickup.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'result', case when v_pickup.is_dropoff then 'removed' else 'updated' end,
    'pickup_id', v_pickup.id,
    'pickup_label', v_pickup.pickup_label,
    'pickup_time', v_pickup.pickup_time,
    'dropoff_label', null,
    'is_dropoff', false
  );
end;
$function$;

revoke all on function public.olli_schedule_save_pickup_v3(text, uuid, uuid, integer, integer, text, time without time zone, text, date) from public, anon, authenticated;
grant execute on function public.olli_schedule_save_pickup_v3(text, uuid, uuid, integer, integer, text, time without time zone, text, date) to anon, authenticated;

revoke all on function public.olli_schedule_save_pickup_arrival(text, uuid, uuid, text, time without time zone) from public, anon, authenticated;
grant execute on function public.olli_schedule_save_pickup_arrival(text, uuid, uuid, text, time without time zone) to anon, authenticated;

revoke all on function public.olli_schedule_remove_pickup_dropoff(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.olli_schedule_remove_pickup_dropoff(text, uuid, uuid) to anon, authenticated;
