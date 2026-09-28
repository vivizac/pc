-- 학생정보 화면은 기본정보(students)와 함께 이 RPC를 사용해
-- 현재 수업 회차, 각 회차 담임, 유치부 픽업을 하나의 서버 원본으로 읽습니다.
create or replace function public.olli_schedule_student_enrollments(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_reference_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date := coalesce(p_reference_date, current_date);
  v_division text;
  v_rows jsonb;
  v_pickups jsonb;
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
    'enrollments', v_rows,
    'pickups', v_pickups
  );
end;
$$;

revoke all on function public.olli_schedule_student_enrollments(text, uuid, uuid, date) from public;
grant execute on function public.olli_schedule_student_enrollments(text, uuid, uuid, date) to anon, authenticated;
