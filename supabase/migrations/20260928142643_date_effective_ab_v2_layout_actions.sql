create or replace function public.olli_schedule_split_class(
  p_session_token text,p_academy_id uuid,p_weekday integer,p_time_slot integer,p_effective_date date
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_account_id uuid;
  v_previous_from date;
  v_next_from date;
  v_next_to date;
begin
  if not private.olli_schedule_can_access(p_session_token,p_academy_id) then
    return jsonb_build_object('ok',false,'code','FORBIDDEN','message','클래스를 분리할 권한이 없습니다.');
  end if;
  if p_effective_date is null then
    return jsonb_build_object('ok',false,'code','TARGET_DATE_REQUIRED','message','분반 적용 날짜를 확인해 주세요.');
  end if;
  if p_weekday not between 1 and 6
     or (p_weekday=6 and p_time_slot not in (10,11,12))
     or (p_weekday<>6 and p_time_slot not between 1 and 6) then
    return jsonb_build_object('ok',false,'code','INVALID_SLOT','message','분리할 요일과 시간을 확인해 주세요.');
  end if;
  if extract(isodow from p_effective_date)::integer<>p_weekday then
    return jsonb_build_object('ok',false,'code','DATE_WEEKDAY_MISMATCH','message','선택한 날짜와 요일이 일치하지 않습니다.');
  end if;
  if p_effective_date<current_date then
    return jsonb_build_object('ok',false,'code','PAST_LAYOUT_CHANGE','message','지난 날짜의 반 구성을 변경할 수 없습니다.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text||':class-layout:'||p_weekday::text||':'||p_time_slot::text,0
  ));

  if private.olli_schedule_class_split_at(p_academy_id,p_weekday,p_time_slot,p_effective_date) then
    return jsonb_build_object('ok',true,'result','unchanged','weekday',p_weekday,'time_slot',p_time_slot,'effective_date',p_effective_date);
  end if;

  select s.effective_from into v_previous_from
  from public.olli_schedule_class_splits s
  where s.academy_id=p_academy_id and s.weekday=p_weekday and s.time_slot=p_time_slot
    and s.effective_to=p_effective_date-1
  order by s.effective_from desc limit 1;

  select s.effective_from,s.effective_to into v_next_from,v_next_to
  from public.olli_schedule_class_splits s
  where s.academy_id=p_academy_id and s.weekday=p_weekday and s.time_slot=p_time_slot
    and s.effective_from>p_effective_date
  order by s.effective_from limit 1;

  v_account_id:=public.olli_account_id_from_session(p_session_token);

  if v_next_from is not null then
    delete from public.olli_schedule_class_splits
    where academy_id=p_academy_id and weekday=p_weekday and time_slot=p_time_slot
      and effective_from=v_next_from;
  end if;

  if v_previous_from is not null then
    update public.olli_schedule_class_splits
    set effective_to=case when v_next_from is null then null else v_next_to end
    where academy_id=p_academy_id and weekday=p_weekday and time_slot=p_time_slot
      and effective_from=v_previous_from;
  else
    insert into public.olli_schedule_class_splits(
      academy_id,weekday,time_slot,effective_from,effective_to,created_by_account_id
    ) values(
      p_academy_id,p_weekday,p_time_slot,p_effective_date,
      case when v_next_from is null then null else v_next_to end,
      v_account_id
    );
  end if;

  return jsonb_build_object('ok',true,'result','split','weekday',p_weekday,'time_slot',p_time_slot,'effective_date',p_effective_date);
end;
$$;

create or replace function public.olli_schedule_merge_class(
  p_session_token text,p_academy_id uuid,p_weekday integer,p_time_slot integer,p_effective_date date
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_active_from date;
  v_next_split date;
  v_regular integer:=0;
  v_one_time integer:=0;
  v_waitlist integer:=0;
  v_scheduled_change integer:=0;
begin
  if not private.olli_schedule_can_access(p_session_token,p_academy_id) then
    return jsonb_build_object('ok',false,'code','FORBIDDEN','message','클래스를 통합할 권한이 없습니다.');
  end if;
  if p_effective_date is null then
    return jsonb_build_object('ok',false,'code','TARGET_DATE_REQUIRED','message','합반 적용 날짜를 확인해 주세요.');
  end if;
  if p_weekday not between 1 and 6
     or (p_weekday=6 and p_time_slot not in (10,11,12))
     or (p_weekday<>6 and p_time_slot not between 1 and 6) then
    return jsonb_build_object('ok',false,'code','INVALID_SLOT','message','통합할 요일과 시간을 확인해 주세요.');
  end if;
  if extract(isodow from p_effective_date)::integer<>p_weekday then
    return jsonb_build_object('ok',false,'code','DATE_WEEKDAY_MISMATCH','message','선택한 날짜와 요일이 일치하지 않습니다.');
  end if;
  if p_effective_date<current_date then
    return jsonb_build_object('ok',false,'code','PAST_LAYOUT_CHANGE','message','지난 날짜의 반 구성을 변경할 수 없습니다.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text||':class-layout:'||p_weekday::text||':'||p_time_slot::text,0
  ));

  select s.effective_from into v_active_from
  from public.olli_schedule_class_splits s
  where s.academy_id=p_academy_id and s.weekday=p_weekday and s.time_slot=p_time_slot
    and s.effective_from<=p_effective_date
    and (s.effective_to is null or s.effective_to>=p_effective_date)
  order by s.effective_from desc limit 1;

  if v_active_from is null then
    return jsonb_build_object('ok',true,'result','unchanged','weekday',p_weekday,'time_slot',p_time_slot,'effective_date',p_effective_date);
  end if;

  select min(s.effective_from) into v_next_split
  from public.olli_schedule_class_splits s
  where s.academy_id=p_academy_id and s.weekday=p_weekday and s.time_slot=p_time_slot
    and s.effective_from>p_effective_date;

  select count(*) into v_regular
  from public.olli_schedule_enrollments e
  cross join lateral (
    select private.olli_schedule_first_occurrence_on_or_after(
      greatest(e.effective_from,p_effective_date),p_weekday
    ) as first_session_date
  ) x
  where e.academy_id=p_academy_id and e.weekday=p_weekday and e.time_slot=p_time_slot
    and e.class_group='B' and e.status='active'
    and x.first_session_date is not null
    and (e.effective_to is null or x.first_session_date<=e.effective_to)
    and (v_next_split is null or x.first_session_date<v_next_split);

  select count(*) into v_one_time
  from public.olli_schedule_one_time_sessions o
  where o.academy_id=p_academy_id
    and extract(isodow from o.session_date)::integer=p_weekday
    and o.time_slot=p_time_slot and o.class_group='B' and o.status<>'cancelled'
    and o.session_date>=p_effective_date
    and (v_next_split is null or o.session_date<v_next_split);

  select count(*) into v_waitlist
  from public.olli_schedule_waitlist w
  where w.academy_id=p_academy_id
    and w.target_weekday=p_weekday and w.target_time_slot=p_time_slot
    and w.target_class_group='B' and w.status in ('waiting','offered')
    and (
      w.desired_effective_date is null
      or (
        private.olli_schedule_first_occurrence_on_or_after(w.desired_effective_date,p_weekday)>=p_effective_date
        and (v_next_split is null or private.olli_schedule_first_occurrence_on_or_after(w.desired_effective_date,p_weekday)<v_next_split)
      )
    );

  select count(*) into v_scheduled_change
  from public.olli_schedule_changes c
  join public.olli_schedule_enrollments e on e.id=c.target_enrollment_id
  where c.academy_id=p_academy_id and c.status='scheduled'
    and c.change_type in ('add','move') and c.target_class_group='B'
    and e.weekday=p_weekday and e.time_slot=p_time_slot
    and private.olli_schedule_first_occurrence_on_or_after(c.effective_date,p_weekday)>=p_effective_date
    and (v_next_split is null or private.olli_schedule_first_occurrence_on_or_after(c.effective_date,p_weekday)<v_next_split);

  if v_regular+v_one_time+v_waitlist+v_scheduled_change>0 then
    return jsonb_build_object(
      'ok',false,'code','MERGE_BLOCKED_B_USAGE',
      'message','합반 적용 구간의 B반 일정이 있어 통합할 수 없습니다. 앞으로의 B반 일정을 먼저 정리해 주세요.',
      'conflicts',jsonb_build_object(
        'regular',v_regular,'one_time',v_one_time,
        'waitlist',v_waitlist,'scheduled_change',v_scheduled_change
      )
    );
  end if;

  if v_active_from=p_effective_date then
    delete from public.olli_schedule_class_splits
    where academy_id=p_academy_id and weekday=p_weekday and time_slot=p_time_slot
      and effective_from=v_active_from;
  else
    update public.olli_schedule_class_splits
    set effective_to=p_effective_date-1
    where academy_id=p_academy_id and weekday=p_weekday and time_slot=p_time_slot
      and effective_from=v_active_from;
  end if;

  return jsonb_build_object('ok',true,'result','merged','weekday',p_weekday,'time_slot',p_time_slot,'effective_date',p_effective_date);
end;
$$;

create or replace function public.olli_schedule_split_class(
  p_session_token text,p_academy_id uuid,p_weekday integer,p_time_slot integer
)
returns jsonb language sql security definer set search_path=''
as $$
  select public.olli_schedule_split_class(
    p_session_token,p_academy_id,p_weekday,p_time_slot,
    private.olli_schedule_first_occurrence_on_or_after(current_date,p_weekday)
  );
$$;

create or replace function public.olli_schedule_merge_class(
  p_session_token text,p_academy_id uuid,p_weekday integer,p_time_slot integer
)
returns jsonb language sql security definer set search_path=''
as $$
  select public.olli_schedule_merge_class(
    p_session_token,p_academy_id,p_weekday,p_time_slot,
    private.olli_schedule_first_occurrence_on_or_after(current_date,p_weekday)
  );
$$;

revoke all on function public.olli_schedule_split_class(text,uuid,integer,integer,date) from public,anon,authenticated;
revoke all on function public.olli_schedule_merge_class(text,uuid,integer,integer,date) from public,anon,authenticated;
revoke all on function public.olli_schedule_split_class(text,uuid,integer,integer) from public,anon,authenticated;
revoke all on function public.olli_schedule_merge_class(text,uuid,integer,integer) from public,anon,authenticated;


