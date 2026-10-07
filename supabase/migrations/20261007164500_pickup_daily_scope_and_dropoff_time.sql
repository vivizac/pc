-- Add one-day pickup schedules and optional dropoff time while preserving weekly pickup behavior.

alter table public.olli_schedule_pickups
  add column if not exists dropoff_time time without time zone,
  add column if not exists pickup_scope text not null default 'weekly';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='olli_schedule_pickups_scope_check'
      and conrelid='public.olli_schedule_pickups'::regclass
  ) then
    alter table public.olli_schedule_pickups
      add constraint olli_schedule_pickups_scope_check
      check (pickup_scope in ('weekly','daily'));
  end if;
end $$;

create index if not exists olli_schedule_pickups_scope_date_idx
  on public.olli_schedule_pickups
  (academy_id,pickup_scope,effective_from,effective_to,weekday,class_time);

-- Production definitions for olli_schedule_save_pickup_v4,
-- olli_schedule_save_pickup_v3 compatibility wrapper,
-- olli_schedule_pickup_dropoff_flags, and olli_schedule_remove_pickup_dropoff
-- are applied below exactly as deployed.

CREATE OR REPLACE FUNCTION public.olli_schedule_save_pickup_v4(p_session_token text, p_academy_id uuid, p_student_id uuid, p_weekday integer, p_class_time integer, p_arrival_label text, p_pickup_time time without time zone, p_dropoff_label text, p_dropoff_time time without time zone, p_effective_date date, p_pickup_scope text DEFAULT 'weekly'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_effective date := coalesce(p_effective_date, current_date);
  v_scope text := lower(btrim(coalesce(p_pickup_scope, 'weekly')));
  v_id uuid;
  v_count integer;
  v_arrival_label text := btrim(coalesce(p_arrival_label, ''));
  v_dropoff_label text := btrim(coalesce(p_dropoff_label, ''));
  v_has_arrival boolean := false;
  v_has_dropoff boolean := false;
  v_effective_to date;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '픽업 시간표를 변경할 권한이 없습니다.');
  end if;

  if v_scope not in ('weekly','daily') then
    return jsonb_build_object('ok', false, 'message', '픽업 적용 방식을 확인해 주세요.');
  end if;

  if not private.olli_schedule_slot_is_valid(p_academy_id, 'kinder', p_weekday, p_class_time) then
    return jsonb_build_object('ok', false, 'message', '현재 시간표 모드에서 사용할 수 있는 유치부 수업 시간을 확인해 주세요.');
  end if;

  if v_scope = 'daily' and extract(isodow from v_effective)::integer <> p_weekday then
    return jsonb_build_object('ok', false, 'message', '당일 픽업 날짜와 요일을 확인해 주세요.');
  end if;

  v_has_arrival := (v_arrival_label <> '' or p_pickup_time is not null);
  v_has_dropoff := (v_dropoff_label <> '' or p_dropoff_time is not null);

  if v_has_arrival and (v_arrival_label = '' or p_pickup_time is null) then
    return jsonb_build_object('ok', false, 'message', '등원 픽업은 장소와 시간을 모두 입력해 주세요.');
  end if;
  if p_dropoff_time is not null and v_dropoff_label = '' then
    return jsonb_build_object('ok', false, 'message', '하원 시간을 입력하려면 하원 장소도 입력해 주세요.');
  end if;
  if not v_has_arrival and not v_has_dropoff then
    return jsonb_build_object('ok', false, 'message', '등원 또는 하원 중 하나 이상을 입력해 주세요.');
  end if;
  if char_length(v_arrival_label) > 80 or char_length(v_dropoff_label) > 80 then
    return jsonb_build_object('ok', false, 'message', '픽업 장소는 80자 이내로 입력해 주세요.');
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
  perform set_config(
    'olli.schedule_action',
    case when v_scope = 'daily' then 'pickup_daily_add' else 'pickup_add' end,
    true
  );

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':pickup:' || p_weekday::text || ':' || p_class_time::text || ':' || v_effective::text,
    0
  ));

  if v_scope = 'daily' then
    if exists (
      select 1
      from public.olli_schedule_pickups p
      where p.academy_id = p_academy_id
        and p.student_id = p_student_id
        and p.weekday = p_weekday
        and p.class_time = p_class_time
        and p.pickup_scope = 'daily'
        and p.status = 'active'
        and p.effective_from = v_effective
        and p.effective_to = v_effective
    ) then
      return jsonb_build_object('ok', false, 'message', '이 학생은 해당 날짜에 이미 당일 픽업이 설정되어 있습니다.');
    end if;
  else
    if exists (
      select 1
      from public.olli_schedule_pickups p
      where p.academy_id = p_academy_id
        and p.student_id = p_student_id
        and p.weekday = p_weekday
        and p.class_time = p_class_time
        and p.pickup_scope = 'weekly'
        and p.status = 'active'
        and p.effective_from <= v_effective
        and (p.effective_to is null or p.effective_to >= v_effective)
    ) then
      return jsonb_build_object('ok', false, 'message', '이 학생은 이미 같은 수업의 매주 픽업 명단에 있습니다.');
    end if;
  end if;

  select count(distinct p.student_id) into v_count
  from public.olli_schedule_pickups p
  where p.academy_id = p_academy_id
    and p.weekday = p_weekday
    and p.class_time = p_class_time
    and p.student_id <> p_student_id
    and p.status = 'active'
    and p.effective_from <= v_effective
    and (p.effective_to is null or p.effective_to >= v_effective);

  if v_count >= 6 then
    return jsonb_build_object('ok', false, 'message', '이 픽업 시간은 최대 6명까지 등록할 수 있습니다.', 'full', true);
  end if;

  v_effective_to := case when v_scope = 'daily' then v_effective else null end;

  insert into public.olli_schedule_pickups (
    academy_id,
    student_id,
    weekday,
    class_time,
    pickup_label,
    pickup_time,
    is_dropoff,
    dropoff_label,
    dropoff_time,
    pickup_scope,
    effective_from,
    effective_to,
    created_by_account_id
  ) values (
    p_academy_id,
    p_student_id,
    p_weekday,
    p_class_time,
    case when v_has_arrival then v_arrival_label else v_dropoff_label end,
    case when v_has_arrival then p_pickup_time else null end,
    not v_has_arrival,
    case when v_has_dropoff then v_dropoff_label else null end,
    case when v_has_dropoff then p_dropoff_time else null end,
    v_scope,
    v_effective,
    v_effective_to,
    v_account_id
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'result', 'saved',
    'pickup_id', v_id,
    'effective_date', v_effective,
    'pickup_scope', v_scope,
    'has_arrival', v_has_arrival,
    'has_dropoff', v_has_dropoff,
    'is_dropoff', not v_has_arrival
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_schedule_save_pickup_v3(p_session_token text, p_academy_id uuid, p_student_id uuid, p_weekday integer, p_class_time integer, p_arrival_label text, p_pickup_time time without time zone, p_dropoff_label text, p_effective_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return public.olli_schedule_save_pickup_v4(
    p_session_token,
    p_academy_id,
    p_student_id,
    p_weekday,
    p_class_time,
    p_arrival_label,
    p_pickup_time,
    p_dropoff_label,
    null,
    p_effective_date,
    'weekly'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_schedule_pickup_dropoff_flags(p_session_token text, p_academy_id uuid, p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        'dropoff_label', p.dropoff_label,
        'dropoff_time', p.dropoff_time,
        'pickup_scope', p.pickup_scope
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

CREATE OR REPLACE FUNCTION public.olli_schedule_remove_pickup_dropoff(p_session_token text, p_academy_id uuid, p_pickup_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    set dropoff_label = null,
        dropoff_time = null,
        updated_at = now()
    where id = v_pickup.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'result', case when v_pickup.is_dropoff then 'removed' else 'updated' end,
    'pickup_id', v_pickup.id,
    'pickup_label', v_pickup.pickup_label,
    'pickup_time', v_pickup.pickup_time,
    'dropoff_label', null,
    'dropoff_time', null,
    'is_dropoff', false
  );
end;
$function$;

revoke all on function public.olli_schedule_save_pickup_v4(text,uuid,uuid,integer,integer,text,time without time zone,text,time without time zone,date,text) from public;
grant execute on function public.olli_schedule_save_pickup_v4(text,uuid,uuid,integer,integer,text,time without time zone,text,time without time zone,date,text) to anon, authenticated;
