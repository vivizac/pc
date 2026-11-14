-- Parent self-service makeup booking. No existing schedule RPC or sync function is replaced.
-- Public API callers require service_role; browser callers never receive staff credentials.
begin;

create table public.olli_makeup_parent_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  academy_id uuid not null references public.academies(id),
  student_id uuid not null references public.students(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index olli_makeup_parent_sessions_student_idx
  on public.olli_makeup_parent_sessions(academy_id,student_id,expires_at);

create table public.olli_makeup_requests (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  student_id uuid not null references public.students(id),
  request_key uuid not null,
  requested_absences jsonb not null default '[]'::jsonb,
  requested_makeups jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by_account_id uuid,
  unique(academy_id,student_id,request_key)
);
create index olli_makeup_requests_unread_idx
  on public.olli_makeup_requests(academy_id,created_at) where acknowledged_at is null;

create table public.olli_makeup_request_items (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.olli_makeup_requests(id) on delete cascade,
  kind text not null check(kind in ('absence','makeup')),
  session_date date not null,
  time_slot integer not null,
  class_group text not null check(class_group in ('A','B')),
  one_time_session_id uuid references public.olli_schedule_one_time_sessions(id) on delete set null,
  unique(request_id,kind,session_date,time_slot,class_group)
);

alter table public.olli_makeup_parent_sessions enable row level security;
alter table public.olli_makeup_requests enable row level security;
alter table public.olli_makeup_request_items enable row level security;
revoke all on public.olli_makeup_parent_sessions,public.olli_makeup_requests,
  public.olli_makeup_request_items from public,anon,authenticated;
grant select,insert,update,delete on public.olli_makeup_parent_sessions,
  public.olli_makeup_requests,public.olli_makeup_request_items to service_role;
grant usage,select on sequence public.olli_makeup_request_items_id_seq to service_role;

-- Match Olli PC's actual Saturday labels (stored slots 10/11/12 are 10/11/12시).
-- Keep the older shared label helper untouched to avoid regression.
create function private.olli_makeup_slot_label(
  p_academy_id uuid,p_division text,p_date date,p_time_slot integer
) returns text language sql stable set search_path=''
as $fn$
  select case when p_division='elementary'
      and extract(isodow from p_date)=6 and p_time_slot between 10 and 12
    then p_time_slot::text||'시'
    else private.olli_schedule_time_slot_label(
      p_academy_id,p_division,extract(isodow from p_date)::integer,p_time_slot)
  end;
$fn$;
revoke all on function private.olli_makeup_slot_label(uuid,text,date,integer)
  from public,anon,authenticated;

-- Reuse the consultation academy's immutable public link slug, confirmed
-- guardian contact, IP-attempt table and academy membership without changing them.
create function public.olli_makeup_parent_identify(
  p_slug text,p_student_name text,p_guardian_phone text,
  p_token_hash text,p_ip_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_academy uuid;v_student uuid;v_name text;v_division text;v_matches int;
begin
  if p_slug is null or p_slug !~ '^[0-9a-f]{36}$'
    or p_student_name is null or char_length(btrim(p_student_name)) not between 2 and 60
    or p_student_name ~ '[%_]'
    or p_guardian_phone is null or p_guardian_phone !~ '^01[016789][0-9]{7,8}$'
    or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_ip_digest is null or p_ip_digest !~ '^[0-9a-f]{64}$'
  then return jsonb_build_object('ok',false,'code','FORM_INVALID');end if;
  select p.academy_id into v_academy
  from public.olli_booking_public_academies p
  join public.academies a on a.id=p.academy_id
  where p.slug=p_slug and a.status='active' and a.access_status='active'
    and a.deleted_at is null;
  if v_academy is null then return jsonb_build_object('ok',false,'code','MATCH_NOT_FOUND');end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('booking-public-attempt:'||v_academy::text,0));
  if (select count(*) from public.olli_booking_public_attempts
      where academy_id=v_academy and created_at>now()-interval '1 hour')>=300
     or (select count(*) from public.olli_booking_public_attempts
      where academy_id=v_academy and ip_digest=p_ip_digest
        and created_at>now()-interval '1 hour')>=20
  then return jsonb_build_object('ok',false,'code','TOO_MANY_ATTEMPTS');end if;
  insert into public.olli_booking_public_attempts(academy_id,ip_digest)
  values(v_academy,p_ip_digest);
  select count(*),(array_agg(s.id))[1],(array_agg(s.name))[1],(array_agg(s.division))[1]
    into v_matches,v_student,v_name,v_division
  from public.students s
  join public.olli_consultation_message_contacts c
    on c.student_id=s.id and c.academy_id=s.academy_id
  where s.academy_id=v_academy and s.status='active'
    and s.is_deleted=false and coalesce(s.is_stat_only,false)=false
    and regexp_replace(btrim(s.name),'[[:space:]]','','g')
        like regexp_replace(btrim(p_student_name),'[[:space:]]','','g')||'%'
    and c.confirmed=true
    and regexp_replace(c.phone,'[^0-9]','','g')=p_guardian_phone;
  if v_matches<>1 then
    return jsonb_build_object('ok',false,
      'code',case when v_matches>1 then 'NAME_AMBIGUOUS' else 'MATCH_NOT_FOUND' end);
  end if;
  insert into public.olli_makeup_parent_sessions(token_hash,academy_id,student_id,expires_at)
    values(p_token_hash,v_academy,v_student,now()+interval '30 minutes');
  return jsonb_build_object('ok',true,'student_id',v_student,
    'student_name',v_name,'division',v_division);
end;
$fn$;

-- Parent snapshot never exposes other pupils or staff/session credentials.
create function public.olli_makeup_parent_snapshot(p_token_hash text)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_s public.olli_makeup_parent_sessions%rowtype;
v_name text;v_division text;v_regular jsonb;v_absences jsonb;v_makeups jsonb;
begin
  select * into v_s from public.olli_makeup_parent_sessions
    where token_hash=p_token_hash and expires_at>now();
  if not found then return jsonb_build_object('ok',false,'code','ACCESS_DENIED');end if;
  select s.name,s.division into v_name,v_division from public.students s
    join public.academies a on a.id=s.academy_id
    where s.id=v_s.student_id and s.academy_id=v_s.academy_id
    and s.status='active' and not s.is_deleted and coalesce(s.is_stat_only,false)=false
    and a.status='active' and a.access_status='active' and a.deleted_at is null;
  if not found then return jsonb_build_object('ok',false,'code','ACCESS_DENIED');end if;
  select coalesce(jsonb_agg(jsonb_build_object('date',d.day::date,
    'time_slot',e.time_slot,'group',e.class_group,'label',
    private.olli_makeup_slot_label(v_s.academy_id,v_division,d.day::date,e.time_slot))
    order by d.day,e.time_slot),'[]'::jsonb) into v_regular
  from public.olli_schedule_enrollments e
  join lateral generate_series(
    (now() at time zone 'Asia/Seoul')::date,
    (now() at time zone 'Asia/Seoul')::date+90,interval '1 day'
  ) d(day) on extract(isodow from d.day)::integer=e.weekday
  where e.student_id=v_s.student_id and e.academy_id=v_s.academy_id
    and e.status='active' and e.effective_from<=d.day::date
    and (e.effective_to is null or e.effective_to>=d.day::date)
    and not private.olli_schedule_is_closed_day(v_s.academy_id,d.day::date);
  select coalesce(jsonb_agg(jsonb_build_object('date',o.session_date,
    'time_slot',o.time_slot,'group',o.class_group) order by o.session_date,o.time_slot),'[]'::jsonb)
    into v_absences
  from private.olli_schedule_attendance_session_overrides o
  where o.academy_id=v_s.academy_id and o.student_id=v_s.student_id
    and o.session_kind='regular' and o.status='absent'
    and o.session_date>=(now() at time zone 'Asia/Seoul')::date-365;
  select coalesce(jsonb_agg(jsonb_build_object(
    'date',o.session_date,'time_slot',o.time_slot,'group',o.class_group,
    'label',private.olli_makeup_slot_label(v_s.academy_id,v_division,o.session_date,o.time_slot),
    'status',case when o.status='cancelled' then 'cancelled'
      when o.status='attended' then 'completed'
      when exists(select 1 from private.olli_schedule_attendance_session_overrides a
        where a.academy_id=v_s.academy_id and a.student_id=v_s.student_id
          and a.session_date=o.session_date and a.time_slot=o.time_slot
          and a.class_group=o.class_group and a.session_kind='makeup'
          and a.status='makeup') then 'completed'
      when o.session_date<(now() at time zone 'Asia/Seoul')::date then 'past'
      else 'scheduled' end)
    order by o.session_date desc,o.time_slot),'[]'::jsonb) into v_makeups
  from public.olli_schedule_one_time_sessions o
  where o.academy_id=v_s.academy_id and o.student_id=v_s.student_id
    and o.session_type='makeup'
    and o.session_date>=(now() at time zone 'Asia/Seoul')::date-365;
  return jsonb_build_object('ok',true,'student_name',v_name,
    'division',v_division,'regular',v_regular,
    'absences',v_absences,'makeups',v_makeups);
end;
$fn$;

-- Slots are computed on demand for just one date, so no other student names
-- or schedules are returned. Capacity uses the current Olli vacancy rules.
create function public.olli_makeup_parent_slots(p_token_hash text,p_date date)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_s public.olli_makeup_parent_sessions%rowtype;
v_division text;v_weekday integer;v_slots jsonb;
begin
  select * into v_s from public.olli_makeup_parent_sessions
  where token_hash=p_token_hash and expires_at>now();
  if not found then return jsonb_build_object('ok',false,'code','ACCESS_DENIED');end if;
  select s.division into v_division from public.students s
    where s.id=v_s.student_id and s.academy_id=v_s.academy_id
    and s.status='active' and not s.is_deleted and not coalesce(s.is_stat_only,false);
  if v_division is null then return jsonb_build_object('ok',false,'code','ACCESS_DENIED');end if;
  if p_date is null or p_date<(now() at time zone 'Asia/Seoul')::date
    or p_date>(now() at time zone 'Asia/Seoul')::date+90
    or extract(isodow from p_date)=7
    or private.olli_schedule_is_closed_day(v_s.academy_id,p_date)
  then return jsonb_build_object('ok',true,'slots','[]'::jsonb);end if;
  v_weekday:=extract(isodow from p_date)::integer;
  select coalesce(jsonb_agg(jsonb_build_object('date',p_date,
    'time_slot',x.time_slot,'group',x.class_group,
    'label',private.olli_makeup_slot_label(v_s.academy_id,v_division,p_date,x.time_slot)) order by x.time_slot,x.class_group),'[]'::jsonb)
    into v_slots
  from (
    select t.slot as time_slot,g.grp as class_group
    from generate_series(1,12) t(slot)
    cross join (values('A'),('B')) g(grp)
    where private.olli_schedule_slot_is_valid(v_s.academy_id,v_division,v_weekday,t.slot)
      and (g.grp='A' or private.olli_schedule_group_is_enabled(
        v_s.academy_id,v_division,v_weekday,t.slot,p_date))
      and not exists (
        select 1 from public.olli_schedule_enrollments e
        where e.academy_id=v_s.academy_id and e.student_id=v_s.student_id
          and e.status='active' and e.weekday=v_weekday and e.time_slot=t.slot
          and e.effective_from<=p_date and (e.effective_to is null or e.effective_to>=p_date))
      and not exists (
        select 1 from public.olli_schedule_one_time_sessions o
        where o.academy_id=v_s.academy_id and o.student_id=v_s.student_id
          and o.status<>'cancelled' and o.session_date=p_date and o.time_slot=t.slot)
      and (
        (select count(*) from public.olli_schedule_enrollments e
          join public.students s on s.id=e.student_id
          where e.academy_id=v_s.academy_id and s.division=v_division
          and s.status='active' and not s.is_deleted and e.status='active'
          and e.weekday=v_weekday and e.time_slot=t.slot
          and (not private.olli_schedule_group_is_enabled(
            v_s.academy_id,v_division,v_weekday,t.slot,p_date)
            or upper(coalesce(nullif(btrim(e.class_group),''),'A'))=g.grp)
          and e.effective_from<=p_date and (e.effective_to is null or e.effective_to>=p_date)
          and not exists(select 1 from private.olli_schedule_attendance_session_overrides a
            where a.academy_id=v_s.academy_id and a.student_id=e.student_id
              and a.session_date=p_date and a.time_slot=t.slot
              and a.session_kind='regular' and a.status='absent'
              and (not private.olli_schedule_group_is_enabled(
                v_s.academy_id,v_division,v_weekday,t.slot,p_date)
                or a.class_group=g.grp)))
        +
        (select count(*) from public.olli_schedule_one_time_sessions o
          left join public.students s on s.id=o.student_id
          where o.academy_id=v_s.academy_id
            and coalesce(s.division,o.guest_division)=v_division
            and (o.student_id is null or (s.status='active' and not s.is_deleted))
            and o.status<>'cancelled' and o.session_date=p_date and o.time_slot=t.slot
            and (not private.olli_schedule_group_is_enabled(
              v_s.academy_id,v_division,v_weekday,t.slot,p_date)
              or o.class_group=g.grp))
      ) < private.olli_schedule_capacity(v_s.academy_id,v_division)
  ) x;
  return jsonb_build_object('ok',true,'slots',v_slots);
end;
$fn$;

-- Multiple regular absences and makeup sessions are written in a single
-- PostgreSQL transaction. Any exception rolls back the entire batch.
-- Parent submissions cannot alter the existing staff schedule RPC definitions.
create function public.olli_makeup_parent_submit(
  p_token_hash text,p_request_key uuid,p_absences jsonb,p_makeups jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_s public.olli_makeup_parent_sessions%rowtype;
v_division text;v_request uuid;v_existing public.olli_makeup_requests%rowtype;
v_item jsonb;v_date date;v_slot int;v_group text;v_weekday int;
v_old_status text;v_enabled boolean;v_capacity int;v_occupancy int;
v_session_id uuid;v_abs_credit int;v_makeup_count int;
v_today date:=(now() at time zone 'Asia/Seoul')::date;
begin
  if p_request_key is null or jsonb_typeof(p_absences)<>'array'
    or jsonb_typeof(p_makeups)<>'array'
    or jsonb_array_length(p_absences)>10 or jsonb_array_length(p_makeups)>10
    or jsonb_array_length(p_absences)+jsonb_array_length(p_makeups)=0
  then raise exception 'FORM_INVALID';end if;
  select * into v_s from public.olli_makeup_parent_sessions
    where token_hash=p_token_hash and expires_at>now();
  if not found then raise exception 'ACCESS_DENIED';end if;
  select s.division into v_division from public.students s
    join public.academies a on a.id=s.academy_id
    where s.id=v_s.student_id and s.academy_id=v_s.academy_id
      and s.status='active' and not s.is_deleted and not coalesce(s.is_stat_only,false)
      and a.status='active' and a.access_status='active' and a.deleted_at is null;
  if v_division is null then raise exception 'ACCESS_DENIED';end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('makeup-parent:'||v_s.academy_id||':'||v_s.student_id,0));
  select * into v_existing from public.olli_makeup_requests
    where academy_id=v_s.academy_id and student_id=v_s.student_id
      and request_key=p_request_key;
  if found then
    if v_existing.requested_absences<>p_absences
      or v_existing.requested_makeups<>p_makeups then raise exception 'REQUEST_CONFLICT';end if;
    return jsonb_build_object('ok',true,'request_id',v_existing.id,'unchanged',true);
  end if;

  -- Validate all input shapes before any timetable mutation.
  for v_item in select value from jsonb_array_elements(p_absences||p_makeups)
  loop
    if jsonb_typeof(v_item)<>'object'
      or coalesce(v_item->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(v_item->>'time_slot','') !~ '^[0-9]{1,2}$'
      or coalesce(v_item->>'group','') not in ('A','B')
    then raise exception 'FORM_INVALID';end if;
    begin
      v_date:=(v_item->>'date')::date;
      v_slot:=(v_item->>'time_slot')::integer;
    exception when others then raise exception 'FORM_INVALID';end;
    if v_date<v_today or v_date>v_today+90 or v_slot not between 1 and 12
    then raise exception 'DATE_INVALID';end if;
  end loop;
  insert into public.olli_makeup_requests(
    academy_id,student_id,request_key,requested_absences,requested_makeups)
  values(v_s.academy_id,v_s.student_id,p_request_key,p_absences,p_makeups)
  returning id into v_request;

  for v_item in select value from jsonb_array_elements(p_absences)
  loop
    v_date:=(v_item->>'date')::date;
    v_slot:=(v_item->>'time_slot')::integer;
    v_group:=v_item->>'group';
    v_weekday:=extract(isodow from v_date)::integer;
    if private.olli_schedule_is_closed_day(v_s.academy_id,v_date)
      or not exists(select 1 from public.olli_schedule_enrollments e
        where e.academy_id=v_s.academy_id and e.student_id=v_s.student_id
          and e.status='active' and e.weekday=v_weekday and e.time_slot=v_slot
          and e.class_group=v_group and e.effective_from<=v_date
          and (e.effective_to is null or e.effective_to>=v_date))
    then raise exception 'ABSENCE_INVALID';end if;
    select status into v_old_status
      from private.olli_schedule_attendance_session_overrides
      where academy_id=v_s.academy_id and student_id=v_s.student_id
        and session_date=v_date and time_slot=v_slot
        and class_group=v_group and session_kind='regular';
    if v_old_status='present' then raise exception 'ABSENCE_INVALID';end if;
    insert into private.olli_schedule_attendance_session_overrides(
      academy_id,student_id,session_date,time_slot,class_group,
      session_kind,status,updated_by_account_id,updated_at)
    values(v_s.academy_id,v_s.student_id,v_date,v_slot,v_group,
      'regular','absent',null,now())
    on conflict(academy_id,student_id,session_date,time_slot,class_group,session_kind)
    do update set status='absent',updated_at=now()
      where private.olli_schedule_attendance_session_overrides.status<>'absent';
    insert into public.olli_makeup_request_items(
      request_id,kind,session_date,time_slot,class_group)
    values(v_request,'absence',v_date,v_slot,v_group);
  end loop;

  -- Only real recorded absences create makeup entitlement. Future planned
  -- absences count, so parents may book the replacement class beforehand.
  select count(*) into v_abs_credit
  from private.olli_schedule_attendance_session_overrides a
  where a.academy_id=v_s.academy_id and a.student_id=v_s.student_id
    and a.session_kind='regular' and a.status='absent' and a.session_date>=v_today-365;
  select count(*) into v_makeup_count
  from public.olli_schedule_one_time_sessions o
  where o.academy_id=v_s.academy_id and o.student_id=v_s.student_id
    and o.session_type='makeup' and o.status<>'cancelled'
    and o.session_date>=v_today-365;
  if v_makeup_count+jsonb_array_length(p_makeups)>v_abs_credit
  then raise exception 'MAKEUP_CREDIT_REQUIRED';end if;

  for v_item in select value from jsonb_array_elements(p_makeups)
  loop
    v_date:=(v_item->>'date')::date;
    v_slot:=(v_item->>'time_slot')::integer;
    v_group:=v_item->>'group';
    v_weekday:=extract(isodow from v_date)::integer;
    if v_weekday=7 or private.olli_schedule_is_closed_day(v_s.academy_id,v_date)
      or not private.olli_schedule_slot_is_valid(
        v_s.academy_id,v_division,v_weekday,v_slot)
    then raise exception 'SLOT_UNAVAILABLE';end if;
    v_enabled:=private.olli_schedule_group_is_enabled(
      v_s.academy_id,v_division,v_weekday,v_slot,v_date);
    if not v_enabled and v_group<>'A' then raise exception 'SLOT_UNAVAILABLE';end if;
    if exists(select 1 from public.olli_schedule_enrollments e
      where e.academy_id=v_s.academy_id and e.student_id=v_s.student_id
        and e.status='active' and e.weekday=v_weekday and e.time_slot=v_slot
        and e.effective_from<=v_date and (e.effective_to is null or e.effective_to>=v_date))
      or exists(select 1 from public.olli_schedule_one_time_sessions o
        where o.academy_id=v_s.academy_id and o.student_id=v_s.student_id
          and o.session_date=v_date and o.time_slot=v_slot and o.status<>'cancelled')
    then raise exception 'SLOT_CONFLICT';end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_s.academy_id::text||':'||v_date::text||
        ':'||v_slot::text||':'||v_group,0));
    v_capacity:=private.olli_schedule_capacity(v_s.academy_id,v_division);
    select
      (select count(*) from public.olli_schedule_enrollments e
        join public.students s on s.id=e.student_id
        where e.academy_id=v_s.academy_id and s.division=v_division
          and s.status='active' and not s.is_deleted
          and e.status='active' and e.weekday=v_weekday and e.time_slot=v_slot
          and (not v_enabled or upper(coalesce(nullif(btrim(e.class_group),''),'A'))=v_group)
          and e.effective_from<=v_date and (e.effective_to is null or e.effective_to>=v_date)
          and not exists(select 1 from private.olli_schedule_attendance_session_overrides a
            where a.academy_id=v_s.academy_id and a.student_id=e.student_id
              and a.session_date=v_date and a.time_slot=v_slot
              and a.session_kind='regular' and a.status='absent'
              and (not v_enabled or a.class_group=v_group)))
      +
      (select count(*) from public.olli_schedule_one_time_sessions o
        left join public.students s on s.id=o.student_id
        where o.academy_id=v_s.academy_id
          and coalesce(s.division,o.guest_division)=v_division
          and (o.student_id is null or (s.status='active' and not s.is_deleted))
          and o.session_date=v_date and o.time_slot=v_slot and o.status<>'cancelled'
          and (not v_enabled or o.class_group=v_group))
      into v_occupancy;
    if v_occupancy>=v_capacity then raise exception 'SLOT_UNAVAILABLE';end if;
    insert into public.olli_schedule_one_time_sessions(
      academy_id,student_id,session_date,time_slot,class_group,session_type,note)
    values(v_s.academy_id,v_s.student_id,v_date,v_slot,v_group,'makeup',
      '학부모 보강 신청')
    returning id into v_session_id;
    insert into public.olli_makeup_request_items(
      request_id,kind,session_date,time_slot,class_group,one_time_session_id)
    values(v_request,'makeup',v_date,v_slot,v_group,v_session_id);
  end loop;
  return jsonb_build_object('ok',true,'request_id',v_request,'unchanged',false);
end;
$fn$;

-- The only staff-facing endpoint. Delivered as a PC page modal, with unread
-- requests stored permanently until a staff member confirms them.
create function public.olli_makeup_staff_notifications(
  p_session_token text,p_academy_id uuid,p_action text default 'list',
  p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_rows jsonb;v_count integer;
begin
  if not private.olli_schedule_can_access(p_session_token,p_academy_id)
  then return jsonb_build_object('ok',false,'code','ACCESS_DENIED');end if;
  if p_action='ack' then
    if p_request_id is null then return jsonb_build_object('ok',false,'code','FORM_INVALID');end if;
    update public.olli_makeup_requests
      set acknowledged_at=now(),
        acknowledged_by_account_id=public.olli_account_id_from_session(p_session_token)
      where id=p_request_id and academy_id=p_academy_id and acknowledged_at is null;
    get diagnostics v_count = row_count;
    return jsonb_build_object('ok',true,'acknowledged',v_count>0);
  elsif p_action='list' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',x.id,'student_name',x.student_name,'created_at',x.created_at,
      'items',x.items) order by x.created_at,x.id),'[]'::jsonb)
    into v_rows
    from (select r.id,s.name as student_name,r.created_at,
      (select coalesce(jsonb_agg(jsonb_build_object(
        'kind',i.kind,'date',i.session_date,'time_slot',i.time_slot,
        'group',i.class_group,'label',
        private.olli_makeup_slot_label(r.academy_id,s.division,i.session_date,i.time_slot))
        order by i.kind,i.session_date,i.time_slot),'[]'::jsonb)
       from public.olli_makeup_request_items i where i.request_id=r.id) as items
      from public.olli_makeup_requests r
      join public.students s on s.id=r.student_id and s.academy_id=r.academy_id
      where r.academy_id=p_academy_id and r.acknowledged_at is null
      order by r.created_at,r.id limit 20) x;
    return jsonb_build_object('ok',true,'requests',v_rows);
  end if;
  return jsonb_build_object('ok',false,'code','FORM_INVALID');
end;
$fn$;

revoke all on function public.olli_makeup_parent_identify(text,text,text,text,text)
  from public,anon,authenticated;
revoke all on function public.olli_makeup_parent_snapshot(text)
  from public,anon,authenticated;
revoke all on function public.olli_makeup_parent_slots(text,date)
  from public,anon,authenticated;
revoke all on function public.olli_makeup_parent_submit(text,uuid,jsonb,jsonb)
  from public,anon,authenticated;
revoke all on function public.olli_makeup_staff_notifications(text,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.olli_makeup_parent_identify(text,text,text,text,text)
  to service_role;
grant execute on function public.olli_makeup_parent_snapshot(text) to service_role;
grant execute on function public.olli_makeup_parent_slots(text,date) to service_role;
grant execute on function public.olli_makeup_parent_submit(text,uuid,jsonb,jsonb)
  to service_role;
grant execute on function public.olli_makeup_staff_notifications(text,uuid,text,uuid)
  to service_role,anon,authenticated;
commit;
