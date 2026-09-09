-- 학생정보/폰 시간표에서 수업 조회와 담임 조회가 서로 분리되어
-- 담임 조회 실패가 정상 수업까지 '없음'으로 보이게 하던 문제를 제거합니다.
-- 학생 수업 조회 RPC 자체가 각 회차의 반 담임을 함께 반환합니다.

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

  return jsonb_build_object(
    'ok', true,
    'division', v_division,
    'reference_date', v_date,
    'enrollments', v_rows
  );
end;
$$;

revoke all on function public.olli_schedule_student_enrollments(text, uuid, uuid, date) from public;
grant execute on function public.olli_schedule_student_enrollments(text, uuid, uuid, date) to anon, authenticated;
