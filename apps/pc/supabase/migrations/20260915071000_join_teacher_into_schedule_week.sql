-- 주간 시간표 응답이 수업 정보와 반 담임 정보를 한 번에 반환하도록 통합합니다.
-- 별도 담임 context 조회 없이 같은 인증된 schedule RPC 응답만으로 학생정보/TODAY가 담임을 판별할 수 있습니다.

create or replace function public.olli_schedule_week(
  p_session_token text,
  p_academy_id uuid,
  p_week_start date
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_week_start date := coalesce(p_week_start, current_date - (extract(isodow from current_date)::integer - 1));
  v_week_end date;
  v_enrollments jsonb;
  v_waitlist jsonb;
  v_one_time jsonb;
  v_changes jsonb;
  v_attendance jsonb;
  v_pickups jsonb;
  v_class_splits jsonb;
  v_cell_memos jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표를 볼 권한이 없습니다.');
  end if;
  v_week_end := v_week_start + 5;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.weekday, x.time_slot, x.student_name), '[]'::jsonb)
  into v_enrollments
  from (
    select e.id, e.student_id, s.name as student_name, s.division,
           e.weekday, e.time_slot, e.class_group, e.session_order,
           e.effective_from, e.effective_to, e.source,
           ct.teacher_member_id, coalesce(ct.teacher_name, '') as teacher_name
    from public.olli_schedule_enrollments e
    join public.students s on s.id = e.student_id
    left join public.olli_schedule_class_teachers ct
      on ct.academy_id = e.academy_id
     and ct.division = s.division
     and ct.weekday = e.weekday
     and ct.time_slot = e.time_slot
     and ct.class_group = coalesce(nullif(upper(trim(e.class_group)), ''), 'A')
    where e.academy_id = p_academy_id and e.status = 'active'
      and e.effective_from <= v_week_end
      and (e.effective_to is null or e.effective_to >= v_week_start)
      and s.status = 'active'
      and coalesce(s.is_deleted, false) = false
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.target_weekday, x.target_time_slot, x.requested_at), '[]'::jsonb)
  into v_waitlist
  from (
    select w.id, w.student_id,
           coalesce(s.name, w.guest_name) as student_name,
           coalesce(s.division, w.guest_division) as division,
           (w.student_id is null) as is_guest,
           w.target_weekday, w.target_time_slot, w.target_class_group, w.request_type,
           w.source_enrollment_id, w.desired_effective_date, w.status, w.requested_at
    from public.olli_schedule_waitlist w
    left join public.students s on s.id = w.student_id
    where w.academy_id = p_academy_id and w.status in ('waiting','offered')
      and (w.requested_at at time zone 'Asia/Seoul')::date <= v_week_end
      and (
        w.student_id is null
        or (s.status = 'active' and coalesce(s.is_deleted, false) = false)
      )
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.session_date, x.time_slot, x.student_name), '[]'::jsonb)
  into v_one_time
  from (
    select o.id, o.student_id,
           coalesce(s.name, o.guest_name) as student_name,
           coalesce(s.division, o.guest_division) as division,
           (o.student_id is null) as is_guest,
           o.session_date, o.time_slot, o.class_group, o.session_type, o.status, o.note,
           ct.teacher_member_id, coalesce(ct.teacher_name, '') as teacher_name
    from public.olli_schedule_one_time_sessions o
    left join public.students s on s.id = o.student_id
    left join public.olli_schedule_class_teachers ct
      on ct.academy_id = o.academy_id
     and ct.division = coalesce(s.division, o.guest_division)
     and ct.weekday = extract(isodow from o.session_date)::integer
     and ct.time_slot = o.time_slot
     and ct.class_group = coalesce(nullif(upper(trim(o.class_group)), ''), 'A')
    where o.academy_id = p_academy_id
      and o.session_date between v_week_start and v_week_end
      and o.status <> 'cancelled'
      and (
        o.student_id is null
        or (s.status = 'active' and coalesce(s.is_deleted, false) = false)
      )
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.effective_date, x.student_name), '[]'::jsonb)
  into v_changes
  from (
    select c.id, c.student_id, s.name as student_name, s.division,
           c.change_type, c.source_enrollment_id, c.target_enrollment_id,
           c.target_class_group, c.effective_date, c.status, c.waitlist_id
    from public.olli_schedule_changes c
    join public.students s on s.id = c.student_id
    where c.academy_id = p_academy_id and c.status in ('scheduled','applied')
      and c.effective_date >= v_week_start - 35
      and c.effective_date <= v_week_end + 365
      and s.status = 'active'
      and coalesce(s.is_deleted, false) = false
  ) x;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.session_date, a.time_slot, a.student_id), '[]'::jsonb)
  into v_attendance
  from (
    select atn.id, atn.student_id, atn.session_date, atn.time_slot, atn.class_group, atn.session_kind, atn.marked_at
    from public.olli_schedule_attendance atn
    join public.students s on s.id = atn.student_id
    where atn.academy_id = p_academy_id
      and atn.session_date between v_week_start and v_week_end
      and s.status = 'active'
      and coalesce(s.is_deleted, false) = false
  ) a;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.weekday, x.class_time, x.pickup_time, x.student_name), '[]'::jsonb)
  into v_pickups
  from (
    select p.id, p.student_id, s.name as student_name, p.weekday, p.class_time,
           p.pickup_label, p.pickup_time, p.effective_from, p.effective_to
    from public.olli_schedule_pickups p
    join public.students s on s.id = p.student_id
    where p.academy_id = p_academy_id and p.status = 'active'
      and p.effective_from <= v_week_end
      and (p.effective_to is null or p.effective_to >= v_week_start)
      and s.status = 'active'
      and coalesce(s.is_deleted, false) = false
  ) x;

  select coalesce(
    jsonb_agg(jsonb_build_object('weekday', s.weekday, 'time_slot', s.time_slot) order by s.weekday, s.time_slot),
    '[]'::jsonb
  )
  into v_class_splits
  from public.olli_schedule_class_splits s
  where s.academy_id = p_academy_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'division', m.division,
        'session_date', m.session_date,
        'time_slot', m.time_slot,
        'note', m.note,
        'updated_at', m.updated_at
      )
      order by m.session_date, m.time_slot, m.division
    ),
    '[]'::jsonb
  )
  into v_cell_memos
  from public.olli_schedule_cell_memos m
  where m.academy_id = p_academy_id
    and m.session_date between v_week_start and v_week_end;

  return jsonb_build_object(
    'ok', true,
    'week_start', v_week_start,
    'week_end', v_week_end,
    'elementary_capacity', coalesce((select st.elementary_capacity from public.olli_schedule_settings st where st.academy_id = p_academy_id), 5),
    'kinder_capacity', 5,
    'waitlist_capacity', coalesce((select st.waitlist_capacity from public.olli_schedule_settings st where st.academy_id = p_academy_id), 1),
    'enrollments', v_enrollments,
    'waitlist', v_waitlist,
    'one_time_sessions', v_one_time,
    'changes', v_changes,
    'attendance', v_attendance,
    'pickups', v_pickups,
    'class_splits', v_class_splits,
    'cell_memos', v_cell_memos
  );
end;
$function$;
