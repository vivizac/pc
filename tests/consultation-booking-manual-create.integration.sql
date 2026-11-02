-- Isolated PostgreSQL test, after booking stages 1-3; no production data.
do $$
declare
  aid uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  other uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  student uuid:='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  second_student uuid:='a1a1a1a1-aaaa-4aaa-8aaa-a1a1a1a1a1a1';
  ts timestamptz;
  v_booking_id uuid;
  reply jsonb;
begin
  insert into public.students(id,academy_id,name)
    values(student,aid,'수동등록 테스트'),(second_student,aid,'두번째 테스트');
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
  exception when unique_violation then null; end;
  begin
    perform public.olli_booking_staff_manual_manage('fixture-owner',aid,'create',
      second_student,ts,'aaaaaaaa-0000-4000-8000-000000000903');
    raise exception 'OVERLAPPING_BOOKING_ALLOWED';
  exception when exclusion_violation then null; end;
  begin
    perform public.olli_booking_staff_manual_manage('fixture-owner',aid,'create',
      '22222222-2222-4222-8222-222222222222',ts+interval '30 minutes',
      'aaaaaaaa-0000-4000-8000-000000000904');
    raise exception 'OTHER_ACADEMY_STUDENT_ALLOWED';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS manual consultation appointment creation, owner, idempotency and isolation';
end $$;
