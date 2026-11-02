-- Olli scheduled consultation reminder: owner/manager only, 10:00 Asia/Seoul.
-- Uses existing mobile web-push subscriptions; no edits to booking/sync tables.
begin;

create table public.olli_consultation_reminder_deliveries (
  academy_id uuid not null references public.academies(id) on delete cascade,
  subscription_id uuid not null references public.olli_team_chat_push_subscriptions(id) on delete cascade,
  reminder_date date not null,
  member_id uuid not null references public.academy_members(id) on delete cascade,
  status text not null default 'claimed' check (status in ('claimed','sent','failed')),
  claim_token uuid not null default gen_random_uuid(),
  attempts integer not null default 1,
  leased_until timestamptz not null default now()+interval '3 minutes',
  sent_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null default now(),
  primary key (academy_id,subscription_id,reminder_date)
);
create index olli_consultation_reminder_deliveries_day_idx
  on public.olli_consultation_reminder_deliveries (reminder_date,status);
alter table public.olli_consultation_reminder_deliveries enable row level security;
revoke all on public.olli_consultation_reminder_deliveries from public,anon,authenticated;
grant select,insert,update,delete on public.olli_consultation_reminder_deliveries to service_role;

-- Foreground badge count for the authenticated current academy. Do not expose
-- names, push endpoints or cross-tenant appointments to the browser.
create function public.olli_consultation_today_count(
 p_session_token text, p_academy_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $f$
declare
 v_account_id uuid;
 v_role text;
 v_today date := (now() at time zone 'Asia/Seoul')::date;
 v_count integer;
begin
 v_account_id:=public.olli_account_id_from_session(p_session_token);
 if v_account_id is null then raise exception 'SESSION_INVALID' using errcode='42501';end if;
 select m.role into v_role from public.academy_members m
 join public.academies a on a.id=m.academy_id
 where m.account_id=v_account_id and m.academy_id=p_academy_id
   and m.status='active' and m.role in ('owner','super_admin','manager')
   and a.status='active' and a.deleted_at is null
 limit 1;
 if v_role is null then raise exception 'ACADEMY_ACCESS_DENIED' using errcode='42501';end if;
 select count(*)::integer into v_count from public.olli_booking_reservations r
 where r.academy_id=p_academy_id and r.status='confirmed'
   and (r.start_at at time zone 'Asia/Seoul')::date=v_today;
 return jsonb_build_object('ok',true,'date',v_today,'consultation_count',v_count);
end;$f$;
revoke all on function public.olli_consultation_today_count(text,uuid) from public,anon,authenticated;
grant execute on function public.olli_consultation_today_count(text,uuid) to anon,authenticated,service_role;

-- Batch-level claims atomically prevent duplicate reminder pushes across cron
-- retries. Every send gets a token, and only the claimed sender may mark sent.
create function public.olli_consultation_reminder_claim_targets(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare
 v_day date:=(now() at time zone 'Asia/Seoul')::date;
 v_targets jsonb;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
 then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';end if;
 if (now() at time zone 'Asia/Seoul')::time < '10:00'::time
    or (now() at time zone 'Asia/Seoul')::time >= '10:25'::time
 then return jsonb_build_object('ok',true,'date',v_day,'targets','[]'::jsonb,'outside_window',true);end if;
 with candidates as (
   select s.id subscription_id,s.academy_id,s.member_id
   from public.olli_team_chat_push_subscriptions s
   join public.academy_members m on m.id=s.member_id and m.academy_id=s.academy_id
   join public.academies a on a.id=s.academy_id
   where s.disabled_at is null and m.status='active'
     and m.role in ('owner','super_admin','manager')
     and a.status='active' and a.deleted_at is null
     and exists (
       select 1 from public.olli_booking_reservations r
       where r.academy_id=s.academy_id and r.status='confirmed'
         and (r.start_at at time zone 'Asia/Seoul')::date=v_day
     )
   order by s.id
   limit greatest(1,least(coalesce(p_limit,100),100))
 ), claimed as (
   insert into public.olli_consultation_reminder_deliveries
     (academy_id,subscription_id,reminder_date,member_id)
   select c.academy_id,c.subscription_id,v_day,c.member_id from candidates c
   on conflict(academy_id,subscription_id,reminder_date)
   do update set status='claimed',claim_token=gen_random_uuid(),
      attempts=public.olli_consultation_reminder_deliveries.attempts+1,
      leased_until=now()+interval '3 minutes',updated_at=now(),last_error_code=null
   where public.olli_consultation_reminder_deliveries.status<>'sent'
     and public.olli_consultation_reminder_deliveries.attempts<5
     and public.olli_consultation_reminder_deliveries.leased_until<=now()
   returning academy_id,subscription_id,member_id,reminder_date,claim_token
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'academy_id',c.academy_id,'subscription_id',c.subscription_id,
   'member_id',c.member_id,'reminder_date',c.reminder_date,
   'claim_token',c.claim_token,'endpoint',s.endpoint,
   'p256dh',s.p256dh,'auth',s.auth,
   'consultation_count',(
      select count(*)::integer from public.olli_booking_reservations r
      where r.academy_id=c.academy_id and r.status='confirmed'
        and (r.start_at at time zone 'Asia/Seoul')::date=v_day
   )
 ) order by c.academy_id,c.member_id,c.subscription_id),'[]'::jsonb)
 into v_targets from claimed c
 join public.olli_team_chat_push_subscriptions s on s.id=c.subscription_id and s.disabled_at is null;
 return jsonb_build_object('ok',true,'date',v_day,'targets',v_targets);
end;$f$;
revoke all on function public.olli_consultation_reminder_claim_targets(integer) from public,anon,authenticated;
grant execute on function public.olli_consultation_reminder_claim_targets(integer) to service_role;

create function public.olli_consultation_reminder_finish(
 p_academy_id uuid,p_subscription_id uuid,p_reminder_date date,
 p_claim_token uuid,p_success boolean,p_error_code text default null
) returns boolean language plpgsql security definer set search_path='' as $f$
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
 then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';end if;
 update public.olli_consultation_reminder_deliveries d set
   status=case when p_success then 'sent' else 'failed' end,
   sent_at=case when p_success then now() else null end,
   leased_until=now(),updated_at=now(),
   last_error_code=case when p_success then null else left(coalesce(p_error_code,'push_failed'),80) end
 where d.academy_id=p_academy_id and d.subscription_id=p_subscription_id
   and d.reminder_date=p_reminder_date
   and d.claim_token=p_claim_token and d.status='claimed';
 return found;
end;$f$;
revoke all on function public.olli_consultation_reminder_finish(uuid,uuid,date,uuid,boolean,text)
 from public,anon,authenticated;
grant execute on function public.olli_consultation_reminder_finish(uuid,uuid,date,uuid,boolean,text)
 to service_role;

commit;
