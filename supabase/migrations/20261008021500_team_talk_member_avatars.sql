alter table public.academy_members
  add column if not exists team_talk_avatar_key text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'academy_members_team_talk_avatar_key_check'
      and conrelid = 'public.academy_members'::regclass
  ) then
    alter table public.academy_members
      add constraint academy_members_team_talk_avatar_key_check
      check (
        team_talk_avatar_key is null
        or team_talk_avatar_key ~ '^avatar-(0[1-9]|1[0-5])$'
      );
  end if;
end
$$;

-- 비비작 현재 구성원에게만 요청된 초기 아이콘을 지정합니다.
-- 이 매핑은 공통 런타임 로직에 포함되지 않습니다.
update public.academy_members m
set team_talk_avatar_key = case m.display_name
  when '루루' then 'avatar-13'
  when '최민기' then 'avatar-11'
  when '송지원' then 'avatar-01'
  when '조영아' then 'avatar-05'
  when '김다미' then 'avatar-03'
  else m.team_talk_avatar_key
end
from public.academies a
where a.id = m.academy_id
  and a.academy_name = '비비작아이성향미술학원'
  and a.deleted_at is null
  and m.display_name in ('루루','최민기','송지원','조영아','김다미');

-- 기존 다른 구성원은 최초 한 번만 랜덤 배정하고 이후 값을 유지합니다.
update public.academy_members
set team_talk_avatar_key =
  'avatar-' || lpad((1 + floor(random() * 15))::int::text, 2, '0')
where status = 'active'
  and account_id is not null
  and team_talk_avatar_key is null;

create or replace function public.olli_team_talk_avatar_get(
  p_session_token text,
  p_academy_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_member_id uuid;
  v_avatar_key text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.id, m.team_talk_avatar_key
  into v_member_id, v_avatar_key
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and a.status = 'active'
    and a.deleted_at is null
  order by m.created_at
  limit 1;

  if v_member_id is null then
    raise exception '현재 계정은 이 학원의 팀챗을 사용할 수 없습니다.';
  end if;

  if v_avatar_key is null then
    update public.academy_members
    set team_talk_avatar_key =
      'avatar-' || lpad((1 + floor(random() * 15))::int::text, 2, '0')
    where id = v_member_id
      and team_talk_avatar_key is null
    returning team_talk_avatar_key into v_avatar_key;

    if v_avatar_key is null then
      select m.team_talk_avatar_key
      into v_avatar_key
      from public.academy_members m
      where m.id = v_member_id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'member_id', v_member_id,
    'avatar_key', v_avatar_key
  );
end;
$function$;

create or replace function public.olli_team_talk_avatar_update(
  p_session_token text,
  p_academy_id uuid,
  p_avatar_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_member_id uuid;
  v_avatar_key text := lower(trim(coalesce(p_avatar_key, '')));
begin
  if v_avatar_key !~ '^avatar-(0[1-9]|1[0-5])$' then
    raise exception '올바르지 않은 프로필 아이콘입니다.';
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.id
  into v_member_id
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and a.status = 'active'
    and a.deleted_at is null
  order by m.created_at
  limit 1;

  if v_member_id is null then
    raise exception '현재 계정은 이 학원의 팀챗을 사용할 수 없습니다.';
  end if;

  update public.academy_members
  set team_talk_avatar_key = v_avatar_key
  where id = v_member_id;

  return jsonb_build_object(
    'ok', true,
    'member_id', v_member_id,
    'avatar_key', v_avatar_key
  );
end;
$function$;

create or replace function public.olli_team_chat_members(
  p_session_token text,
  p_academy_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_current_member_id uuid;
  v_members jsonb;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.id
  into v_current_member_id
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and a.status = 'active'
    and a.deleted_at is null
  order by m.created_at
  limit 1;

  if v_current_member_id is null then
    raise exception '현재 계정은 이 학원의 올리톡을 사용할 수 없습니다.';
  end if;

  update public.academy_members
  set team_talk_avatar_key =
    'avatar-' || lpad((1 + floor(random() * 15))::int::text, 2, '0')
  where academy_id = p_academy_id
    and status = 'active'
    and account_id is not null
    and team_talk_avatar_key is null;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'member_id', m.id,
        'display_name', m.display_name,
        'role', m.role,
        'avatar_key', m.team_talk_avatar_key,
        'is_current_member', m.id = v_current_member_id
      )
      order by
        case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,
        m.display_name,
        m.created_at
    ),
    '[]'::jsonb
  )
  into v_members
  from public.academy_members m
  where m.academy_id = p_academy_id
    and m.status = 'active'
    and m.account_id is not null;

  return jsonb_build_object(
    'ok', true,
    'current_member_id', v_current_member_id,
    'members', v_members
  );
end;
$function$;
