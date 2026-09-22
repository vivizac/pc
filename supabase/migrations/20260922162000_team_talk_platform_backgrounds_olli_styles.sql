-- Separate Team Talk background preferences by platform and add Olli visual styles.
-- Existing shared background is copied into both platform columns once for backward compatibility.

alter table public.academy_settings
  add column if not exists team_talk_background_pc text,
  add column if not exists team_talk_background_phone text;

update public.academy_settings
set
  team_talk_background_pc = coalesce(team_talk_background_pc, team_talk_background, 'dark'),
  team_talk_background_phone = coalesce(team_talk_background_phone, team_talk_background, 'dark')
where team_talk_background_pc is null
   or team_talk_background_phone is null;

alter table public.academy_settings
  alter column team_talk_background_pc set default 'dark',
  alter column team_talk_background_phone set default 'dark',
  alter column team_talk_background_pc set not null,
  alter column team_talk_background_phone set not null;

alter table public.academy_settings
  drop constraint if exists academy_settings_team_talk_background_pc_check,
  drop constraint if exists academy_settings_team_talk_background_phone_check;

alter table public.academy_settings
  add constraint academy_settings_team_talk_background_pc_check
    check (team_talk_background_pc in ('light','dark','light-blue','dark-blue','olli-light','olli-dark')),
  add constraint academy_settings_team_talk_background_phone_check
    check (team_talk_background_phone in ('light','dark','light-blue','dark-blue','olli-light','olli-dark'));

create or replace function public.olli_team_talk_background_get(
  p_session_token text,
  p_academy_id uuid,
  p_platform text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_platform text := lower(btrim(coalesce(p_platform, '')));
  v_background text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;
  if v_platform not in ('pc','phone') then raise exception '팀톡 배경 플랫폼 값을 확인해 주세요.'; end if;
  if not exists (
    select 1 from public.academy_members m
    join public.academies a on a.id = m.academy_id
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and a.status = 'active'
      and a.deleted_at is null
  ) then raise exception '현재 계정은 이 학원의 팀톡 배경설정을 확인할 수 없습니다.'; end if;

  insert into public.academy_settings(academy_id) values (p_academy_id)
  on conflict (academy_id) do nothing;

  select case when v_platform = 'phone' then s.team_talk_background_phone else s.team_talk_background_pc end
    into v_background
  from public.academy_settings s
  where s.academy_id = p_academy_id;

  return jsonb_build_object('ok', true, 'platform', v_platform, 'background', coalesce(v_background, 'dark'));
end;
$function$;

create or replace function public.olli_team_talk_background_update(
  p_session_token text,
  p_academy_id uuid,
  p_platform text,
  p_background text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_platform text := lower(btrim(coalesce(p_platform, '')));
  v_background text := lower(btrim(coalesce(p_background, 'dark')));
  v_role text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;

  select m.role into v_role
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and a.status = 'active'
    and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 else 3 end, m.created_at
  limit 1;

  if v_role not in ('owner','manager') then raise exception '팀톡 배경설정은 원장 또는 관리자만 변경할 수 있습니다.'; end if;
  if v_platform not in ('pc','phone') then raise exception '팀톡 배경 플랫폼 값을 확인해 주세요.'; end if;
  if v_background not in ('light','dark','light-blue','dark-blue','olli-light','olli-dark') then
    raise exception '팀톡 배경 설정 값을 확인해 주세요.';
  end if;

  insert into public.academy_settings(academy_id) values (p_academy_id)
  on conflict (academy_id) do nothing;

  if v_platform = 'phone' then
    update public.academy_settings
    set team_talk_background_phone = v_background, updated_at = now()
    where academy_id = p_academy_id;
  else
    update public.academy_settings
    set team_talk_background_pc = v_background, updated_at = now()
    where academy_id = p_academy_id;
  end if;

  return jsonb_build_object('ok', true, 'platform', v_platform, 'background', v_background);
end;
$function$;

revoke all on function public.olli_team_talk_background_get(text, uuid, text) from public;
revoke all on function public.olli_team_talk_background_update(text, uuid, text, text) from public;
grant execute on function public.olli_team_talk_background_get(text, uuid, text) to anon, authenticated, service_role;
grant execute on function public.olli_team_talk_background_update(text, uuid, text, text) to anon, authenticated, service_role;
