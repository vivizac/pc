-- Run only against disposable PG17 after stage 1/2/3/4 migrations.
do $$
declare
 v_a uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 v_b uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 v_s uuid:='11111111-1111-4111-8111-111111111111';
 v_slug text;
 v_first jsonb;
 v_second jsonb;
 v_unauthorized jsonb;
 v_verified jsonb;
 v_hash text:=repeat('7',64);
 v_aid text;
begin
 begin
  perform public.olli_booking_public_link_manage('invalid',v_a);
  raise exception 'NON_OWNER_PUBLIC_LINK_ALLOWED';
 exception when insufficient_privilege then null;end;
 begin
  perform public.olli_booking_public_link_manage('fixture-owner',v_b);
  raise exception 'WRONG_ACADEMY_PUBLIC_LINK_ALLOWED';
 exception when insufficient_privilege then null;end;
 v_first:=public.olli_booking_public_link_manage('fixture-owner',v_a);
 v_second:=public.olli_booking_public_link_manage('fixture-owner',v_a);
 v_slug:=v_first->>'slug';
 if length(v_slug)<>36 or v_first<>v_second then
   raise exception 'ACADEMY_LINK_NOT_STABLE: % %',v_first,v_second;
 end if;
 update public.students set name='김하늘' where id=v_s;
 insert into public.olli_consultation_message_contacts
  (academy_id,student_id,phone,enabled,confirmed)
 values(v_a,v_s,'010-2222-4444',true,true);
 -- Grade, birth year and age are intentionally entirely absent from this call.
 v_unauthorized:=public.olli_booking_public_begin(
   v_slug,'김하늘','01000000000','11111111-1111-4111-8111-111111111117',
    repeat('1',64),repeat('8',64));
 if v_unauthorized->>'send_to' is not null then
  raise exception 'WRONG_GUARDIAN_PHONE_MATCHED';
 end if;
 v_first:=public.olli_booking_public_begin(
   v_slug,'김하늘','01022224444','11111111-1111-4111-8111-111111111118',
    repeat('2',64),repeat('8',64));
 if v_first->>'send_to' <> '01022224444' then
  raise exception 'NAME_AND_PHONE_MATCH_FAILED: %',v_first;
 end if;
 -- Same contact but wrong student name cannot receive SMS.
 v_second:=public.olli_booking_public_begin(
   v_slug,'김다른','01022224444','11111111-1111-4111-8111-111111111119',
    repeat('2',64),repeat('8',64));
 if v_second->>'send_to' is not null then
  raise exception 'WRONG_STUDENT_NAME_MATCHED';
 end if;
 v_verified:=public.olli_booking_public_verify(
    '11111111-1111-4111-8111-111111111118',repeat('9',64),v_hash);
 if v_verified->>'ok'<>'false' then raise exception 'WRONG_OTP_ALLOWED';end if;
 v_verified:=public.olli_booking_public_verify(
    '11111111-1111-4111-8111-111111111118',repeat('2',64),v_hash);
 if v_verified->>'ok'<>'true' then raise exception 'CORRECT_OTP_REJECTED';end if;
 v_verified:=public.olli_booking_public_verify(
    '11111111-1111-4111-8111-111111111118',repeat('2',64),v_hash);
 if v_verified->>'ok'<>'false' then raise exception 'OTP_REPLAY_ALLOWED';end if;
 if not exists(select 1 from public.olli_booking_links
    where academy_id=v_a and student_id=v_s and token_hash=v_hash
     and expires_at<=now()+interval '46 minutes') then
  raise exception 'SCOPE_45_MIN_TOKEN_ABSENT';end if;
 if (public.olli_booking_parent_request(v_hash,'snapshot')->>'ok')<>'true' then
   raise exception 'VERIFIED_SESSION_CANNOT_BOOK';end if;
 -- Multiple identical names on the same confirmed phone must never be chosen.
 insert into public.students(id,academy_id,name)
 values('11111111-1111-4111-8111-111111111120',v_a,'김하늘');
 insert into public.olli_consultation_message_contacts
  (academy_id,student_id,phone,enabled,confirmed)
 values(v_a,'11111111-1111-4111-8111-111111111120','01022224444',true,true);
 v_second:=public.olli_booking_public_begin(
   v_slug,'김하늘','01022224444','11111111-1111-4111-8111-111111111121',
    repeat('2',64),repeat('9',64));
 if v_second->>'send_to' is not null then
  raise exception 'DUPLICATE_STUDENT_AND_GUARDIAN_NOT_REJECTED';
 end if;
 -- Only a successfully matched target's verified phone may receive SMS.
 raise notice 'PASS one-academy-link, exact name+confirmed phone, duplicate guard, OTP';
end $$;
set role anon;
do $$
begin
 begin
  perform 1 from public.olli_booking_public_challenges limit 1;
  raise exception 'PUBLIC_OTP_TABLE_EXPOSED_TO_ANON';
 exception when insufficient_privilege then null;end;
 begin
  perform public.olli_booking_public_begin(repeat('1',36),'김하늘',
    '01022224444','11111111-1111-4111-8111-111111111150',repeat('5',64),repeat('6',64));
  raise exception 'ANONYMOUS_BYPASSED_BOOKING_API';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
