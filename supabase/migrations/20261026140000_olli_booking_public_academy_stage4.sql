-- Olli booking stage 4: ONE stable public URL per academy.
-- A guardian self-identifies using the student's name and confirmed
-- guardian phone stored in Olli. SMS verification mints a SHORT-LIVED internal
-- student session, NEVER a student-specific public URL.
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

create table public.olli_booking_public_challenges (
 id uuid primary key,
 academy_id uuid not null references public.academies(id) on delete cascade,
 student_id uuid not null,
 contact_revision bigint not null,
 code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
 attempts integer not null default 0 check (attempts between 0 and 5),
 expires_at timestamptz not null default(now()+interval '5 minutes'),
 consumed_at timestamptz,
 created_at timestamptz not null default now(),
 constraint olli_booking_public_challenge_student_fk
 foreign key(student_id,academy_id) references public.students(id,academy_id)
);
create index olli_booking_public_challenges_student_idx
 on public.olli_booking_public_challenges(academy_id,student_id,created_at desc);
alter table public.olli_booking_public_academies enable row level security;
alter table public.olli_booking_public_attempts enable row level security;
alter table public.olli_booking_public_challenges enable row level security;
revoke all on public.olli_booking_public_academies,
 public.olli_booking_public_attempts,public.olli_booking_public_challenges
 from public,anon,authenticated;
grant select,insert,update,delete on public.olli_booking_public_academies,
 public.olli_booking_public_attempts,public.olli_booking_public_challenges
 to service_role;
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

-- All failed lookups return the exact same accepted result to the API; no
-- student names, IDs, guardian phones or existence evidence go to the browser.
-- Service-role only; the server must enforce captcha/edge abuse controls too.
create function public.olli_booking_public_begin(
 p_slug text,p_student_name text,
 p_guardian_phone text,p_challenge_id uuid,p_code_hash text,p_ip_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare
 v_academy uuid;
 v_student uuid;
 v_phone text;
 v_revision bigint;
 v_matches integer;
 v_response jsonb:=jsonb_build_object('ok',true,'send_to',null);
begin
 if p_slug is null or p_slug !~ '^[0-9a-f]{36}$'
  or p_student_name is null or length(btrim(p_student_name)) not between 2 and 60
  or p_guardian_phone is null or p_guardian_phone !~ '^01[016789][0-9]{7,8}$'
  or p_challenge_id is null or p_code_hash !~ '^[0-9a-f]{64}$'
  or p_ip_digest !~ '^[0-9a-f]{64}$'
 then return v_response;end if;

 select p.academy_id into v_academy from public.olli_booking_public_academies p
 join public.academies a on a.id=p.academy_id
 where p.slug=p_slug and a.status='active' and a.access_status='active'
   and a.deleted_at is null;
 if v_academy is null then return v_response;end if;
 -- Transactional global and per-IP throttles count even failed name matches.
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('booking-public-begin:'||v_academy::text,0));
 if (select count(*) from public.olli_booking_public_attempts
     where academy_id=v_academy and created_at>now()-interval '1 hour')>=300
    or (select count(*) from public.olli_booking_public_attempts
     where academy_id=v_academy and ip_digest=p_ip_digest
       and created_at>now()-interval '1 hour')>=20 then
  return v_response;
 end if;
 insert into public.olli_booking_public_attempts(academy_id,ip_digest)
 values(v_academy,p_ip_digest);

 -- No fuzzy matching, no client-supplied student ID, no name-only fallback.
 -- Elementary may use school_entry_year only if the grade field is absent;
 -- kindergarten may use birth_year only if age is absent.
 select count(*),(array_agg(s.id))[1],(array_agg(c.phone))[1],(array_agg(c.revision))[1]
 into v_matches,v_student,v_phone,v_revision
 from public.students s
 join public.olli_consultation_message_contacts c
   on c.student_id=s.id and c.academy_id=s.academy_id
 where s.academy_id=v_academy
   and s.status='active' and s.is_deleted=false
   and regexp_replace(btrim(s.name),'[[:space:]]','','g')
      =regexp_replace(btrim(p_student_name),'[[:space:]]','','g')
   and c.enabled=true and c.confirmed=true
   and regexp_replace(c.phone,'[^0-9]','','g')=p_guardian_phone;
 if v_matches<>1 then return v_response;end if;
 if (select count(*) from public.olli_booking_public_challenges
      where academy_id=v_academy and student_id=v_student
        and created_at>now()-interval '15 minutes')>=3 then
  return v_response;
 end if;
 insert into public.olli_booking_public_challenges(
   id,academy_id,student_id,contact_revision,code_hash)
 values(p_challenge_id,v_academy,v_student,v_revision,p_code_hash);
 -- This field is returned ONLY to the server's service-role RPC caller.
 -- The HTTP handler strips it before constructing its generic response.
 return jsonb_build_object('ok',true,'send_to',
   regexp_replace(v_phone,'[^0-9]','','g'),'academy_id',v_academy);
end;
$fn$;

create function public.olli_booking_public_verify(
 p_challenge_id uuid,p_code_hash text,p_session_hash text
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare
 v public.olli_booking_public_challenges%rowtype;
 v_link_id uuid;
begin
 if p_challenge_id is null or p_code_hash is null or
    p_code_hash !~ '^[0-9a-f]{64}$' or
    p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
 then return jsonb_build_object('ok',false);end if;
 select * into v from public.olli_booking_public_challenges
 where id=p_challenge_id for update;
 if not found or v.consumed_at is not null or v.expires_at<=now()
    or v.attempts>=5 then return jsonb_build_object('ok',false);end if;
 update public.olli_booking_public_challenges
    set attempts=attempts+1 where id=v.id;
 if v.code_hash<>p_code_hash then return jsonb_build_object('ok',false);end if;
 -- Guard against owner changing/revoking the confirmed contact mid-challenge.
 if not exists(
   select 1 from public.olli_consultation_message_contacts c
   join public.students s on s.id=c.student_id and s.academy_id=c.academy_id
   where c.academy_id=v.academy_id and c.student_id=v.student_id
    and c.revision=v.contact_revision and c.enabled and c.confirmed
    and s.status='active' and s.is_deleted=false
 ) then return jsonb_build_object('ok',false);end if;
 update public.olli_booking_public_challenges
    set consumed_at=clock_timestamp() where id=v.id;
 -- Existing parent_request RPC recognizes these internal, hashed, scoped links.
 insert into public.olli_booking_links(
   academy_id,student_id,token_hash,expires_at)
 values(v.academy_id,v.student_id,p_session_hash,now()+interval '45 minutes')
 returning id into v_link_id;
 return jsonb_build_object('ok',true,'expires_in_seconds',2700);
end;
$fn$;

revoke all on function public.olli_booking_public_link_manage(text,uuid)
 from public,anon,authenticated;
revoke all on function public.olli_booking_public_begin(text,text,text,uuid,text,text)
 from public,anon,authenticated;
revoke all on function public.olli_booking_public_verify(uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.olli_booking_public_link_manage(text,uuid) to service_role;
grant execute on function public.olli_booking_public_begin(text,text,text,uuid,text,text) to service_role;
grant execute on function public.olli_booking_public_verify(uuid,text,text) to service_role;
commit;
