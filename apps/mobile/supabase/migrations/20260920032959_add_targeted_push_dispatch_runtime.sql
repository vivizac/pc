-- Runtime support for targeted Web Push dispatch.
-- Private VAPID key is created by the Edge Function on first authorized use
-- and stored in Supabase Vault; only the public key is stored in this table.
create table if not exists public.olli_server_runtime_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.olli_server_runtime_config enable row level security;
revoke all on table public.olli_server_runtime_config from anon, authenticated;
grant select, insert, update, delete on table public.olli_server_runtime_config to service_role;

create or replace function public.olli_push_server_store_vapid(p_public_key text, p_private_key text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_secret_id uuid; v_public text := btrim(coalesce(p_public_key,'')); v_private text := btrim(coalesce(p_private_key,''));
begin
  if v_public = '' or v_private = '' then raise exception 'VAPID key pair is required.'; end if;
  select s.id into v_secret_id from vault.secrets s
  where s.name='olli_web_push_vapid_private_20260920' order by s.created_at desc limit 1;
  if v_secret_id is null then
    perform vault.create_secret(v_private,'olli_web_push_vapid_private_20260920','OLLI team chat targeted Web Push VAPID private key',null);
  else
    perform vault.update_secret(v_secret_id,v_private,'olli_web_push_vapid_private_20260920','OLLI team chat targeted Web Push VAPID private key',null);
  end if;
  insert into public.olli_server_runtime_config(key,value,updated_at)
  values('olli_web_push_vapid_public_20260920',v_public,now())
  on conflict(key) do update set value=excluded.value, updated_at=now();
  return jsonb_build_object('ok',true);
end;
$function$;

create or replace function public.olli_push_server_vapid()
returns jsonb language sql security definer set search_path = ''
as $function$
select jsonb_build_object(
  'ok',true,
  'public_key',(select c.value from public.olli_server_runtime_config c where c.key='olli_web_push_vapid_public_20260920' limit 1),
  'private_key',(select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name='olli_web_push_vapid_private_20260920' order by ds.created_at desc limit 1)
);
$function$;

create or replace function public.olli_team_chat_push_context(p_session_token text,p_academy_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_account_id uuid; v_member_id uuid;
begin
  v_account_id:=public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;
  select m.id into v_member_id
  from public.academy_members m join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id and m.account_id=v_account_id and m.status='active'
    and a.status='active' and a.deleted_at is null
  order by m.created_at limit 1;
  if v_member_id is null then raise exception '현재 계정은 이 학원의 알림을 사용할 수 없습니다.'; end if;
  return jsonb_build_object('ok',true,'member_id',v_member_id);
end;
$function$;

create or replace function public.olli_team_chat_push_targets(p_session_token text,p_academy_id uuid,p_message_id bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_account_id uuid; v_sender_member_id uuid; v_sender_name text; v_body text; v_targets jsonb;
begin
  v_account_id:=public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;
  select m.id into v_sender_member_id from public.academy_members m
  where m.academy_id=p_academy_id and m.account_id=v_account_id and m.status='active'
  order by m.created_at limit 1;
  if v_sender_member_id is null then raise exception '현재 계정은 이 학원의 올리톡을 사용할 수 없습니다.'; end if;

  select msg.sender_name_snapshot,msg.body into v_sender_name,v_body
  from public.olli_team_chat_messages msg
  where msg.academy_id=p_academy_id and msg.id=p_message_id
    and msg.sender_member_id=v_sender_member_id and msg.deleted_at is null limit 1;
  if v_body is null then raise exception '현재 계정이 보낸 메시지만 푸시 알림을 전송할 수 있습니다.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'subscription_id',s.id,'member_id',mt.member_id,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth
  ) order by mt.member_id,s.id),'[]'::jsonb)
  into v_targets
  from public.olli_team_chat_mentions mt
  join public.academy_members target on target.id=mt.member_id and target.academy_id=mt.academy_id and target.status='active'
  join public.olli_team_chat_push_subscriptions s on s.academy_id=mt.academy_id and s.member_id=mt.member_id and s.disabled_at is null
  where mt.academy_id=p_academy_id and mt.message_id=p_message_id and mt.read_at is null
    and not exists(select 1 from public.olli_team_chat_push_deliveries d where d.message_id=p_message_id and d.subscription_id=s.id);

  return jsonb_build_object('ok',true,'sender_name',v_sender_name,'body',v_body,'message_id',p_message_id,'targets',v_targets);
end;
$function$;

create or replace function public.olli_team_chat_push_mark_delivered(p_academy_id uuid,p_message_id bigint,p_subscription_id uuid,p_member_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  insert into public.olli_team_chat_push_deliveries(message_id,subscription_id,academy_id,member_id,delivered_at)
  values(p_message_id,p_subscription_id,p_academy_id,p_member_id,now())
  on conflict(message_id,subscription_id) do nothing;
  return jsonb_build_object('ok',true);
end;
$function$;

create or replace function public.olli_team_chat_push_disable_subscription(p_academy_id uuid,p_subscription_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  update public.olli_team_chat_push_subscriptions set disabled_at=now(),updated_at=now()
  where id=p_subscription_id and academy_id=p_academy_id;
  return jsonb_build_object('ok',true);
end;
$function$;

revoke all on function public.olli_push_server_store_vapid(text,text) from public;
revoke all on function public.olli_push_server_vapid() from public;
revoke all on function public.olli_team_chat_push_context(text,uuid) from public;
revoke all on function public.olli_team_chat_push_targets(text,uuid,bigint) from public;
revoke all on function public.olli_team_chat_push_mark_delivered(uuid,bigint,uuid,uuid) from public;
revoke all on function public.olli_team_chat_push_disable_subscription(uuid,uuid) from public;

grant execute on function public.olli_push_server_store_vapid(text,text) to service_role;
grant execute on function public.olli_push_server_vapid() to service_role;
grant execute on function public.olli_team_chat_push_context(text,uuid) to service_role;
grant execute on function public.olli_team_chat_push_targets(text,uuid,bigint) to service_role;
grant execute on function public.olli_team_chat_push_mark_delivered(uuid,bigint,uuid,uuid) to service_role;
grant execute on function public.olli_team_chat_push_disable_subscription(uuid,uuid) to service_role;
