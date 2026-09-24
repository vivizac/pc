-- OLLI Students + Consultation snapshot revisions
-- Step 7:
-- 1) Students reuse the existing schedule revision as their durable reconnect marker.
-- 2) Consultation gets one lightweight academy revision covering survey records and consultation settings.
-- 3) Realtime uses dedicated students / consultation domains; existing schedule behavior is preserved.

create table if not exists private.olli_consultation_sync_revisions (
  academy_id uuid primary key references public.academies(id) on delete cascade,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table private.olli_consultation_sync_revisions enable row level security;
revoke all on table private.olli_consultation_sync_revisions from public, anon, authenticated;

-- Extend shared realtime domains while preserving prior compatibility behavior.
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
     or v_domain not in ('observation', 'schedule', 'chat', 'materials', 'feedback', 'students', 'consultation') then
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

  -- Step 5 rolling-deploy compatibility for older material clients.
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

-- Preserve the existing schedule revision trigger contract.
-- When the source table is students, emit an additional students-only wake-up signal
-- using the same durable schedule revision. No second student revision is introduced.
create or replace function private.olli_schedule_bump_sync_revision()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_academy_id uuid;
  v_version bigint;
begin
  v_academy_id := case when tg_op = 'DELETE' then old.academy_id else new.academy_id end;
  if v_academy_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  insert into public.olli_schedule_sync_revisions (academy_id, version, updated_at)
  values (v_academy_id, 1, now())
  on conflict (academy_id)
  do update set
    version = public.olli_schedule_sync_revisions.version + 1,
    updated_at = now()
  returning version into v_version;

  if tg_table_name = 'students' then
    perform private.olli_realtime_send_signal(v_academy_id, 'students', v_version);
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

create or replace function private.olli_consultation_bump_sync_revision()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_academy_id uuid;
  v_version bigint;
begin
  if tg_table_name = 'academy_settings' and tg_op = 'UPDATE' then
    if new.consultation_rules is not distinct from old.consultation_rules
       and new.consultation_progress is not distinct from old.consultation_progress
       and new.elementary_group_feedback_months is not distinct from old.elementary_group_feedback_months then
      return new;
    end if;
  end if;

  v_academy_id := case when tg_op = 'DELETE' then old.academy_id else new.academy_id end;
  if v_academy_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  insert into private.olli_consultation_sync_revisions (academy_id, version, updated_at)
  values (v_academy_id, 1, now())
  on conflict (academy_id)
  do update set
    version = private.olli_consultation_sync_revisions.version + 1,
    updated_at = now()
  returning version into v_version;

  perform private.olli_realtime_send_signal(v_academy_id, 'consultation', v_version);

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

revoke all on function private.olli_consultation_bump_sync_revision() from public, anon, authenticated;

drop trigger if exists olli_consultation_surveys_sync_revision_trg on public.consultation_surveys;
create trigger olli_consultation_surveys_sync_revision_trg
after insert or update or delete on public.consultation_surveys
for each row execute function private.olli_consultation_bump_sync_revision();

drop trigger if exists olli_consultation_observations_sync_revision_trg on public.consultation_observations;
create trigger olli_consultation_observations_sync_revision_trg
after insert or update or delete on public.consultation_observations
for each row execute function private.olli_consultation_bump_sync_revision();

drop trigger if exists olli_consultation_final_analyses_sync_revision_trg on public.consultation_final_analyses;
create trigger olli_consultation_final_analyses_sync_revision_trg
after insert or update or delete on public.consultation_final_analyses
for each row execute function private.olli_consultation_bump_sync_revision();

drop trigger if exists olli_academy_settings_consultation_sync_revision_trg on public.academy_settings;
create trigger olli_academy_settings_consultation_sync_revision_trg
after insert or delete or update of consultation_rules, consultation_progress, elementary_group_feedback_months
on public.academy_settings
for each row execute function private.olli_consultation_bump_sync_revision();

-- Step 7 manifest:
-- students intentionally reuse schedule revision; consultation has its own lightweight revision.
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
  v_consultation_revision bigint := 0;
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
  ), 0) into v_chat_message_id;

  select coalesce((
    select e.id
    from private.olli_team_chat_change_events e
    where e.academy_id = p_academy_id
    order by e.id desc
    limit 1
  ), 0) into v_chat_change_id;

  select coalesce((
    select e.id
    from public.olli_team_material_request_events e
    where e.academy_id = p_academy_id
    order by e.id desc
    limit 1
  ), 0) into v_material_event_id;

  select coalesce((
    select e.id
    from private.olli_feedback_change_events e
    where e.academy_id = p_academy_id
    order by e.id desc
    limit 1
  ), 0) into v_feedback_event_id;

  select coalesce(r.version, 0)
    into v_consultation_revision
  from private.olli_consultation_sync_revisions r
  where r.academy_id = p_academy_id;
  v_consultation_revision := coalesce(v_consultation_revision, 0);

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
      'students', pg_catalog.jsonb_build_object(
        'kind', 'revision',
        'value', v_schedule_revision,
        'coverage', 'students_snapshot_via_schedule_revision'
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
      ),
      'consultation', pg_catalog.jsonb_build_object(
        'kind', 'revision',
        'value', v_consultation_revision,
        'coverage', 'consultation_snapshot_revision'
      )
    ),
    'pending', pg_catalog.jsonb_build_object(
      'observation', 'per_record_revision_only'
    )
  );
end;
$function$;

revoke all on function public.olli_sync_manifest(text, uuid) from public;
grant execute on function public.olli_sync_manifest(text, uuid) to anon, authenticated;
