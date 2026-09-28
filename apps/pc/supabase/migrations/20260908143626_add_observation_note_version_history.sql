-- 관찰노트 성공 저장본 버전 이력
-- 충돌센터(private.olli_data_conflicts)는 거절된 저장을 보관하고,
-- 이 테이블은 정상적으로 반영된 revision만 보관한다.

create table if not exists private.olli_note_draft_versions (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null,
  student_id uuid not null,
  note_type text not null,
  revision bigint not null,
  content text not null default '',
  saved_at timestamptz not null default now(),
  account_id uuid null,
  device_id text null,
  mutation_id text null,
  source text not null default 'save',
  source_revision bigint null,
  created_at timestamptz not null default now(),
  constraint olli_note_draft_versions_revision_nonnegative check (revision >= 0),
  constraint olli_note_draft_versions_unique_revision unique (academy_id, student_id, note_type, revision)
);

create index if not exists olli_note_draft_versions_lookup_idx
  on private.olli_note_draft_versions (academy_id, student_id, note_type, revision desc);

revoke all on table private.olli_note_draft_versions from public, anon, authenticated;
grant usage on schema private to anon, authenticated;

create or replace function private.olli_capture_note_draft_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text := coalesce(nullif(current_setting('olli.note_version_source', true), ''), lower(tg_op));
  v_source_revision bigint;
begin
  begin
    v_source_revision := nullif(current_setting('olli.note_version_source_revision', true), '')::bigint;
  exception when others then
    v_source_revision := null;
  end;

  insert into private.olli_note_draft_versions (
    academy_id, student_id, note_type, revision, content,
    saved_at, account_id, device_id, mutation_id,
    source, source_revision
  ) values (
    new.academy_id,
    new.student_id,
    new.note_type,
    new.revision,
    coalesce(new.content, ''),
    coalesce(new.updated_at, now()),
    new.updated_by_account_id,
    new.updated_by_device_id,
    new.last_mutation_id,
    v_source,
    v_source_revision
  )
  on conflict (academy_id, student_id, note_type, revision) do nothing;

  -- 작업용 관찰노트는 학생/노트유형별 최근 300 revision만 유지한다.
  delete from private.olli_note_draft_versions history_row
  where history_row.id in (
    select v.id
    from private.olli_note_draft_versions v
    where v.academy_id = new.academy_id
      and v.student_id = new.student_id
      and v.note_type = new.note_type
    order by v.revision desc, v.created_at desc
    offset 300
  );

  return new;
end;
$$;

revoke all on function private.olli_capture_note_draft_version() from public, anon, authenticated;

drop trigger if exists olli_note_draft_version_capture on public.student_note_drafts;
create trigger olli_note_draft_version_capture
after insert or update of content, revision, updated_at, last_mutation_id, updated_by_account_id, updated_by_device_id
on public.student_note_drafts
for each row
execute function private.olli_capture_note_draft_version();

-- 기존 현재 저장본을 최초 복구 기준점으로 1회 보관한다.
insert into private.olli_note_draft_versions (
  academy_id, student_id, note_type, revision, content,
  saved_at, account_id, device_id, mutation_id, source
)
select d.academy_id,
       d.student_id,
       d.note_type,
       d.revision,
       coalesce(d.content, ''),
       coalesce(d.updated_at, now()),
       d.updated_by_account_id,
       d.updated_by_device_id,
       d.last_mutation_id,
       'backfill_current'
from public.student_note_drafts d
on conflict (academy_id, student_id, note_type, revision) do nothing;

create or replace function private.olli_note_draft_version_list_impl(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_note_type text,
  p_limit integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_note_type text := btrim(coalesce(p_note_type, ''));
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 50));
  v_items jsonb;
  v_current_revision bigint;
  v_current_updated_at timestamptz;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null or not exists (
    select 1
    from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and m.role in ('owner','manager','teacher')
  ) then
    return jsonb_build_object('ok', false, 'code', 'PERMISSION_DENIED', 'message', '관찰노트 이전 기록을 볼 권한이 없습니다.');
  end if;

  if p_student_id is null or v_note_type = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', '관찰노트 이전 기록 정보를 확인해 주세요.');
  end if;

  if not exists (
    select 1
    from public.students s
    where s.id = p_student_id
      and s.academy_id = p_academy_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'STUDENT_NOT_FOUND', 'message', '학생 정보를 찾을 수 없습니다.');
  end if;

  select d.revision, d.updated_at
    into v_current_revision, v_current_updated_at
  from public.student_note_drafts d
  where d.academy_id = p_academy_id
    and d.student_id = p_student_id
    and d.note_type = v_note_type;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.revision desc), '[]'::jsonb)
    into v_items
  from (
    select v.revision,
           v.content,
           v.saved_at,
           v.device_id,
           v.source,
           v.source_revision,
           (v.revision = v_current_revision) as is_current
    from private.olli_note_draft_versions v
    where v.academy_id = p_academy_id
      and v.student_id = p_student_id
      and v.note_type = v_note_type
    order by v.revision desc
    limit v_limit
  ) x;

  return jsonb_build_object(
    'ok', true,
    'student_id', p_student_id,
    'note_type', v_note_type,
    'current_revision', coalesce(v_current_revision, 0),
    'current_updated_at', v_current_updated_at,
    'items', v_items
  );
end;
$$;

revoke all on function private.olli_note_draft_version_list_impl(text, uuid, uuid, text, integer) from public;
grant execute on function private.olli_note_draft_version_list_impl(text, uuid, uuid, text, integer) to anon, authenticated;

create or replace function public.olli_note_draft_version_list(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_note_type text,
  p_limit integer default 30
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.olli_note_draft_version_list_impl(
    p_session_token, p_academy_id, p_student_id, p_note_type, p_limit
  );
$$;

revoke all on function public.olli_note_draft_version_list(text, uuid, uuid, text, integer) from public;
grant execute on function public.olli_note_draft_version_list(text, uuid, uuid, text, integer) to anon, authenticated;

create or replace function private.olli_note_draft_version_restore_impl(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_note_type text,
  p_target_revision bigint,
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
  v_note_type text := btrim(coalesce(p_note_type, ''));
  v_target private.olli_note_draft_versions%rowtype;
  v_current public.student_note_drafts%rowtype;
  v_expected bigint := coalesce(p_expected_revision, 0);
  v_mutation_id text := nullif(btrim(coalesce(p_mutation_id, '')), '');
  v_device_id text := nullif(btrim(coalesce(p_device_id, '')), '');
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null or not exists (
    select 1
    from public.academy_members m
    where m.academy_id = p_academy_id
      and m.account_id = v_account_id
      and m.status = 'active'
      and m.role in ('owner','manager','teacher')
  ) then
    return jsonb_build_object('ok', false, 'code', 'PERMISSION_DENIED', 'message', '관찰노트 이전 기록을 복구할 권한이 없습니다.');
  end if;

  if p_student_id is null or v_note_type = '' or p_target_revision is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', '복구할 관찰노트 버전을 확인해 주세요.');
  end if;

  select * into v_target
  from private.olli_note_draft_versions v
  where v.academy_id = p_academy_id
    and v.student_id = p_student_id
    and v.note_type = v_note_type
    and v.revision = p_target_revision;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'VERSION_NOT_FOUND', 'message', '복구할 이전 기록을 찾지 못했습니다.');
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
    if v_current.revision <> v_expected then
      return jsonb_build_object(
        'ok', false,
        'code', 'REVISION_CONFLICT',
        'message', '이전 기록을 선택한 뒤 다른 기기에서 관찰노트가 변경되었습니다. 최신 내용을 확인해 주세요.',
        'expected_revision', v_expected,
        'server_revision', v_current.revision,
        'server_content', coalesce(v_current.content, ''),
        'server_updated_at', v_current.updated_at
      );
    end if;

    if v_current.revision = v_target.revision and coalesce(v_current.content, '') = v_target.content then
      return jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'result', 'already_current',
        'revision', v_current.revision,
        'content', coalesce(v_current.content, ''),
        'updated_at', v_current.updated_at
      );
    end if;

    perform set_config('olli.note_version_source', 'history_restore', true);
    perform set_config('olli.note_version_source_revision', v_target.revision::text, true);

    update public.student_note_drafts
       set content = v_target.content,
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

    perform set_config('olli.note_version_source', 'history_restore', true);
    perform set_config('olli.note_version_source_revision', v_target.revision::text, true);

    insert into public.student_note_drafts (
      academy_id, student_id, student_name, note_type, content,
      revision, updated_at, last_mutation_id,
      updated_by_account_id, updated_by_device_id
    )
    select p_academy_id, p_student_id, s.name, v_note_type, v_target.content,
           1, now(), v_mutation_id, v_account_id, v_device_id
    from public.students s
    where s.id = p_student_id and s.academy_id = p_academy_id
    returning * into v_current;

    if v_current.id is null then
      return jsonb_build_object('ok', false, 'code', 'STUDENT_NOT_FOUND', 'message', '학생 정보를 찾지 못했습니다.');
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'result', 'restored',
    'student_id', p_student_id,
    'note_type', v_note_type,
    'restored_from_revision', v_target.revision,
    'revision', v_current.revision,
    'content', coalesce(v_current.content, ''),
    'updated_at', v_current.updated_at
  );
end;
$$;

revoke all on function private.olli_note_draft_version_restore_impl(text, uuid, uuid, text, bigint, bigint, text, text) from public;
grant execute on function private.olli_note_draft_version_restore_impl(text, uuid, uuid, text, bigint, bigint, text, text) to anon, authenticated;

create or replace function public.olli_note_draft_version_restore(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_note_type text,
  p_target_revision bigint,
  p_expected_revision bigint,
  p_mutation_id text default null,
  p_device_id text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.olli_note_draft_version_restore_impl(
    p_session_token,
    p_academy_id,
    p_student_id,
    p_note_type,
    p_target_revision,
    p_expected_revision,
    p_mutation_id,
    p_device_id
  );
$$;

revoke all on function public.olli_note_draft_version_restore(text, uuid, uuid, text, bigint, bigint, text, text) from public;
grant execute on function public.olli_note_draft_version_restore(text, uuid, uuid, text, bigint, bigint, text, text) to anon, authenticated;
