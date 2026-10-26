-- Olli booking stage 4: ONE stable public URL per academy.
-- Parents choose a time before entering name and stored guardian phone.
-- No SMS or OTP. A short-lived internal session is issued after exact matching.
begin;

create table public.olli_booking_public_academies (
 academy_id uuid primary key references public.academies(id) on delete cascade,
 slug text not null unique default substr(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),1,36)
   check (slug ~ '^[0-9a-f]{36}$'),
 created_at timestamptz not null default now()
);
create table public.olli_booking_public_attempts (
 id bigint generated always as identity primary key,
 academy_id uuid not null references public.academies(id) on delete cascade,
 ip_digest text not null check (ip_digest ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now()
);
create index olli_booking_public_attempts_ip_idx
 on public.olli_booking_public_attempts(academy_id,ip_digest,created_at desc);
create index olli_booking_public_attempts_academy_idx
 on public.olli_booking_public_attempts(academy_id,created_at desc);


alter table public.olli_booking_public_academies enable row level security;
alter table public.olli_booking_public_attempts enable row level security;
revoke all on public.olli_booking_public_academies,public.olli_booking_public_attempts
 from public,anon,authenticated;
grant select,insert,update,delete on public.olli_booking_public_academies,
 public.olli_booking_public_attempts to service_role;
grant usage,select on sequence public.olli_booking_public_attempts_id_seq to service_role;
create function public.olli_booking_public_link_manage(
 p_session_token text,p_academy_id uuid
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_slug text;
begin
 perform olli_consultation_private.require_owner(p_session_token,p_academy_id);
 if not exists(select 1 from public.academies a where a.id=p_academy_id
  and a.status='active' and a.access_status='active' and a.deleted_at is null)
 then raise exception 'ACADEMY_INACTIVE' using errcode='42501';end if;
 insert into public.olli_booking_public_academies(academy_id) values(p_academy_id)
 on conflict(academy_id) do nothing;
 select slug into strict v_slug from public.olli_booking_public_academies
 where academy_id=p_academy_id;
 return jsonb_build_object('ok',true,'slug',v_slug);
end;
$fn$;


-- No guardian login, OTP, SMS, or student data is needed to display calendar slots.
create function public.olli_booking_public_slots(p_slug text,p_date date)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_academy uuid;
begin
 if p_slug is null or p_slug !~ '^[0-9a-f]{36}$'
 then return jsonb_build_object('ok',true,'slots','[]'::jsonb);end if;
 select p.academy_id into v_academy from public.olli_booking_public_academies p
 join public.academies a on a.id=p.academy_id
 where p.slug=p_slug and a.status='active' and a.access_status='active' and a.deleted_at is null;
 if v_academy is null then return jsonb_build_object('ok',true,'slots','[]'::jsonb);end if;
 if p_date is null or p_date < (now() at time zone 'Asia/Seoul')::date
   or p_date > (now() at time zone 'Asia/Seoul')::date+120
 then return jsonb_build_object('ok',true,'slots','[]'::jsonb);end if;
 insert into public.olli_booking_settings(academy_id) values(v_academy)
 on conflict(academy_id) do nothing;
 return jsonb_build_object('ok',true,'slots',olli_booking_private.available_slots(v_academy,p_date));
end;
$fn$;

-- All-or-nothing final reservation with unique student-name + confirmed guardian-phone match.
-- No age/grade. Unknown/ambiguous identity cannot acquire a token or mutate a booking.
create function public.olli_booking_public_reserve(
 p_slug text,p_student_name text,p_guardian_phone text,
 p_start_at timestamptz,p_request_key uuid,p_session_hash text,p_ip_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_academy uuid;v_student uuid;v_matches integer;v_result jsonb;v_existing boolean;
begin
 if p_slug is null or p_slug !~ '^[0-9a-f]{36}$'
   or p_student_name is null or length(btrim(p_student_name)) not between 2 and 60
   or p_guardian_phone is null or p_guardian_phone !~ '^01[016789][0-9]{7,8}$'
   or p_start_at is null or p_request_key is null
   or p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
   or p_ip_digest is null or p_ip_digest !~ '^[0-9a-f]{64}$'
 then return jsonb_build_object('ok',false,'code','FORM_INVALID');end if;
 select p.academy_id into v_academy from public.olli_booking_public_academies p
 join public.academies a on a.id=p.academy_id
 where p.slug=p_slug and a.status='active' and a.access_status='active' and a.deleted_at is null;
 if v_academy is null then return jsonb_build_object('ok',false,'code','MATCH_NOT_FOUND');end if;
 perform pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('booking-public-attempt:'||v_academy::text,0));
 if (select count(*) from public.olli_booking_public_attempts
     where academy_id=v_academy and created_at>now()-interval '1 hour')>=300
   or (select count(*) from public.olli_booking_public_attempts
     where academy_id=v_academy and ip_digest=p_ip_digest
       and created_at>now()-interval '1 hour')>=20
 then return jsonb_build_object('ok',false,'code','TOO_MANY_ATTEMPTS');end if;
 insert into public.olli_booking_public_attempts(academy_id,ip_digest) values(v_academy,p_ip_digest);
 select count(*),(array_agg(s.id))[1] into v_matches,v_student
 from public.students s join public.olli_consultation_message_contacts c
   on c.student_id=s.id and c.academy_id=s.academy_id
 where s.academy_id=v_academy and s.status='active' and s.is_deleted=false
   and regexp_replace(btrim(s.name),'[[:space:]]','','g')
     =regexp_replace(btrim(p_student_name),'[[:space:]]','','g')
   and c.enabled=true and c.confirmed=true
   and regexp_replace(c.phone,'[^0-9]','','g')=p_guardian_phone;
 if v_matches<>1 then return jsonb_build_object('ok',false,'code','MATCH_NOT_FOUND');end if;
 select exists(select 1 from public.olli_booking_reservations
  where academy_id=v_academy and student_id=v_student and status='confirmed')
 into v_existing;
 begin
  insert into public.olli_booking_links(academy_id,student_id,token_hash,expires_at)
  values(v_academy,v_student,p_session_hash,now()+interval '45 minutes');
  if not v_existing then
   v_result:=public.olli_booking_parent_request(
    p_session_hash,'reserve',null,p_start_at,p_request_key,null);
  end if;
 exception
  when unique_violation or exclusion_violation then
    return jsonb_build_object('ok',false,'code','SLOT_UNAVAILABLE');
  when invalid_parameter_value then
    return jsonb_build_object('ok',false,'code','BOOKING_INVALID');
  when insufficient_privilege then
    return jsonb_build_object('ok',false,'code','ACCESS_DENIED');
 end;
 return jsonb_build_object('ok',true,'existing',v_existing);
end;
$fn$;

revoke all on function public.olli_booking_public_link_manage(text,uuid)
 from public,anon,authenticated;
revoke all on function public.olli_booking_public_slots(text,date)
 from public,anon,authenticated;
revoke all on function public.olli_booking_public_reserve(text,text,text,timestamptz,uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.olli_booking_public_link_manage(text,uuid) to service_role;
grant execute on function public.olli_booking_public_slots(text,date) to service_role;
grant execute on function public.olli_booking_public_reserve(text,text,text,timestamptz,uuid,text,text)
 to service_role;
commit;
