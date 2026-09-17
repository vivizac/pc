-- 클래스 담임과 피드백 담임의 의미를 서버 계약에서 명확히 구분합니다.
--
-- Source of Truth
--   * 클래스 담임: public.olli_schedule_class_teachers
--   * 피드백 담임: 학생의 1회차(session_order = 1) 정규수업의 클래스 담임에서 계산
--
-- 기존 teacher_member_id / teacher_name 응답 필드는 구버전 호환을 위해 유지합니다.
-- 별도의 피드백 담임 저장 테이블/컬럼은 만들지 않습니다.

create or replace function public.olli_schedule_class_teacher_context(
  p_session_token text,
  p_academy_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_teachers jsonb;
  v_assignments jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '클래스 담임 정보를 확인할 권한이 없습니다.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'display_name', trim(m.display_name),
    'role', m.role
  ) order by trim(m.display_name), m.id), '[]'::jsonb)
    into v_teachers
  from public.academy_members m
  where m.academy_id = p_academy_id
    and m.status = 'active'
    and nullif(trim(coalesce(m.display_name, '')), '') is not null
    and m.role in ('owner','manager','teacher');

  select coalesce(jsonb_agg(jsonb_build_object(
    'division', ct.division,
    'weekday', ct.weekday,
    'time_slot', ct.time_slot,
    'class_group', ct.class_group,
    'class_teacher_member_id', ct.teacher_member_id,
    'class_teacher_name', ct.teacher_name,
    -- legacy aliases
    'teacher_member_id', ct.teacher_member_id,
    'teacher_name', ct.teacher_name
  ) order by ct.division, ct.weekday, ct.time_slot, ct.class_group), '[]'::jsonb)
    into v_assignments
  from public.olli_schedule_class_teachers ct
  where ct.academy_id = p_academy_id;

  return jsonb_build_object('ok', true, 'teachers', v_teachers, 'assignments', v_assignments);
end;
$function$;

create or replace function public.olli_schedule_student_enrollments(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_reference_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_date date := coalesce(p_reference_date, current_date);
  v_division text;
  v_rows jsonb;
  v_pickups jsonb;
  v_feedback_teacher_member_id uuid;
  v_feedback_teacher_name text := '';
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '학생 시간표를 확인할 권한이 없습니다.');
  end if;

  select s.division
    into v_division
  from public.students s
  where s.id = p_student_id
    and s.academy_id = p_academy_id
    and coalesce(s.is_deleted, false) = false;

  if v_division is null then
    return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'weekday', e.weekday,
        'time_slot', e.time_slot,
        'class_group', coalesce(e.class_group, 'A'),
        'session_order', e.session_order,
        'effective_from', e.effective_from,
        'effective_to', e.effective_to,
        'class_teacher_member_id', ct.teacher_member_id,
        'class_teacher_name', coalesce(ct.teacher_name, ''),
        -- legacy aliases
        'teacher_member_id', ct.teacher_member_id,
        'teacher_name', coalesce(ct.teacher_name, '')
      )
      order by coalesce(e.session_order, 99), e.weekday, e.time_slot, e.class_group
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.olli_schedule_enrollments e
  left join public.olli_schedule_class_teachers ct
    on ct.academy_id = e.academy_id
   and ct.division = v_division
   and ct.weekday = e.weekday
   and ct.time_slot = e.time_slot
   and ct.class_group = coalesce(nullif(upper(trim(e.class_group)), ''), 'A')
  where e.academy_id = p_academy_id
    and e.student_id = p_student_id
    and e.status = 'active'
    and e.effective_from <= v_date
    and (e.effective_to is null or e.effective_to >= v_date);

  -- 피드백 담임은 별도로 저장하지 않습니다.
  -- 1회차 수업을 최우선으로 하고, 예전 데이터처럼 session_order가 없으면
  -- 기존 동작과 동일하게 첫 정규수업을 보조 기준으로 사용합니다.
  select ct.teacher_member_id, coalesce(ct.teacher_name, '')
    into v_feedback_teacher_member_id, v_feedback_teacher_name
  from public.olli_schedule_enrollments e
  left join public.olli_schedule_class_teachers ct
    on ct.academy_id = e.academy_id
   and ct.division = v_division
   and ct.weekday = e.weekday
   and ct.time_slot = e.time_slot
   and ct.class_group = coalesce(nullif(upper(trim(e.class_group)), ''), 'A')
  where e.academy_id = p_academy_id
    and e.student_id = p_student_id
    and e.status = 'active'
    and e.effective_from <= v_date
    and (e.effective_to is null or e.effective_to >= v_date)
  order by
    case when e.session_order = 1 then 0 when e.session_order is null then 1 else 2 end,
    coalesce(e.session_order, 99),
    e.weekday,
    e.time_slot,
    coalesce(e.class_group, 'A')
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'weekday', p.weekday,
        'class_time', p.class_time,
        'pickup_label', p.pickup_label,
        'pickup_time', to_char(p.pickup_time, 'HH24:MI'),
        'effective_from', p.effective_from,
        'effective_to', p.effective_to
      )
      order by p.weekday, p.class_time, p.pickup_time, p.id
    ),
    '[]'::jsonb
  )
  into v_pickups
  from public.olli_schedule_pickups p
  where p.academy_id = p_academy_id
    and p.student_id = p_student_id
    and p.status = 'active'
    and p.effective_from <= v_date
    and (p.effective_to is null or p.effective_to >= v_date);

  return jsonb_build_object(
    'ok', true,
    'division', v_division,
    'reference_date', v_date,
    'feedback_teacher_member_id', v_feedback_teacher_member_id,
    'feedback_teacher_name', coalesce(v_feedback_teacher_name, ''),
    'enrollments', v_rows,
    'pickups', v_pickups
  );
end;
$function$;

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
           ct.teacher_member_id as class_teacher_member_id,
           coalesce(ct.teacher_name, '') as class_teacher_name,
           -- legacy aliases
           ct.teacher_member_id,
           coalesce(ct.teacher_name, '') as teacher_name
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
           ct.teacher_member_id as class_teacher_member_id,
           coalesce(ct.teacher_name, '') as class_teacher_name,
           -- legacy aliases
           ct.teacher_member_id,
           coalesce(ct.teacher_name, '') as teacher_name
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

revoke all on function public.olli_schedule_class_teacher_context(text, uuid) from public;
revoke all on function public.olli_schedule_student_enrollments(text, uuid, uuid, date) from public;
revoke all on function public.olli_schedule_week(text, uuid, date) from public;
grant execute on function public.olli_schedule_class_teacher_context(text, uuid) to anon, authenticated;
grant execute on function public.olli_schedule_student_enrollments(text, uuid, uuid, date) to anon, authenticated;
grant execute on function public.olli_schedule_week(text, uuid, date) to anon, authenticated;
