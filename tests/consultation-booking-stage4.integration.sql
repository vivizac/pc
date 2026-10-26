-- Run only against disposable PostgreSQL 17 after stages 1/2/3/4 migrations.
do $$
declare
 a uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 b uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 s uuid:='11111111-1111-4111-8111-111111111111';
 slug text;
 first_link jsonb; second_link jsonb; result jsonb;
 day date; slot timestamptz; slots jsonb; n integer;
 hash text:=repeat('7',64);
begin
 begin perform public.olli_booking_public_link_manage('invalid',a);
  raise exception 'NON_OWNER_LINK_ALLOWED';exception when insufficient_privilege then null;end;
 begin perform public.olli_booking_public_link_manage('fixture-owner',b);
  raise exception 'CROSS_ACADEMY_LINK_ALLOWED';exception when insufficient_privilege then null;end;
 first_link:=public.olli_booking_public_link_manage('fixture-owner',a);
 second_link:=public.olli_booking_public_link_manage('fixture-owner',a);
 slug:=first_link->>'slug';
 if length(slug)<>36 or first_link<>second_link then raise exception 'ACADEMY_URL_NOT_STABLE';end if;
 update public.students set name='김하늘' where id=s;
 insert into public.olli_consultation_message_contacts(academy_id,student_id,phone,enabled,confirmed)
 values(a,s,'010-2222-4444',true,true);
 for n in 1..80 loop
  day:=(now() at time zone 'Asia/Seoul')::date+n;
  slots:=public.olli_booking_public_slots(slug,day)->'slots';
  if jsonb_array_length(slots)>0 then
    slot:=(slots->0->>'start_at')::timestamptz;exit;
  end if;
 end loop;
 if slot is null then raise exception 'PUBLIC_SLOTS_EMPTY_FOR_80_DAYS';end if;
 -- Incorrect name/phone MUST not create a reservation or session.
 result:=public.olli_booking_public_reserve(slug,'김하늘','01000000000',
  slot,'11111111-1111-4111-8111-111111111117',repeat('1',64),repeat('8',64));
 if result->>'code'<>'MATCH_NOT_FOUND' then raise exception 'WRONG_PHONE_MATCHED %',result;end if;
 result:=public.olli_booking_public_reserve(slug,'김다른','01022224444',
  slot,'11111111-1111-4111-8111-111111111118',repeat('2',64),repeat('8',64));
 if result->>'code'<>'MATCH_NOT_FOUND' then raise exception 'WRONG_NAME_MATCHED %',result;end if;
 if exists(select 1 from public.olli_booking_links where token_hash in (repeat('1',64),repeat('2',64)))
 then raise exception 'FAILED_MATCH_CREATED_SESSION';end if;
 result:=public.olli_booking_public_reserve(slug,'김하늘','01022224444',
  slot,'11111111-1111-4111-8111-111111111119',hash,repeat('8',64));
 if result->>'ok'<>'true' or result->>'existing'<>'false' then
  raise exception 'VALID_NAME_PHONE_DID_NOT_RESERVE: %',result;end if;
 if not exists(select 1 from public.olli_booking_reservations where academy_id=a and student_id=s
  and status='confirmed' and start_at=slot)
 then raise exception 'NO_RESERVATION_SAVED';end if;
 if (public.olli_booking_parent_request(hash,'snapshot')->>'ok')<>'true'
 then raise exception 'MATCHED_SESSION_INVALID';end if;
 -- Existing reservations are reported, not silently duplicated.
 result:=public.olli_booking_public_reserve(slug,'김하늘','01022224444',
  slot,'11111111-1111-4111-8111-111111111121',repeat('9',64),repeat('8',64));
 if result->>'existing'<>'true' then raise exception 'DUPLICATE_BOOKING_NOT_DETECTED';end if;
 insert into public.students(id,academy_id,name) values
  ('11111111-1111-4111-8111-111111111120',a,'김하늘');
 insert into public.olli_consultation_message_contacts
  (academy_id,student_id,phone,enabled,confirmed)
 values(a,'11111111-1111-4111-8111-111111111120','01022224444',true,true);
 result:=public.olli_booking_public_reserve(slug,'김하늘','01022224444',
  slot,'11111111-1111-4111-8111-111111111123',repeat('a',64),repeat('8',64));
 if result->>'code'<>'MATCH_NOT_FOUND' then raise exception 'AMBIGUOUS_MATCH_ALLOWED';end if;
 raise notice 'PASS calendar first, exact name+phone on reserve, wrong/duplicate guard, existing booking';
end $$;
set role anon;
do $$
begin
 begin perform 1 from public.olli_booking_public_attempts limit 1;
  raise exception 'ANON_ACCESS_TO_ATTEMPTS';exception when insufficient_privilege then null;end;
 begin perform public.olli_booking_public_reserve(repeat('1',36),'김하늘','01022224444',
  now()+interval '8 days','11111111-1111-4111-8111-111111111124',repeat('5',64),repeat('6',64));
  raise exception 'ANON_CAN_RESERVE';exception when insufficient_privilege then null;end;
end $$;
reset role;
