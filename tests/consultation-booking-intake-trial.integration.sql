-- Isolated CI PostgreSQL after booking staff/reschedule migrations, never Production.
do $$
declare
 aid uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 existing_student uuid:='a1a1a1a1-aaaa-4aaa-8aaa-a1a1a1a1a1a1';
 booked_at timestamptz;
 consultation_id uuid;
 trial_id uuid;
 intake_id uuid;
 duplicate_count integer;
 reply jsonb;
 slot_day date;
begin
 select (slot->>'start_at')::timestamptz into booked_at
 from generate_series((now() at time zone 'Asia/Seoul')::date+2,
  (now() at time zone 'Asia/Seoul')::date+60,interval '1 day') d
 cross join lateral jsonb_array_elements(
  (public.olli_booking_staff_manual_slots('fixture-owner',aid,d::date))->'slots') slot
 order by slot->>'start_at' limit 1;
 if booked_at is null then raise exception 'NO_AVAILABLE_OWNER_SLOT'; end if;
 slot_day:=(booked_at at time zone 'Asia/Seoul')::date;
 begin
  perform public.olli_booking_staff_intake_create('bad-token',aid,
    '권한없음',6,'trial',booked_at,'b1000000-0000-4000-8000-000000000000');
  raise exception 'UNAUTHORIZED_INTAKE_CREATED';
 exception when insufficient_privilege then null; end;
 begin
  perform public.olli_booking_staff_intake_create('fixture-owner',aid,
    '나이오류',0,'trial',booked_at,'b1000000-0000-4000-8000-000000000001');
  raise exception 'INVALID_AGE_ACCEPTED';
 exception when invalid_parameter_value then null; end;

 reply:=public.olli_booking_staff_intake_create('fixture-owner',aid,
   '  신규이름  ',7,'consultation',booked_at,'b1000000-0000-4000-8000-000000000002');
 consultation_id:=(reply->>'reservation_id')::uuid;
 intake_id:=(reply->>'intake_id')::uuid;
 if reply->>'ok'<>'true' or not exists(
  select 1 from public.olli_booking_reservations r
  join public.olli_booking_intakes i on i.id=r.intake_id
  where r.id=consultation_id and r.academy_id=aid and r.status='confirmed'
    and r.student_id is null and i.child_name='신규이름'
    and i.age_years=7 and i.visit_type='consultation'
 ) then raise exception 'INTAKE_CONSULTATION_SAVE_FAILED'; end if;

 reply:=public.olli_booking_staff_intake_create('fixture-owner',aid,
   '신규이름',7,'consultation',booked_at,'b1000000-0000-4000-8000-000000000002');
 if (reply->>'reservation_id')::uuid<>consultation_id or reply->>'replayed'<>'true'
  then raise exception 'INTAKE_RETRY_NOT_IDEMPOTENT'; end if;
 begin
  perform public.olli_booking_staff_intake_create('fixture-owner',aid,
    '신규이름',8,'consultation',booked_at,'b1000000-0000-4000-8000-000000000002');
  raise exception 'MUTATED_RETRY_ACCEPTED';
 exception when invalid_parameter_value then null; end;

 -- Regular students, new consultations and trials must share an identical slot ledger.
 begin
  perform public.olli_booking_staff_intake_create('fixture-owner',aid,
    '중복체험',6,'trial',booked_at,'b1000000-0000-4000-8000-000000000003');
  raise exception 'TRIAL_OVERLAP_WITH_NEW_CONSULTATION';
 exception when invalid_parameter_value or exclusion_violation then null; end;
 begin
  perform public.olli_booking_staff_manual_manage('fixture-owner',aid,'create',
    existing_student,booked_at,'b1000000-0000-4000-8000-000000000004');
  raise exception 'REGULAR_OVERLAP_WITH_NEW_CONSULTATION';
 exception when invalid_parameter_value or exclusion_violation or unique_violation then null; end;
 if exists(select 1 from public.olli_booking_intakes
  where academy_id=aid and child_name='중복체험') then
  raise exception 'FAILED_BOOKING_LEFT_ORPHAN_INTAKE';
 end if;

 reply:=public.olli_booking_staff_manage('fixture-owner',aid,'cancel',null,
   consultation_id,null,'b1000000-0000-4000-8000-000000000005');
 if reply->>'ok'<>'true' then raise exception 'CANCEL_FAILED'; end if;
 reply:=public.olli_booking_staff_intake_create('fixture-owner',aid,
   '체험학생',5,'trial',booked_at,'b1000000-0000-4000-8000-000000000006');
 trial_id:=(reply->>'reservation_id')::uuid;
 if trial_id=consultation_id then raise exception 'REUSED_CANCELLED_RESERVATION'; end if;
 reply:=public.olli_booking_staff_manage('fixture-owner',aid,'list',to_char(slot_day,'YYYY-MM'));
 if not exists (
  select 1 from jsonb_array_elements(reply->'appointments') item
  where item->>'id'=trial_id::text and item->>'kind'='intake'
    and item->>'visit_type'='trial' and (item->>'age_years')::integer=5
 ) then raise exception 'TRIAL_NOT_VISIBLE_IN_OWNER_LIST'; end if;
 begin
  perform public.olli_booking_staff_intake_create('fixture-owner',aid,
    '다시신규',8,'consultation',booked_at,'b1000000-0000-4000-8000-000000000007');
  raise exception 'NEW_CONSULTATION_OVERLAP_WITH_TRIAL';
 exception when invalid_parameter_value or exclusion_violation then null; end;
 select count(*) into duplicate_count from public.olli_booking_reservations
  where academy_id=aid and status='confirmed'
    and tstzrange(start_at,end_at,'[)') @> booked_at;
 if duplicate_count<>1 then raise exception 'OVERLAPPING_ACTIVE_RESERVATIONS'; end if;
 raise notice 'PASS: intake/trial age, subtype, owner auth, retry, atomic no overlap and list';
end $$;
