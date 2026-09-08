-- 인증/시간표 검증과 실제 멱등 상태 전환을 분리해 서버 로직을 테스트 가능하게 유지한다.
create or replace function private.olli_schedule_apply_attendance_state(
  p_academy_id uuid,
  p_student_id uuid,
  p_session_date date,
  p_time_slot integer,
  p_class_group text,
  p_session_kind text,
  p_attended boolean,
  p_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mark_id uuid;
  v_marked_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':attendance:' || p_student_id::text || ':' || p_session_date::text || ':' || p_time_slot::text || ':' || p_class_group || ':' || p_session_kind,
    0
  ));

  select a.id, a.marked_at into v_mark_id, v_marked_at
  from public.olli_schedule_attendance a
  where a.academy_id=p_academy_id
    and a.student_id=p_student_id
    and a.session_date=p_session_date
    and a.time_slot=p_time_slot
    and a.class_group=p_class_group
    and a.session_kind=p_session_kind
  for update;

  if p_attended then
    if v_mark_id is not null then
      return jsonb_build_object('ok',true,'attended',true,'unchanged',true,'marked_at',v_marked_at);
    end if;
    insert into public.olli_schedule_attendance(
      academy_id,student_id,session_date,time_slot,class_group,session_kind,marked_by_account_id
    ) values (
      p_academy_id,p_student_id,p_session_date,p_time_slot,p_class_group,p_session_kind,p_account_id
    ) returning marked_at into v_marked_at;
    return jsonb_build_object('ok',true,'attended',true,'unchanged',false,'marked_at',v_marked_at);
  end if;

  if v_mark_id is null then
    return jsonb_build_object('ok',true,'attended',false,'unchanged',true);
  end if;
  delete from public.olli_schedule_attendance where id=v_mark_id;
  return jsonb_build_object('ok',true,'attended',false,'unchanged',false);
end;
$$;
revoke all on function private.olli_schedule_apply_attendance_state(uuid,uuid,date,integer,text,text,boolean,uuid)
from public, anon, authenticated, service_role;

create or replace function public.olli_schedule_set_attendance(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_session_date date,
  p_time_slot integer,
  p_class_group text default 'A',
  p_session_kind text default 'regular',
  p_attended boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_division text;
  v_weekday integer;
  v_class_group text := upper(coalesce(nullif(btrim(p_class_group), ''), 'A'));
begin
  if not private.olli_schedule_can_access(p_session_token,p_academy_id) then
    return jsonb_build_object('ok',false,'message','출석을 변경할 권한이 없습니다.');
  end if;
  if p_attended is null or p_session_date is null or p_session_date>current_date or p_session_kind not in('regular','makeup') then
    return jsonb_build_object('ok',false,'message','출석 날짜와 수업 정보를 확인해 주세요.');
  end if;
  v_account_id := public.olli_account_id_from_session(p_session_token);
  v_weekday := extract(isodow from p_session_date)::integer;
  select s.division into v_division
  from public.students s
  where s.id=p_student_id and s.academy_id=p_academy_id and s.status='active';
  if v_division is null then
    return jsonb_build_object('ok',false,'message','학생을 찾을 수 없습니다.');
  end if;
  if (v_division='elementary' and v_weekday=6 and p_time_slot not in(10,11,12))
     or (v_division='elementary' and v_weekday<>6 and p_time_slot not between 1 and 6)
     or (v_division='kinder' and p_time_slot not in(4,5)) then
    return jsonb_build_object('ok',false,'message','출석 날짜와 수업 시간을 확인해 주세요.');
  end if;
  if not private.olli_schedule_group_is_enabled(p_academy_id,v_division,v_weekday,p_time_slot) then
    v_class_group := 'A';
  end if;
  if v_class_group not in('A','B') then
    return jsonb_build_object('ok',false,'message','수업 반을 확인해 주세요.');
  end if;
  if p_session_kind='regular' and not exists(
    select 1 from public.olli_schedule_enrollments e
    where e.academy_id=p_academy_id and e.student_id=p_student_id
      and e.weekday=v_weekday and e.time_slot=p_time_slot and e.class_group=v_class_group
      and e.status='active' and e.effective_from<=p_session_date
      and (e.effective_to is null or e.effective_to>=p_session_date)
  ) then
    return jsonb_build_object('ok',false,'message','해당 날짜의 정규 수업을 찾을 수 없습니다.');
  end if;
  if p_session_kind='makeup' and not exists(
    select 1 from public.olli_schedule_one_time_sessions o
    where o.academy_id=p_academy_id and o.student_id=p_student_id
      and o.session_date=p_session_date and o.time_slot=p_time_slot
      and o.class_group=v_class_group and o.status<>'cancelled'
  ) then
    return jsonb_build_object('ok',false,'message','해당 날짜의 보강 수업을 찾을 수 없습니다.');
  end if;
  return private.olli_schedule_apply_attendance_state(
    p_academy_id,p_student_id,p_session_date,p_time_slot,v_class_group,p_session_kind,p_attended,v_account_id
  );
end;
$$;
revoke all on function public.olli_schedule_set_attendance(text,uuid,uuid,date,integer,text,text,boolean)
from public, anon, authenticated;
grant execute on function public.olli_schedule_set_attendance(text,uuid,uuid,date,integer,text,text,boolean) to service_role;
