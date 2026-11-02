-- Owner-created consultations can use any calendar week/day; public booking
-- retains its existing published week and weekday restrictions.
begin;

create function public.olli_booking_staff_manual_slots(
  p_session_token text, p_academy_id uuid, p_date date
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  s public.olli_booking_settings%rowtype;
  v_slots jsonb := '[]'::jsonb;
begin
  perform olli_consultation_private.require_owner(p_session_token,p_academy_id);
  if p_date is null
     or p_date < (now() at time zone 'Asia/Seoul')::date
     or p_date > (now() at time zone 'Asia/Seoul')::date+120 then
    return jsonb_build_object('ok',true,'slots',v_slots);
  end if;
  insert into public.olli_booking_settings(academy_id) values(p_academy_id)
    on conflict(academy_id) do nothing;
  select * into strict s from public.olli_booking_settings
    where academy_id=p_academy_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'start_at',g.local_start at time zone s.timezone,
    'end_at',(g.local_start+make_interval(mins=>s.slot_minutes)) at time zone s.timezone,
    'local_start',to_char(g.local_start,'YYYY-MM-DD"T"HH24:MI')
  ) order by g.local_start),'[]'::jsonb)
    into v_slots
  from generate_series(
    p_date+s.start_time,
    p_date+s.end_time-make_interval(mins=>s.slot_minutes),
    make_interval(mins=>s.slot_minutes)) g(local_start)
  where (g.local_start at time zone s.timezone)>now()
    and not exists (
      select 1 from public.olli_booking_blocks b
      where b.academy_id=p_academy_id and b.block_date=p_date
        and (b.start_time is null
          or (g.local_start::time<b.end_time
            and (g.local_start+make_interval(mins=>s.slot_minutes))::time>b.start_time))
    )
    and not exists (
      select 1 from public.olli_booking_reservations r
      where r.academy_id=p_academy_id and r.status='confirmed'
        and tstzrange(r.start_at,r.end_at,'[)') &&
          tstzrange(g.local_start at time zone s.timezone,
            (g.local_start+make_interval(mins=>s.slot_minutes)) at time zone s.timezone,'[)')
    );
  return jsonb_build_object('ok',true,'slots',v_slots);
end;
$function$;

revoke all on function public.olli_booking_staff_manual_slots(text,uuid,date)
  from public,anon,authenticated;
grant execute on function public.olli_booking_staff_manual_slots(text,uuid,date)
  to anon,authenticated,service_role;

create or replace function public.olli_booking_staff_manual_manage(
  p_session_token text, p_academy_id uuid, p_action text,
  p_student_id uuid default null, p_start_at timestamptz default null,
  p_request_key uuid default null
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_students jsonb;
  v_id uuid;
  v_existing public.olli_booking_reservations%rowtype;
  v_settings public.olli_booking_settings%rowtype;
  v_day date;
  v_slots jsonb;
  v_end timestamptz;
begin
  perform olli_consultation_private.require_owner(p_session_token,p_academy_id);
  if p_action='students' then
    if p_student_id is not null or p_start_at is not null or p_request_key is not null then
      raise exception 'INVALID_STUDENT_LIST_REQUEST' using errcode='22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',st.id,'name',st.name,'school',coalesce(st.school,''),
      'grade',coalesce(st.grade,'')) order by st.name,st.id),'[]'::jsonb)
      into v_students from public.students st
    where st.academy_id=p_academy_id and st.status='active' and st.is_deleted=false;
    return jsonb_build_object('ok',true,'students',v_students);
  end if;
  if p_action<>'create' then
    raise exception 'INVALID_ACTION' using errcode='22023';
  end if;
  if p_student_id is null or p_start_at is null or p_request_key is null then
    raise exception 'MANUAL_BOOKING_FIELDS_REQUIRED' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.academies a
    where a.id=p_academy_id and a.status='active'
      and a.deleted_at is null and a.access_status='active'
  ) then raise exception 'ACADEMY_UNAVAILABLE' using errcode='42501'; end if;
  if not exists (
    select 1 from public.students st where st.id=p_student_id
      and st.academy_id=p_academy_id and st.status='active'
      and st.is_deleted=false
  ) then raise exception 'STUDENT_UNAVAILABLE' using errcode='42501'; end if;

  -- Identical owner retry remains idempotent; preserve DB uniqueness/overlap.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_academy_id::text||':'||p_request_key::text,0));
  select * into v_existing from public.olli_booking_reservations r
    where r.academy_id=p_academy_id and r.request_key=p_request_key;
  if found then
    if v_existing.student_id is distinct from p_student_id
      or v_existing.intake_id is not null
      or v_existing.start_at is distinct from p_start_at then
      raise exception 'REQUEST_KEY_REUSED' using errcode='22023';
    end if;
    return jsonb_build_object('ok',true,'reservation_id',v_existing.id);
  end if;

  insert into public.olli_booking_settings(academy_id) values(p_academy_id)
    on conflict(academy_id) do nothing;
  select * into strict v_settings from public.olli_booking_settings s
    where s.academy_id=p_academy_id;
  v_day:=(p_start_at at time zone v_settings.timezone)::date;
  v_slots:=public.olli_booking_staff_manual_slots(
    p_session_token,p_academy_id,v_day);
  if not exists (
    select 1 from jsonb_array_elements(v_slots->'slots') slot
    where (slot->>'start_at')::timestamptz=p_start_at
  ) then
    raise exception 'SLOT_NOT_AVAILABLE' using errcode='22023';
  end if;

  v_end:=((p_start_at at time zone v_settings.timezone)
    +make_interval(mins=>v_settings.slot_minutes))
    at time zone v_settings.timezone;
  insert into public.olli_booking_reservations
    (academy_id,student_id,start_at,end_at,request_key)
  values(p_academy_id,p_student_id,p_start_at,v_end,p_request_key)
  returning id into v_id;
  insert into public.olli_booking_events
    (reservation_id,academy_id,action,actor)
  values(v_id,p_academy_id,'created','staff');
  return jsonb_build_object('ok',true,'reservation_id',v_id);
end;
$function$;

revoke all on function public.olli_booking_staff_manual_manage(
  text,uuid,text,uuid,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.olli_booking_staff_manual_manage(
  text,uuid,text,uuid,timestamptz,uuid) to anon,authenticated,service_role;
commit;
