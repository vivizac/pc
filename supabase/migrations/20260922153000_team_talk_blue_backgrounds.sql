-- Extend Team Talk background themes with light blue and dark blue.
-- Existing gray values remain unchanged for backward compatibility.

alter table public.academy_settings
  drop constraint if exists academy_settings_team_talk_background_check;

alter table public.academy_settings
  add constraint academy_settings_team_talk_background_check
  check (team_talk_background in ('light', 'dark', 'light-blue', 'dark-blue'));

create or replace function public.olli_team_talk_settings_update(
  p_session_token text,
  p_academy_id uuid,
  p_background text,
  p_bot_notifications_enabled boolean,
  p_ai_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_background text := lower(btrim(coalesce(p_background, 'dark')));
  v_role text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.role
    into v_role
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and a.status = 'active'
    and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 else 3 end, m.created_at
  limit 1;

  if v_role not in ('owner','manager') then
    raise exception '팀톡 설정은 원장 또는 관리자만 변경할 수 있습니다.';
  end if;

  if v_background not in ('light','dark','light-blue','dark-blue') then
    raise exception '팀톡 배경 설정 값을 확인해 주세요.';
  end if;

  insert into public.academy_settings(
    academy_id,
    team_talk_background,
    team_talk_bot_notifications_enabled,
    team_talk_ai_enabled,
    updated_at
  )
  values (
    p_academy_id,
    v_background,
    coalesce(p_bot_notifications_enabled, true),
    coalesce(p_ai_enabled, false),
    now()
  )
  on conflict (academy_id)
  do update set
    team_talk_background = excluded.team_talk_background,
    team_talk_bot_notifications_enabled = excluded.team_talk_bot_notifications_enabled,
    team_talk_ai_enabled = excluded.team_talk_ai_enabled,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'background', v_background,
    'bot_notifications_enabled', coalesce(p_bot_notifications_enabled, true),
    'ai_enabled', coalesce(p_ai_enabled, false)
  );
end;
$function$;

create or replace function public.olli_team_talk_settings_update(
  p_session_token text,
  p_academy_id uuid,
  p_background text,
  p_bot_notifications_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_background text := lower(btrim(coalesce(p_background, 'dark')));
  v_role text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.role
    into v_role
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and a.status = 'active'
    and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 else 3 end, m.created_at
  limit 1;

  if v_role not in ('owner','manager') then
    raise exception '팀톡 설정은 원장 또는 관리자만 변경할 수 있습니다.';
  end if;

  if v_background not in ('light','dark','light-blue','dark-blue') then
    raise exception '팀톡 배경 설정 값을 확인해 주세요.';
  end if;

  insert into public.academy_settings(
    academy_id,
    team_talk_background,
    team_talk_bot_notifications_enabled,
    updated_at
  )
  values (
    p_academy_id,
    v_background,
    coalesce(p_bot_notifications_enabled, true),
    now()
  )
  on conflict (academy_id)
  do update set
    team_talk_background = excluded.team_talk_background,
    team_talk_bot_notifications_enabled = excluded.team_talk_bot_notifications_enabled,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'background', v_background,
    'bot_notifications_enabled', coalesce(p_bot_notifications_enabled, true)
  );
end;
$function$;
