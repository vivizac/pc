-- OLLI Feedback durable change sequence + per-student delta
-- Step 6: preserve existing feedback write/delete paths and observe them at the table level.

create table if not exists private.olli_feedback_change_events (
  id bigint generated always as identity primary key,
  academy_id uuid not null references public.academies(id) on delete cascade,
  student_id uuid,
  student_name text,
  source_table text not null check (source_table in ('feedbacks','fail_feedbacks','summary_feedbacks')),
  record_id text not null,
  change_type text not null check (change_type in ('inserted','updated','deleted','restored')),
  created_at timestamptz not null default now()
);

alter table private.olli_feedback_change_events enable row level security;
revoke all on table private.olli_feedback_change_events from public, anon, authenticated;

create index if not exists olli_feedback_change_events_academy_id_idx
  on private.olli_feedback_change_events (academy_id, id);

create index if not exists olli_feedback_change_events_academy_student_id_idx
  on private.olli_feedback_change_events (academy_id, student_id, id)
  where student_id is not null;

create index if not exists olli_feedback_change_events_academy_student_name_idx
  on private.olli_feedback_change_events (academy_id, student_name, id)
  where student_id is null and student_name is not null;

-- Extend the shared realtime sender while retaining Step 5 rolling-deploy compatibility.
create or replace function private.olli_realtime_send_signal(
  p_academy_id uuid,
  p_domain text,
  p_revision bigint default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_topic text;
  v_domain text;
begin
  v_domain := lower(btrim(coalesce(p_domain, '')));
  if p_academy_id is null
     or v_domain not in ('observation', 'schedule', 'chat', 'materials', 'feedback') then
    return;
  end if;

  v_topic := private.olli_realtime_topic_for_academy(p_academy_id);
  if v_topic is null then
    return;
  end if;

  perform realtime.send(
    pg_catalog.jsonb_build_object(
      'protocol', 1,
      'domain', v_domain,
      'revision', p_revision
    ),
    'changed',
    v_topic,
    false
  );

  if v_domain = 'materials' then
    perform realtime.send(
      pg_catalog.jsonb_build_object(
        'protocol', 1,
        'domain', 'chat',
        'revision', p_revision,
        'compatibility_alias', 'materials'
      ),
      'changed',
      v_topic,
      false
    );
  end if;
exception
  when others then
    raise warning 'OLLI realtime signal skipped: %', sqlerrm;
end;
$function$;

create or replace function private.olli_feedback_log_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_academy_id uuid;
  v_student_id uuid;
  v_student_name text;
  v_record_id text;
  v_source_table text := tg_table_name;
  v_change_type text;
  v_old_deleted boolean := false;
  v_new_deleted boolean := false;
  v_event_id bigint;
begin
  if tg_op = 'INSERT' then
    v_academy_id := new.academy_id;
    v_student_id := new.student_id;
    v_student_name := nullif(btrim(coalesce(new.student_name, '')), '');
    v_record_id := new.id::text;
    v_change_type := 'inserted';
  elsif tg_op = 'DELETE' then
    v_academy_id := old.academy_id;
    v_student_id := old.student_id;
    v_student_name := nullif(btrim(coalesce(old.student_name, '')), '');
    v_record_id := old.id::text;
    v_change_type := 'deleted';
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is not distinct from to_jsonb(old) then
      return new;
    end if;

    v_academy_id := coalesce(new.academy_id, old.academy_id);
    v_student_id := coalesce(new.student_id, old.student_id);
    v_student_name := nullif(btrim(coalesce(new.student_name, old.student_name, '')), '');
    v_record_id := coalesce(new.id, old.id)::text;
    v_old_deleted := coalesce(old.is_deleted, false);
    v_new_deleted := coalesce(new.is_deleted, false);

    if not v_old_deleted and v_new_deleted then
      v_change_type := 'deleted';
    elsif v_old_deleted and not v_new_deleted then
      v_change_type := 'restored';
    else
      v_change_type := 'updated';
    end if;
  else
    return coalesce(new, old);
  end if;

  -- Legacy rows without academy scope cannot participate in academy sync.
  if v_academy_id is null or v_record_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  insert into private.olli_feedback_change_events (
    academy_id,
    student_id,
    student_name,
    source_table,
    record_id,
    change_type
  )
  values (
    v_academy_id,
    v_student_id,
    v_student_name,
    v_source_table,
    v_record_id,
    v_change_type
  )
  returning id into v_event_id;

  perform private.olli_realtime_send_signal(v_academy_id, 'feedback', v_event_id);

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

revoke all on function private.olli_feedback_log_change() from public, anon, authenticated;

drop trigger if exists olli_feedback_change_event_trg on public.feedbacks;
create trigger olli_feedback_change_event_trg
after insert or update or delete on public.feedbacks
for each row execute function private.olli_feedback_log_change();

drop trigger if exists olli_growth_feedback_change_event_trg on public.fail_feedbacks;
create trigger olli_growth_feedback_change_event_trg
after insert or update or delete on public.fail_feedbacks
for each row execute function private.olli_feedback_log_change();

drop trigger if exists olli_summary_feedback_change_event_trg on public.summary_feedbacks;
create trigger olli_summary_feedback_change_event_trg
after insert or update or delete on public.summary_feedbacks
for each row execute function private.olli_feedback_log_change();

create or replace function public.olli_feedback_delta(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid default null,
  p_student_name text default null,
  p_after_event_id bigint default null,
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 500));
  v_cursor bigint := greatest(coalesce(p_after_event_id, 0), 0);
  v_student_name text := nullif(btrim(coalesce(p_student_name, '')), '');
  v_window_head bigint := 0;
  v_next_event_id bigint := v_cursor;
  v_event_ids bigint[] := array[]::bigint[];
  v_has_more boolean := false;
  v_baseline boolean := p_after_event_id is null;
  v_records jsonb := '[]'::jsonb;
  v_deleted_records jsonb := '[]'::jsonb;
  v_change_types jsonb := '[]'::jsonb;
begin
  if p_academy_id is null
     or not private.olli_realtime_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object(
      'ok', false,
      'message', '피드백 동기화 정보를 확인할 권한이 없습니다.'
    );
  end if;

  if p_student_id is null and v_student_name is null then
    return jsonb_build_object(
      'ok', false,
      'message', '피드백 동기화 학생 정보가 없습니다.'
    );
  end if;

  -- Freeze the academy event head before reading this student's window.
  select coalesce(max(e.id), 0)
    into v_window_head
  from private.olli_feedback_change_events e
  where e.academy_id = p_academy_id;

  if v_baseline then
    return jsonb_build_object(
      'ok', true,
      'protocol', 1,
      'baseline', true,
      'academy_id', p_academy_id,
      'student_id', p_student_id,
      'student_name', v_student_name,
      'latest_event_id', v_window_head,
      'next_event_id', v_window_head,
      'has_more', false,
      'records', '[]'::jsonb,
      'deleted_records', '[]'::jsonb,
      'change_types', '[]'::jsonb
    );
  end if;

  select
    coalesce(array_agg(q.id order by q.id), array[]::bigint[]),
    coalesce(max(q.id), v_cursor)
  into v_event_ids, v_next_event_id
  from (
    select e.id
    from private.olli_feedback_change_events e
    where e.academy_id = p_academy_id
      and e.id > v_cursor
      and e.id <= v_window_head
      and (
        (p_student_id is not null and e.student_id = p_student_id)
        or (
          e.student_id is null
          and v_student_name is not null
          and e.student_name = v_student_name
        )
      )
    order by e.id asc
    limit v_limit
  ) q;

  if cardinality(v_event_ids) = 0 then
    -- No relevant event exists in this frozen academy window.
    -- It is safe for this student's checkpoint to skip unrelated students.
    v_next_event_id := v_window_head;
  end if;

  with changed_keys as (
    select distinct e.source_table, e.record_id
    from private.olli_feedback_change_events e
    where e.academy_id = p_academy_id
      and e.id = any(v_event_ids)
  ),
  current_rows as (
    select 'feedbacks'::text as source_table, f.id::text as record_id, to_jsonb(f) as row_data
    from public.feedbacks f
    join changed_keys k on k.source_table='feedbacks' and k.record_id=f.id::text
    where f.academy_id=p_academy_id and coalesce(f.is_deleted,false)=false

    union all

    select 'fail_feedbacks', f.id::text, to_jsonb(f)
    from public.fail_feedbacks f
    join changed_keys k on k.source_table='fail_feedbacks' and k.record_id=f.id::text
    where f.academy_id=p_academy_id and coalesce(f.is_deleted,false)=false

    union all

    select 'summary_feedbacks', f.id::text, to_jsonb(f)
    from public.summary_feedbacks f
    join changed_keys k on k.source_table='summary_feedbacks' and k.record_id=f.id::text
    where f.academy_id=p_academy_id and coalesce(f.is_deleted,false)=false
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'source_table', source_table,
        'record_id', record_id,
        'row', row_data
      )
      order by source_table, record_id
    ),
    '[]'::jsonb
  )
  into v_records
  from current_rows;

  with changed_keys as (
    select distinct e.source_table, e.record_id
    from private.olli_feedback_change_events e
    where e.academy_id = p_academy_id
      and e.id = any(v_event_ids)
  ),
  missing_rows as (
    select k.source_table, k.record_id
    from changed_keys k
    where
      (k.source_table='feedbacks' and not exists (
        select 1 from public.feedbacks f
        where f.academy_id=p_academy_id
          and f.id::text=k.record_id
          and coalesce(f.is_deleted,false)=false
      ))
      or
      (k.source_table='fail_feedbacks' and not exists (
        select 1 from public.fail_feedbacks f
        where f.academy_id=p_academy_id
          and f.id::text=k.record_id
          and coalesce(f.is_deleted,false)=false
      ))
      or
      (k.source_table='summary_feedbacks' and not exists (
        select 1 from public.summary_feedbacks f
        where f.academy_id=p_academy_id
          and f.id::text=k.record_id
          and coalesce(f.is_deleted,false)=false
      ))
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'source_table', source_table,
        'record_id', record_id
      )
      order by source_table, record_id
    ),
    '[]'::jsonb
  )
  into v_deleted_records
  from missing_rows;

  select coalesce(
    to_jsonb(array_agg(distinct e.change_type order by e.change_type)),
    '[]'::jsonb
  )
  into v_change_types
  from private.olli_feedback_change_events e
  where e.academy_id=p_academy_id
    and e.id=any(v_event_ids);

  if cardinality(v_event_ids) > 0 then
    select exists (
      select 1
      from private.olli_feedback_change_events e
      where e.academy_id=p_academy_id
        and e.id > v_next_event_id
        and e.id <= v_window_head
        and (
          (p_student_id is not null and e.student_id=p_student_id)
          or (
            e.student_id is null
            and v_student_name is not null
            and e.student_name=v_student_name
          )
        )
    )
    into v_has_more;
  end if;

  return jsonb_build_object(
    'ok', true,
    'protocol', 1,
    'baseline', false,
    'academy_id', p_academy_id,
    'student_id', p_student_id,
    'student_name', v_student_name,
    'latest_event_id', v_window_head,
    'next_event_id', v_next_event_id,
    'has_more', v_has_more,
    'records', coalesce(v_records, '[]'::jsonb),
    'deleted_records', coalesce(v_deleted_records, '[]'::jsonb),
    'change_types', coalesce(v_change_types, '[]'::jsonb)
  );
end;
$function$;

comment on function public.olli_feedback_delta(text, uuid, uuid, text, bigint, integer) is
  'Per-student feedback delta over a durable academy change sequence. Supports hard delete and soft delete/restore.';

revoke all on function public.olli_feedback_delta(text, uuid, uuid, text, bigint, integer) from public;
grant execute on function public.olli_feedback_delta(text, uuid, uuid, text, bigint, integer)
  to anon, authenticated;

-- Step 3 manifest now exposes a durable feedback change marker.
create or replace function public.olli_sync_manifest(
  p_session_token text,
  p_academy_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_schedule_revision bigint := 0;
  v_chat_message_id bigint := 0;
  v_chat_change_id bigint := 0;
  v_material_event_id bigint := 0;
  v_feedback_event_id bigint := 0;
begin
  if p_academy_id is null
     or not private.olli_realtime_can_access(p_session_token, p_academy_id) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'message', '동기화 상태를 확인할 권한이 없습니다.'
    );
  end if;

  select coalesce(r.version, 0)
    into v_schedule_revision
  from public.olli_schedule_sync_revisions r
  where r.academy_id = p_academy_id;

  v_schedule_revision := coalesce(v_schedule_revision, 0);

  select coalesce((
    select m.id
    from public.olli_team_chat_messages m
    where m.academy_id = p_academy_id
    order by m.id desc
    limit 1
  ), 0)
    into v_chat_message_id;

  select coalesce((
    select e.id
    from private.olli_team_chat_change_events e
    where e.academy_id = p_academy_id
    order by e.id desc
    limit 1
  ), 0)
    into v_chat_change_id;

  select coalesce((
    select e.id
    from public.olli_team_material_request_events e
    where e.academy_id = p_academy_id
    order by e.id desc
    limit 1
  ), 0)
    into v_material_event_id;

  select coalesce((
    select e.id
    from private.olli_feedback_change_events e
    where e.academy_id = p_academy_id
    order by e.id desc
    limit 1
  ), 0)
    into v_feedback_event_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'protocol', 1,
    'academy_id', p_academy_id,
    'markers', pg_catalog.jsonb_build_object(
      'schedule', pg_catalog.jsonb_build_object(
        'kind', 'revision',
        'value', v_schedule_revision,
        'coverage', 'schedule_revision'
      ),
      'chat_messages', pg_catalog.jsonb_build_object(
        'kind', 'message_id',
        'value', v_chat_message_id,
        'coverage', 'message_insert'
      ),
      'chat_mutations', pg_catalog.jsonb_build_object(
        'kind', 'change_id',
        'value', v_chat_change_id,
        'coverage', 'message_action_attachment_mention_read_state'
      ),
      'materials', pg_catalog.jsonb_build_object(
        'kind', 'event_id',
        'value', v_material_event_id,
        'coverage', 'material_row_event_cursor'
      ),
      'feedback', pg_catalog.jsonb_build_object(
        'kind', 'event_id',
        'value', v_feedback_event_id,
        'coverage', 'feedback_row_event_cursor'
      )
    ),
    'pending', pg_catalog.jsonb_build_object(
      'students', 'no_independent_durable_checkpoint',
      'observation', 'per_record_revision_only',
      'consultation', 'no_academy_checkpoint'
    )
  );
end;
$function$;

revoke all on function public.olli_sync_manifest(text, uuid) from public;
grant execute on function public.olli_sync_manifest(text, uuid) to anon, authenticated;
