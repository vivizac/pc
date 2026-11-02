-- Isolated PostgreSQL only. Verify 17:00,17:30,18:00 owner slots, closing time
-- at 18:30, parent slots unchanged, and overlapping writes rejected.
do $$
declare
  aid uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  student_one uuid:='b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3';
  student_two uuid:='b4b4b4b4-b4b4-4b4b-8b4b-b4b4b4b4b4b4';
  student_three uuid:='b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5';
  v_day date;
  v_slots jsonb;
  v_guardian jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_response jsonb;
  v_booking_id uuid;
  v_time text;
begin
  insert into public.students(id,academy_id,name) values
    (student_one,aid,'저녁 상담 학생1'),
    (student_two,aid,'저녁 상담 학생2'),
    (student_three,aid,'저녁 상담 학생3');

  -- Pick a future weekday that has all three owner starts free; no real data.
  select d::date into v_day
  from generate_series(
    (now() at time zone 'Asia/Seoul')::date+1,
    (now() at time zone 'Asia/Seoul')::date+90,
    interval '1 day') d
  where extract(isodow from d) between 1 and 5
    and (
      select count(distinct right(slot->>'local_start',5))
      from jsonb_array_elements(
        public.olli_booking_staff_manual_slots('fixture-owner',aid,d::date)->'slots') slot
      where right(slot->>'local_start',5) in ('17:00','17:30','18:00')
    )=3
  order by d limit 1;
  if v_day is null then raise exception 'MISSING_EVENING_TEST_DATE'; end if;
  v_slots:=public.olli_booking_staff_manual_slots('fixture-owner',aid,v_day);
  for v_time in select unnest(array['17:00','17:30','18:00']) loop
    select (slot->>'start_at')::timestamptz,(slot->>'end_at')::timestamptz
      into v_start,v_end
    from jsonb_array_elements(v_slots->'slots') slot
    where right(slot->>'local_start',5)=v_time;
    if v_start is null or v_end-v_start<>interval '30 minutes' then
      raise exception 'EVENING_SLOT_DURATION_WRONG: %',v_time;
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(v_slots->'slots') slot
    where right(slot->>'local_start',5)='18:30'
  ) then raise exception 'UNEXPECTED_1830_START';end if;

  -- Parent/guardian booking has never allowed 17:00 or later with a 17:00 closing time.
  if (select s.end_time from public.olli_booking_settings s where s.academy_id=aid)<>'17:00'::time
    then raise exception 'PARENT_SETTINGS_MODIFIED';end if;
  v_guardian:=public.olli_booking_list_slots('fixture-owner',aid,v_day);
  if exists (
    select 1 from jsonb_array_elements(v_guardian->'slots') slot
    where right(slot->>'local_start',5) in ('17:00','17:30','18:00')
  ) then raise exception 'GUARDIAN_EVENING_HOURS_WIDENED';end if;

  select (slot->>'start_at')::timestamptz into v_start
    from jsonb_array_elements(v_slots->'slots') slot
    where right(slot->>'local_start',5)='18:00';
  v_response:=public.olli_booking_staff_manual_manage(
    'fixture-owner',aid,'create',student_one,v_start,
    'b3b3b3b3-0000-4000-8000-000000000001');
  v_booking_id:=(v_response->>'reservation_id')::uuid;
  if (select r.end_at-r.start_at from public.olli_booking_reservations r
      where r.id=v_booking_id)<>interval '30 minutes'
    then raise exception 'EVENING_BOOKING_DURATION_WRONG';end if;
  if exists (
    select 1 from jsonb_array_elements(
      public.olli_booking_staff_manual_slots('fixture-owner',aid,v_day)->'slots') slot
    where right(slot->>'local_start',5)='18:00'
  ) then raise exception 'BOOKED_EVENING_SLOT_STILL_VISIBLE';end if;

  -- No duplicate or overlapping booking can be accepted.
  begin
    perform public.olli_booking_staff_manual_manage(
      'fixture-owner',aid,'create',student_two,v_start,
      'b3b3b3b3-0000-4000-8000-000000000002');
    raise exception 'EVENING_OVERLAP_ALLOWED';
  exception when invalid_parameter_value or exclusion_violation then null;end;
  -- Adjacent slot, 17:30–18:00, must remain available.
  select (slot->>'start_at')::timestamptz into v_start
    from jsonb_array_elements(
      public.olli_booking_staff_manual_slots('fixture-owner',aid,v_day)->'slots') slot
    where right(slot->>'local_start',5)='17:30';
  if v_start is null then raise exception 'ADJACENT_SLOT_NOT_AVAILABLE';end if;
  v_response:=public.olli_booking_staff_manual_manage(
    'fixture-owner',aid,'create',student_three,v_start,
    'b3b3b3b3-0000-4000-8000-000000000003');
  if v_response->>'ok'<>'true' then raise exception 'ADJACENT_1730_CREATE_FAILED';end if;

  begin
    perform public.olli_booking_staff_manual_slots('invalid',aid,v_day);
    raise exception 'OWNER_SLOT_UNAUTHORIZED';
  exception when insufficient_privilege then null;end;
  raise notice 'PASS: owner-only 17:00 / 17:30 / 18:00, 30-minute duration, guardian unchanged, overlap blocked';
end $$;
