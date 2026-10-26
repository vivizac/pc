-- CI-only stage 3 SQL checks, following stage 1 + stage 2 tests.
do $$
declare
 aid uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 other uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 sid uuid:='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 future_day date;
 at_time timestamptz;
 booking uuid;
 r jsonb;
 m text;
begin
 insert into public.students(id,academy_id) values(sid,aid);
 select d::date into future_day from generate_series(
  (now() at time zone 'Asia/Seoul')::date+1,
  (now() at time zone 'Asia/Seoul')::date+90,interval '1 day') d
 where extract(isodow from d) between 1 and 5 and
  1+((extract(day from d)::int+extract(isodow from date_trunc('month',d)::date)::int-2)/7) in (2,3)
  and not exists(select 1 from public.olli_booking_blocks b where b.academy_id=aid and b.block_date=d::date)
 order by d limit 1;
 at_time:=(future_day+'12:00'::time) at time zone 'Asia/Seoul';
 m:=to_char(future_day,'YYYY-MM');
 booking:=public.olli_booking_server_reserve(aid,sid,null,at_time,
 'abbbaaaa-0000-4000-8000-000000000001',null,null);
 begin
  perform public.olli_booking_staff_manage('wrong',aid,'list',m);
  raise exception 'UNAUTHORIZED_LIST_ALLOWED';
 exception when insufficient_privilege then null;end;
 begin
  perform public.olli_booking_staff_manage('fixture-owner',other,'list',m);
  raise exception 'CROSS_ACADEMY_LIST_ALLOWED';
 exception when insufficient_privilege then null;end;
 r:=public.olli_booking_staff_manage('fixture-owner',aid,'list',m);
 if (select count(*) from jsonb_array_elements(r->'appointments') x
     where x->>'id'=booking::text)<>1 then
  raise exception 'APPOINTMENT_NOT_VISIBLE_TO_OWNER: %',r;
 end if;
 if r->'settings'->>'end_time' is null then raise exception 'SETTINGS_ABSENT';end if;
 r:=public.olli_booking_staff_manage('fixture-owner',aid,'reschedule',null,booking,
  at_time+interval '30 minutes','abbbaaaa-0000-4000-8000-000000000002');
 if r->>'replayed'<>'false' then raise exception 'RESCHEDULE_FAILED';end if;
 r:=public.olli_booking_staff_manage('fixture-owner',aid,'reschedule',null,booking,
  at_time+interval '30 minutes','abbbaaaa-0000-4000-8000-000000000002');
 if r->>'replayed'<>'true' then raise exception 'RESCHEDULE_IDEMPOTENCY';end if;
 if (select count(*) from public.olli_booking_events
     where reservation_id=booking and action='rescheduled' and actor='staff')<>1 then
    raise exception 'DUPLICATE_RESCHEDULE_EVENT';end if;
 r:=public.olli_booking_staff_manage('fixture-owner',aid,'cancel',null,booking,null,
   'abbbaaaa-0000-4000-8000-000000000003');
 if r->>'replayed'<>'false' then raise exception 'STAFF_CANCEL_FAILED';end if;
 r:=public.olli_booking_staff_manage('fixture-owner',aid,'cancel',null,booking,null,
   'abbbaaaa-0000-4000-8000-000000000003');
 if r->>'replayed'<>'true' then raise exception 'CANCEL_REPLAY_FAILED';end if;
 if (select count(*) from public.olli_booking_events
    where reservation_id=booking and action='cancelled' and actor='staff')<>1 then
   raise exception 'DUPLICATE_CANCEL_EVENT';end if;
 -- Same student may later reserve a new slot, cancelled booking remains in history.
 if not exists (select 1 from public.olli_booking_reservations
   where id=booking and status='cancelled') then raise exception 'BOOKING_HISTORY_LOST';end if;
 raise notice 'PASS stage3 staff owner operations';
end $$;

set role anon;
do $$
begin
 begin
  perform 1 from public.olli_booking_staff_mutations limit 1;
  raise exception 'ANON_STAFF_MUTATIONS_READABLE';
 exception when insufficient_privilege then null;end;
 begin
  perform public.olli_booking_staff_manage('invalid',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','list','2026-11');
  raise exception 'ANON_STAFF_LIST_WITH_INVALID_SESSION';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
