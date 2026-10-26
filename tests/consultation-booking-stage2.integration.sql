-- Isolated stage 2 integration tests; run after stage 1 integration.
do $$
declare
 aid uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 other uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 sid uuid:='11111111-1111-4111-8111-111111111111';
 sid2 uuid:='33333333-3333-4333-8333-333333333333';
 hid text:=repeat('a',64);
 hid2 text:=repeat('b',64);
 day date;
 v_start_at timestamptz;
 next_at timestamptz;
 result jsonb;
 res_id uuid;
 res2 uuid;
 link_id uuid;
begin
 -- Stage 1 fixture leaves a booked blocked day; remove it in disposable CI only.
 delete from public.olli_booking_reservations where academy_id=aid;
 insert into public.students(id,academy_id) values(sid2,aid);
 select d::date into day from generate_series(
  (now() at time zone 'Asia/Seoul')::date+1,
  (now() at time zone 'Asia/Seoul')::date+90,interval '1 day') as d
 where extract(isodow from d) between 1 and 5
   and 1+((extract(day from d)::int+
     extract(isodow from date_trunc('month',d)::date)::int-2)/7) in(2,3)
   and not exists(select 1 from public.olli_booking_blocks b where b.academy_id=aid and b.block_date=d::date)
 order by d limit 1;
 if day is null then raise exception 'TEST_DAY_MISSING'; end if;
 v_start_at:=(day+'11:00'::time) at time zone 'Asia/Seoul';
 next_at:=v_start_at+interval '30 min';
 begin
  perform public.olli_booking_staff_link_manage('wrong',aid,'issue',sid,null,hid,now()+interval '7 days',null);
  raise exception 'OWNER_GATE_FAILED';
 exception when insufficient_privilege then null;end;
 begin
  perform public.olli_booking_staff_link_manage('fixture-owner',aid,'issue',
    '22222222-2222-4222-8222-222222222222',null,hid,now()+interval '7 days',null);
  raise exception 'CROSS_ACADEMY_LINK';
 exception when invalid_parameter_value then null;end;
 result:=public.olli_booking_staff_link_manage('fixture-owner',aid,'issue',
   sid,null,hid,now()+interval '7 days',null);
 link_id:=(result->>'link_id')::uuid;
 if link_id is null then raise exception 'LINK_ISSUE_FAILED'; end if;
 begin
  perform public.olli_booking_parent_request(repeat('c',64),'snapshot');
  raise exception 'GUESSABLE_LINK_ACCEPTED';
 exception when insufficient_privilege then null;end;
 result:=public.olli_booking_parent_request(hid,'snapshot');
 if result->'reservation'<>'null'::jsonb then raise exception 'SNAPSHOT_NOT_EMPTY';end if;
 result:=public.olli_booking_parent_request(hid,'slots',day);
 if jsonb_array_length(result->'slots')<>12 then raise exception 'PARENT_SLOTS_INVALID %',result;end if;
 result:=public.olli_booking_parent_request(hid,'reserve',null,v_start_at,
   'aaaaaaaa-0000-4000-8000-000000000001'::uuid);
 res_id:=(result->>'reservation_id')::uuid;
 if res_id is null then raise exception 'RESERVE_FAILED';end if;
 result:=public.olli_booking_parent_request(hid,'reserve',null,v_start_at,
   'aaaaaaaa-0000-4000-8000-000000000001'::uuid);
 if result->>'replayed'<>'true' or (result->>'reservation_id')::uuid<>res_id then
   raise exception 'RETRY_NOT_IDEMPOTENT';end if;
 begin
  perform public.olli_booking_parent_request(hid,'reserve',null,next_at,
   'aaaaaaaa-0000-4000-8000-000000000001'::uuid);
  raise exception 'MUTATION_KEY_REUSE';
 exception when invalid_parameter_value then null;end;
 begin
  perform public.olli_booking_parent_request(hid,'reserve',null,next_at,
   'aaaaaaaa-0000-4000-8000-000000000002'::uuid);
  raise exception 'DUPLICATE_LIVE_RESERVATION';
 exception when unique_violation then null;end;

 -- Another student claims 11:30. Moving there must fail and retain 11:00.
 res2:=public.olli_booking_server_reserve(aid,sid2,null,next_at,
   'aaaaaaaa-0000-4000-8000-000000000003',null,null);
 begin
  perform public.olli_booking_parent_request(hid,'reschedule',null,next_at,
   'aaaaaaaa-0000-4000-8000-000000000004',res_id);
  raise exception 'RESCHEDULE_OVERLAP_ACCEPTED';
 exception when exclusion_violation then null;end;
 if not exists(select 1 from public.olli_booking_reservations b
   where id=res_id and status='confirmed' and b.start_at=v_start_at) then
   raise exception 'FAILED_RESCHEDULE_LOST_BOOKING';end if;
 -- Different destination can be moved atomically.
 result:=public.olli_booking_parent_request(hid,'reschedule',null,
   v_start_at+interval '60 minutes','aaaaaaaa-0000-4000-8000-000000000005',res_id);
 if (result->>'reservation_id')::uuid<>res_id then raise exception 'RESCHEDULE_CHANGED_ID';end if;
 if (select count(*) from public.olli_booking_events where reservation_id=res_id and action='rescheduled')<>1
   then raise exception 'RESCHEDULE_HISTORY_MISSING';end if;

 result:=public.olli_booking_parent_request(hid,'cancel',null,null,
  'aaaaaaaa-0000-4000-8000-000000000006',res_id);
 if result->>'status'<>'cancelled' then raise exception 'CANCEL_FAILED';end if;
 result:=public.olli_booking_parent_request(hid,'cancel',null,null,
  'aaaaaaaa-0000-4000-8000-000000000006',res_id);
 if result->>'replayed'<>'true' then raise exception 'CANCEL_RETRY_FAILED';end if;
 if (select count(*) from public.olli_booking_events where reservation_id=res_id and action='cancelled')<>1
   then raise exception 'CANCEL_HISTORY_DUPLICATED';end if;

 -- Verify settings switches really gate parent mutation actions.
 result:=public.olli_booking_parent_request(hid,'reserve',null,v_start_at,
  'aaaaaaaa-0000-4000-8000-000000000007');
 res_id:=(result->>'reservation_id')::uuid;
 update public.olli_booking_settings set
  allow_parent_cancel=false,allow_parent_reschedule=false where academy_id=aid;
 begin
  perform public.olli_booking_parent_request(hid,'cancel',null,null,
    'aaaaaaaa-0000-4000-8000-000000000008',res_id);
  raise exception 'DISABLED_CANCEL_ALLOWED';
 exception when insufficient_privilege then null;end;
 begin
  perform public.olli_booking_parent_request(hid,'reschedule',null,
    v_start_at+interval '60 minutes',
    'aaaaaaaa-0000-4000-8000-000000000009',res_id);
  raise exception 'DISABLED_RESCHEDULE_ALLOWED';
 exception when insufficient_privilege then null;end;
 update public.olli_booking_settings set
  allow_parent_cancel=true,allow_parent_reschedule=true where academy_id=aid;
 result:=public.olli_booking_staff_link_manage('fixture-owner',aid,'revoke',
   null,null,null,null,link_id);
 begin
  perform public.olli_booking_parent_request(hid,'snapshot');
  raise exception 'REVOKED_LINK_ACCEPTED';
 exception when insufficient_privilege then null;end;

 -- Expired link must be rejected. Existing booking remains untouched.
 result:=public.olli_booking_staff_link_manage('fixture-owner',aid,'issue',
   sid,null,hid2,now()+interval '7 days',null);
 update public.olli_booking_links set expires_at=now()-interval '1 minute'
   where id=(result->>'link_id')::uuid;
 begin
  perform public.olli_booking_parent_request(hid2,'snapshot');
  raise exception 'EXPIRED_LINK_ACCEPTED';
 exception when insufficient_privilege then null;end;
 if not exists(select 1 from public.olli_booking_reservations where id=res_id and status='confirmed')
  then raise exception 'EXPIRED_LINK_CHANGED_BOOKING'; end if;
 raise notice 'STAGE2 SQL PASS: %, target %, events verified',day,sid;
end $$;

-- Verify untrusted database roles cannot call privileged functions or read private tables.
set role anon;
do $$
begin
 begin
  perform 1 from public.olli_booking_links limit 1;
  raise exception 'ANON_LINK_READ_ALLOWED';
 exception when insufficient_privilege then null;end;
 begin
  perform public.olli_booking_parent_request(repeat('a',64),'snapshot');
  raise exception 'ANON_PARENT_RPC_ALLOWED';
 exception when insufficient_privilege then null;end;
 begin
  perform public.olli_booking_staff_link_manage('fixture-owner',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','revoke',null,null,null,null,
    '11111111-1111-4111-8111-111111111111');
  raise exception 'ANON_STAFF_RPC_ALLOWED';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'STAGE2 PASS' as result;
