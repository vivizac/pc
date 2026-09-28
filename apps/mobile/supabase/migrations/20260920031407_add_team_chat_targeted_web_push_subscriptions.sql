create table if not exists public.olli_team_chat_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  member_id uuid not null references public.academy_members(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  unique (endpoint)
);

create index if not exists olli_team_chat_push_subscriptions_member_idx
  on public.olli_team_chat_push_subscriptions (academy_id, member_id)
  where disabled_at is null;

alter table public.olli_team_chat_push_subscriptions enable row level security;
revoke all on table public.olli_team_chat_push_subscriptions from anon, authenticated;
grant select, insert, update, delete on table public.olli_team_chat_push_subscriptions to service_role;

create or replace function public.olli_team_chat_push_subscribe(
  p_session_token text,
  p_academy_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_member_id uuid;
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
  v_p256dh text := btrim(coalesce(p_p256dh, ''));
  v_auth text := btrim(coalesce(p_auth, ''));
  v_subscription_id uuid;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;

  select m.id into v_member_id
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and a.status = 'active'
    and a.deleted_at is null
  order by m.created_at
  limit 1;

  if v_member_id is null then raise exception '현재 계정은 이 학원의 알림을 사용할 수 없습니다.'; end if;
  if v_endpoint = '' or v_p256dh = '' or v_auth = '' then raise exception '푸시 구독 정보가 올바르지 않습니다.'; end if;

  insert into public.olli_team_chat_push_subscriptions (
    academy_id, member_id, endpoint, p256dh, auth, user_agent, disabled_at, updated_at
  )
  values (
    p_academy_id, v_member_id, v_endpoint, v_p256dh, v_auth,
    nullif(btrim(coalesce(p_user_agent, '')), ''), null, now()
  )
  on conflict (endpoint)
  do update set
    academy_id = excluded.academy_id,
    member_id = excluded.member_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    disabled_at = null,
    updated_at = now()
  returning id into v_subscription_id;

  return jsonb_build_object('ok', true, 'subscription_id', v_subscription_id, 'member_id', v_member_id);
end;
$function$;

create or replace function public.olli_team_chat_push_unsubscribe(
  p_session_token text,
  p_academy_id uuid,
  p_endpoint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_member_id uuid;
  v_updated integer := 0;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;

  select m.id into v_member_id
  from public.academy_members m
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
  order by m.created_at
  limit 1;

  if v_member_id is null then raise exception '현재 계정은 이 학원의 알림을 사용할 수 없습니다.'; end if;

  update public.olli_team_chat_push_subscriptions
  set disabled_at = now(), updated_at = now()
  where academy_id = p_academy_id
    and member_id = v_member_id
    and endpoint = btrim(coalesce(p_endpoint, ''))
    and disabled_at is null;

  get diagnostics v_updated = row_count;
  return jsonb_build_object('ok', true, 'disabled_count', v_updated);
end;
$function$;

revoke all on function public.olli_team_chat_push_subscribe(text, uuid, text, text, text, text) from public;
revoke all on function public.olli_team_chat_push_unsubscribe(text, uuid, text) from public;
grant execute on function public.olli_team_chat_push_subscribe(text, uuid, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.olli_team_chat_push_unsubscribe(text, uuid, text) to anon, authenticated, service_role;
