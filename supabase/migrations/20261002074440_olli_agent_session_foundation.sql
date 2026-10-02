create table if not exists public.olli_agent_sessions (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  member_id uuid not null references public.academy_members(id) on delete cascade,
  surface text not null default 'team_talk' check (surface in ('team_talk')),
  status text not null default 'active' check (status in ('active','closed')),
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, member_id, surface)
);

create index if not exists olli_agent_sessions_activity_idx
  on public.olli_agent_sessions (academy_id, member_id, last_activity_at desc);

alter table public.olli_agent_sessions enable row level security;
revoke all on table public.olli_agent_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.olli_agent_sessions to service_role;

create table if not exists public.olli_agent_session_items (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.olli_agent_sessions(id) on delete cascade,
  item_type text not null check (item_type in ('user','assistant','tool_call','tool_result','action','system')),
  content jsonb not null default '{}'::jsonb,
  source_message_id bigint,
  client_item_key text not null,
  created_at timestamptz not null default now(),
  unique (session_id, client_item_key)
);

create index if not exists olli_agent_session_items_recent_idx
  on public.olli_agent_session_items (session_id, id desc);

alter table public.olli_agent_session_items enable row level security;
revoke all on table public.olli_agent_session_items from public, anon, authenticated;
revoke all on sequence public.olli_agent_session_items_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.olli_agent_session_items to service_role;
grant usage, select on sequence public.olli_agent_session_items_id_seq to service_role;

create table if not exists private.olli_agent_subject_refs (
  session_id uuid not null references public.olli_agent_sessions(id) on delete cascade,
  subject_ref text not null,
  student_id uuid not null references public.students(id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, subject_ref),
  unique (session_id, student_id),
  unique (session_id, label)
);

revoke all on table private.olli_agent_subject_refs from public, anon, authenticated;

create or replace function private.olli_agent_session_member(
  p_session_token text,
  p_academy_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_member_id uuid;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    return null;
  end if;

  select m.id
    into v_member_id
  from public.academy_members m
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
  order by case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end
  limit 1;

  return v_member_id;
end;
$$;

revoke all on function private.olli_agent_session_member(text, uuid) from public;

create or replace function public.olli_agent_session_open(
  p_session_token text,
  p_academy_id uuid,
  p_surface text default 'team_talk'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_surface text := lower(btrim(coalesce(p_surface, 'team_talk')));
  v_session public.olli_agent_sessions%rowtype;
  v_item_count integer;
begin
  if v_surface <> 'team_talk' then
    return jsonb_build_object('ok', false, 'code', 'OLLI_AGENT_SESSION_SURFACE_UNSUPPORTED', 'message', '지원하지 않는 Agent surface입니다.');
  end if;

  v_member_id := private.olli_agent_session_member(p_session_token, p_academy_id);
  if v_member_id is null then
    return jsonb_build_object('ok', false, 'code', 'OLLI_AGENT_SESSION_FORBIDDEN', 'message', 'Agent Session을 사용할 권한이 없습니다.');
  end if;

  insert into public.olli_agent_sessions (
    academy_id, member_id, surface, status, last_activity_at, updated_at
  ) values (
    p_academy_id, v_member_id, v_surface, 'active', now(), now()
  )
  on conflict (academy_id, member_id, surface)
  do update set
    status = 'active',
    last_activity_at = now(),
    updated_at = now()
  returning * into v_session;

  select count(*)::integer
    into v_item_count
  from public.olli_agent_session_items i
  where i.session_id = v_session.id;

  return jsonb_build_object(
    'ok', true,
    'session_id', v_session.id,
    'surface', v_session.surface,
    'item_count', coalesce(v_item_count, 0),
    'last_activity_at', v_session.last_activity_at
  );
end;
$$;

revoke all on function public.olli_agent_session_open(text, uuid, text) from public, anon, authenticated;
grant execute on function public.olli_agent_session_open(text, uuid, text) to service_role;

create or replace function public.olli_agent_session_append(
  p_session_token text,
  p_academy_id uuid,
  p_session_id uuid,
  p_item_type text,
  p_content jsonb,
  p_client_item_key text,
  p_source_message_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_item_type text := lower(btrim(coalesce(p_item_type, '')));
  v_key text := btrim(coalesce(p_client_item_key, ''));
  v_item_id bigint;
begin
  v_member_id := private.olli_agent_session_member(p_session_token, p_academy_id);
  if v_member_id is null then
    return jsonb_build_object('ok', false, 'code', 'OLLI_AGENT_SESSION_FORBIDDEN', 'message', 'Agent Session을 사용할 권한이 없습니다.');
  end if;

  if not exists (
    select 1
    from public.olli_agent_sessions s
    where s.id = p_session_id
      and s.academy_id = p_academy_id
      and s.member_id = v_member_id
      and s.surface = 'team_talk'
      and s.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'OLLI_AGENT_SESSION_NOT_FOUND', 'message', 'Agent Session을 찾지 못했습니다.');
  end if;

  if v_item_type not in ('user','assistant','tool_call','tool_result','action','system') then
    return jsonb_build_object('ok', false, 'code', 'OLLI_AGENT_SESSION_ITEM_TYPE_INVALID', 'message', '지원하지 않는 Agent Session item입니다.');
  end if;

  if v_key = '' or length(v_key) > 200 then
    return jsonb_build_object('ok', false, 'code', 'OLLI_AGENT_SESSION_ITEM_KEY_INVALID', 'message', 'Agent Session item key를 확인해 주세요.');
  end if;

  if p_content is null or jsonb_typeof(p_content) <> 'object' or length(p_content::text) > 12000 then
    return jsonb_build_object('ok', false, 'code', 'OLLI_AGENT_SESSION_CONTENT_INVALID', 'message', 'Agent Session 저장 내용을 확인해 주세요.');
  end if;

  insert into public.olli_agent_session_items (
    session_id, item_type, content, source_message_id, client_item_key
  ) values (
    p_session_id, v_item_type, p_content, p_source_message_id, v_key
  )
  on conflict (session_id, client_item_key)
  do update set client_item_key = excluded.client_item_key
  returning id into v_item_id;

  update public.olli_agent_sessions
  set last_activity_at = now(), updated_at = now()
  where id = p_session_id;

  return jsonb_build_object('ok', true, 'item_id', v_item_id);
end;
$$;

revoke all on function public.olli_agent_session_append(text, uuid, uuid, text, jsonb, text, bigint) from public, anon, authenticated;
grant execute on function public.olli_agent_session_append(text, uuid, uuid, text, jsonb, text, bigint) to service_role;

create or replace function public.olli_agent_session_recent(
  p_session_token text,
  p_academy_id uuid,
  p_session_id uuid,
  p_limit integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_items jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 50);
begin
  v_member_id := private.olli_agent_session_member(p_session_token, p_academy_id);
  if v_member_id is null then
    return jsonb_build_object('ok', false, 'code', 'OLLI_AGENT_SESSION_FORBIDDEN', 'message', 'Agent Session을 사용할 권한이 없습니다.');
  end if;

  if not exists (
    select 1
    from public.olli_agent_sessions s
    where s.id = p_session_id
      and s.academy_id = p_academy_id
      and s.member_id = v_member_id
      and s.surface = 'team_talk'
  ) then
    return jsonb_build_object('ok', false, 'code', 'OLLI_AGENT_SESSION_NOT_FOUND', 'message', 'Agent Session을 찾지 못했습니다.');
  end if;

  with recent as (
    select i.id, i.item_type, i.content, i.created_at
    from public.olli_agent_session_items i
    where i.session_id = p_session_id
    order by i.id desc
    limit v_limit
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'item_type', r.item_type,
        'content', r.content,
        'created_at', r.created_at
      )
      order by r.id
    ),
    '[]'::jsonb
  )
  into v_items
  from recent r;

  return jsonb_build_object('ok', true, 'items', v_items);
end;
$$;

revoke all on function public.olli_agent_session_recent(text, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.olli_agent_session_recent(text, uuid, uuid, integer) to service_role;

create or replace function public.olli_agent_subject_ref_upsert(
  p_session_token text,
  p_academy_id uuid,
  p_session_id uuid,
  p_subject_ref text,
  p_student_id uuid,
  p_label text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_subject_ref text := btrim(coalesce(p_subject_ref, ''));
  v_label text := btrim(coalesce(p_label, ''));
begin
  v_member_id := private.olli_agent_session_member(p_session_token, p_academy_id);
  if v_member_id is null then
    return jsonb_build_object('ok', false, 'code', 'OLLI_AGENT_SESSION_FORBIDDEN', 'message', 'Agent Session을 사용할 권한이 없습니다.');
  end if;

  if not exists (
    select 1
    from public.olli_agent_sessions s
    where s.id = p_session_id
      and s.academy_id = p_academy_id
      and s.member_id = v_member_id
      and s.surface = 'team_talk'
      and s.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'OLLI_AGENT_SESSION_NOT_FOUND', 'message', 'Agent Session을 찾지 못했습니다.');
  end if;

  if v_subject_ref = '' or length(v_subject_ref) > 120 or v_label !~ '^학생[A-Z]$' then
    return jsonb_build_object('ok', false, 'code', 'OLLI_AGENT_SUBJECT_REF_INVALID', 'message', '학생 참조 값을 확인해 주세요.');
  end if;

  if not exists (
    select 1
    from public.students st
    where st.id = p_student_id
      and st.academy_id = p_academy_id
      and coalesce(st.is_deleted, false) = false
  ) then
    return jsonb_build_object('ok', false, 'code', 'OLLI_AGENT_SUBJECT_STUDENT_NOT_FOUND', 'message', '학생 참조 대상을 확인하지 못했습니다.');
  end if;

  insert into private.olli_agent_subject_refs (
    session_id, subject_ref, student_id, label, updated_at
  ) values (
    p_session_id, v_subject_ref, p_student_id, v_label, now()
  )
  on conflict (session_id, student_id)
  do update set
    subject_ref = excluded.subject_ref,
    label = excluded.label,
    updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.olli_agent_subject_ref_upsert(text, uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.olli_agent_subject_ref_upsert(text, uuid, uuid, text, uuid, text) to service_role;

create or replace function public.olli_agent_subject_refs_get(
  p_session_token text,
  p_academy_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_items jsonb;
begin
  v_member_id := private.olli_agent_session_member(p_session_token, p_academy_id);
  if v_member_id is null then
    return jsonb_build_object('ok', false, 'code', 'OLLI_AGENT_SESSION_FORBIDDEN', 'message', 'Agent Session을 사용할 권한이 없습니다.');
  end if;

  if not exists (
    select 1
    from public.olli_agent_sessions s
    where s.id = p_session_id
      and s.academy_id = p_academy_id
      and s.member_id = v_member_id
      and s.surface = 'team_talk'
  ) then
    return jsonb_build_object('ok', false, 'code', 'OLLI_AGENT_SESSION_NOT_FOUND', 'message', 'Agent Session을 찾지 못했습니다.');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'subject_ref', r.subject_ref,
        'student_id', r.student_id,
        'label', r.label
      )
      order by r.updated_at desc, r.label
    ),
    '[]'::jsonb
  )
  into v_items
  from private.olli_agent_subject_refs r
  where r.session_id = p_session_id;

  return jsonb_build_object('ok', true, 'items', v_items);
end;
$$;

revoke all on function public.olli_agent_subject_refs_get(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.olli_agent_subject_refs_get(text, uuid, uuid) to service_role;
