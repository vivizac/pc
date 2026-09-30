create or replace function public.olli_schedule_student_pickups_range(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
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
  v_end date := coalesce(p_end_date, p_start_date, current_date);
  v_division text;
  v_pickups jsonb;
  v_closed_dates jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '픽업 시간표를 볼 권한이 없습니다.');
  end if;
  if p_student_id is null then
    return jsonb_build_object('ok', false, 'message', '픽업을 확인할 학생을 지정해 주세요.');
  end if;
  if v_end < v_start or v_end > v_start + 61 then
    return jsonb_build_object('ok', false, 'message', '픽업 조회 기간을 확인해 주세요.');
  end if;

  select s.division into v_division
  from public.students s
  where s.id = p_student_id
    and s.academy_id = p_academy_id
    and s.status = 'active'
    and coalesce(s.is_deleted, false) = false;

  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;

  if v_division <> 'kinder' then
    return jsonb_build_object(
      'ok', true, 'division', v_division,
      'start_date', v_start, 'end_date', v_end,
      'pickup_supported', false,
      'pickups', '[]'::jsonb, 'pickup_count', 0,
      'closed_dates', '[]'::jsonb
    );
  end if;

  with dates as (
    select gs::date as session_date
    from generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') gs
  ),
  candidates as (
    select
      d.session_date,
      extract(isodow from d.session_date)::integer as weekday,
      p.id,
      p.class_time,
      p.pickup_label,
      p.pickup_time,
      p.is_dropoff,
      p.dropoff_label,
      p.effective_from,
      p.effective_to,
      p.updated_at,
      p.created_at,
      row_number() over (
        partition by d.session_date, p.class_time
        order by p.effective_from desc, p.updated_at desc, p.created_at desc, p.id desc
      ) as precedence_rank
    from dates d
    join public.olli_schedule_pickups p
      on p.academy_id = p_academy_id
     and p.student_id = p_student_id
     and p.status = 'active'
     and p.weekday = extract(isodow from d.session_date)::integer
     and p.effective_from <= d.session_date
     and (p.effective_to is null or p.effective_to >= d.session_date)
    where extract(isodow from d.session_date)::integer between 1 and 6
      and not private.olli_schedule_is_closed_day(p_academy_id, d.session_date)
  ),
  resolved as (
    select * from candidates where precedence_rank = 1
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'date', r.session_date,
      'weekday', r.weekday,
      'class_time', r.class_time,
      'has_arrival', (not r.is_dropoff)
        and nullif(btrim(coalesce(r.pickup_label, '')), '') is not null
        and r.pickup_time is not null,
      'arrival_label', case when r.is_dropoff then '' else coalesce(r.pickup_label, '') end,
      'arrival_time', case when r.is_dropoff or r.pickup_time is null then '' else to_char(r.pickup_time, 'HH24:MI') end,
      'has_dropoff', r.is_dropoff or nullif(btrim(coalesce(r.dropoff_label, '')), '') is not null,
      'dropoff_label', case
        when nullif(btrim(coalesce(r.dropoff_label, '')), '') is not null then r.dropoff_label
        when r.is_dropoff then r.pickup_label
        else ''
      end
    ) order by r.session_date, r.class_time
  ), '[]'::jsonb)
  into v_pickups
  from resolved r;

  with dates as (
    select gs::date as session_date
    from generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') gs
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'date', d.session_date,
      'reason', case
        when extract(isodow from d.session_date)::integer = 7 then '일요일'
        else '휴원일 또는 공휴일'
      end
    ) order by d.session_date
  ), '[]'::jsonb)
  into v_closed_dates
  from dates d
  where extract(isodow from d.session_date)::integer = 7
     or private.olli_schedule_is_closed_day(p_academy_id, d.session_date);

  return jsonb_build_object(
    'ok', true,
    'division', v_division,
    'start_date', v_start,
    'end_date', v_end,
    'pickup_supported', true,
    'pickups', v_pickups,
    'pickup_count', jsonb_array_length(v_pickups),
    'closed_dates', v_closed_dates
  );
end;
$function$;

revoke all on function public.olli_schedule_student_pickups_range(text, uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.olli_schedule_student_pickups_range(text, uuid, uuid, date, date)
  to anon, authenticated;
