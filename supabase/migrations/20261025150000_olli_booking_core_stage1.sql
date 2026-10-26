-- Olli booking stage 1: tenant-owned settings, slots and durable reservation ledger.
-- Prepared on feature/olli-self-consultation-booking-20261025. Apply only after DB tests.
-- 17:00 is the closing time; 16:30 is the final 30-minute start.
-- Weeks are calendar weeks starting Monday, counting the week containing day 1 as week 1.
begin;

create extension if not exists btree_gist with schema extensions;

create table public.olli_booking_settings (
  academy_id uuid primary key references public.academies(id) on delete cascade,
  weeks smallint[] not null default array[2,3]::smallint[],
  weekdays smallint[] not null default array[1,2,3,4,5]::smallint[],
  start_time time without time zone not null default '11:00',
  end_time time without time zone not null default '17:00',
  slot_minutes smallint not null default 30,
  timezone text not null default 'Asia/Seoul',
  allow_parent_reschedule boolean not null default true,
  allow_parent_cancel boolean not null default true,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  constraint olli_booking_settings_weeks_chk check (
    cardinality(weeks) between 1 and 6 and weeks <@ array[1,2,3,4,5,6]::smallint[]
  ),
  constraint olli_booking_settings_days_chk check (
    cardinality(weekdays) between 1 and 7 and weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
  ),
  constraint olli_booking_settings_hours_chk check (start_time < end_time),
  constraint olli_booking_settings_slot_chk check (slot_minutes in (15,30,60)),
  constraint olli_booking_settings_timezone_chk check (timezone = 'Asia/Seoul')
);

create table public.olli_booking_blocks (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  block_date date not null,
  start_time time without time zone,
  end_time time without time zone,
  reason text,
  created_at timestamptz not null default now(),
  constraint olli_booking_blocks_pair_chk check (
    (start_time is null and end_time is null)
    or (start_time is not null and end_time is not null and start_time < end_time)
  )
);
create index olli_booking_blocks_lookup_idx on public.olli_booking_blocks(academy_id,block_date);

create table public.olli_booking_intakes (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  child_name text not null check (char_length(btrim(child_name)) between 1 and 80),
  status text not null default 'new' check (status in ('new','linked','closed')),
  linked_student_id uuid,
  created_at timestamptz not null default now(),
  unique(id,academy_id),
  constraint olli_booking_intakes_student_academy_fk
    foreign key(linked_student_id,academy_id) references public.students(id,academy_id)
);
create index olli_booking_intakes_academy_idx on public.olli_booking_intakes(academy_id,created_at desc);

create table public.olli_booking_reservations (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  student_id uuid,
  intake_id uuid,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  due_month text,
  rule_key text,
  request_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(academy_id,request_key),
  constraint olli_booking_reservations_target_chk check (
    (student_id is not null and intake_id is null)
    or (student_id is null and intake_id is not null)
  ),
  constraint olli_booking_reservations_time_chk check (start_at < end_at),
  constraint olli_booking_reservations_due_chk check (
    due_month is null or due_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
  ),
  constraint olli_booking_reservations_student_academy_fk
    foreign key(student_id,academy_id) references public.students(id,academy_id),
  constraint olli_booking_reservations_intake_academy_fk
    foreign key(intake_id,academy_id) references public.olli_booking_intakes(id,academy_id),
  constraint olli_booking_reservations_no_overlap
    exclude using gist (
      academy_id with =,
      tstzrange(start_at,end_at,'[)') with &&
    ) where (status='confirmed')
);
create index olli_booking_reservations_academy_time_idx
  on public.olli_booking_reservations(academy_id,start_at desc);
create index olli_booking_reservations_student_idx
  on public.olli_booking_reservations(academy_id,student_id,start_at desc);

-- Parent links are opaque, individually scoped and hashed. The raw bearer link is NEVER stored.
create table public.olli_booking_links (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  student_id uuid,
  intake_id uuid,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint olli_booking_links_target_chk check (
    (student_id is not null and intake_id is null)
    or (student_id is null and intake_id is not null)
  ),
  constraint olli_booking_links_student_fk
    foreign key(student_id,academy_id) references public.students(id,academy_id),
  constraint olli_booking_links_intake_fk
    foreign key(intake_id,academy_id) references public.olli_booking_intakes(id,academy_id)
);
create index olli_booking_links_academy_idx on public.olli_booking_links(academy_id,expires_at);

create table public.olli_booking_events (
  id bigint generated always as identity primary key,
  reservation_id uuid not null references public.olli_booking_reservations(id) on delete cascade,
  academy_id uuid not null references public.academies(id) on delete cascade,
  action text not null check (action in ('created','rescheduled','cancelled')),
  actor text not null check (actor in ('parent','staff','system')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index olli_booking_events_reservation_idx on public.olli_booking_events(reservation_id,created_at);

-- The six tables are private. Only server service_role can read/write their rows.
alter table public.olli_booking_settings enable row level security;
alter table public.olli_booking_blocks enable row level security;
alter table public.olli_booking_intakes enable row level security;
alter table public.olli_booking_reservations enable row level security;
alter table public.olli_booking_links enable row level security;
alter table public.olli_booking_events enable row level security;
revoke all on public.olli_booking_settings,public.olli_booking_blocks,
  public.olli_booking_intakes,public.olli_booking_reservations,
  public.olli_booking_links,public.olli_booking_events from public,anon,authenticated;
grant select,insert,update,delete on public.olli_booking_settings,public.olli_booking_blocks,
  public.olli_booking_intakes,public.olli_booking_reservations,
  public.olli_booking_links,public.olli_booking_events to service_role;
grant usage,select on sequence public.olli_booking_events_id_seq to service_role;

-- Owner-only configuration management, using the existing Olli account session.
create function public.olli_booking_settings_manage(
  p_session_token text, p_academy_id uuid,
  p_action text default 'load', p_data jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  s public.olli_booking_settings%rowtype;
  v_weeks smallint[];
  v_days smallint[];
  v_start time;
  v_end time;
  v_minutes smallint;
begin
  perform olli_consultation_private.require_owner(p_session_token,p_academy_id);
  if p_action not in ('load','save') then
    raise exception 'INVALID_ACTION' using errcode='22023';
  end if;
  insert into public.olli_booking_settings(academy_id) values(p_academy_id)
    on conflict(academy_id) do nothing;
  select * into strict s from public.olli_booking_settings where academy_id=p_academy_id;
  if p_action='save' then
    if p_data is null or jsonb_typeof(p_data) <> 'object'
       or p_data->>'expected_revision' is null then
      raise exception 'EXPECTED_REVISION_REQUIRED' using errcode='22023';
    end if;
    v_weeks := array(select distinct x::smallint from
      jsonb_array_elements_text(coalesce(p_data->'weeks',to_jsonb(s.weeks))) as x order by 1);
    v_days := array(select distinct x::smallint from
      jsonb_array_elements_text(coalesce(p_data->'weekdays',to_jsonb(s.weekdays))) as x order by 1);
    if cardinality(v_weeks) not between 1 and 6
      or not (v_weeks <@ array[1,2,3,4,5,6]::smallint[])
      or cardinality(v_days) not between 1 and 7
      or not (v_days <@ array[1,2,3,4,5,6,7]::smallint[]) then
      raise exception 'INVALID_CALENDAR' using errcode='22023';
    end if;
    if coalesce(p_data->>'start_time',to_char(s.start_time,'HH24:MI')) !~ '^[0-2][0-9]:[0-5][0-9]$'
      or coalesce(p_data->>'end_time',to_char(s.end_time,'HH24:MI')) !~ '^[0-2][0-9]:[0-5][0-9]$' then
      raise exception 'INVALID_TIME' using errcode='22023';
    end if;
    v_start := coalesce((p_data->>'start_time')::time,s.start_time);
    v_end := coalesce((p_data->>'end_time')::time,s.end_time);
    v_minutes := coalesce((p_data->>'slot_minutes')::smallint,s.slot_minutes);
    if v_start>=v_end or v_minutes not in (15,30,60) then
      raise exception 'INVALID_SLOT_SETTINGS' using errcode='22023';
    end if;
    update public.olli_booking_settings cfg set
      weeks=v_weeks,weekdays=v_days,start_time=v_start,end_time=v_end,
      slot_minutes=v_minutes,
      allow_parent_reschedule=coalesce((p_data->>'allow_parent_reschedule')::boolean,s.allow_parent_reschedule),
      allow_parent_cancel=coalesce((p_data->>'allow_parent_cancel')::boolean,s.allow_parent_cancel),
      revision=cfg.revision+1, updated_at=clock_timestamp()
    where cfg.academy_id=p_academy_id
      and cfg.revision=(p_data->>'expected_revision')::bigint;
    if not found then
      raise exception 'SETTINGS_REVISION_CONFLICT' using errcode='40001';
    end if;
    select * into strict s from public.olli_booking_settings where academy_id=p_academy_id;
  end if;
  return jsonb_build_object('ok',true,'settings',to_jsonb(s));
end;
$function$;

-- Private owner-facing slot lookup. No student names or PII are returned.
create function public.olli_booking_list_slots(
  p_session_token text, p_academy_id uuid, p_date date
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
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
  v_week := 1 + ((extract(day from p_date)::int
    + extract(isodow from date_trunc('month',p_date::timestamp)::date)::int - 2) / 7);
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

-- Server-only atomic reservation primitive. The parent/staff API and scoped
-- bearer-link verification are built in stage 2; NEVER expose this RPC to browsers.
create function public.olli_booking_server_reserve(
  p_academy_id uuid, p_student_id uuid, p_intake_id uuid,
  p_start_at timestamptz, p_request_key uuid,
  p_due_month text default null, p_rule_key text default null
) returns uuid
language plpgsql set search_path = ''
as $function$
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
  v_week := 1 + ((extract(day from v_date)::int
    + extract(isodow from date_trunc('month',v_date::timestamp)::date)::int-2)/7);
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

-- PostgreSQL grants EXECUTE to PUBLIC by default; explicitly close it.
revoke all on function public.olli_booking_settings_manage(text,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.olli_booking_list_slots(text,uuid,date) from public,anon,authenticated;
revoke all on function public.olli_booking_server_reserve(uuid,uuid,uuid,timestamptz,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.olli_booking_settings_manage(text,uuid,text,jsonb) to anon,authenticated,service_role;
grant execute on function public.olli_booking_list_slots(text,uuid,date) to anon,authenticated,service_role;
grant execute on function public.olli_booking_server_reserve(uuid,uuid,uuid,timestamptz,uuid,text,text) to service_role;

commit;
