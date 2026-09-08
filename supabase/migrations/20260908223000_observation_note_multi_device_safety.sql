-- Observation-note multi-device safety.
-- The server is the only authority for revision order. Device timestamps are display metadata only.

alter table public.student_note_drafts
  add column if not exists revision bigint not null default 1,
  add column if not exists last_mutation_id text,
  add column if not exists updated_by_account_id uuid,
  add column if not exists updated_by_device_id text;

create unique index if not exists student_note_drafts_academy_id_student_id_note_type_key
  on public.student_note_drafts (academy_id, student_id, note_type);

create schema if not exists private;

create table if not exists private.olli_data_conflicts (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null,
  feature text not null,
  student_id uuid,
  entity_key text not null,
  base_revision bigint,
  server_revision bigint,
  rejected_payload jsonb not null default '{}'::jsonb,
  mutation_id text,
  account_id uuid,
  device_id text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text,
  resolved_by_account_id uuid,
  resolved_by_device_id text
);

alter table private.olli_data_conflicts
  add column if not exists resolution text,
  add column if not exists resolved_by_account_id uuid,
  add column if not exists resolved_by_device_id text;

create index if not exists olli_data_conflicts_open_academy_feature_idx
  on private.olli_data_conflicts (academy_id, feature, created_at desc)
  where resolved_at is null;

create unique index if not exists olli_data_conflicts_mutation_unique_idx
  on private.olli_data_conflicts (academy_id, feature, mutation_id)
  where mutation_id is not null;

create or replace function public.olli_note_draft_save_cas(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_note_type text,
  p_content text,
  p_expected_revision bigint default null,
  p_mutation_id text default null,
  p_device_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_current public.student_note_drafts%rowtype;
  v_note_type text := btrim(coalesce(p_note_type, ''));
  v_content text := coalesce(p_content, '');
  v_mutation_id text := nullif(btrim(coalesce(p_mutation_id, '')), '');
  v_device_id text := nullif(btrim(coalesce(p_device_id, '')), '');
  v_expected bigint := coalesce(p_expected_revision, 0);
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null or not exists (
    select 1 from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and m.role in ('owner','manager','teacher')
  ) then
    return jsonb_build_object('ok', false, 'code', 'PERMISSION_DENIED', 'message', '관찰노트를 저장할 권한이 없습니다.');
  end if;

  if p_student_id is null or v_note_type = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', '관찰노트 저장 정보를 확인해 주세요.');
  end if;

  if not exists (
    select 1 from public.students s
    where s.id = p_student_id
      and s.academy_id = p_academy_id
      and coalesce(s.is_deleted, false) = false
  ) then
    return jsonb_build_object('ok', false, 'code', 'STUDENT_NOT_FOUND', 'message', '학생 정보를 찾을 수 없습니다.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':note-draft:' || p_student_id::text || ':' || v_note_type, 0
  ));

  select * into v_current
  from public.student_note_drafts d
  where d.academy_id = p_academy_id
    and d.student_id = p_student_id
    and d.note_type = v_note_type
  for update;

  if found then
    if v_mutation_id is not null and v_current.last_mutation_id = v_mutation_id then
      return jsonb_build_object(
        'ok', true, 'idempotent', true,
        'revision', v_current.revision,
        'updated_at', v_current.updated_at,
        'content', coalesce(v_current.content, ''),
        'student_id', v_current.student_id,
        'note_type', v_current.note_type
      );
    end if;

    if v_current.revision <> v_expected then
      insert into private.olli_data_conflicts (
        academy_id, feature, student_id, entity_key,
        base_revision, server_revision, rejected_payload,
        mutation_id, account_id, device_id
      ) values (
        p_academy_id, 'student_note_draft', p_student_id,
        p_student_id::text || ':' || v_note_type,
        v_expected, v_current.revision,
        jsonb_build_object('note_type', v_note_type, 'content', v_content),
        v_mutation_id, v_account_id, v_device_id
      ) on conflict do nothing;

      return jsonb_build_object(
        'ok', false,
        'code', 'REVISION_CONFLICT',
        'message', '다른 기기에서 더 최신 관찰노트가 저장되었습니다.',
        'expected_revision', v_expected,
        'server_revision', v_current.revision,
        'server_content', coalesce(v_current.content, ''),
        'server_updated_at', v_current.updated_at
      );
    end if;

    update public.student_note_drafts
       set content = v_content,
           revision = v_current.revision + 1,
           updated_at = now(),
           last_mutation_id = v_mutation_id,
           updated_by_account_id = v_account_id,
           updated_by_device_id = v_device_id,
           student_name = coalesce((select s.name from public.students s where s.id = p_student_id), v_current.student_name)
     where id = v_current.id
     returning * into v_current;
  else
    if v_expected <> 0 then
      insert into private.olli_data_conflicts (
        academy_id, feature, student_id, entity_key,
        base_revision, server_revision, rejected_payload,
        mutation_id, account_id, device_id
      ) values (
        p_academy_id, 'student_note_draft', p_student_id,
        p_student_id::text || ':' || v_note_type,
        v_expected, 0,
        jsonb_build_object('note_type', v_note_type, 'content', v_content),
        v_mutation_id, v_account_id, v_device_id
      ) on conflict do nothing;

      return jsonb_build_object(
        'ok', false,
        'code', 'REVISION_CONFLICT',
        'message', '관찰노트 서버 버전이 예상과 다릅니다.',
        'expected_revision', v_expected,
        'server_revision', 0,
        'server_content', '',
        'server_updated_at', null
      );
    end if;

    insert into public.student_note_drafts (
      academy_id, student_id, student_name, note_type, content,
      revision, updated_at, last_mutation_id,
      updated_by_account_id, updated_by_device_id
    )
    select p_academy_id, p_student_id, s.name, v_note_type, v_content,
           1, now(), v_mutation_id, v_account_id, v_device_id
      from public.students s
     where s.id = p_student_id and s.academy_id = p_academy_id
    returning * into v_current;
  end if;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'revision', v_current.revision,
    'updated_at', v_current.updated_at,
    'content', coalesce(v_current.content, ''),
    'student_id', v_current.student_id,
    'note_type', v_current.note_type
  );
end;
$$;

create or replace function public.olli_note_conflict_list(
  p_session_token text,
  p_academy_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_items jsonb;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null or not exists (
    select 1 from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and m.role in ('owner','manager','teacher')
  ) then
    return jsonb_build_object('ok', false, 'code', 'PERMISSION_DENIED', 'message', '복구센터를 볼 권한이 없습니다.');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
    into v_items
  from (
    select c.id,
           c.student_id,
           coalesce(s.name, '학생') as student_name,
           coalesce(c.rejected_payload->>'note_type', 'elementary_observation') as note_type,
           coalesce(c.rejected_payload->>'content', '') as rejected_content,
           c.base_revision,
           c.server_revision,
           c.mutation_id,
           c.device_id,
           c.created_at,
           d.revision as current_revision,
           coalesce(d.content, '') as current_content,
           d.updated_at as current_updated_at,
           d.updated_by_device_id as current_device_id
      from private.olli_data_conflicts c
      left join public.students s
        on s.id = c.student_id and s.academy_id = c.academy_id
      left join public.student_note_drafts d
        on d.academy_id = c.academy_id
       and d.student_id = c.student_id
       and d.note_type = coalesce(c.rejected_payload->>'note_type', 'elementary_observation')
     where c.academy_id = p_academy_id
       and c.feature = 'student_note_draft'
       and c.resolved_at is null
  ) x;

  return jsonb_build_object('ok', true, 'items', v_items);
end;
$$;

create or replace function public.olli_note_conflict_restore(
  p_session_token text,
  p_academy_id uuid,
  p_conflict_id uuid,
  p_expected_revision bigint,
  p_mutation_id text default null,
  p_device_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_conflict private.olli_data_conflicts%rowtype;
  v_current public.student_note_drafts%rowtype;
  v_note_type text;
  v_content text;
  v_expected bigint := coalesce(p_expected_revision, 0);
  v_mutation_id text := nullif(btrim(coalesce(p_mutation_id, '')), '');
  v_device_id text := nullif(btrim(coalesce(p_device_id, '')), '');
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null or not exists (
    select 1 from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and m.role in ('owner','manager','teacher')
  ) then
    return jsonb_build_object('ok', false, 'code', 'PERMISSION_DENIED', 'message', '충돌 작성본을 복구할 권한이 없습니다.');
  end if;

  select * into v_conflict
  from private.olli_data_conflicts c
  where c.id = p_conflict_id
    and c.academy_id = p_academy_id
    and c.feature = 'student_note_draft'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT_NOT_FOUND', 'message', '복구할 충돌 작성본을 찾지 못했습니다.');
  end if;

  if v_conflict.resolved_at is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'result', 'already_resolved', 'resolved_at', v_conflict.resolved_at);
  end if;

  v_note_type := coalesce(nullif(btrim(v_conflict.rejected_payload->>'note_type'), ''), 'elementary_observation');
  v_content := coalesce(v_conflict.rejected_payload->>'content', '');

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':note-draft:' || v_conflict.student_id::text || ':' || v_note_type, 0
  ));

  select * into v_current
  from public.student_note_drafts d
  where d.academy_id = p_academy_id
    and d.student_id = v_conflict.student_id
    and d.note_type = v_note_type
  for update;

  if found then
    if v_current.revision <> v_expected then
      return jsonb_build_object(
        'ok', false,
        'code', 'REVISION_CONFLICT',
        'message', '복구를 누른 뒤 다른 기기에서 기록이 다시 변경되었습니다. 최신 내용을 확인해 주세요.',
        'expected_revision', v_expected,
        'server_revision', v_current.revision,
        'server_content', coalesce(v_current.content, ''),
        'server_updated_at', v_current.updated_at
      );
    end if;

    update public.student_note_drafts
       set content = v_content,
           revision = v_current.revision + 1,
           updated_at = now(),
           last_mutation_id = v_mutation_id,
           updated_by_account_id = v_account_id,
           updated_by_device_id = v_device_id
     where id = v_current.id
     returning * into v_current;
  else
    if v_expected <> 0 then
      return jsonb_build_object(
        'ok', false,
        'code', 'REVISION_CONFLICT',
        'message', '현재 관찰노트 버전이 예상과 다릅니다. 최신 내용을 확인해 주세요.',
        'expected_revision', v_expected,
        'server_revision', 0,
        'server_content', '',
        'server_updated_at', null
      );
    end if;

    insert into public.student_note_drafts (
      academy_id, student_id, student_name, note_type, content,
      revision, updated_at, last_mutation_id,
      updated_by_account_id, updated_by_device_id
    )
    select p_academy_id, v_conflict.student_id, s.name, v_note_type, v_content,
           1, now(), v_mutation_id, v_account_id, v_device_id
      from public.students s
     where s.id = v_conflict.student_id and s.academy_id = p_academy_id
    returning * into v_current;

    if v_current.id is null then
      return jsonb_build_object('ok', false, 'code', 'STUDENT_NOT_FOUND', 'message', '학생 정보를 찾지 못했습니다.');
    end if;
  end if;

  update private.olli_data_conflicts
     set resolved_at = now(),
         resolution = 'restored_from_pc_recovery',
         resolved_by_account_id = v_account_id,
         resolved_by_device_id = v_device_id
   where id = v_conflict.id;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'result', 'restored',
    'conflict_id', v_conflict.id,
    'student_id', v_conflict.student_id,
    'note_type', v_note_type,
    'content', coalesce(v_current.content, ''),
    'revision', v_current.revision,
    'updated_at', v_current.updated_at
  );
end;
$$;

revoke all on function public.olli_note_draft_save_cas(text, uuid, uuid, text, text, bigint, text, text) from public;
revoke all on function public.olli_note_conflict_list(text, uuid) from public;
revoke all on function public.olli_note_conflict_restore(text, uuid, uuid, bigint, text, text) from public;
grant execute on function public.olli_note_draft_save_cas(text, uuid, uuid, text, text, bigint, text, text) to anon, authenticated;
grant execute on function public.olli_note_conflict_list(text, uuid) to anon, authenticated;
grant execute on function public.olli_note_conflict_restore(text, uuid, uuid, bigint, text, text) to anon, authenticated;
