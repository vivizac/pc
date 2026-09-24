-- OLLI Team Chat delta sync
-- Step 4: forward message delta + durable mutable-change cursor.
-- Existing olli_team_chat_list remains unchanged as the full-snapshot fallback.

create table if not exists private.olli_team_chat_change_events (
  id bigint generated always as identity primary key,
  academy_id uuid not null references public.academies(id) on delete cascade,
  change_type text not null check (
    change_type in (
      'message_mutated',
      'action_mutated',
      'attachment_mutated',
      'mention_mutated',
      'read_state'
    )
  ),
  message_id bigint,
  from_message_id bigint,
  to_message_id bigint,
  created_at timestamptz not null default now()
);

alter table private.olli_team_chat_change_events enable row level security;
revoke all on table private.olli_team_chat_change_events from public, anon, authenticated;

create index if not exists olli_team_chat_change_events_academy_id_idx
  on private.olli_team_chat_change_events (academy_id, id);

create index if not exists olli_team_chat_change_events_academy_message_idx
  on private.olli_team_chat_change_events (academy_id, message_id, id desc)
  where message_id is not null;

create or replace function private.olli_team_chat_log_mutation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_academy_id uuid;
  v_message_id bigint;
  v_from_message_id bigint;
  v_to_message_id bigint;
  v_change_type text;
  v_event_id bigint;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) is not distinct from to_jsonb(old) then
    return new;
  end if;

  if tg_table_name = 'olli_team_chat_messages' then
    v_academy_id := coalesce(new.academy_id, old.academy_id);
    v_message_id := coalesce(new.id, old.id);
    v_change_type := 'message_mutated';
  elsif tg_table_name = 'olli_team_chat_actions' then
    v_academy_id := coalesce(new.academy_id, old.academy_id);
    v_message_id := coalesce(new.message_id, old.message_id);
    v_change_type := 'action_mutated';
  elsif tg_table_name = 'olli_team_chat_attachments' then
    v_academy_id := coalesce(new.academy_id, old.academy_id);
    v_message_id := coalesce(new.message_id, old.message_id);
    v_change_type := 'attachment_mutated';
  elsif tg_table_name = 'olli_team_chat_mentions' then
    v_academy_id := coalesce(new.academy_id, old.academy_id);
    v_message_id := coalesce(new.message_id, old.message_id);
    v_change_type := 'mention_mutated';
  elsif tg_table_name = 'olli_team_chat_member_state' then
    v_academy_id := coalesce(new.academy_id, old.academy_id);
    v_from_message_id := case when tg_op = 'INSERT' then 0 else coalesce(old.last_read_message_id, 0) end;
    v_to_message_id := case when tg_op = 'DELETE' then 0 else coalesce(new.last_read_message_id, 0) end;
    v_change_type := 'read_state';
  else
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_academy_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  insert into private.olli_team_chat_change_events (
    academy_id,
    change_type,
    message_id,
    from_message_id,
    to_message_id
  )
  values (
    v_academy_id,
    v_change_type,
    v_message_id,
    v_from_message_id,
    v_to_message_id
  )
  returning id into v_event_id;

  -- Existing mention/read RPCs already emit one coalesced chat signal.
  -- Mutations on message/action/attachment need their own wake-up path,
  -- including thumbnail metadata updates performed outside those RPCs.
  if v_change_type in ('message_mutated', 'action_mutated', 'attachment_mutated') then
    perform private.olli_realtime_send_signal(v_academy_id, 'chat', v_event_id);
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

revoke all on function private.olli_team_chat_log_mutation() from public, anon, authenticated;

drop trigger if exists olli_team_chat_delta_message_mutation_trg on public.olli_team_chat_messages;
create trigger olli_team_chat_delta_message_mutation_trg
after update or delete on public.olli_team_chat_messages
for each row execute function private.olli_team_chat_log_mutation();

drop trigger if exists olli_team_chat_delta_action_mutation_trg on public.olli_team_chat_actions;
create trigger olli_team_chat_delta_action_mutation_trg
after update or delete on public.olli_team_chat_actions
for each row execute function private.olli_team_chat_log_mutation();

drop trigger if exists olli_team_chat_delta_attachment_mutation_trg on public.olli_team_chat_attachments;
create trigger olli_team_chat_delta_attachment_mutation_trg
after update or delete on public.olli_team_chat_attachments
for each row execute function private.olli_team_chat_log_mutation();

drop trigger if exists olli_team_chat_delta_mention_mutation_trg on public.olli_team_chat_mentions;
create trigger olli_team_chat_delta_mention_mutation_trg
after insert or update or delete on public.olli_team_chat_mentions
for each row execute function private.olli_team_chat_log_mutation();

drop trigger if exists olli_team_chat_delta_read_state_trg on public.olli_team_chat_member_state;
create trigger olli_team_chat_delta_read_state_trg
after insert or update or delete on public.olli_team_chat_member_state
for each row execute function private.olli_team_chat_log_mutation();

create or replace function private.olli_team_chat_render_messages(
  p_academy_id uuid,
  p_message_ids bigint[]
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'academy_id', x.academy_id,
        'sender_member_id', x.sender_member_id,
        'sender_name', x.sender_name_snapshot,
        'message_type', x.message_type,
        'body', x.body,
        'reply_to_message_id', x.reply_to_message_id,
        'client_message_id', x.client_message_id,
        'created_at', x.created_at,
        'attachment', (
          select jsonb_build_object(
            'id', a.id,
            'kind', a.kind,
            'file_name', a.file_name,
            'mime_type', a.mime_type,
            'file_size', a.file_size,
            'thumbnail_storage_path', a.thumbnail_storage_path,
            'thumbnail_mime_type', a.thumbnail_mime_type,
            'thumbnail_size', a.thumbnail_size,
            'image_width', a.image_width,
            'image_height', a.image_height
          )
          from public.olli_team_chat_attachments a
          where a.academy_id = x.academy_id
            and a.message_id = x.id
          limit 1
        ),
        'action', (
          select jsonb_build_object(
            'id', ac.id,
            'action_type', ac.action_type,
            'status', ac.status,
            'revision', ac.revision,
            'created_at', ac.created_at,
            'updated_at', ac.updated_at,
            'resolved_at', ac.resolved_at,
            'error', ac.error_text,
            'result_message_id', ac.result_message_id
          )
          from public.olli_team_chat_actions ac
          where ac.academy_id = x.academy_id
            and ac.message_id = x.id
          limit 1
        ),
        'unread_count',
          case
            when exists (
              select 1
              from public.olli_team_chat_mentions mt
              where mt.academy_id = x.academy_id
                and mt.message_id = x.id
            )
            then (
              select count(*)::integer
              from public.olli_team_chat_mentions mt
              where mt.academy_id = x.academy_id
                and mt.message_id = x.id
                and mt.read_at is null
            )
            else (
              select count(*)::integer
              from public.academy_members am
              left join public.olli_team_chat_member_state st
                on st.academy_id = am.academy_id
               and st.member_id = am.id
              where am.academy_id = x.academy_id
                and am.status = 'active'
                and am.account_id is not null
                and (x.sender_member_id is null or am.id <> x.sender_member_id)
                and coalesce(st.last_read_message_id, 0) < x.id
            )
          end
      )
      order by x.id asc
    ),
    '[]'::jsonb
  )
  from public.olli_team_chat_messages x
  where x.academy_id = p_academy_id
    and x.deleted_at is null
    and x.id = any(coalesce(p_message_ids, array[]::bigint[]));
$function$;

revoke all on function private.olli_team_chat_render_messages(uuid, bigint[]) from public, anon, authenticated;

create or replace function public.olli_team_chat_delta(
  p_session_token text,
  p_academy_id uuid,
  p_after_message_id bigint default null,
  p_after_change_id bigint default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
  v_latest_message_id bigint := 0;
  v_latest_change_id bigint := 0;
  v_message_cursor bigint := greatest(coalesce(p_after_message_id, 0), 0);
  v_change_cursor bigint := greatest(coalesce(p_after_change_id, 0), 0);
  v_next_message_id bigint;
  v_next_change_id bigint;
  v_message_ids bigint[] := array[]::bigint[];
  v_change_event_ids bigint[] := array[]::bigint[];
  v_changed_message_ids bigint[] := array[]::bigint[];
  v_deleted_message_ids jsonb := '[]'::jsonb;
  v_new_messages jsonb := '[]'::jsonb;
  v_changed_messages jsonb := '[]'::jsonb;
  v_change_types jsonb := '[]'::jsonb;
  v_has_more_messages boolean := false;
  v_has_more_changes boolean := false;
  v_baseline boolean := p_after_message_id is null and p_after_change_id is null;
begin
  if p_academy_id is null
     or not private.olli_realtime_can_access(p_session_token, p_academy_id) then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'message', '팀톡 동기화 정보를 확인할 권한이 없습니다.'
    );
  end if;

  select coalesce(max(m.id), 0)
    into v_latest_message_id
  from public.olli_team_chat_messages m
  where m.academy_id = p_academy_id;

  select coalesce(max(e.id), 0)
    into v_latest_change_id
  from private.olli_team_chat_change_events e
  where e.academy_id = p_academy_id;

  if v_baseline then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'protocol', 1,
      'baseline', true,
      'academy_id', p_academy_id,
      'latest_message_id', v_latest_message_id,
      'latest_change_id', v_latest_change_id,
      'next_message_id', v_latest_message_id,
      'next_change_id', v_latest_change_id,
      'has_more_messages', false,
      'has_more_changes', false,
      'new_messages', '[]'::jsonb,
      'changed_messages', '[]'::jsonb,
      'deleted_message_ids', '[]'::jsonb,
      'change_types', '[]'::jsonb
    );
  end if;

  select
    coalesce(array_agg(q.id order by q.id asc), array[]::bigint[]),
    coalesce(max(q.id), v_message_cursor)
  into v_message_ids, v_next_message_id
  from (
    select m.id
    from public.olli_team_chat_messages m
    where m.academy_id = p_academy_id
      and m.id > v_message_cursor
    order by m.id asc
    limit v_limit
  ) q;

  select
    coalesce(array_agg(q.id order by q.id asc), array[]::bigint[]),
    coalesce(max(q.id), v_change_cursor)
  into v_change_event_ids, v_next_change_id
  from (
    select e.id
    from private.olli_team_chat_change_events e
    where e.academy_id = p_academy_id
      and e.id > v_change_cursor
    order by e.id asc
    limit v_limit
  ) q;

  select coalesce(array_agg(q.id order by q.id asc), array[]::bigint[])
    into v_changed_message_ids
  from (
    select ids.id
    from (
      select e.message_id as id
      from private.olli_team_chat_change_events e
      where e.academy_id = p_academy_id
        and e.id = any(v_change_event_ids)
        and e.change_type <> 'read_state'
        and e.message_id is not null

      union

      select m.id
      from private.olli_team_chat_change_events e
      join public.olli_team_chat_messages m
        on m.academy_id = e.academy_id
       and m.id > least(coalesce(e.from_message_id, 0), coalesce(e.to_message_id, 0))
       and m.id <= greatest(coalesce(e.from_message_id, 0), coalesce(e.to_message_id, 0))
      where e.academy_id = p_academy_id
        and e.id = any(v_change_event_ids)
        and e.change_type = 'read_state'
    ) ids
    where ids.id is not null
    group by ids.id
    order by ids.id desc
    limit 500
  ) q;

  v_new_messages := private.olli_team_chat_render_messages(p_academy_id, v_message_ids);
  v_changed_messages := private.olli_team_chat_render_messages(p_academy_id, v_changed_message_ids);

  select coalesce(jsonb_agg(q.id order by q.id asc), '[]'::jsonb)
    into v_deleted_message_ids
  from (
    select distinct m.id
    from public.olli_team_chat_messages m
    where m.academy_id = p_academy_id
      and m.deleted_at is not null
      and (
        m.id = any(v_message_ids)
        or m.id = any(v_changed_message_ids)
      )
  ) q;

  select coalesce(to_jsonb(array_agg(distinct e.change_type order by e.change_type)), '[]'::jsonb)
    into v_change_types
  from private.olli_team_chat_change_events e
  where e.academy_id = p_academy_id
    and e.id = any(v_change_event_ids);

  v_has_more_messages := v_latest_message_id > v_next_message_id;
  v_has_more_changes := v_latest_change_id > v_next_change_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'protocol', 1,
    'baseline', false,
    'academy_id', p_academy_id,
    'latest_message_id', v_latest_message_id,
    'latest_change_id', v_latest_change_id,
    'next_message_id', v_next_message_id,
    'next_change_id', v_next_change_id,
    'has_more_messages', v_has_more_messages,
    'has_more_changes', v_has_more_changes,
    'new_messages', v_new_messages,
    'changed_messages', v_changed_messages,
    'deleted_message_ids', v_deleted_message_ids,
    'change_types', v_change_types
  );
end;
$function$;

comment on function public.olli_team_chat_delta(text, uuid, bigint, bigint, integer) is
  'Forward Team Chat delta. New inserts use message id; mutable message state uses durable private change id.';

revoke all on function public.olli_team_chat_delta(text, uuid, bigint, bigint, integer) from public;
grant execute on function public.olli_team_chat_delta(text, uuid, bigint, bigint, integer) to anon, authenticated;

-- Step 3 manifest gains a durable chat mutation marker once the change log exists.
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
        'coverage', 'create_and_status_change'
      )
    ),
    'pending', pg_catalog.jsonb_build_object(
      'students', 'no_independent_durable_checkpoint',
      'observation', 'per_record_revision_only',
      'feedback', 'no_durable_change_cursor',
      'consultation', 'no_academy_checkpoint'
    )
  );
end;
$function$;

revoke all on function public.olli_sync_manifest(text, uuid) from public;
grant execute on function public.olli_sync_manifest(text, uuid) to anon, authenticated;
