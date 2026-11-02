-- Isolated PostgreSQL tests for owner-only, tenant-scoped daily consultation badge.
do $$
declare
 aid uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 other uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 subscription uuid:='cccccccc-1111-4111-8111-111111111111';
 member uuid:='bbbbbbbb-1111-4111-8111-111111111111';
 token uuid:='dddddddd-1111-4111-8111-111111111111';
 day date:=(now() at time zone 'Asia/Seoul')::date;
 r jsonb;
begin
 insert into public.olli_booking_reservations
  (academy_id,student_id,start_at,end_at,request_key)
 values(aid,'11111111-1111-4111-8111-111111111111',
 (day+'12:00'::time) at time zone 'Asia/Seoul',
 (day+'12:30'::time) at time zone 'Asia/Seoul',
 'aaaa1111-1111-4111-8111-111111111111');
 r:=public.olli_consultation_today_count('fixture-owner',aid);
 if r->>'ok'<>'true' or (r->>'consultation_count')::integer<>1
 then raise exception 'TODAY_BOOKING_COUNT_WRONG';end if;
 begin
  perform public.olli_consultation_today_count('wrong',aid);
  raise exception 'UNAUTHORIZED_COUNT';
 exception when insufficient_privilege then null;end;
 begin
  perform public.olli_consultation_today_count('fixture-owner',other);
  raise exception 'CROSS_TENANT_COUNT';
 exception when insufficient_privilege then null;end;
 insert into public.olli_consultation_reminder_deliveries
 (academy_id,subscription_id,reminder_date,member_id,claim_token)
 values(aid,subscription,day,member,token);
 perform set_config('request.jwt.claim.role','service_role',true);
 if not public.olli_consultation_reminder_finish(aid,subscription,day,token,true) then
   raise exception 'DELIVERY_ACK_FAILED';end if;
 if public.olli_consultation_reminder_finish(aid,subscription,day,
   'dddddddd-2222-4222-8222-222222222222',true)
 then raise exception 'WRONG_CLAIM_TOKEN_ACK_ALLOWED';end if;
 if (select d.status from public.olli_consultation_reminder_deliveries d
     where d.academy_id=aid and d.subscription_id=subscription and d.reminder_date=day)<>'sent'
 then raise exception 'DELIVERY_NOT_RECORDED';end if;
 raise notice 'PASS consultation daily count, tenant guard, idempotent delivery ledger';
end $$;
set role anon;
do $$
begin
 begin
   perform 1 from public.olli_consultation_reminder_deliveries limit 1;
   raise exception 'ANON_READ_DELIVERIES_ALLOWED';
 exception when insufficient_privilege then null;end;
 begin
   perform public.olli_consultation_reminder_claim_targets();
   raise exception 'ANON_CLAIM_ALLOWED';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
