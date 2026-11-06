-- Owner PC intake/trial registration. Shared existing reservation overlap constraint.
begin;
alter table public.olli_booking_intakes
 add column age_years smallint,
 add column visit_type text not null default 'consultation';
alter table public.olli_booking_intakes
 add constraint olli_booking_intakes_age_years_chk
   check(age_years is null or age_years between 1 and 99),
 add constraint olli_booking_intakes_visit_type_chk
   check(visit_type in ('consultation','trial'));

create function public.olli_booking_staff_intake_create(
 p_session_token text, p_academy_id uuid,
 p_child_name text, p_age_years smallint, p_visit_type text,
 p_start_at timestamptz, p_request_key uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
 v_name text;
 v_existing public.olli_booking_reservations%rowtype;
 v_intake public.olli_booking_intakes%rowtype;
 v_settings public.olli_booking_settings%rowtype;
 v_end timestamptz;
 v_intake_id uuid;
 v_reservation_id uuid;
begin
 perform olli_consultation_private.require_owner(p_session_token,p_academy_id);
 v_name:=btrim(coalesce(p_child_name,''));
 if char_length(v_name) not between 1 and 80
  or p_age_years is null or p_age_years not between 1 and 99
  or p_visit_type is null or p_visit_type not in ('consultation','trial')
  or p_start_at is null or p_request_key is null then
  raise exception 'INTAKE_BOOKING_FIELDS_INVALID' using errcode='22023';
 end if;
 if not exists(select 1 from public.academies a
   where a.id=p_academy_id and a.status='active'
   and a.deleted_at is null and a.access_status='active') then
  raise exception 'ACADEMY_UNAVAILABLE' using errcode='42501';
 end if;

 -- The same request key must not create duplicate intake/reservation rows.
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(p_academy_id::text||':'||p_request_key::text,0));
 select * into v_existing from public.olli_booking_reservations r
  where r.academy_id=p_academy_id and r.request_key=p_request_key;
 if found then
  select * into v_intake from public.olli_booking_intakes i
   where i.id=v_existing.intake_id and i.academy_id=p_academy_id;
  if v_existing.student_id is not null
    or v_existing.start_at is distinct from p_start_at
    or v_intake.id is null
    or v_intake.child_name is distinct from v_name
    or v_intake.age_years is distinct from p_age_years
    or v_intake.visit_type is distinct from p_visit_type then
   raise exception 'REQUEST_KEY_REUSED' using errcode='22023';
  end if;
  return jsonb_build_object('ok',true,'reservation_id',v_existing.id,
   'intake_id',v_existing.intake_id,'replayed',true);
 end if;

 insert into public.olli_booking_settings(academy_id) values(p_academy_id)
   on conflict(academy_id) do nothing;
 select * into strict v_settings from public.olli_booking_settings
   where academy_id=p_academy_id;
 -- Staff-only slots include permitted evenings; blocked and booked slots are excluded.
 select (slot->>'end_at')::timestamptz into v_end
 from jsonb_array_elements(
  (public.olli_booking_staff_manual_slots(p_session_token,p_academy_id,
   (p_start_at at time zone v_settings.timezone)::date))->'slots') slot
 where (slot->>'start_at')::timestamptz=p_start_at;
 if v_end is null then raise exception 'SLOT_NOT_AVAILABLE' using errcode='22023'; end if;

 insert into public.olli_booking_intakes(academy_id,child_name,age_years,visit_type)
  values(p_academy_id,v_name,p_age_years,p_visit_type)
  returning id into v_intake_id;
 -- This single transaction rolls back intake creation on any reservation conflict.
 -- Existing GiST exclusion constraint rejects overlap across ALL booking kinds.
 insert into public.olli_booking_reservations
   (academy_id,intake_id,start_at,end_at,request_key)
  values(p_academy_id,v_intake_id,p_start_at,v_end,p_request_key)
  returning id into v_reservation_id;
 insert into public.olli_booking_events(reservation_id,academy_id,action,actor)
  values(v_reservation_id,p_academy_id,'created','staff');
 return jsonb_build_object('ok',true,'reservation_id',v_reservation_id,
  'intake_id',v_intake_id,'replayed',false);
end;
$function$;

revoke all on function public.olli_booking_staff_intake_create(
 text,uuid,text,smallint,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.olli_booking_staff_intake_create(
 text,uuid,text,smallint,text,timestamptz,uuid) to anon,authenticated,service_role;

-- Retain all original owner list/change/cancel behavior; expose subtype and age.
create or replace function public.olli_booking_staff_manage(
 p_session_token text,
 p_academy_id uuid,
 p_action text default 'list',
 p_month text default null,
 p_reservation_id uuid default null,
 p_start_at timestamptz default null,
 p_request_key uuid default null
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
 v_month date;
 v_rows jsonb;
 v_settings public.olli_booking_settings%rowtype;
 v_record public.olli_booking_reservations%rowtype;
 v_saved public.olli_booking_staff_mutations%rowtype;
 v_end timestamptz;
begin
 perform olli_consultation_private.require_owner(p_session_token,p_academy_id);
 if p_action not in ('list','reschedule','cancel') then
  raise exception 'INVALID_ACTION' using errcode='22023';
 end if;
 if p_action='list' then
  if p_month is null or p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then
    raise exception 'INVALID_MONTH' using errcode='22023';
  end if;
  v_month:=(p_month||'-01')::date;
  if v_month < date_trunc('month',(now() at time zone 'Asia/Seoul')-interval '12 months')::date
    or v_month > date_trunc('month',(now() at time zone 'Asia/Seoul')+interval '12 months')::date then
    raise exception 'MONTH_OUTSIDE_RANGE' using errcode='22023';
  end if;
  insert into public.olli_booking_settings(academy_id) values(p_academy_id)
    on conflict(academy_id) do nothing;
  select * into strict v_settings from public.olli_booking_settings where academy_id=p_academy_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,
    'student_id',r.student_id,
    'intake_id',r.intake_id,
    'name',coalesce(s.name,i.child_name,'이름 없음'),
    'visit_type',case when r.student_id is not null then 'consultation' else coalesce(i.visit_type,'consultation') end,
    'age_years',i.age_years,
    'kind',case when r.student_id is not null then 'student' else 'intake' end,
    'start_at',r.start_at,'end_at',r.end_at,'status',r.status,
    'due_month',r.due_month,'rule_key',r.rule_key
  ) order by r.start_at),'[]'::jsonb) into v_rows
  from public.olli_booking_reservations r
  left join public.students s on s.id=r.student_id and s.academy_id=r.academy_id
  left join public.olli_booking_intakes i on i.id=r.intake_id and i.academy_id=r.academy_id
  where r.academy_id=p_academy_id and
    (r.start_at at time zone v_settings.timezone)::date>=v_month
    and (r.start_at at time zone v_settings.timezone)::date<(v_month+interval '1 month')::date;
  return jsonb_build_object('ok',true,'month',p_month,
    'appointments',v_rows,'settings',to_jsonb(v_settings));
 end if;

 if p_request_key is null or p_reservation_id is null then
  raise exception 'REQUEST_ID_REQUIRED' using errcode='22023';
 end if;
 if (p_action='cancel' and p_start_at is not null)
   or (p_action='reschedule' and p_start_at is null) then
    raise exception 'INVALID_MUTATION_DATA' using errcode='22023';
 end if;
 -- Serialize duplicate retries and overlapping owner/parent updates to this target.
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(p_academy_id::text||':'||p_reservation_id::text,0));
 select * into v_saved from public.olli_booking_staff_mutations m
   where m.academy_id=p_academy_id and m.request_key=p_request_key;
 if found then
   if v_saved.action<>p_action or v_saved.reservation_id<>p_reservation_id
     or v_saved.new_start_at is distinct from p_start_at then
     raise exception 'REQUEST_KEY_REUSED' using errcode='22023';
   end if;
   return jsonb_build_object('ok',true,'reservation_id',p_reservation_id,'replayed',true);
 end if;
 select * into v_record from public.olli_booking_reservations
   where id=p_reservation_id and academy_id=p_academy_id and status='confirmed'
   for update;
 if not found then raise exception 'ACTIVE_RESERVATION_NOT_FOUND' using errcode='22023'; end if;
 if p_action='reschedule' then
   if p_start_at=v_record.start_at then
     raise exception 'SAME_SLOT' using errcode='22023';
   end if;
   -- Use the same owner-only slot source as the reschedule dialog and
   -- staff manual creation (including extended evening slots).
   -- Locked reservation and GiST overlap protection remain unchanged.
   select * into strict v_settings from public.olli_booking_settings
     where academy_id=p_academy_id;
   select (slot->>'end_at')::timestamptz into v_end
   from jsonb_array_elements(
     (public.olli_booking_staff_manual_slots(
       p_session_token,p_academy_id,
       (p_start_at at time zone v_settings.timezone)::date
     ))->'slots'
   ) slot
   where (slot->>'start_at')::timestamptz=p_start_at;
   if v_end is null then
     raise exception 'SLOT_NOT_AVAILABLE' using errcode='22023';
   end if;
   update public.olli_booking_reservations set start_at=p_start_at,end_at=v_end,
     updated_at=clock_timestamp() where id=v_record.id;
   insert into public.olli_booking_events(reservation_id,academy_id,action,actor,detail)
     values(v_record.id,p_academy_id,'rescheduled','staff',
       jsonb_build_object('previous_start_at',v_record.start_at,'new_start_at',p_start_at));
 else
   update public.olli_booking_reservations set status='cancelled',updated_at=clock_timestamp()
    where id=v_record.id;
   insert into public.olli_booking_events(reservation_id,academy_id,action,actor)
    values(v_record.id,p_academy_id,'cancelled','staff');
 end if;
 insert into public.olli_booking_staff_mutations
   (academy_id,request_key,reservation_id,action,new_start_at)
   values(p_academy_id,p_request_key,p_reservation_id,p_action,p_start_at);
 return jsonb_build_object('ok',true,'reservation_id',p_reservation_id,'replayed',false);
end;
$function$;

revoke all on function public.olli_booking_staff_manage(text,uuid,text,text,uuid,timestamptz,uuid)
  from public,anon,authenticated;
grant execute on function public.olli_booking_staff_manage(text,uuid,text,text,uuid,timestamptz,uuid)
  to anon,authenticated,service_role;
commit;
