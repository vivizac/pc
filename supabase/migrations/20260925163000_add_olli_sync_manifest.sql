-- OLLI Local-first Sync Manifest
-- Step 3: add a compact, read-only server freshness manifest.
-- This migration does not change any existing save/load/realtime/CAS path.

create index if not exists olli_team_material_request_events_academy_id_desc_idx
  on public.olli_team_material_request_events (academy_id, id desc);

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
  v_material_event_id bigint := 0;
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
    from public.olli_team_material_request_events e
    where e.academy_id = p_academy_id
    order by e.id desc
    limit 1
  ), 0)
    into v_material_event_id;

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
        'coverage', 'message_insert_only'
      ),
      'materials', pg_catalog.jsonb_build_object(
        'kind', 'event_id',
        'value', v_material_event_id,
        'coverage', 'create_and_status_change'
      )
    ),
    'pending', pg_catalog.jsonb_build_object(
      'students', 'no_independent_durable_checkpoint',
      'observation', 'per_record_revision_only',
      'feedback', 'no_durable_change_cursor',
      'consultation', 'no_academy_checkpoint',
      'chat_mutations', 'no_durable_change_cursor'
    )
  );
end;
$function$;

comment on function public.olli_sync_manifest(text, uuid) is
  'Read-only OLLI sync freshness manifest. Existing domain save/realtime logic remains authoritative.';

revoke all on function public.olli_sync_manifest(text, uuid) from public;
grant execute on function public.olli_sync_manifest(text, uuid) to anon, authenticated;
