create or replace function public.olli_schedule_save_pickup(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_weekday integer,
  p_class_time integer,
  p_pickup_label text,
  p_pickup_time time without time zone,
  p_effective_date date
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account_id uuid;
  v_effective date := greatest(coalesce(p_effective_date, current_date), current_date);
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
  ) then
    return jsonb_build_object('ok', false, 'message', '유치부 학생을 찾을 수 없습니다.');
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);

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
    effective_from,
    created_by_account_id
  ) values (
    p_academy_id,
    p_student_id,
    p_weekday,
    p_class_time,
    btrim(p_pickup_label),
    p_pickup_time,
    v_effective,
    v_account_id
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'result', 'saved', 'pickup_id', v_id, 'effective_date', v_effective);
end;
$function$;
