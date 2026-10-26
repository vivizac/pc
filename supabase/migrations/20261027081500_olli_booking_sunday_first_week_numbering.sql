-- Booking week numbers follow the Sunday-to-Saturday rows displayed in the parent calendar.
-- Change only nth-week arithmetic. ISO weekdays (Mon=1 .. Sun=7), validation,
-- existing booking constraints, privileges, RLS, sessions and reservation data remain intact.
-- DEFER APPLY UNTIL THE USER AUTHORIZES PRODUCTION DEPLOYMENT.
begin;

-- olli_booking_private.assert_slot: align nth-week selection with Sunday-first calendar.
CREATE OR REPLACE FUNCTION olli_booking_private.assert_slot(p_academy_id uuid, p_start_at timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 s public.olli_booking_settings%rowtype;
 v_local timestamp;
 v_day date;
 v_week integer;
 v_finish timestamptz;
begin
 if p_start_at is null or p_start_at<=now() then
  raise exception 'SLOT_INVALID' using errcode='22023';
 end if;
 select * into s from public.olli_booking_settings where academy_id=p_academy_id;
 if not found then raise exception 'SETTINGS_MISSING' using errcode='22023'; end if;
 v_local:=p_start_at at time zone s.timezone;
 v_day:=v_local::date;
 v_week := 1 + ((extract(day from v_day)::int + extract(dow from date_trunc('month',v_day::timestamp)::date)::int - 1) / 7);
 if v_day > (now() at time zone s.timezone)::date+120
    or not(v_week=any(s.weeks))
    or not(extract(isodow from v_day)::smallint=any(s.weekdays))
    or v_local<v_day+s.start_time
    or v_local+make_interval(mins=>s.slot_minutes)>v_day+s.end_time
    or mod(extract(epoch from(v_local-(v_day+s.start_time)))::bigint,
           s.slot_minutes::bigint*60)<>0 then
  raise exception 'SLOT_OUTSIDE_SETTINGS' using errcode='22023';
 end if;
 if exists (
  select 1 from public.olli_booking_blocks b
  where b.academy_id=p_academy_id and b.block_date=v_day
    and (b.start_time is null
      or (v_local::time<b.end_time and
          (v_local+make_interval(mins=>s.slot_minutes))::time>b.start_time))
 ) then raise exception 'SLOT_BLOCKED' using errcode='22023'; end if;
 v_finish:=(v_local+make_interval(mins=>s.slot_minutes)) at time zone s.timezone;
 return v_finish;
end;
$function$;

-- olli_booking_private.available_slots: align nth-week selection with Sunday-first calendar.
CREATE OR REPLACE FUNCTION olli_booking_private.available_slots(p_academy_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 s public.olli_booking_settings%rowtype;
 v_week integer;
 v_slots jsonb;
begin
 if p_date is null or p_date < (now() at time zone 'Asia/Seoul')::date
   or p_date > (now() at time zone 'Asia/Seoul')::date+120 then
  return '[]'::jsonb;
 end if;
 select * into s from public.olli_booking_settings where academy_id=p_academy_id;
 if not found then return '[]'::jsonb; end if;
 v_week := 1 + ((extract(day from p_date)::int + extract(dow from date_trunc('month',p_date::timestamp)::date)::int - 1) / 7);
 if not(v_week=any(s.weeks))
   or not(extract(isodow from p_date)::smallint=any(s.weekdays)) then
   return '[]'::jsonb;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'start_at',g.local_start at time zone s.timezone,
   'local_start',to_char(g.local_start,'YYYY-MM-DD"T"HH24:MI')
 ) order by g.local_start),'[]'::jsonb)
 into v_slots
 from generate_series(
   p_date+s.start_time,p_date+s.end_time-make_interval(mins=>s.slot_minutes),
   make_interval(mins=>s.slot_minutes)) as g(local_start)
 where (g.local_start at time zone s.timezone)>now()
   and not exists(
     select 1 from public.olli_booking_blocks b
     where b.academy_id=p_academy_id and b.block_date=p_date and
       (b.start_time is null or
        (g.local_start::time < b.end_time and
        (g.local_start+make_interval(mins=>s.slot_minutes))::time>b.start_time))
   )
   and not exists(
     select 1 from public.olli_booking_reservations r
     where r.academy_id=p_academy_id and r.status='confirmed'
     and tstzrange(r.start_at,r.end_at,'[)') &&
       tstzrange(g.local_start at time zone s.timezone,
       (g.local_start+make_interval(mins=>s.slot_minutes)) at time zone s.timezone,'[)')
   );
 return v_slots;
end;
$function$;

-- public.olli_booking_list_slots: align nth-week selection with Sunday-first calendar.
CREATE OR REPLACE FUNCTION public.olli_booking_list_slots(p_session_token text, p_academy_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.olli_booking_settings%rowtype;
  v_week integer;
  v_slots jsonb := '[]'::jsonb;
begin
  perform olli_consultation_private.require_owner(p_session_token,p_academy_id);
  if p_date is null or p_date < (now() at time zone 'Asia/Seoul')::date
    or p_date > ((now() at time zone 'Asia/Seoul')::date + 120) then
    return jsonb_build_object('ok',true,'slots','[]'::jsonb);
  end if;
  insert into public.olli_booking_settings(academy_id) values(p_academy_id)
    on conflict(academy_id) do nothing;
  select * into strict s from public.olli_booking_settings where academy_id=p_academy_id;
  v_week := 1 + ((extract(day from p_date)::int + extract(dow from date_trunc('month',p_date::timestamp)::date)::int - 1) / 7);
  if not (v_week = any(s.weeks))
     or not (extract(isodow from p_date)::smallint = any(s.weekdays)) then
    return jsonb_build_object('ok',true,'slots','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'local_start',to_char(g.local_start,'YYYY-MM-DD"T"HH24:MI'),
    'start_at',g.local_start at time zone s.timezone,
    'end_at',(g.local_start + make_interval(mins => s.slot_minutes)) at time zone s.timezone
  ) order by g.local_start),'[]'::jsonb)
  into v_slots
  from generate_series(
      p_date+s.start_time,
      p_date+s.end_time-make_interval(mins=>s.slot_minutes),
      make_interval(mins=>s.slot_minutes)
    ) as g(local_start)
  where g.local_start at time zone s.timezone > now()
    and not exists (
      select 1 from public.olli_booking_blocks b
      where b.academy_id=p_academy_id and b.block_date=p_date
        and (b.start_time is null
          or (g.local_start::time < b.end_time and
              (g.local_start+make_interval(mins=>s.slot_minutes))::time > b.start_time))
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

-- public.olli_booking_server_reserve: align nth-week selection with Sunday-first calendar.
CREATE OR REPLACE FUNCTION public.olli_booking_server_reserve(p_academy_id uuid, p_student_id uuid, p_intake_id uuid, p_start_at timestamp with time zone, p_request_key uuid, p_due_month text DEFAULT NULL::text, p_rule_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  s public.olli_booking_settings%rowtype;
  v_date date;
  v_local timestamp;
  v_end timestamptz;
  v_week integer;
  v_existing public.olli_booking_reservations%rowtype;
  v_id uuid;
begin
  if p_request_key is null or p_start_at is null
     or ((p_student_id is not null)::int+(p_intake_id is not null)::int)<>1
     or (p_due_month is not null and p_due_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$')
     or (p_rule_key is not null and length(p_rule_key)>100) then
    raise exception 'INVALID_BOOKING' using errcode='22023';
  end if;
  if not exists(select 1 from public.academies a where a.id=p_academy_id
    and a.status='active' and a.deleted_at is null and a.access_status='active') then
    raise exception 'ACADEMY_UNAVAILABLE' using errcode='42501';
  end if;
  if p_student_id is not null and not exists (
    select 1 from public.students st where st.id=p_student_id and st.academy_id=p_academy_id
      and st.status='active' and st.is_deleted=false
  ) then raise exception 'STUDENT_UNAVAILABLE' using errcode='42501'; end if;
  if p_intake_id is not null and not exists (
    select 1 from public.olli_booking_intakes i where i.id=p_intake_id
      and i.academy_id=p_academy_id and i.status='new'
  ) then raise exception 'INTAKE_UNAVAILABLE' using errcode='42501'; end if;

  -- Serialize the same idempotency key (not a substitute for the GiST exclusion).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_academy_id::text||':'||p_request_key::text,0));
  select * into v_existing from public.olli_booking_reservations
    where academy_id=p_academy_id and request_key=p_request_key;
  if found then
    if v_existing.student_id is distinct from p_student_id
      or v_existing.intake_id is distinct from p_intake_id
      or v_existing.start_at is distinct from p_start_at then
      raise exception 'REQUEST_KEY_REUSED' using errcode='22023';
    end if;
    return v_existing.id;
  end if;

  insert into public.olli_booking_settings(academy_id) values(p_academy_id)
    on conflict(academy_id) do nothing;
  select * into strict s from public.olli_booking_settings where academy_id=p_academy_id;
  v_local := p_start_at at time zone s.timezone;
  v_date := v_local::date;
  v_week := 1 + ((extract(day from v_date)::int + extract(dow from date_trunc('month',v_date::timestamp)::date)::int - 1) / 7);
  if p_start_at<=now() or v_week<>all(s.weeks)
    or extract(isodow from v_date)::smallint<>all(s.weekdays)
    or v_local < (v_date+s.start_time)
    or v_local+make_interval(mins=>s.slot_minutes)>(v_date+s.end_time)
    or mod(extract(epoch from (v_local-(v_date+s.start_time)))::bigint,
      (s.slot_minutes::bigint*60))<>0 then
    raise exception 'SLOT_OUTSIDE_SETTINGS' using errcode='22023';
  end if;
  if exists (
    select 1 from public.olli_booking_blocks b
    where b.academy_id=p_academy_id and b.block_date=v_date
      and (b.start_time is null or
        (v_local::time<b.end_time and
         (v_local+make_interval(mins=>s.slot_minutes))::time>b.start_time))
  ) then raise exception 'SLOT_BLOCKED' using errcode='22023'; end if;
  v_end := (v_local+make_interval(mins=>s.slot_minutes)) at time zone s.timezone;
  -- olli_booking_reservations_no_overlap rejects simultaneous overlapping writes.
  insert into public.olli_booking_reservations
    (academy_id,student_id,intake_id,start_at,end_at,request_key,due_month,rule_key)
  values(p_academy_id,p_student_id,p_intake_id,p_start_at,v_end,p_request_key,p_due_month,p_rule_key)
  returning id into v_id;
  insert into public.olli_booking_events(reservation_id,academy_id,action,actor)
    values(v_id,p_academy_id,'created','system');
  return v_id;
end;
$function$;

commit;
