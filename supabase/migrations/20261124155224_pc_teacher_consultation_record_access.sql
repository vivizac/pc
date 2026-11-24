-- Academy-scoped consultation permission. Existing teacher role and all other
-- owner-only permissions remain unchanged. No existing student records are modified.
begin;
create table olli_consultation_private.teacher_record_access (
  member_id uuid primary key references public.academy_members(id) on delete cascade,
  granted_at timestamptz not null default now()
);
alter table olli_consultation_private.teacher_record_access enable row level security;
revoke all on olli_consultation_private.teacher_record_access from public,anon,authenticated;

create function olli_consultation_private.clear_teacher_record_access() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.role is distinct from old.role or new.status is distinct from old.status
     or new.account_id is distinct from old.account_id or new.academy_id is distinct from old.academy_id then
    delete from olli_consultation_private.teacher_record_access where member_id=old.id;
  end if;
  return new;
end;
$$;
revoke all on function olli_consultation_private.clear_teacher_record_access() from public,anon,authenticated;
create trigger olli_clear_teacher_record_access after update of role,status,account_id,academy_id
on public.academy_members for each row execute function olli_consultation_private.clear_teacher_record_access();

create function olli_consultation_private.require_record_access(p_session_token text,p_academy_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists (
    select 1 from public.academy_members m join public.academies a on a.id=m.academy_id
    where m.account_id=public.olli_account_id_from_session(p_session_token)
      and m.academy_id=p_academy_id and m.status='active' and a.status='active' and a.deleted_at is null
      and (m.role in ('owner','super_admin') or (m.role='teacher' and exists(
        select 1 from olli_consultation_private.teacher_record_access x where x.member_id=m.id)))
  ) then raise exception '상담 기록 관리 권한이 필요합니다.' using errcode='42501'; end if;
end;
$$;
revoke all on function olli_consultation_private.require_record_access(text,uuid) from public,anon,authenticated;

create function public.olli_consultation_record_access(p_session_token text,p_academy_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_account_id uuid := public.olli_account_id_from_session(p_session_token);
  v_owner boolean;
  v_allowed boolean;
  v_ids jsonb := '[]'::jsonb;
begin
  if v_account_id is null then return jsonb_build_object('ok',false,'allowed',false); end if;
  select exists(select 1 from public.academy_members m join public.academies a on a.id=m.academy_id
    where m.account_id=v_account_id and m.academy_id=p_academy_id and m.status='active'
      and a.status='active' and a.deleted_at is null and m.role in ('owner','super_admin')) into v_owner;
  select exists(select 1 from public.academy_members m join public.academies a on a.id=m.academy_id
    join olli_consultation_private.teacher_record_access x on x.member_id=m.id
    where m.account_id=v_account_id and m.academy_id=p_academy_id and m.status='active'
      and a.status='active' and a.deleted_at is null and m.role='teacher') into v_allowed;
  if v_owner then
    select coalesce(jsonb_agg(x.member_id),'[]'::jsonb) into v_ids
    from olli_consultation_private.teacher_record_access x join public.academy_members m on m.id=x.member_id
    where m.academy_id=p_academy_id and m.status='active' and m.role='teacher';
  end if;
  return jsonb_build_object('ok',true,'allowed',v_owner or v_allowed,'member_ids',v_ids);
end;
$$;
revoke all on function public.olli_consultation_record_access(text,uuid) from public,anon,authenticated;
grant execute on function public.olli_consultation_record_access(text,uuid) to anon,authenticated,service_role;

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
  perform olli_consultation_private.require_record_access(p_session_token,p_academy_id);
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

CREATE OR REPLACE FUNCTION public.olli_booking_public_link_manage(p_session_token text, p_academy_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_slug text;
begin
 perform olli_consultation_private.require_record_access(p_session_token,p_academy_id);
 if not exists(select 1 from public.academies a where a.id=p_academy_id
  and a.status='active' and a.access_status='active' and a.deleted_at is null)
 then raise exception 'ACADEMY_INACTIVE' using errcode='42501';end if;
 insert into public.olli_booking_public_academies(academy_id) values(p_academy_id)
 on conflict(academy_id) do nothing;
 select slug into strict v_slug from public.olli_booking_public_academies
 where academy_id=p_academy_id;
 return jsonb_build_object('ok',true,'slug',v_slug);
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_booking_settings_manage(p_session_token text, p_academy_id uuid, p_action text DEFAULT 'load'::text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.olli_booking_settings%rowtype;
  v_weeks smallint[];
  v_days smallint[];
  v_start time;
  v_end time;
  v_minutes smallint;
begin
  perform olli_consultation_private.require_record_access(p_session_token,p_academy_id);
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

CREATE OR REPLACE FUNCTION public.olli_booking_staff_intake_create(p_session_token text, p_academy_id uuid, p_child_name text, p_age_years integer, p_visit_type text, p_start_at timestamp with time zone, p_request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_name text;
 v_existing public.olli_booking_reservations%rowtype;
 v_intake public.olli_booking_intakes%rowtype;
 v_settings public.olli_booking_settings%rowtype;
 v_end timestamptz;
 v_intake_id uuid;
 v_reservation_id uuid;
begin
 perform olli_consultation_private.require_record_access(p_session_token,p_academy_id);
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

CREATE OR REPLACE FUNCTION public.olli_booking_staff_link_manage(p_session_token text, p_academy_id uuid, p_action text, p_student_id uuid DEFAULT NULL::uuid, p_intake_id uuid DEFAULT NULL::uuid, p_token_hash text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_link_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
 perform olli_consultation_private.require_record_access(p_session_token,p_academy_id);
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

CREATE OR REPLACE FUNCTION public.olli_booking_staff_manage(p_session_token text, p_academy_id uuid, p_action text DEFAULT 'list'::text, p_month text DEFAULT NULL::text, p_reservation_id uuid DEFAULT NULL::uuid, p_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_request_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_month date;
 v_rows jsonb;
 v_settings public.olli_booking_settings%rowtype;
 v_record public.olli_booking_reservations%rowtype;
 v_saved public.olli_booking_staff_mutations%rowtype;
 v_end timestamptz;
begin
 perform olli_consultation_private.require_record_access(p_session_token,p_academy_id);
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

CREATE OR REPLACE FUNCTION public.olli_booking_staff_manual_manage(p_session_token text, p_academy_id uuid, p_action text, p_student_id uuid DEFAULT NULL::uuid, p_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_request_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_students jsonb;
  v_id uuid;
  v_existing public.olli_booking_reservations%rowtype;
  v_settings public.olli_booking_settings%rowtype;
  v_day date;
  v_slots jsonb;
  v_end timestamptz;
begin
  perform olli_consultation_private.require_record_access(p_session_token,p_academy_id);
  if p_action='students' then
    if p_student_id is not null or p_start_at is not null or p_request_key is not null then
      raise exception 'INVALID_STUDENT_LIST_REQUEST' using errcode='22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',st.id,'name',st.name,'school',coalesce(to_jsonb(st)->>'school',''),
      'grade',coalesce(to_jsonb(st)->>'grade','')) order by st.name,st.id),'[]'::jsonb)
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
  -- Match the same available slot returned by owner-only lookup.
  -- Evening starts at 17:00, 17:30 and 18:00 always last 30 minutes.
  select (slot->>'end_at')::timestamptz into v_end
  from jsonb_array_elements(v_slots->'slots') slot
  where (slot->>'start_at')::timestamptz=p_start_at;
  if v_end is null then
    raise exception 'SLOT_NOT_AVAILABLE' using errcode='22023';
  end if;
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

CREATE OR REPLACE FUNCTION public.olli_booking_staff_manual_slots(p_session_token text, p_academy_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.olli_booking_settings%rowtype;
  v_slots jsonb := '[]'::jsonb;
begin
  perform olli_consultation_private.require_record_access(p_session_token,p_academy_id);
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
    'end_at',(g.local_start+make_interval(mins=>g.duration_minutes)) at time zone s.timezone,
    'local_start',to_char(g.local_start,'YYYY-MM-DD"T"HH24:MI')
  ) order by g.local_start),'[]'::jsonb)
    into v_slots
  from (
    -- Keep ordinary owner slots, but use explicit half-hour duration at 17:00–18:00.
    -- Removing regular duplicates avoids conflicting durations when settings change.
    select regular.local_start, s.slot_minutes::integer as duration_minutes
    from generate_series(
      p_date+s.start_time,
      p_date+s.end_time-make_interval(mins=>s.slot_minutes),
      make_interval(mins=>s.slot_minutes)) regular(local_start)
    where regular.local_start::time not in ('17:00'::time,'17:30'::time,'18:00'::time)
    union all
    select p_date+evening.start_time,30 as duration_minutes
    from (values ('17:00'::time),('17:30'::time),('18:00'::time)) evening(start_time)
  ) g
  where (g.local_start at time zone s.timezone)>now()
    and not exists (
      select 1 from public.olli_booking_blocks b
      where b.academy_id=p_academy_id and b.block_date=p_date
        and (b.start_time is null
          or (g.local_start::time<b.end_time
            and (g.local_start+make_interval(mins=>g.duration_minutes))::time>b.start_time))
    )
    and not exists (
      select 1 from public.olli_booking_reservations r
      where r.academy_id=p_academy_id and r.status='confirmed'
        and tstzrange(r.start_at,r.end_at,'[)') &&
          tstzrange(g.local_start at time zone s.timezone,
            (g.local_start+make_interval(mins=>g.duration_minutes)) at time zone s.timezone,'[)')
    );
  return jsonb_build_object('ok',true,'slots',v_slots);
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_set_account_membership_role(p_session_token text, p_academy_id uuid, p_member_id uuid, p_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_reviewer_account_id uuid;
  v_target public.academy_members%rowtype;
  v_role text;
  v_consultation boolean;
  v_other_owner_id uuid;
begin
  v_reviewer_account_id := public.olli_account_id_from_session(p_session_token);
  if v_reviewer_account_id is null then
    return jsonb_build_object('ok',false,'message','계정 세션이 만료되었거나 올바르지 않습니다.');
  end if;

  if not exists (
    select 1 from public.academy_members m
    where m.academy_id=p_academy_id
      and m.account_id=v_reviewer_account_id
      and m.role='owner'
      and m.status='active'
  ) then
    return jsonb_build_object('ok',false,'message','현재 계정에는 이 학원의 원장 권한이 없습니다.');
  end if;

  v_consultation := lower(btrim(coalesce(p_role,'')))='teacher_consultation';
  v_role := case when v_consultation then 'teacher' else lower(btrim(coalesce(p_role,''))) end;
  if v_role not in ('manager','teacher') then
    return jsonb_build_object(
      'ok',false,
      'message','일반 권한 변경에서는 owner를 지정할 수 없습니다. 원장 변경은 원장권한 넘기기를 사용해 주세요.'
    );
  end if;

  select m.* into v_target
  from public.academy_members m
  where m.id=p_member_id
    and m.academy_id=p_academy_id
    and m.account_id is not null
  for update;
  if not found then
    return jsonb_build_object('ok',false,'message','변경할 계정 연결을 찾지 못했습니다.');
  end if;

  if v_consultation and v_target.status<>'active' then
    return jsonb_build_object('ok',false,'message','활성화된 선생님만 상담 권한을 부여할 수 있습니다.');
  end if;

  if v_target.role='owner' and v_role<>'owner' then
    select m.id into v_other_owner_id
    from public.academy_members m
    where m.academy_id=p_academy_id
      and m.id<>v_target.id
      and m.role='owner'
      and m.status='active'
    order by m.created_at
    limit 1;
    if v_other_owner_id is null then
      return jsonb_build_object('ok',false,'message','마지막 원장의 권한은 일반 권한 변경으로 낮출 수 없습니다.');
    end if;
  end if;

  update public.academy_members
  set role=v_role,updated_at=now()
  where id=v_target.id
  returning * into v_target;

  if exists (
    select 1 from public.academies a
    where a.id=p_academy_id and a.owner_member_id=v_target.id
  ) then
    update public.academies
    set owner_member_id=v_other_owner_id,updated_at=now()
    where id=p_academy_id;
  end if;

  if v_consultation then
    insert into olli_consultation_private.teacher_record_access(member_id) values(v_target.id) on conflict do nothing;
  else
    delete from olli_consultation_private.teacher_record_access where member_id=v_target.id;
  end if;
  return jsonb_build_object('ok',true,'member_id',v_target.id,'role',case when v_consultation then 'teacher_consultation' else v_target.role end,'status',v_target.status);
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_set_member_role(p_session_token text, p_academy_id uuid, p_member_id uuid, p_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
v_account_id uuid;
v_role text;
v_consultation boolean;
v_member public.academy_members%rowtype;
begin
if p_session_token is null or length(btrim(p_session_token)) = 0 then
return jsonb_build_object(
$key$ok$key$, false,
$key$message$key$, $msg$원장 계정 세션이 없습니다.$msg$
);
end if;

if p_academy_id is null then
return jsonb_build_object(
$key$ok$key$, false,
$key$message$key$, $msg$학원 ID가 없습니다.$msg$
);
end if;

if p_member_id is null then
return jsonb_build_object(
$key$ok$key$, false,
$key$message$key$, $msg$선생님 ID가 없습니다.$msg$
);
end if;

if p_role is null then
return jsonb_build_object(
$key$ok$key$, false,
$key$message$key$, $msg$변경할 권한이 없습니다.$msg$
);
end if;

v_account_id := public.olli_account_id_from_session(p_session_token);

if v_account_id is null then
return jsonb_build_object(
$key$ok$key$, false,
$key$message$key$, $msg$원장 계정 세션이 만료되었거나 올바르지 않습니다.$msg$
);
end if;

if not exists (
select 1
from public.academy_members owner_member
where owner_member.academy_id = p_academy_id
and owner_member.account_id = v_account_id
and owner_member.role = $val$owner$val$
and owner_member.status = $val$active$val$
) then
return jsonb_build_object(
$key$ok$key$, false,
$key$message$key$, $msg$현재 계정에는 이 학원의 원장 권한이 없습니다.$msg$
);
end if;

v_consultation := lower(btrim(p_role))='teacher_consultation';
v_role := case when v_consultation then 'teacher' else lower(btrim(p_role)) end;

if v_role not in ($val$teacher$val$, $val$manager$val$) then
return jsonb_build_object(
$key$ok$key$, false,
$key$message$key$, $msg$권한은 teacher 또는 manager만 사용할 수 있습니다.$msg$
);
end if;

update public.academy_members
set
role = v_role,
updated_at = now()
where id = p_member_id
and academy_id = p_academy_id
and role in ($val$teacher$val$, $val$manager$val$)
and (not v_consultation or (status='active' and account_id is not null))
returning * into v_member;

if not found then
return jsonb_build_object(
$key$ok$key$, false,
$key$message$key$, $msg$현재 학원에서 권한을 변경할 선생님을 찾지 못했습니다.$msg$
);
end if;

if v_consultation then
  insert into olli_consultation_private.teacher_record_access(member_id) values(v_member.id) on conflict do nothing;
else
  delete from olli_consultation_private.teacher_record_access where member_id=v_member.id;
end if;

return jsonb_build_object(
$key$ok$key$, true,
$key$academy_id$key$, v_member.academy_id,
$key$member_id$key$, v_member.id,
$key$member_name$key$, v_member.display_name,
$key$role$key$, case when v_consultation then 'teacher_consultation' else v_member.role end,
$key$status$key$, v_member.status
);
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_get_consultation_observation(p_session_token text, p_academy_id uuid, p_survey_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_row jsonb;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);

  if v_account_id is null then
    return jsonb_build_object('ok', false, 'message', '계정 세션이 만료되었거나 올바르지 않습니다.');
  end if;

  if not exists (
    select 1
    from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and (m.role in ('owner','manager') or (m.role='teacher' and exists(select 1 from olli_consultation_private.teacher_record_access x where x.member_id=m.id)))
  ) then
    return jsonb_build_object('ok', false, 'message', '이 학원의 수업 관찰 기록을 볼 권한이 없습니다.');
  end if;

  if not exists (
    select 1
    from public.consultation_surveys s
    where s.id = p_survey_id
      and s.academy_id = p_academy_id
  ) then
    return jsonb_build_object('ok', false, 'message', '상담 설문을 찾을 수 없습니다.');
  end if;

  select to_jsonb(o)
  into v_row
  from public.consultation_observations o
  where o.consultation_survey_id = p_survey_id
    and o.academy_id = p_academy_id;

  return jsonb_build_object('ok', true, 'row', v_row);
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_save_consultation_observation(p_session_token text, p_academy_id uuid, p_survey_id uuid, p_selected_item_ids jsonb, p_ratings jsonb, p_notes jsonb, p_complete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_allowed_items text[] := array[
    'A1','A2','A3','B1','B2','B3','C1','C2','C3','D1','D2','D3',
    'E1','E2','E3','F1','F2','F3','G1','G2','G3','H1','H2','H3'
  ];
  v_selected_count integer;
  v_status text := case when coalesce(p_complete, false) then 'final_analysis_waiting' else 'observation_in_progress' end;
  v_updated_at timestamptz := now();
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);

  if v_account_id is null then
    return jsonb_build_object('ok', false, 'message', '계정 세션이 만료되었거나 올바르지 않습니다.');
  end if;

  if not exists (
    select 1
    from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and (m.role in ('owner','manager') or (m.role='teacher' and exists(select 1 from olli_consultation_private.teacher_record_access x where x.member_id=m.id)))
  ) then
    return jsonb_build_object('ok', false, 'message', '이 학원의 수업 관찰 기록을 저장할 권한이 없습니다.');
  end if;

  if not exists (
    select 1
    from public.consultation_surveys s
    where s.id = p_survey_id
      and s.academy_id = p_academy_id
  ) then
    return jsonb_build_object('ok', false, 'message', '상담 설문을 찾을 수 없습니다.');
  end if;

  if p_selected_item_ids is null or jsonb_typeof(p_selected_item_ids) <> 'array' then
    return jsonb_build_object('ok', false, 'message', '관찰 항목 형식이 올바르지 않습니다.');
  end if;

  v_selected_count := jsonb_array_length(p_selected_item_ids);
  if v_selected_count < 6 or v_selected_count > 10 then
    return jsonb_build_object('ok', false, 'message', '관찰 항목은 6~10개여야 합니다.');
  end if;

  if (select count(distinct x.value) from jsonb_array_elements_text(p_selected_item_ids) x) <> v_selected_count
     or exists (
       select 1 from jsonb_array_elements_text(p_selected_item_ids) x
       where not (x.value = any(v_allowed_items))
     ) then
    return jsonb_build_object('ok', false, 'message', '관찰 항목 ID를 확인해주세요.');
  end if;

  if p_ratings is null or jsonb_typeof(p_ratings) <> 'object' then
    return jsonb_build_object('ok', false, 'message', '관찰 결과 형식이 올바르지 않습니다.');
  end if;

  if exists (
    select 1
    from jsonb_each(p_ratings) e
    where jsonb_typeof(e.value) <> 'string'
       or not ((e.value #>> '{}') in ('2','1','0','X'))
       or not exists (
         select 1 from jsonb_array_elements_text(p_selected_item_ids) s where s.value = e.key
       )
  ) then
    return jsonb_build_object('ok', false, 'message', '관찰 결과 값이 올바르지 않습니다.');
  end if;

  if coalesce(p_complete, false) and exists (
    select 1
    from jsonb_array_elements_text(p_selected_item_ids) s
    where not (p_ratings ? s.value)
  ) then
    return jsonb_build_object('ok', false, 'message', '관찰 완료 전 모든 항목을 선택해주세요.');
  end if;

  if p_notes is null or jsonb_typeof(p_notes) <> 'object' then
    return jsonb_build_object('ok', false, 'message', '관찰 메모 형식이 올바르지 않습니다.');
  end if;

  if exists (
    select 1
    from jsonb_each(p_notes) e
    where jsonb_typeof(e.value) <> 'string'
       or char_length(e.value #>> '{}') > 500
       or not exists (
         select 1 from jsonb_array_elements_text(p_selected_item_ids) s where s.value = e.key
       )
  ) then
    return jsonb_build_object('ok', false, 'message', '관찰 메모를 확인해주세요.');
  end if;

  insert into public.consultation_observations (
    consultation_survey_id, academy_id, observation_version,
    selected_item_ids, ratings, notes, is_completed, created_at, updated_at
  ) values (
    p_survey_id, p_academy_id, 'OBSERVATION_2026_09',
    p_selected_item_ids, p_ratings, p_notes, coalesce(p_complete, false), v_updated_at, v_updated_at
  )
  on conflict (consultation_survey_id) do update
  set academy_id = excluded.academy_id,
      observation_version = excluded.observation_version,
      selected_item_ids = excluded.selected_item_ids,
      ratings = excluded.ratings,
      notes = excluded.notes,
      is_completed = excluded.is_completed,
      updated_at = excluded.updated_at;

  update public.consultation_surveys
  set status = v_status,
      updated_at = v_updated_at
  where id = p_survey_id
    and academy_id = p_academy_id;

  return jsonb_build_object('ok', true, 'status', v_status, 'updated_at', v_updated_at);
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_get_consultation_final_analysis(p_session_token text, p_academy_id uuid, p_survey_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_role text;
  v_row jsonb;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'message', '계정 세션이 만료되었거나 올바르지 않습니다.');
  end if;

  select m.role into v_role
  from public.academy_members m
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and (m.role in ('owner','manager') or (m.role='teacher' and exists(select 1 from olli_consultation_private.teacher_record_access x where x.member_id=m.id)))
  limit 1;

  if v_role is null then
    return jsonb_build_object('ok', false, 'message', '이 학원의 최종 분석을 볼 권한이 없습니다.');
  end if;

  if not exists (
    select 1 from public.consultation_surveys s
    where s.id = p_survey_id and s.academy_id = p_academy_id
  ) then
    return jsonb_build_object('ok', false, 'message', '상담 설문을 찾을 수 없습니다.');
  end if;

  select to_jsonb(f) into v_row
  from public.consultation_final_analyses f
  where f.consultation_survey_id = p_survey_id
    and f.academy_id = p_academy_id;

  return jsonb_build_object(
    'ok', true,
    'row', v_row,
    'can_save', v_role in ('owner','manager','teacher')
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_save_consultation_final_analysis(p_session_token text, p_academy_id uuid, p_survey_id uuid, p_analysis_version text, p_auto_result jsonb, p_override_result jsonb DEFAULT '{}'::jsonb, p_override_reason text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_reason text := btrim(coalesce(p_override_reason, ''));
  v_updated_at timestamptz := now();
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'message', '계정 세션이 만료되었거나 올바르지 않습니다.');
  end if;

  if not exists (
    select 1 from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and (m.role in ('owner','manager') or (m.role='teacher' and exists(select 1 from olli_consultation_private.teacher_record_access x where x.member_id=m.id)))
  ) then
    return jsonb_build_object('ok', false, 'message', '최종 분석 확정은 원장 또는 관리자만 할 수 있습니다.');
  end if;

  if not exists (
    select 1 from public.consultation_surveys s
    where s.id = p_survey_id and s.academy_id = p_academy_id
  ) then
    return jsonb_build_object('ok', false, 'message', '상담 설문을 찾을 수 없습니다.');
  end if;

  if not exists (
    select 1 from public.consultation_observations o
    where o.consultation_survey_id = p_survey_id
      and o.academy_id = p_academy_id
      and o.is_completed = true
  ) then
    return jsonb_build_object('ok', false, 'message', '체험수업 관찰을 먼저 완료해주세요.');
  end if;

  if coalesce(p_analysis_version, '') <> 'FINAL_2026_09' then
    return jsonb_build_object('ok', false, 'message', '최종 분석 버전을 확인해주세요.');
  end if;

  if p_auto_result is null or jsonb_typeof(p_auto_result) <> 'object'
     or p_auto_result ->> 'version' <> p_analysis_version
     or p_auto_result ->> 'completed' <> 'true' then
    return jsonb_build_object('ok', false, 'message', '자동 분석 결과 형식이 올바르지 않습니다.');
  end if;

  if p_override_result is null or jsonb_typeof(p_override_result) <> 'object' then
    return jsonb_build_object('ok', false, 'message', '판정 수정 형식이 올바르지 않습니다.');
  end if;

  if p_override_result <> '{}'::jsonb then
    if jsonb_object_length(p_override_result) <> 1
       or not (p_override_result ? 'hypothesis_statuses')
       or jsonb_typeof(p_override_result -> 'hypothesis_statuses') <> 'object'
       or exists (
         select 1
         from jsonb_each_text(p_override_result -> 'hypothesis_statuses') e
         where e.key !~ '^([1-9]|1[0-9]|2[0-8])$'
            or e.value not in ('confirmed','partial','hold','needs')
       ) then
      return jsonb_build_object('ok', false, 'message', '판정 수정 값을 확인해주세요.');
    end if;
    if v_reason = '' then
      return jsonb_build_object('ok', false, 'message', '자동 판정을 수정한 이유를 입력해주세요.');
    end if;
  end if;

  if char_length(v_reason) > 1000 then
    return jsonb_build_object('ok', false, 'message', '판정 수정 이유는 1000자 이내로 입력해주세요.');
  end if;

  insert into public.consultation_final_analyses (
    consultation_survey_id, academy_id, analysis_version, auto_result,
    override_result, override_reason, saved_by_account_id, created_at, updated_at
  ) values (
    p_survey_id, p_academy_id, p_analysis_version, p_auto_result,
    p_override_result, v_reason, v_account_id, v_updated_at, v_updated_at
  )
  on conflict (consultation_survey_id) do update
  set academy_id = excluded.academy_id,
      analysis_version = excluded.analysis_version,
      auto_result = excluded.auto_result,
      override_result = excluded.override_result,
      override_reason = excluded.override_reason,
      saved_by_account_id = excluded.saved_by_account_id,
      updated_at = excluded.updated_at;

  update public.consultation_surveys
  set status = 'ready', updated_at = v_updated_at
  where id = p_survey_id and academy_id = p_academy_id;

  return jsonb_build_object('ok', true, 'status', 'ready', 'updated_at', v_updated_at);
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_list_consultation_surveys(p_session_token text, p_academy_id uuid, p_limit integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_account_id uuid;
  v_rows jsonb;
  v_limit integer := greatest(1, least(coalesce(p_limit, 300), 500));
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);

  if v_account_id is null then
    return jsonb_build_object('ok', false, 'message', '계정 세션이 만료되었거나 올바르지 않습니다.', 'rows', jsonb_build_array());
  end if;

  if not exists (
    select 1
    from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and (m.role in ('owner','manager') or (m.role='teacher' and exists(select 1 from olli_consultation_private.teacher_record_access x where x.member_id=m.id)))
  ) then
    return jsonb_build_object('ok', false, 'message', '이 학원의 상담 설문을 볼 권한이 없습니다.', 'rows', jsonb_build_array());
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), jsonb_build_array())
  into v_rows
  from (
    select id, academy_id, student_name, student_age, parent_phone4,
           survey_version, answers, status, created_at, updated_at
    from public.consultation_surveys
    where academy_id = p_academy_id
    order by created_at desc
    limit v_limit
  ) x;

  return jsonb_build_object('ok', true, 'rows', v_rows);
end;
$function$;

CREATE OR REPLACE FUNCTION public.olli_get_consultation_survey_link_token(p_session_token text, p_academy_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_account_id uuid;
  v_token text;
  v_name text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'message', '계정 세션이 만료되었거나 올바르지 않습니다.');
  end if;
  if not exists (
    select 1 from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and (m.role in ('owner','manager') or (m.role='teacher' and exists(select 1 from olli_consultation_private.teacher_record_access x where x.member_id=m.id)))
  ) then
    return jsonb_build_object('ok', false, 'message', '이 학원의 상담 설문 링크를 사용할 권한이 없습니다.');
  end if;
  select a.consultation_survey_token, a.academy_name
    into v_token, v_name
  from public.academies a
  where a.id = p_academy_id
    and coalesce(a.status,'active') <> 'deleted'
    and a.deleted_at is null;
  if v_token is null then
    return jsonb_build_object('ok', false, 'message', '학원 정보를 찾지 못했습니다.');
  end if;
  return jsonb_build_object('ok', true, 'survey_token', v_token, 'academy_name', v_name);
end;
$function$;
commit;
