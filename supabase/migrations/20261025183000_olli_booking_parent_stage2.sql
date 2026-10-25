-- Stage 2: guardian-scoped booking actions and staff-issued links.
-- Operates ONLY after stage 1, and only when reviewed/deployed separately.
begin;
create schema if not exists olli_booking_private;

-- Only one live appointment per enrolled student or pending intake. Cancelled
-- appointments remain as history and cannot reserve another slot.
create unique index olli_booking_one_live_student
  on public.olli_booking_reservations(academy_id,student_id)
  where status='confirmed' and student_id is not null;
create unique index olli_booking_one_live_intake
  on public.olli_booking_reservations(academy_id,intake_id)
  where status='confirmed' and intake_id is not null;

-- Idempotency records remain after cancellation or rescheduling.
create table public.olli_booking_mutations (
  id bigint generated always as identity primary key,
  academy_id uuid not null references public.academies(id) on delete cascade,
  link_id uuid not null references public.olli_booking_links(id) on delete cascade,
  request_key uuid not null,
  action text not null check (action in ('reserve','reschedule','cancel')),
  request_body jsonb not null,
  reservation_id uuid not null references public.olli_booking_reservations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(link_id,request_key)
);
create index olli_booking_mutations_academy_idx
  on public.olli_booking_mutations(academy_id,created_at desc);
alter table public.olli_booking_mutations enable row level security;
revoke all on public.olli_booking_mutations from public,anon,authenticated;
grant select,insert,update,delete on public.olli_booking_mutations to service_role;
grant usage,select on sequence public.olli_booking_mutations_id_seq to service_role;

create function olli_booking_private.assert_slot(p_academy_id uuid,p_start_at timestamptz)
returns timestamptz language plpgsql set search_path = ''
as $function$
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
 v_week:=1+((extract(day from v_day)::int
    +extract(isodow from date_trunc('month',v_day::timestamp)::date)::int-2)/7);
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

create function olli_booking_private.available_slots(p_academy_id uuid,p_date date)
returns jsonb language plpgsql set search_path=''
as $function$
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
 v_week:=1+((extract(day from p_date)::int
    +extract(isodow from date_trunc('month',p_date::timestamp)::date)::int-2)/7);
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

-- Owner-only via Olli session, server-only executable. Staff caller supplies
-- only a SHA256 hash, never the raw bearer link. Raw token is returned by API once.
create function public.olli_booking_staff_link_manage(
 p_session_token text,p_academy_id uuid,p_action text,
 p_student_id uuid default null,p_intake_id uuid default null,
 p_token_hash text default null,p_expires_at timestamptz default null,
 p_link_id uuid default null
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_id uuid;
begin
 perform olli_consultation_private.require_owner(p_session_token,p_academy_id);
 if p_action='issue' then
  if ((p_student_id is not null)::int+(p_intake_id is not null)::int)<>1
    or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at is null or p_expires_at<now()+interval '1 hour'
    or p_expires_at>now()+interval '45 days' then
    raise exception 'LINK_INPUT_INVALID' using errcode='22023';
  end if;
  if p_student_id is not null and not exists(
   select 1 from public.students s
   where s.academy_id=p_academy_id and s.id=p_student_id
     and s.status='active' and s.is_deleted=false
  ) then raise exception 'STUDENT_UNAVAILABLE' using errcode='22023'; end if;
  if p_intake_id is not null and not exists(
   select 1 from public.olli_booking_intakes i
   where i.academy_id=p_academy_id and i.id=p_intake_id and i.status='new'
  ) then raise exception 'INTAKE_UNAVAILABLE' using errcode='22023'; end if;
  insert into public.olli_booking_links(
    academy_id,student_id,intake_id,token_hash,expires_at)
  values(p_academy_id,p_student_id,p_intake_id,p_token_hash,p_expires_at)
  returning id into v_id;
  return jsonb_build_object('ok',true,'link_id',v_id,'expires_at',p_expires_at);
 elsif p_action='revoke' then
  if p_link_id is null then
   raise exception 'LINK_ID_REQUIRED' using errcode='22023';
  end if;
  update public.olli_booking_links set revoked_at=clock_timestamp()
   where id=p_link_id and academy_id=p_academy_id and revoked_at is null;
  if not found then raise exception 'LINK_NOT_FOUND' using errcode='22023'; end if;
  return jsonb_build_object('ok',true,'revoked',true);
 end if;
 raise exception 'INVALID_ACTION' using errcode='22023';
end;
$function$;

-- All guardian actions are one DB transaction, authenticated inside PostgreSQL
-- using token hash, expiry, revocation and exact student/intake scope.
-- These privileged RPCs are executable only by server service_role.
create function public.olli_booking_parent_request(
 p_token_hash text,p_action text,
 p_date date default null,p_start_at timestamptz default null,
 p_request_key uuid default null,p_reservation_id uuid default null
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
 l public.olli_booking_links%rowtype;
 cfg public.olli_booking_settings%rowtype;
 r public.olli_booking_reservations%rowtype;
 saved public.olli_booking_mutations%rowtype;
 payload jsonb;
 v_id uuid;
 v_end timestamptz;
 v_rows jsonb;
begin
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_action not in ('snapshot','slots','reserve','reschedule','cancel') then
    raise exception 'LINK_INVALID' using errcode='42501';
 end if;
 select * into l from public.olli_booking_links
   where token_hash=p_token_hash and expires_at>now() and revoked_at is null
   for share;
 if not found then raise exception 'LINK_INVALID' using errcode='42501'; end if;
 if not exists(
  select 1 from public.academies a where a.id=l.academy_id and
    a.status='active' and a.access_status='active' and a.deleted_at is null
 ) then raise exception 'LINK_INVALID' using errcode='42501'; end if;
 if l.student_id is not null and not exists(
   select 1 from public.students s where s.id=l.student_id
    and s.academy_id=l.academy_id and s.status='active' and s.is_deleted=false
 ) then raise exception 'LINK_INVALID' using errcode='42501'; end if;
 if l.intake_id is not null and not exists(
   select 1 from public.olli_booking_intakes i where i.id=l.intake_id
    and i.academy_id=l.academy_id and i.status='new'
 ) then raise exception 'LINK_INVALID' using errcode='42501'; end if;
 insert into public.olli_booking_settings(academy_id) values(l.academy_id)
   on conflict(academy_id) do nothing;
 select * into strict cfg from public.olli_booking_settings
   where academy_id=l.academy_id;
 if p_action='slots' then
  return jsonb_build_object('ok',true,'slots',
    olli_booking_private.available_slots(l.academy_id,p_date));
 end if;
 select * into r from public.olli_booking_reservations b
    where b.academy_id=l.academy_id
      and ((l.student_id is not null and b.student_id=l.student_id)
        or (l.intake_id is not null and b.intake_id=l.intake_id))
      and b.status='confirmed' order by b.created_at desc limit 1;
 if p_action='snapshot' then
  return jsonb_build_object('ok',true,
   'can_reschedule',cfg.allow_parent_reschedule,
   'can_cancel',cfg.allow_parent_cancel,
   'reservation',case when r.id is null then 'null'::jsonb
     else jsonb_build_object('id',r.id,'start_at',r.start_at,'end_at',r.end_at,
       'status',r.status) end);
 end if;

 if p_request_key is null then
   raise exception 'REQUEST_KEY_REQUIRED' using errcode='22023';
 end if;
 -- One target may receive multiple distinct guardian links.
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(l.academy_id::text||':'||
   coalesce(l.student_id::text,l.intake_id::text),0));
 payload:=jsonb_build_object('action',p_action,
   'start_at',p_start_at,'reservation_id',p_reservation_id);
 select * into saved from public.olli_booking_mutations m
   where m.link_id=l.id and m.request_key=p_request_key;
 if found then
  if saved.action<>p_action or saved.request_body<>payload then
   raise exception 'REQUEST_KEY_REUSED' using errcode='22023';
  end if;
  select * into r from public.olli_booking_reservations
    where id=saved.reservation_id;
  return jsonb_build_object('ok',true,'reservation_id',saved.reservation_id,
    'status',r.status,'start_at',r.start_at,'replayed',true);
 end if;
 -- Re-fetch the live reservation under the target advisory lock.
 select * into r from public.olli_booking_reservations b
    where b.academy_id=l.academy_id
      and ((l.student_id is not null and b.student_id=l.student_id)
        or (l.intake_id is not null and b.intake_id=l.intake_id))
      and b.status='confirmed' order by b.created_at desc limit 1
    for update;
 if p_action='reserve' then
  if p_start_at is null or p_reservation_id is not null then
   raise exception 'INVALID_RESERVE_INPUT' using errcode='22023';
  end if;
  if r.id is not null then
   raise exception 'ACTIVE_RESERVATION_EXISTS' using errcode='23505';
  end if;
  -- Enforce the same 120-day public booking horizon as the slot list.
  perform olli_booking_private.assert_slot(l.academy_id,p_start_at);
  -- Existing stage 1 reserve validates the window, student, block and overlap.
  v_id:=public.olli_booking_server_reserve(
    l.academy_id,l.student_id,l.intake_id,p_start_at,p_request_key,null,null);
  update public.olli_booking_events set actor='parent'
    where reservation_id=v_id and action='created';
  select * into r from public.olli_booking_reservations where id=v_id;
 elsif p_action='reschedule' then
  if not cfg.allow_parent_reschedule then
   raise exception 'RESCHEDULE_DISABLED' using errcode='42501';
  end if;
  if p_start_at is null or p_reservation_id is null
    or r.id is distinct from p_reservation_id then
   raise exception 'RESERVATION_NOT_FOUND' using errcode='22023';
  end if;
  v_end:=olli_booking_private.assert_slot(l.academy_id,p_start_at);
  update public.olli_booking_reservations set
    start_at=p_start_at,end_at=v_end,updated_at=clock_timestamp()
    where id=r.id and status='confirmed';
  insert into public.olli_booking_events(reservation_id,academy_id,action,actor,detail)
   values(r.id,l.academy_id,'rescheduled','parent',
      jsonb_build_object('previous_start_at',r.start_at,'new_start_at',p_start_at));
  v_id:=r.id;
  select * into r from public.olli_booking_reservations where id=v_id;
 elsif p_action='cancel' then
  if not cfg.allow_parent_cancel then
   raise exception 'CANCEL_DISABLED' using errcode='42501';
  end if;
  if p_start_at is not null or p_reservation_id is null
    or r.id is distinct from p_reservation_id then
   raise exception 'RESERVATION_NOT_FOUND' using errcode='22023';
  end if;
  update public.olli_booking_reservations
    set status='cancelled',updated_at=clock_timestamp()
    where id=r.id and status='confirmed';
  insert into public.olli_booking_events(reservation_id,academy_id,action,actor)
    values(r.id,l.academy_id,'cancelled','parent');
  v_id:=r.id;
  select * into r from public.olli_booking_reservations where id=v_id;
 end if;
 insert into public.olli_booking_mutations(
   academy_id,link_id,request_key,action,request_body,reservation_id)
 values(l.academy_id,l.id,p_request_key,p_action,payload,v_id);
 return jsonb_build_object('ok',true,'reservation_id',v_id,
   'status',r.status,'start_at',r.start_at,'replayed',false);
end;
$function$;

-- Explicitly deny browser/anonymous execution; API mediates with service key.
revoke all on function public.olli_booking_staff_link_manage(
 text,uuid,text,uuid,uuid,text,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.olli_booking_parent_request(
 text,text,date,timestamptz,uuid,uuid) from public,anon,authenticated;
grant execute on function public.olli_booking_staff_link_manage(
 text,uuid,text,uuid,uuid,text,timestamptz,uuid) to service_role;
grant execute on function public.olli_booking_parent_request(
 text,text,date,timestamptz,uuid,uuid) to service_role;
-- Private helpers cannot be invoked directly by untrusted roles.
revoke all on schema olli_booking_private from public,anon,authenticated;
revoke all on function olli_booking_private.assert_slot(uuid,timestamptz)
 from public,anon,authenticated;
revoke all on function olli_booking_private.available_slots(uuid,date)
 from public,anon,authenticated;

commit;
