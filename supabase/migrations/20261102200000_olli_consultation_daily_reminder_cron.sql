-- Production scheduler: 10:00 Asia/Seoul is 01:00 UTC.
-- Retry only on 10:05–10:20. Per-subscription claim ledger prevents repeats.
-- Requires existing protected Olli system push secret in Supabase Vault.
begin;

create function public.olli_consultation_reminder_cron_dispatch()
returns bigint language plpgsql security definer set search_path='' as $f$
declare
 v_secret text;
 v_request bigint;
 v_kst time:=(now() at time zone 'Asia/Seoul')::time;
begin
 if v_kst < '10:00'::time or v_kst >= '10:25'::time then return null;end if;
 select decrypted_secret into v_secret
 from vault.decrypted_secrets
 where name='olli_team_chat_system_push_secret_20260921'
 order by created_at desc limit 1;
 if nullif(v_secret,'') is null then
   raise exception 'OLLI_REMINDER_PUSH_SECRET_MISSING';
 end if;
 select net.http_post(
   url:='https://fvkxipjwgeyosgnfhdnx.supabase.co/functions/v1/olli-consultation-reminder',
   headers:=jsonb_build_object('Content-Type','application/json'),
   body:=jsonb_build_object('action','dispatch-daily','internal_token',v_secret),
   timeout_milliseconds:=30000
 ) into v_request;
 return v_request;
end;$f$;
revoke all on function public.olli_consultation_reminder_cron_dispatch()
 from public,anon,authenticated,service_role;
-- Never expose the system dispatch function via Supabase Data API.
select cron.schedule(
 'olli-consultation-reminder-10am-kst-v1',
 '0,5,10,15,20 1 * * *',
 $$select public.olli_consultation_reminder_cron_dispatch();$$
);

commit;
