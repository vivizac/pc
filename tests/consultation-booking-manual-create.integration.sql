-- Isolated PostgreSQL test, after booking stages 1-3; no production data.
do $$
declare
  aid uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  other uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  student uuid:='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  second_student uuid:='a1a1a1a1-aaaa-4aaa-8aaa-a1a1a1a1a1a1';
  outside_student uuid:='a2a2a2a2-aaaa-4aaa-8aaa-a2a2a2a2a2a2';
  outside_start timestamptz;
  ts timestamptz;
  v_booking_id uuid;
  reply jsonb;
begin
  insert into public.students(id,academy_id,name)
    values(student,aid,'수동등록 테스트'),(second_student,aid,'두번째 테스트'),
          (outside_student,aid,'주차제한 밖 예약');
  reply:=public.olli_booking_staff_manual_manage('fixture-owner',aid,'students');
  if not exists(select 1 from jsonb_array_elements(reply->'students') x where x->>'id'=student::text)
    or exists(select 1 from jsonb_array_elements(reply->'students') x where x->>'id'='22222222-2222-4222-8222-222222222222') then
    raise exception 'STUDENT_LIST_TENANT_FILTER_FAILED';
  end if;
  begin
    perform public.olli_booking_staff_manual_manage('bad-token',aid,'students');
    raise exception 'UNAUTHORIZED_STUDENTS_VISIBLE';
  exception when insufficient_privilege then null; end;
  begin
    perform public.olli_booking_staff_manual_manage('fixture-owner',other,'students');
    raise exception 'CROSS_TENANT_STUDENTS_VISIBLE';
  exception when insufficient_privilege then null; end;
  select (slot->>'start_at')::timestamptz into ts
    from generate_series((now() at time zone 'Asia/Seoul')::date+1,
      (now() at time zone 'Asia/Seoul')::date+90,interval '1 day') d
    cross join lateral jsonb_array_elements(
      olli_booking_private.available_slots(aid,d::date)) slot
    order by slot->>'start_at' limit 1;
  if ts is null then raise exception 'NO_FREE_TEST_SLOT'; end if;
  reply:=public.olli_booking_staff_manual_manage('fixture-owner',aid,'create',
    student,ts,'aaaaaaaa-0000-4000-8000-000000000901');
  v_booking_id:=(reply->>'reservation_id')::uuid;
  if reply->>'ok'<>'true' or not exists(
    select 1 from public.olli_booking_reservations r
    where r.id=v_booking_id and r.student_id=student and r.academy_id=aid and r.status='confirmed'
  ) then raise exception 'MANUAL_CREATE_FAILED'; end if;
  if (select count(*) from public.olli_booking_events
    where reservation_id=v_booking_id and action='created' and actor='staff')<>1 then
      raise exception 'STAFF_AUDIT_MISSING'; end if;
  reply:=public.olli_booking_staff_manual_manage('fixture-owner',aid,'create',
    student,ts,'aaaaaaaa-0000-4000-8000-000000000901');
  if (reply->>'reservation_id')::uuid<>v_booking_id or
    (select count(*) from public.olli_booking_reservations
      where academy_id=aid and request_key='aaaaaaaa-0000-4000-8000-000000000901')<>1 then
      raise exception 'MANUAL_RETRY_DUPLICATED'; end if;
  begin
    perform public.olli_booking_staff_manual_manage('fixture-owner',aid,'create',
      student,ts+interval '30 minutes','aaaaaaaa-0000-4000-8000-000000000902');
    raise exception 'SECOND_ACTIVE_STUDENT_BOOKING_ALLOWED';
  exception when unique_violation or invalid_parameter_value then null; end;
  begin
    perform public.olli_booking_staff_manual_manage('fixture-owner',aid,'create',
      second_student,ts,'aaaaaaaa-0000-4000-8000-000000000903');
    raise exception 'OVERLAPPING_BOOKING_ALLOWED';
  exception when exclusion_violation or invalid_parameter_value then null; end;
  begin
    perform public.olli_booking_staff_manual_manage('fixture-owner',aid,'create',
      '22222222-2222-4222-8222-222222222222',ts+interval '30 minutes',
      'aaaaaaaa-0000-4000-8000-000000000904');
    raise exception 'OTHER_ACADEMY_STUDENT_ALLOWED';
  exception when insufficient_privilege then null; end;
  -- Owner can book week one while guardian rules remain limited to weeks 2/3.
  select (slot->>'start_at')::timestamptz into outside_start
    from generate_series((now() at time zone 'Asia/Seoul')::date+1,
      (now() at time zone 'Asia/Seoul')::date+90,interval '1 day') d
    cross join lateral jsonb_array_elements(
      public.olli_booking_staff_manual_slots('fixture-owner',aid,d::date)->'slots') slot
    where 1+((extract(day from d::date)::int+
      extract(dow from date_trunc('month',d::timestamp)::date)::int-1)/7)=1
      and extract(isodow from d)<6
    order by slot->>'start_at' limit 1;
  if outside_start is null then raise exception 'OWNER_FIRST_WEEK_SLOTS_MISSING'; end if;
  if jsonb_array_length((public.olli_booking_list_slots('fixture-owner',aid,
       (outside_start at time zone 'Asia/Seoul')::date))->'slots')<>0
     then raise exception 'GUARDIAN_WEEK_RESTRICTIONS_CHANGED'; end if;
  reply:=public.olli_booking_staff_manual_manage('fixture-owner',aid,'create',
    outside_student,outside_start,'aaaaaaaa-0000-4000-8000-000000000905');
  if reply->>'ok'<>'true' then raise exception 'OWNER_FIRST_WEEK_CREATE_FAILED'; end if;
  begin
    perform public.olli_booking_staff_manual_slots('bad-token',aid,
      (outside_start at time zone 'Asia/Seoul')::date);
    raise exception 'UNAUTHORIZED_OWNER_SLOTS';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS owner booking available outside guardian weeks and remains tenant scoped';
end $$;
