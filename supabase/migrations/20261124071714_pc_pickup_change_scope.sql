-- PC pickup popup: atomic full-field immediate edit or future-week reservation.
-- Existing pickup APIs remain available to other clients. Preserve elapsed history.
create or replace function public.olli_schedule_change_pickup_v2(
  p_session_token text, p_academy_id uuid, p_pickup_id uuid,
  p_expected_from date, p_expected_to date, p_target_date date,
  p_arrival_label text, p_pickup_time time, p_dropoff_label text, p_dropoff_time time,
  p_mode text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_old public.olli_schedule_pickups%rowtype;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_week date;
  v_target_weekday integer;
  v_from date;
  v_until date;
  v_first date;
  v_cutoff date;
  v_id uuid;
  v_actor uuid;
  v_arrival text := btrim(coalesce(p_arrival_label,''));
  v_dropoff text := btrim(coalesce(p_dropoff_label,''));
  v_has_arrival boolean;
  v_has_dropoff boolean;
  v_in_place boolean;
  v_check_date date;
begin
  if not private.olli_schedule_can_access(p_session_token,p_academy_id) then
    return jsonb_build_object('ok',false,'message','픽업을 변경할 권한이 없습니다.');
  end if;
  if p_mode is null or p_mode not in ('immediate','schedule')
     or p_target_date is null or p_target_date < v_today
     or extract(isodow from p_target_date) not between 1 and 6 then
    return jsonb_build_object('ok',false,'message','오늘 이후 월요일부터 토요일까지의 적용일을 선택해 주세요.');
  end if;
  v_target_weekday := extract(isodow from p_target_date)::integer;
  v_week := date_trunc('week',p_target_date)::date;
  v_has_arrival := v_arrival<>'' or p_pickup_time is not null;
  v_has_dropoff := v_dropoff<>'' or p_dropoff_time is not null;
  if (v_has_arrival and (v_arrival='' or p_pickup_time is null))
     or (p_dropoff_time is not null and v_dropoff='')
     or (not v_has_arrival and not v_has_dropoff)
     or char_length(v_arrival)>80 or char_length(v_dropoff)>80 then
    return jsonb_build_object('ok',false,'message','등원 장소·시간 또는 하원 장소를 올바르게 입력해 주세요.');
  end if;

  select * into v_old from public.olli_schedule_pickups p
    where p.id=p_pickup_id and p.academy_id=p_academy_id and p.status='active'
    for update;
  if not found then
    return jsonb_build_object('ok',false,'message','픽업 일정을 찾을 수 없습니다. 새로고침해 주세요.');
  end if;
  if v_old.effective_from is distinct from p_expected_from or v_old.effective_to is distinct from p_expected_to then
    return jsonb_build_object('ok',false,'message','픽업 적용 기간이 변경되었습니다. 새로고침해 주세요.');
  end if;
  if v_old.effective_to is not null and v_old.effective_to < v_today then
    return jsonb_build_object('ok',false,'message','종료된 픽업은 변경할 수 없습니다.');
  end if;
  if not exists (select 1 from public.students s
    where s.id=v_old.student_id and s.academy_id=p_academy_id
      and s.status='active' and s.division='kinder' and not coalesce(s.is_deleted,false)) then
    return jsonb_build_object('ok',false,'message','유치부 재원생을 찾을 수 없습니다.');
  end if;
  if not private.olli_schedule_slot_is_valid(p_academy_id,'kinder',v_target_weekday,v_old.class_time) then
    return jsonb_build_object('ok',false,'message','변경할 수업 요일을 확인해 주세요.');
  end if;

  v_until := v_old.effective_to;
  if v_old.pickup_scope='daily' then
    if p_mode='schedule' then
      return jsonb_build_object('ok',false,'message','당일 픽업은 즉시변경으로 날짜를 수정해 주세요.');
    end if;
    v_from := p_target_date;
    v_until := p_target_date;
    v_cutoff := v_from;
    v_in_place := true;
  elsif p_mode='schedule' then
    if v_week <= date_trunc('week',v_today)::date then
      return jsonb_build_object('ok',false,'message','이번 주 변경은 즉시변경을 이용해 주세요.');
    end if;
    if v_week < date_trunc('week',v_old.effective_from)::date then
      return jsonb_build_object('ok',false,'message','시작일보다 앞선 변경은 즉시변경을 이용해 주세요.');
    end if;
    -- End the old recurrence on Sunday, not on the new pickup day.
    v_cutoff := v_week;
    v_from := p_target_date;
    v_in_place := v_old.effective_from >= v_cutoff;
  elsif v_old.effective_from > v_today then
    -- A not-yet-started card is edited, not split or turned into a reservation.
    v_from := p_target_date;
    v_cutoff := v_from;
    v_in_place := true;
  else
    -- For an existing recurring card the selected day determines the weekday;
    -- immediate always takes effect now, without rewriting elapsed days.
    v_cutoff := v_today;
    v_from := v_today;
    v_in_place := v_old.effective_from >= v_today;
  end if;
  v_first := v_from + ((v_target_weekday-extract(isodow from v_from)::integer+7)%7);
  if v_until is not null and v_first > v_until then
    return jsonb_build_object('ok',false,'message','픽업 종료일 이후로는 변경할 수 없습니다.');
  end if;

  -- Reuse the pickup slot lock convention; inspect the first real occurrence
  -- and all future pickup start boundaries, not an unrelated calendar date.
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':pickup:' || v_target_weekday::text || ':' ||
    v_old.class_time::text || ':' || v_first::text,0));
  if exists (
    select 1 from public.olli_schedule_pickups p
    where p.academy_id=p_academy_id and p.id<>v_old.id
      and p.student_id=v_old.student_id and p.status='active'
      and p.pickup_scope=v_old.pickup_scope and p.weekday=v_target_weekday
      and p.class_time=v_old.class_time
      and (v_until is null or p.effective_from<=v_until)
      and (p.effective_to is null or p.effective_to>=v_first)
  ) then
    return jsonb_build_object('ok',false,'message','해당 시간에 이미 같은 학생의 픽업이 등록되어 있습니다.');
  end if;
  for v_check_date in
    select distinct d from (
      select v_first as d
      union all
      select greatest(v_first,p.effective_from) +
        ((v_target_weekday-extract(isodow from greatest(v_first,p.effective_from))::integer+7)%7)
      from public.olli_schedule_pickups p
      where p.academy_id=p_academy_id and p.status='active' and p.weekday=v_target_weekday
        and p.class_time=v_old.class_time and p.student_id<>v_old.student_id
        and (p.effective_to is null or p.effective_to>=v_first)
        and (v_until is null or p.effective_from<=v_until)
    ) dates where v_until is null or d<=v_until
  loop
    if (select count(distinct p.student_id) from public.olli_schedule_pickups p
      where p.academy_id=p_academy_id and p.status='active' and p.weekday=v_target_weekday
        and p.class_time=v_old.class_time and p.student_id<>v_old.student_id
        and p.effective_from<=v_check_date and (p.effective_to is null or p.effective_to>=v_check_date))>=6 then
      return jsonb_build_object('ok',false,'message','해당 주의 픽업 정원은 최대 6명입니다.','full',true);
    end if;
  end loop;

  v_actor := public.olli_account_id_from_session(p_session_token);
  perform set_config('olli.actor_account_id',coalesce(v_actor::text,''),true);
  perform set_config('olli.schedule_action',case when p_mode='schedule' then 'pickup_schedule' else 'pickup_edit' end,true);

  if v_in_place then
    update public.olli_schedule_pickups set
      weekday=v_target_weekday,
      effective_from=v_from,effective_to=v_until,
      pickup_label=case when v_has_arrival then v_arrival else v_dropoff end,
      pickup_time=case when v_has_arrival then p_pickup_time else null end,
      is_dropoff=not v_has_arrival,
      dropoff_label=nullif(v_dropoff,''),dropoff_time=p_dropoff_time,updated_at=now()
    where id=v_old.id;
    v_id := v_old.id;
  else
    update public.olli_schedule_pickups set effective_to=v_cutoff-1,updated_at=now()
    where id=v_old.id;
    insert into public.olli_schedule_pickups (
      academy_id,student_id,weekday,class_time,pickup_label,pickup_time,is_dropoff,
      dropoff_label,dropoff_time,pickup_scope,effective_from,effective_to,status,
      created_by_account_id,created_at
    ) values (
      p_academy_id,v_old.student_id,v_target_weekday,v_old.class_time,
      case when v_has_arrival then v_arrival else v_dropoff end,
      case when v_has_arrival then p_pickup_time else null end,not v_has_arrival,
      nullif(v_dropoff,''),p_dropoff_time,v_old.pickup_scope,v_from,v_until,'active',
      v_actor,v_old.created_at
    ) returning id into v_id;
  end if;
  return jsonb_build_object('ok',true,'result',case when p_mode='schedule' then 'scheduled' else 'updated' end,
    'pickup_id',v_id,'previous_pickup_id',v_old.id,'effective_date',v_from,
    'first_pickup_date',v_first,'week_start',date_trunc('week',v_from)::date);
end;
$function$;
revoke all on function public.olli_schedule_change_pickup_v2(text,uuid,uuid,date,date,date,text,time,text,time,text) from public;
grant execute on function public.olli_schedule_change_pickup_v2(text,uuid,uuid,date,date,date,text,time,text,time,text) to anon, authenticated, service_role;
