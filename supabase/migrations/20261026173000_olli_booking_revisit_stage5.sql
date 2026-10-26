-- Stage 5: revisit an existing parent reservation by exact student name + confirmed
-- guardian mobile. No OTP, no new reservation, no new tables. Service role only.
begin;
create function public.olli_booking_public_lookup(
 p_slug text,p_student_name text,p_guardian_phone text,
 p_session_hash text,p_ip_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_academy uuid;v_student uuid;v_matches integer;
begin
 if p_slug is null or p_slug !~ '^[0-9a-f]{36}$'
   or p_student_name is null or length(btrim(p_student_name)) not between 2 and 60
   or p_guardian_phone is null or p_guardian_phone !~ '^01[016789][0-9]{7,8}$'
   or p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
   or p_ip_digest is null or p_ip_digest !~ '^[0-9a-f]{64}$'
 then return jsonb_build_object('ok',false,'code','FORM_INVALID'); end if;
 select p.academy_id into v_academy
 from public.olli_booking_public_academies p
 join public.academies a on a.id=p.academy_id
 where p.slug=p_slug and a.status='active' and a.access_status='active'
   and a.deleted_at is null;
 if v_academy is null
 then return jsonb_build_object('ok',false,'code','MATCH_NOT_FOUND'); end if;
 -- Same per-IP and academy rate-limit bucket as public Reserve.
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('booking-public-attempt:'||v_academy::text,0));
 if (select count(*) from public.olli_booking_public_attempts
      where academy_id=v_academy and created_at>now()-interval '1 hour')>=300
  or (select count(*) from public.olli_booking_public_attempts
      where academy_id=v_academy and ip_digest=p_ip_digest
        and created_at>now()-interval '1 hour')>=20
 then return jsonb_build_object('ok',false,'code','TOO_MANY_ATTEMPTS'); end if;
 insert into public.olli_booking_public_attempts(academy_id,ip_digest)
 values(v_academy,p_ip_digest);
 select count(*),(array_agg(s.id))[1] into v_matches,v_student
 from public.students s join public.olli_consultation_message_contacts c
   on c.student_id=s.id and c.academy_id=s.academy_id
 where s.academy_id=v_academy and s.status='active' and s.is_deleted=false
   and regexp_replace(btrim(s.name),'[[:space:]]','','g')
       =regexp_replace(btrim(p_student_name),'[[:space:]]','','g')
   and c.enabled=true and c.confirmed=true
   and regexp_replace(c.phone,'[^0-9]','','g')=p_guardian_phone;
 if v_matches<>1 then return jsonb_build_object('ok',false,'code','MATCH_NOT_FOUND'); end if;
 if not exists(select 1 from public.olli_booking_reservations r
   where r.academy_id=v_academy and r.student_id=v_student and r.status='confirmed')
 then return jsonb_build_object('ok',false,'code','BOOKING_NOT_FOUND'); end if;
 insert into public.olli_booking_links(academy_id,student_id,token_hash,expires_at)
 values(v_academy,v_student,p_session_hash,now()+interval '45 minutes');
 return jsonb_build_object('ok',true);
end;
$fn$;
revoke all on function public.olli_booking_public_lookup(text,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.olli_booking_public_lookup(text,text,text,text,text)
 to service_role;
commit;
