create or replace function public.olli_schedule_availability_horizon(
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
  v_end date := coalesce(p_end_date, coalesce(p_start_date, current_date) + 365);
  v_enrollments jsonb;
  v_one_time jsonb;
  v_class_splits jsonb;
  v_kinder_merges jsonb;
  v_class_teachers jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표를 볼 권한이 없습니다.');
  end if;

  if v_end < v_start or v_end > v_start + 370 then
    return jsonb_build_object('ok', false, 'message', '시간표 조회 범위를 확인해 주세요.');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.weekday, x.time_slot, x.student_name), '[]'::jsonb)
  into v_enrollments
  from (
    select
      e.id,
      e.student_id,
      s.name as student_name,
      s.division,
      e.weekday,
      e.time_slot,
      coalesce(nullif(upper(trim(e.class_group)), ''), 'A') as class_group,
      e.session_order,
      e.effective_from,
      e.effective_to,
      e.source
    from public.olli_schedule_enrollments e
    join public.students s on s.id = e.student_id
    where e.academy_id = p_academy_id
      and e.status = 'active'
      and e.effective_from <= v_end
      and (e.effective_to is null or e.effective_to >= v_start)
      and s.status = 'active'
      and coalesce(s.is_deleted, false) = false
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.session_date, x.time_slot, x.student_name), '[]'::jsonb)
  into v_one_time
  from (
    select
      o.id,
      o.student_id,
      coalesce(s.name, o.guest_name) as student_name,
      coalesce(s.division, o.guest_division) as division,
      (o.student_id is null) as is_guest,
      o.session_date,
      o.time_slot,
      coalesce(nullif(upper(trim(o.class_group)), ''), 'A') as class_group,
      o.session_type,
      o.status
    from public.olli_schedule_one_time_sessions o
    left join public.students s on s.id = o.student_id
    where o.academy_id = p_academy_id
      and o.session_date between v_start and v_end
      and o.status <> 'cancelled'
      and (
        o.student_id is null
        or (s.status = 'active' and coalesce(s.is_deleted, false) = false)
      )
  ) x;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('weekday', s.weekday, 'time_slot', s.time_slot)
      order by s.weekday, s.time_slot
    ),
    '[]'::jsonb
  )
  into v_class_splits
  from public.olli_schedule_class_splits s
  where s.academy_id = p_academy_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('weekday', m.weekday, 'time_slot', m.time_slot)
      order by m.weekday, m.time_slot
    ),
    '[]'::jsonb
  )
  into v_kinder_merges
  from public.olli_schedule_kinder_class_merges m
  where m.academy_id = p_academy_id;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.division, x.weekday, x.time_slot, x.class_group), '[]'::jsonb)
  into v_class_teachers
  from (
    select
      ct.division,
      ct.weekday,
      ct.time_slot,
      coalesce(nullif(upper(trim(ct.class_group)), ''), 'A') as class_group,
      ct.teacher_member_id,
      coalesce(ct.teacher_name, '') as teacher_name
    from public.olli_schedule_class_teachers ct
    where ct.academy_id = p_academy_id
  ) x;

  return jsonb_build_object(
    'ok', true,
    'start_date', v_start,
    'end_date', v_end,
    'elementary_capacity',
      coalesce((select st.elementary_capacity from public.olli_schedule_settings st where st.academy_id = p_academy_id), 5),
    'kinder_capacity', 5,
    'enrollments', v_enrollments,
    'one_time_sessions', v_one_time,
    'class_splits', v_class_splits,
    'kinder_class_merges', v_kinder_merges,
    'class_teachers', v_class_teachers
  );
end;
$function$;

revoke all on function public.olli_schedule_availability_horizon(text, uuid, date, date) from public;
grant execute on function public.olli_schedule_availability_horizon(text, uuid, date, date) to anon, authenticated;
