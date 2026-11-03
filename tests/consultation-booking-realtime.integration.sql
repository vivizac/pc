-- Verify booking CREATE, UPDATE and DELETE send only an opaque refresh signal.
do $$
declare
  v_id uuid;
  v_other uuid;
  v_count integer;
  v_payload jsonb;
begin
  insert into public.students(id,academy_id,name) values
  ('33333333-3333-4333-8333-333333333331',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','신호테스트 학생 1'),
  ('33333333-3333-4333-8333-333333333332',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','신호테스트 학생 2');
  insert into public.olli_booking_reservations
  (academy_id,student_id,start_at,end_at,request_key)
  values (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '33333333-3333-4333-8333-333333333331',
    '2090-02-20T11:00:00+09:00','2090-02-20T11:30:00+09:00',
    'c1000000-0000-4000-8000-000000000001'
  ) returning id into v_id;
  select count(*) into v_count from public.olli_booking_signal_fixture;
  if v_count<>1 then raise exception 'INSERT_SIGNAL_MISSING: %',v_count;end if;
  update public.olli_booking_reservations set updated_at=clock_timestamp() where id=v_id;
  select count(*) into v_count from public.olli_booking_signal_fixture;
  if v_count<>1 then raise exception 'UNRELATED_UPDATE_SENT_SIGNAL';end if;
  update public.olli_booking_reservations set status='cancelled' where id=v_id;
  select count(*) into v_count from public.olli_booking_signal_fixture;
  if v_count<>2 then raise exception 'STATUS_UPDATE_SIGNAL_MISSING';end if;
  delete from public.olli_booking_reservations where id=v_id;
  select count(*) into v_count from public.olli_booking_signal_fixture;
  if v_count<>3 then raise exception 'DELETE_SIGNAL_MISSING';end if;

  insert into public.olli_booking_reservations
  (academy_id,student_id,start_at,end_at,request_key)
  values (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '33333333-3333-4333-8333-333333333332',
    '2090-02-20T12:00:00+09:00','2090-02-20T12:30:00+09:00',
    'c1000000-0000-4000-8000-000000000002'
  ) returning id into v_other;
  select count(*) into v_count from public.olli_booking_signal_fixture;
  if v_count<>4 then raise exception 'SECOND_TENANT_SIGNAL_MISSING';end if;
  if (select count(distinct topic) from public.olli_booking_signal_fixture)<>2
  then raise exception 'TENANT_TOPICS_NOT_ISOLATED';end if;
  if exists(
    select 1 from public.olli_booking_signal_fixture s
    where s.event<>'changed' or s.private
       or s.payload<>jsonb_build_object('protocol',1,'domain','booking','revision',0)
       or s.topic not like 'olli:test:%'
  ) then raise exception 'SIGNAL_CONTAINS_BOOKING_DETAILS';end if;
  raise notice 'PASS booking insert/update/delete -> domain-only tenant-scoped broadcast';
end $$;
