-- 같은 학생의 같은 날짜/시간 활성 보강은 DB에서 하나만 허용한다.
create unique index if not exists olli_schedule_one_time_active_student_slot_key
on public.olli_schedule_one_time_sessions(academy_id,student_id,session_date,time_slot)
where status<>'cancelled';

-- 현재 앱에서 사용하는 class_group 포함 overload를 멱등하게 만든다.
create or replace function public.olli_schedule_add_one_time(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_session_date date,
  p_time_slot integer,
  p_note text,
  p_class_group text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_division text;
  v_class_group text := upper(coalesce(nullif(btrim(p_class_group),''),'A'));
  v_capacity integer;
  v_weekday integer;
  v_occupancy integer;
  v_id uuid;
begin
  if not private.olli_schedule_can_access(p_session_token,p_academy_id) then
    return jsonb_build_object('ok',false,'message','보강을 등록할 권한이 없습니다.');
  end if;
  if p_session_date is null or p_session_date<current_date then
    return jsonb_build_object('ok',false,'message','보강 날짜를 확인해 주세요.');
  end if;
  v_weekday := extract(isodow from p_session_date)::integer;
  if v_weekday not between 1 and 6 then
    return jsonb_build_object('ok',false,'message','일요일에는 보강을 등록할 수 없습니다.');
  end if;
  select s.division into v_division
  from public.students s
  where s.id=p_student_id and s.academy_id=p_academy_id and s.status='active';
  if v_division is null then
    return jsonb_build_object('ok',false,'message','학생을 찾을 수 없습니다.');
  end if;
  if (v_division='elementary' and v_weekday=6 and p_time_slot not in(10,11,12))
     or (v_division='elementary' and v_weekday<>6 and p_time_slot not between 1 and 6)
     or (v_division='kinder' and p_time_slot not in(4,5)) then
    return jsonb_build_object('ok',false,'message','선택한 날짜의 수업 시간을 확인해 주세요.');
  end if;
  if not private.olli_schedule_group_is_enabled(p_academy_id,v_division,v_weekday,p_time_slot) then
    v_class_group := 'A';
  elsif v_class_group not in('A','B') then
    return jsonb_build_object('ok',false,'message','수업 반을 A반 또는 B반으로 선택해 주세요.');
  end if;

  -- 서로 다른 반 정보가 섞여도 같은 학생/날짜/시간 요청은 먼저 직렬화한다.
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':makeup-student:' || p_student_id::text || ':' || p_session_date::text || ':' || p_time_slot::text,0
  ));
  select o.id into v_id
  from public.olli_schedule_one_time_sessions o
  where o.academy_id=p_academy_id and o.student_id=p_student_id
    and o.session_date=p_session_date and o.time_slot=p_time_slot and o.status<>'cancelled'
  limit 1;
  if v_id is not null then
    return jsonb_build_object('ok',true,'result','scheduled','one_time_session_id',v_id,'unchanged',true);
  end if;

  -- 정원 계산은 수업칸별로 직렬화한다.
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':' || p_session_date::text || ':' || p_time_slot::text || ':' || v_class_group,0
  ));
  v_capacity := private.olli_schedule_capacity(p_academy_id,v_division);
  select
    (select count(*) from public.olli_schedule_enrollments e
      join public.students s on s.id=e.student_id
      where e.academy_id=p_academy_id and s.division=v_division
        and e.weekday=v_weekday and e.time_slot=p_time_slot and e.class_group=v_class_group
        and e.status='active' and e.effective_from<=p_session_date
        and (e.effective_to is null or e.effective_to>=p_session_date))
    +
    (select count(*) from public.olli_schedule_one_time_sessions o
      join public.students s on s.id=o.student_id
      where o.academy_id=p_academy_id and s.division=v_division
        and o.session_date=p_session_date and o.time_slot=p_time_slot
        and o.class_group=v_class_group and o.status<>'cancelled')
  into v_occupancy;
  if v_occupancy>=v_capacity then
    return jsonb_build_object('ok',false,'message','선택한 날짜와 시간의 정원이 가득 찼습니다.','full',true);
  end if;

  begin
    insert into public.olli_schedule_one_time_sessions as ots(
      academy_id,student_id,session_date,time_slot,class_group,note
    ) values(
      p_academy_id,p_student_id,p_session_date,p_time_slot,v_class_group,left(coalesce(p_note,''),500)
    ) returning ots.id into v_id;
  exception when unique_violation then
    select o.id into v_id
    from public.olli_schedule_one_time_sessions o
    where o.academy_id=p_academy_id and o.student_id=p_student_id
      and o.session_date=p_session_date and o.time_slot=p_time_slot and o.status<>'cancelled'
    limit 1;
    if v_id is not null then
      return jsonb_build_object('ok',true,'result','scheduled','one_time_session_id',v_id,'unchanged',true);
    end if;
    raise;
  end;
  return jsonb_build_object('ok',true,'result','scheduled','one_time_session_id',v_id,'unchanged',false);
end;
$$;
