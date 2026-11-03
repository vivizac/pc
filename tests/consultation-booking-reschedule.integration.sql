-- Isolated PostgreSQL regression: staff can move an existing booking into an
-- owner-only evening slot on a day excluded from guardian booking settings.
-- Run after the manual evening slots migration and the owner-reschedule migration.
do $$
declare
  aid uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  sid uuid:='e7e7e7e7-e7e7-4e7e-8e7e-e7e7e7e7e7e7';
  other_sid uuid:='e8e8e8e8-e8e8-4e8e-8e8e-e8e8e8e8e8e8';
  day date;
  early timestamptz;
  later timestamptz;
  occupied timestamptz;
  booking_id uuid;
  other_booking uuid;
  response jsonb;
begin
  insert into public.students(id,academy_id,name) values
    (sid,aid,'일정변경 학생'),(other_sid,aid,'중복검증 학생');
  select d::date into day
  from generate_series(
    (now() at time zone 'Asia/Seoul')::date+1,
    (now() at time zone 'Asia/Seoul')::date+90,interval '1 day') d
  where extract(isodow from d) in (6,7)
    and (select count(*) from jsonb_array_elements(
      public.olli_booking_staff_manual_slots('fixture-owner',aid,d::date)->'slots') slot
      where right(slot->>'local_start',5) in ('17:00','17:30','18:00'))=3
  order by d limit 1;
  if day is null then raise exception 'OWNER_RESCHEDULE_DAY_NOT_FOUND';end if;
  if exists (
    select 1 from jsonb_array_elements(
      public.olli_booking_list_slots('fixture-owner',aid,day)->'slots') slot
    where right(slot->>'local_start',5)='17:30'
  ) then raise exception 'GUARDIAN_WEEKDAY_RULE_CHANGED';end if;
  select
    max((slot->>'start_at')::timestamptz) filter(where right(slot->>'local_start',5)='17:00'),
    max((slot->>'start_at')::timestamptz) filter(where right(slot->>'local_start',5)='17:30'),
    max((slot->>'start_at')::timestamptz) filter(where right(slot->>'local_start',5)='18:00')
  into early,later,occupied
  from jsonb_array_elements(
    public.olli_booking_staff_manual_slots('fixture-owner',aid,day)->'slots') slot;
  response:=public.olli_booking_staff_manual_manage('fixture-owner',aid,
    'create',sid,early,'a7a7a7a7-0000-4000-8000-000000000001');
  booking_id:=(response->>'reservation_id')::uuid;
  response:=public.olli_booking_staff_manual_manage('fixture-owner',aid,
    'create',other_sid,occupied,'a7a7a7a7-0000-4000-8000-000000000002');
  other_booking:=(response->>'reservation_id')::uuid;
  response:=public.olli_booking_staff_manage('fixture-owner',aid,'reschedule',
    null,booking_id,later,'a7a7a7a7-0000-4000-8000-000000000003');
  if response->>'ok'<>'true' or response->>'replayed'<>'false'
    then raise exception 'OWNER_RESCHEDULE_FAILED';end if;
  if not exists (
    select 1 from public.olli_booking_reservations r
    where r.id=booking_id and r.start_at=later
      and r.end_at=later+interval '30 minutes' and r.status='confirmed'
  ) then raise exception 'RESCHEDULE_NOT_SAVED';end if;
  response:=public.olli_booking_staff_manage('fixture-owner',aid,'reschedule',
    null,booking_id,later,'a7a7a7a7-0000-4000-8000-000000000003');
  if response->>'replayed'<>'true' then raise exception 'RETRY_NOT_IDEMPOTENT';end if;
  if (select count(*) from public.olli_booking_events
    where reservation_id=booking_id and action='rescheduled' and actor='staff')<>1
    then raise exception 'DUPLICATE_RESCHEDULE_EVENT';end if;
  begin
    perform public.olli_booking_staff_manage('fixture-owner',aid,'reschedule',
      null,booking_id,occupied,'a7a7a7a7-0000-4000-8000-000000000004');
    raise exception 'OVERLAPPING_RESCHEDULE_ALLOWED';
  exception when invalid_parameter_value or exclusion_violation then null;end;
  if (select start_at from public.olli_booking_reservations where id=booking_id)<>later
    then raise exception 'FAILED_RESCHEDULE_MUTATED_BOOKING';end if;
  begin
    perform public.olli_booking_staff_manage('wrong',aid,'reschedule',
      null,booking_id,early,'a7a7a7a7-0000-4000-8000-000000000005');
    raise exception 'UNAUTHORIZED_RESCHEDULE_ALLOWED';
  exception when insufficient_privilege then null;end;
  raise notice 'PASS owner reschedule: excluded weekday, evening, idempotency, overlap, access, data preservation';
end $$;
