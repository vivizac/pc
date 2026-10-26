-- Stage5: existing guardian can find ONLY their confirmed consultation;
-- wrong or ambiguous identity must never create a session.
do $$
declare
 a uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 s uuid:='77777777-7777-4777-8777-777777777777';
 slug text;
 goodhash text:=repeat('b',64);
 result jsonb;
begin
 select p.slug into strict slug from public.olli_booking_public_academies p
 where p.academy_id=a;
 -- Stage4 intentionally inserted an ambiguous duplicate; disable only fixture contact.
 update public.olli_consultation_message_contacts
 set enabled=false where student_id='11111111-1111-4111-8111-111111111120'::uuid;
 result:=public.olli_booking_public_lookup(slug,'김하늘','01000000000',repeat('1',64),repeat('c',64));
 if result->>'code'<>'MATCH_NOT_FOUND'
 then raise exception 'INVALID_CONTACT_MATCHED %',result;end if;
 result:=public.olli_booking_public_lookup(slug,'김하늘','01022224444',goodhash,repeat('c',64));
 if result->>'ok'<>'true' then raise exception 'EXISTING_BOOKING_NOT_FOUND: %',result;end if;
 if not exists(select 1 from public.olli_booking_links l
   where l.academy_id=a and l.student_id=s and l.token_hash=goodhash)
 then raise exception 'LOOKUP_DID_NOT_CREATE_SCOPED_SESSION';end if;
 if (public.olli_booking_parent_request(goodhash,'snapshot')->>'ok')<>'true'
 then raise exception 'LOOKUP_SESSION_CANNOT_READ_OWN_RESERVATION';end if;
 -- Another student without a reservation cannot obtain a session to cancel anyone.
 insert into public.students(id,academy_id,name)
 values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',a,'새로운아이');
 insert into public.olli_consultation_message_contacts(academy_id,student_id,phone,enabled,confirmed)
 values(a,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','01022223333',true,true);
 result:=public.olli_booking_public_lookup(slug,'새로운아이','01022223333',repeat('d',64),repeat('c',64));
 if result->>'code'<>'BOOKING_NOT_FOUND' then raise exception 'LOOKUP_WITHOUT_BOOKING_ALLOWED %',result;end if;
 if exists(select 1 from public.olli_booking_links where token_hash=repeat('d',64))
 then raise exception 'LOOKUP_WITHOUT_BOOKING_CREATED_TOKEN';end if;
 raise notice 'PASS existing booking lookup, wrong guardian, no reservation, scoped session';
end $$;
set role anon;
do $$
begin
 begin
  perform public.olli_booking_public_lookup(repeat('1',36),'김하늘','01022224444',repeat('a',64),repeat('a',64));
  raise exception 'ANON_ALLOWED_TO_LOOKUP_PRIVATE_RESERVATION';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
