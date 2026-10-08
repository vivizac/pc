-- A start-date postponement keeps the original enrollment and never recreates the class.
create or replace function public.olli_schedule_postpone_first_class(
  p_session_token text,
  p_academy_id uuid,
  p_enrollment_id uuid,
  p_new_start_date date
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_source public.olli_schedule_enrollments%rowtype;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok',false,'message','시간표를 변경할 권한이 없습니다.');
  end if;
  select * into v_source from public.olli_schedule_enrollments
   where id=p_enrollment_id and academy_id=p_academy_id and status='active'
   for update;
  if not found then
    return jsonb_build_object('ok',false,'message','기존 정규수업을 찾지 못했습니다.');
  end if;
  if not exists (select 1 from public.students s where s.id=v_source.student_id
    and s.academy_id=p_academy_id and s.status='active' and coalesce(s.is_deleted,false)=false) then
    return jsonb_build_object('ok',false,'message','활성 학생을 찾지 못했습니다.');
  end if;
  if p_new_start_date is null or p_new_start_date <= v_source.effective_from
    or p_new_start_date < current_date
    or extract(isodow from p_new_start_date)::integer <> v_source.weekday
    or (v_source.effective_to is not null and p_new_start_date > v_source.effective_to) then
    return jsonb_build_object('ok',false,'message','기존 시작일보다 늦은 같은 요일의 미래 날짜를 선택해 주세요.');
  end if;
  if exists(select 1 from public.olli_schedule_attendance a
       where a.academy_id=p_academy_id and a.student_id=v_source.student_id
       and a.session_kind='regular' and a.time_slot=v_source.time_slot
       and a.class_group=v_source.class_group
       and a.session_date >= v_source.effective_from and a.session_date < p_new_start_date)
    or exists(select 1 from public.olli_schedule_attendance_register_overrides a
       where a.academy_id=p_academy_id and a.student_id=v_source.student_id
       and a.session_kind='regular'
       and a.session_date >= v_source.effective_from and a.session_date < p_new_start_date)
    or exists(select 1 from public.olli_schedule_changes c
       where c.academy_id=p_academy_id and (c.source_enrollment_id=v_source.id or c.target_enrollment_id=v_source.id)
       and c.status='scheduled')
    or exists(select 1 from public.olli_schedule_waitlist w
       where w.academy_id=p_academy_id and w.source_enrollment_id=v_source.id
       and w.status in ('waiting','offered')) then
    return jsonb_build_object('ok',false,'message','출석 기록 또는 예약 변경이 있어 시작일을 변경할 수 없습니다.');
  end if;
  update public.olli_schedule_enrollments
     set effective_from=p_new_start_date,updated_at=now()
   where id=v_source.id;
  return jsonb_build_object('ok',true,'result','start_date_updated',
    'enrollment_id',v_source.id,'effective_from',p_new_start_date);
end;
$$;
revoke all on function public.olli_schedule_postpone_first_class(text,uuid,uuid,date) from public;
grant execute on function public.olli_schedule_postpone_first_class(text,uuid,uuid,date) to authenticated, anon, service_role;
