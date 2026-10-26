-- Executed only against the ephemeral CI Postgres 17 container.
do $$
declare
  aid uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  other uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  sid uuid := '11111111-1111-4111-8111-111111111111';
  other_student uuid := '22222222-2222-4222-8222-222222222222';
  day date;
  start_at timestamptz;
  booking uuid;
  duplicate uuid;
  j jsonb;
  intake uuid;
begin
  j:=public.olli_booking_settings_manage('fixture-owner',aid,'load','{}');
  if (j->'settings'->>'start_time')::time <> '11:00'::time
    or (j->'settings'->>'end_time')::time <> '17:00'::time
    or (j->'settings'->>'slot_minutes')::int <> 30
    or (j->'settings'->>'allow_parent_cancel')::boolean <> true
    or (j->'settings'->>'allow_parent_reschedule')::boolean <> true then
    raise exception 'DEFAULTS_WRONG: %',j;
  end if;
  -- Find a future Mon-Fri day in the second or third calendar week.
  select v.d::date into day
  from generate_series((now() at time zone 'Asia/Seoul')::date+1,
    (now() at time zone 'Asia/Seoul')::date+90,interval '1 day') as v(d)
  where extract(isodow from v.d) between 1 and 5
    and 1 + ((extract(day from v.d)::int
      +extract(isodow from date_trunc('month',v.d)::date)::int-2)/7) in (2,3)
  order by v.d limit 1;
  if day is null then raise exception 'NO_TEST_DAY'; end if;
  j:=public.olli_booking_list_slots('fixture-owner',aid,day);
  if jsonb_array_length(j->'slots')<>12 then
    raise exception 'SLOT_COUNT_WRONG: %',j;
  end if;
  if (j->'slots'->0->>'local_start') not like '%T11:00'
    or (j->'slots'->11->>'local_start') not like '%T16:30' then
    raise exception 'SLOT_BOUNDARIES_WRONG: %',j;
  end if;
  begin
    perform public.olli_booking_settings_manage('invalid',aid,'load','{}');
    raise exception 'UNAUTHORIZED_SETTINGS_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.olli_booking_settings_manage('fixture-owner',other,'load','{}');
    raise exception 'CROSS_ACADEMY_SETTINGS_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  start_at:=(day+'11:00'::time) at time zone 'Asia/Seoul';
  booking:=public.olli_booking_server_reserve(
    aid,sid,null,start_at,'33333333-3333-4333-8333-333333333333','2026-10','every_12');
  duplicate:=public.olli_booking_server_reserve(
    aid,sid,null,start_at,'33333333-3333-4333-8333-333333333333','2026-10','every_12');
  if booking<>duplicate then raise exception 'IDEMPOTENCY_BROKEN'; end if;
  begin
    perform public.olli_booking_server_reserve(
      aid,sid,null,start_at,'44444444-4444-4444-8444-444444444444',null,null);
    raise exception 'OVERLAPPING_SLOT_ACCEPTED';
  exception when exclusion_violation then null;
  end;
  begin
    perform public.olli_booking_server_reserve(
      aid,other_student,null,start_at+interval '30 minutes',
      '55555555-5555-4555-8555-555555555555',null,null);
    raise exception 'CROSS_ACADEMY_STUDENT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.olli_booking_server_reserve(
      aid,sid,null,(day+'17:00'::time) at time zone 'Asia/Seoul',
      '66666666-6666-4666-8666-666666666666',null,null);
    raise exception 'CLOSING_TIME_ACCEPTED';
  exception when invalid_parameter_value then null;
  end;
  insert into public.olli_booking_blocks(academy_id,block_date)
    values(aid,day);
  j:=public.olli_booking_list_slots('fixture-owner',aid,day);
  if jsonb_array_length(j->'slots')<>0 then raise exception 'BLOCKED_DAY_VISIBLE'; end if;
  begin
    perform public.olli_booking_server_reserve(
      aid,sid,null,start_at+interval '30 minutes',
      '77777777-7777-4777-8777-777777777777',null,null);
    raise exception 'BLOCKED_DAY_BOOKABLE';
  exception when invalid_parameter_value then null;
  end;
  raise notice 'Stage 1 integration passed for academy %, day %',aid,day;
end $$;
-- Explicit role permission probes are isolated from service_role bypass rights.
set role anon;
do $$
begin
  begin
    perform 1 from public.olli_booking_reservations limit 1;
    raise exception 'DIRECT_ANON_READ_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.olli_booking_server_reserve(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null,now(),
      '99999999-9999-4999-8999-999999999999');
    raise exception 'ANON_SERVER_RESERVE_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select 'PASS' as isolated_booking_schema_integration;
