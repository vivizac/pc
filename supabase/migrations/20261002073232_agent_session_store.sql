-- Olli Agents SDK persistent session storage.
-- Server-only store scoped by academy + member + Team Chat surface.

create table if not exists private.olli_agent_sessions (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  member_id uuid not null references public.academy_members(id) on delete cascade,
  surface text not null default 'team_talk'
    check (surface in ('team_talk')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  unique (academy_id, member_id, surface)
);

create table if not exists private.olli_agent_session_items (
  id bigint generated always as identity primary key,
  session_id uuid not null references private.olli_agent_sessions(id) on delete cascade,
  sequence_no bigint not null,
  batch_key text not null,
  batch_index integer not null check (batch_index >= 1 and batch_index <= 50),
  item jsonb not null check (jsonb_typeof(item) = 'object'),
  created_at timestamptz not null default now(),
  unique (session_id, sequence_no),
  unique (session_id, batch_key, batch_index)
);

create index if not exists olli_agent_session_items_recent_idx
  on private.olli_agent_session_items (session_id, sequence_no desc);

create table if not exists private.olli_agent_subject_refs (
  id bigint generated always as identity primary key,
  session_id uuid not null references private.olli_agent_sessions(id) on delete cascade,
  subject_ref text not null
    check (subject_ref ~ '^subject_[A-Za-z0-9_-]{16}$'),
  label text not null
    check (label ~ '^학생[A-Z]$'),
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  unique (session_id, subject_ref),
  unique (session_id, label),
  unique (session_id, student_id)
);

create index if not exists olli_agent_subject_refs_recent_idx
  on private.olli_agent_subject_refs (session_id, last_used_at desc);

alter table private.olli_agent_sessions enable row level security;
alter table private.olli_agent_session_items enable row level security;
alter table private.olli_agent_subject_refs enable row level security;

revoke all on table private.olli_agent_sessions from public, anon, authenticated;
revoke all on table private.olli_agent_session_items from public, anon, authenticated;
revoke all on table private.olli_agent_subject_refs from public, anon, authenticated;
revoke all on sequence private.olli_agent_session_items_id_seq from public, anon, authenticated;
revoke all on sequence private.olli_agent_subject_refs_id_seq from public, anon, authenticated;

grant select, insert, update, delete on table private.olli_agent_sessions to service_role;
grant select, insert, update, delete on table private.olli_agent_session_items to service_role;
grant select, insert, update, delete on table private.olli_agent_subject_refs to service_role;
grant usage, select on sequence private.olli_agent_session_items_id_seq to service_role;
grant usage, select on sequence private.olli_agent_subject_refs_id_seq to service_role;

create or replace function public.olli_agent_session_access(
  p_session_token text,
  p_academy_id uuid,
  p_member_id uuid,
  p_surface text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_surface text := lower(btrim(coalesce(p_surface, '')));
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_session_id uuid;
  v_items jsonb;
  v_item jsonb;
  v_item_id bigint;
  v_limit integer := 160;
  v_batch_key text;
  v_array jsonb;
  v_count integer := 0;
  v_max_sequence bigint := 0;
  v_added integer := 0;
  v_subjects jsonb;
  v_subject jsonb;
  v_student_id uuid;
  v_subject_ref text;
  v_label text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'OLLI_AGENT_SESSION_UNAUTHORIZED',
      'message', '로그인 세션을 확인하지 못했습니다.'
    );
  end if;

  if p_academy_id is null or p_member_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'OLLI_AGENT_SESSION_CONTEXT_REQUIRED',
      'message', '학원과 멤버 정보를 확인해 주세요.'
    );
  end if;

  if v_surface <> 'team_talk' then
    return jsonb_build_object(
      'ok', false,
      'code', 'OLLI_AGENT_SESSION_SURFACE_INVALID',
      'message', '지원하지 않는 Agent Session surface입니다.'
    );
  end if;

  if not exists (
    select 1
    from public.academy_members m
    join public.academies a on a.id = m.academy_id
    where m.id = p_member_id
      and m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and a.status = 'active'
      and a.deleted_at is null
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'OLLI_AGENT_SESSION_MEMBER_FORBIDDEN',
      'message', '현재 계정의 Agent Session 접근 권한을 확인하지 못했습니다.'
    );
  end if;

  insert into private.olli_agent_sessions (
    academy_id, member_id, surface, updated_at, last_active_at
  )
  values (
    p_academy_id, p_member_id, v_surface, now(), now()
  )
  on conflict (academy_id, member_id, surface)
  do update set
    updated_at = now(),
    last_active_at = now()
  returning id into v_session_id;

  if v_action = 'ensure' then
    return jsonb_build_object(
      'ok', true,
      'session_id', v_session_id
    );
  end if;

  if v_action = 'get_items' then
    begin
      v_limit := least(
        160,
        greatest(1, coalesce(nullif(v_payload->>'limit', '')::integer, 160))
      );
    exception when invalid_text_representation or numeric_value_out_of_range then
      v_limit := 160;
    end;

    select coalesce(jsonb_agg(q.item order by q.sequence_no), '[]'::jsonb)
    into v_items
    from (
      select i.sequence_no, i.item
      from private.olli_agent_session_items i
      where i.session_id = v_session_id
      order by i.sequence_no desc
      limit v_limit
    ) q;

    return jsonb_build_object(
      'ok', true,
      'session_id', v_session_id,
      'items', v_items
    );
  end if;

  if v_action = 'add_items' then
    v_array := v_payload->'items';
    v_batch_key := left(btrim(coalesce(v_payload->>'batch_key', '')), 220);

    if jsonb_typeof(v_array) <> 'array' or v_batch_key = '' then
      return jsonb_build_object(
        'ok', false,
        'code', 'OLLI_AGENT_SESSION_ITEMS_INVALID',
        'message', '저장할 Agent Session 항목을 확인해 주세요.'
      );
    end if;

    v_count := jsonb_array_length(v_array);
    if v_count < 1 or v_count > 50 then
      return jsonb_build_object(
        'ok', false,
        'code', 'OLLI_AGENT_SESSION_ITEMS_TOO_MANY',
        'message', '한 번에 저장할 Agent Session 항목 수를 확인해 주세요.'
      );
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_array) e(value)
      where jsonb_typeof(e.value) <> 'object'
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'OLLI_AGENT_SESSION_ITEM_INVALID',
        'message', 'Agent Session 항목 형식을 확인해 주세요.'
      );
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(v_session_id::text || ':olli-agent-session', 0)
    );

    select coalesce(max(i.sequence_no), 0)
    into v_max_sequence
    from private.olli_agent_session_items i
    where i.session_id = v_session_id;

    insert into private.olli_agent_session_items (
      session_id, sequence_no, batch_key, batch_index, item
    )
    select
      v_session_id,
      v_max_sequence + e.ordinality,
      v_batch_key,
      e.ordinality::integer,
      e.value
    from jsonb_array_elements(v_array) with ordinality as e(value, ordinality)
    on conflict (session_id, batch_key, batch_index) do nothing;

    get diagnostics v_added = row_count;

    delete from private.olli_agent_session_items old_item
    where old_item.id in (
      select prune.id
      from private.olli_agent_session_items prune
      where prune.session_id = v_session_id
      order by prune.sequence_no desc
      offset 160
    );

    update private.olli_agent_sessions
    set updated_at = now(), last_active_at = now()
    where id = v_session_id;

    return jsonb_build_object(
      'ok', true,
      'session_id', v_session_id,
      'added', v_added
    );
  end if;

  if v_action = 'pop_item' then
    perform pg_advisory_xact_lock(
      hashtextextended(v_session_id::text || ':olli-agent-session', 0)
    );

    select i.id, i.item
    into v_item_id, v_item
    from private.olli_agent_session_items i
    where i.session_id = v_session_id
    order by i.sequence_no desc
    limit 1
    for update;

    if v_item_id is not null then
      delete from private.olli_agent_session_items
      where id = v_item_id;
    end if;

    return jsonb_build_object(
      'ok', true,
      'session_id', v_session_id,
      'item', v_item
    );
  end if;

  if v_action = 'clear' then
    perform pg_advisory_xact_lock(
      hashtextextended(v_session_id::text || ':olli-agent-session', 0)
    );

    delete from private.olli_agent_session_items
    where session_id = v_session_id;

    delete from private.olli_agent_subject_refs
    where session_id = v_session_id;

    update private.olli_agent_sessions
    set updated_at = now(), last_active_at = now()
    where id = v_session_id;

    return jsonb_build_object(
      'ok', true,
      'session_id', v_session_id,
      'cleared', true
    );
  end if;

  if v_action = 'get_subjects' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'subject_ref', s.subject_ref,
      'label', s.label,
      'student_id', s.student_id,
      'last_used_at', s.last_used_at
    ) order by s.last_used_at desc, s.id desc), '[]'::jsonb)
    into v_subjects
    from private.olli_agent_subject_refs s
    where s.session_id = v_session_id;

    return jsonb_build_object(
      'ok', true,
      'session_id', v_session_id,
      'subjects', v_subjects
    );
  end if;

  if v_action = 'bind_subjects' then
    v_array := v_payload->'subjects';
    if jsonb_typeof(v_array) <> 'array'
       or jsonb_array_length(v_array) < 1
       or jsonb_array_length(v_array) > 8 then
      return jsonb_build_object(
        'ok', false,
        'code', 'OLLI_AGENT_SESSION_SUBJECTS_INVALID',
        'message', 'Agent Session 학생 참조 정보를 확인해 주세요.'
      );
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(v_session_id::text || ':olli-agent-session-subjects', 0)
    );

    for v_subject in
      select value
      from jsonb_array_elements(v_array)
    loop
      begin
        v_student_id := nullif(btrim(v_subject->>'student_id'), '')::uuid;
      exception when invalid_text_representation then
        return jsonb_build_object(
          'ok', false,
          'code', 'OLLI_AGENT_SESSION_SUBJECT_INVALID',
          'message', '학생 참조 정보를 확인해 주세요.'
        );
      end;

      v_subject_ref := btrim(coalesce(v_subject->>'subject_ref', ''));
      v_label := btrim(coalesce(v_subject->>'label', ''));

      if v_student_id is null
         or v_subject_ref !~ '^subject_[A-Za-z0-9_-]{16}$'
         or v_label !~ '^학생[A-Z]$' then
        return jsonb_build_object(
          'ok', false,
          'code', 'OLLI_AGENT_SESSION_SUBJECT_INVALID',
          'message', '학생 참조 정보를 확인해 주세요.'
        );
      end if;

      if not exists (
        select 1
        from public.students st
        where st.id = v_student_id
          and st.academy_id = p_academy_id
          and coalesce(st.is_deleted, false) = false
      ) then
        return jsonb_build_object(
          'ok', false,
          'code', 'OLLI_AGENT_SESSION_SUBJECT_FORBIDDEN',
          'message', '현재 학원에서 학생 참조를 확인하지 못했습니다.'
        );
      end if;

      if exists (
        select 1
        from private.olli_agent_subject_refs sr
        where sr.session_id = v_session_id
          and sr.student_id = v_student_id
      ) then
        update private.olli_agent_subject_refs
        set last_used_at = now()
        where session_id = v_session_id
          and student_id = v_student_id;
      else
        if exists (
          select 1
          from private.olli_agent_subject_refs sr
          where sr.session_id = v_session_id
            and (sr.subject_ref = v_subject_ref or sr.label = v_label)
        ) then
          return jsonb_build_object(
            'ok', false,
            'code', 'OLLI_AGENT_SESSION_SUBJECT_CONFLICT',
            'message', '이미 사용 중인 학생 참조입니다.'
          );
        end if;

        insert into private.olli_agent_subject_refs (
          session_id, subject_ref, label, student_id, last_used_at
        )
        values (
          v_session_id, v_subject_ref, v_label, v_student_id, now()
        );
      end if;
    end loop;

    select coalesce(jsonb_agg(jsonb_build_object(
      'subject_ref', s.subject_ref,
      'label', s.label,
      'student_id', s.student_id,
      'last_used_at', s.last_used_at
    ) order by s.last_used_at desc, s.id desc), '[]'::jsonb)
    into v_subjects
    from private.olli_agent_subject_refs s
    where s.session_id = v_session_id;

    return jsonb_build_object(
      'ok', true,
      'session_id', v_session_id,
      'subjects', v_subjects
    );
  end if;

  return jsonb_build_object(
    'ok', false,
    'code', 'OLLI_AGENT_SESSION_ACTION_UNSUPPORTED',
    'message', '지원하지 않는 Agent Session 작업입니다.'
  );
end;
$function$;

revoke all on function public.olli_agent_session_access(
  text, uuid, uuid, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.olli_agent_session_access(
  text, uuid, uuid, text, text, jsonb
) to service_role;
