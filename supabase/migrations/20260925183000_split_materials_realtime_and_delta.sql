-- OLLI Materials domain split + event cursor delta
-- Step 5: keep request CAS/revision semantics, centralize row-change events,
-- and separate material realtime from Team Chat.

-- Existing history only allows created/status_changed.
-- Extend it before the row trigger begins recording generic edits/soft-delete changes.
alter table public.olli_team_material_request_events
  drop constraint if exists olli_team_material_request_events_type_check;

alter table public.olli_team_material_request_events
  add constraint olli_team_material_request_events_type_check
  check (event_type in ('created','status_changed','updated','deleted','restored'));

create index if not exists olli_team_material_request_events_academy_id_desc_idx
  on public.olli_team_material_request_events (academy_id, id desc);

-- Realtime domain whitelist: materials becomes independent from chat.
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
     or v_domain not in ('observation', 'schedule', 'chat', 'materials') then
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

  -- Rolling-deploy compatibility:
  -- old clients only know the chat domain and their material watcher is attached there.
  -- New clients ignore this tagged alias, so Team Chat itself is not refreshed.
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

-- One DB-level source of truth for every application row mutation.
-- Hard DELETE is intentionally not used by the app; deleted_at is the durable tombstone.
create or replace function private.olli_team_material_request_log_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_event_type text;
  v_member_id uuid;
  v_from_status text;
  v_to_status text;
  v_note text;
  v_event_id bigint;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'created';
    v_member_id := new.requested_by_member_id;
    v_to_status := new.status;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is not distinct from to_jsonb(old) then
      return new;
    end if;

    if old.deleted_at is null and new.deleted_at is not null then
      v_event_type := 'deleted';
    elsif old.deleted_at is not null and new.deleted_at is null then
      v_event_type := 'restored';
    elsif new.status is distinct from old.status then
      v_event_type := 'status_changed';
      v_member_id := new.status_changed_by_member_id;
      v_from_status := old.status;
      v_to_status := new.status;
      if new.status = 'on_hold' then
        v_note := new.hold_reason;
      end if;
    else
      v_event_type := 'updated';
    end if;
  else
    return coalesce(new, old);
  end if;

  insert into public.olli_team_material_request_events (
    academy_id,
    request_id,
    member_id,
    event_type,
    from_status,
    to_status,
    note
  )
  values (
    new.academy_id,
    new.id,
    v_member_id,
    v_event_type,
    v_from_status,
    v_to_status,
    v_note
  )
  returning id into v_event_id;

  perform private.olli_realtime_send_signal(
    new.academy_id,
    'materials',
    v_event_id
  );

  return new;
end;
$function$;

revoke all on function private.olli_team_material_request_log_change()
  from public, anon, authenticated;

drop trigger if exists olli_team_material_request_change_event_trg
  on public.olli_team_material_requests;

create trigger olli_team_material_request_change_event_trg
after insert or update on public.olli_team_material_requests
for each row
execute function private.olli_team_material_request_log_change();

-- Preserve create idempotency and authorization.
-- Event + realtime are now emitted by the table trigger only.
create or replace function public.olli_team_material_request_create(
  p_session_token text,
  p_academy_id uuid,
  p_item_name text,
  p_quantity_text text,
  p_needed_on date default null,
  p_use_context text default null,
  p_purchase_url text default null,
  p_memo text default null,
  p_client_mutation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_request public.olli_team_material_requests%rowtype;
  v_item_name text := btrim(coalesce(p_item_name, ''));
  v_quantity_text text := btrim(coalesce(p_quantity_text, ''));
  v_use_context text := nullif(btrim(coalesce(p_use_context, '')), '');
  v_purchase_url text := nullif(btrim(coalesce(p_purchase_url, '')), '');
  v_memo text := nullif(btrim(coalesce(p_memo, '')), '');
  v_client_mutation_id uuid := coalesce(p_client_mutation_id, extensions.gen_random_uuid());
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.*
    into v_member
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and a.status = 'active'
    and a.deleted_at is null
  order by
    case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,
    m.created_at
  limit 1;

  if v_member.id is null then
    raise exception '현재 계정은 이 학원의 재료주문을 사용할 수 없습니다.';
  end if;

  if char_length(v_item_name) < 1 or char_length(v_item_name) > 120 then
    raise exception '재료명은 1~120자로 입력해 주세요.';
  end if;
  if char_length(v_quantity_text) < 1 or char_length(v_quantity_text) > 60 then
    raise exception '수량은 1~60자로 입력해 주세요.';
  end if;
  if v_use_context is not null and char_length(v_use_context) > 160 then
    raise exception '사용수업은 160자 이내로 입력해 주세요.';
  end if;
  if v_purchase_url is not null
     and (char_length(v_purchase_url) > 2000 or v_purchase_url !~* '^https?://') then
    raise exception '구매링크는 http 또는 https 주소로 입력해 주세요.';
  end if;
  if v_memo is not null and char_length(v_memo) > 1000 then
    raise exception '메모는 1000자 이내로 입력해 주세요.';
  end if;

  insert into public.olli_team_material_requests (
    academy_id,
    item_name,
    quantity_text,
    needed_on,
    use_context,
    purchase_url,
    memo,
    status,
    requested_by_member_id,
    requested_by_name_snapshot,
    status_changed_by_member_id,
    client_mutation_id
  )
  values (
    p_academy_id,
    v_item_name,
    v_quantity_text,
    p_needed_on,
    v_use_context,
    v_purchase_url,
    v_memo,
    'requested',
    v_member.id,
    v_member.display_name,
    v_member.id,
    v_client_mutation_id
  )
  on conflict (academy_id, client_mutation_id) do nothing
  returning * into v_request;

  if v_request.id is null then
    select r.*
      into v_request
    from public.olli_team_material_requests r
    where r.academy_id = p_academy_id
      and r.client_mutation_id = v_client_mutation_id
    limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request.id,
    'revision', v_request.revision,
    'status', v_request.status
  );
end;
$function$;

-- Preserve optimistic CAS exactly as before.
-- Event + realtime are now emitted by the table trigger only.
create or replace function public.olli_team_material_request_set_status(
  p_session_token text,
  p_academy_id uuid,
  p_request_id uuid,
  p_status text,
  p_expected_revision bigint,
  p_hold_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_request public.olli_team_material_requests%rowtype;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_hold_reason text := nullif(btrim(coalesce(p_hold_reason, '')), '');
  v_previous_status text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.*
    into v_member
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and a.status = 'active'
    and a.deleted_at is null
  order by
    case m.role when 'owner' then 1 when 'manager' then 2 else 3 end,
    m.created_at
  limit 1;

  if v_member.id is null or v_member.role not in ('owner','manager') then
    raise exception '재료 주문 상태는 원장 또는 관리자만 변경할 수 있습니다.';
  end if;

  if v_status not in ('requested','on_hold','ordered','arrived') then
    raise exception '재료 주문 상태 값을 확인해 주세요.';
  end if;
  if v_hold_reason is not null and char_length(v_hold_reason) > 500 then
    raise exception '보류 사유는 500자 이내로 입력해 주세요.';
  end if;

  select r.status
    into v_previous_status
  from public.olli_team_material_requests r
  where r.id = p_request_id
    and r.academy_id = p_academy_id
    and r.deleted_at is null;

  if v_previous_status is null then
    raise exception '재료 요청을 찾지 못했습니다.';
  end if;

  update public.olli_team_material_requests r
  set
    status = v_status,
    hold_reason = case when v_status = 'on_hold' then v_hold_reason else null end,
    status_changed_by_member_id = v_member.id,
    status_changed_at = now(),
    ordered_at = case
      when v_status = 'ordered' then coalesce(r.ordered_at, now())
      when v_status in ('requested','on_hold') then null
      else r.ordered_at
    end,
    ordered_by_member_id = case
      when v_status = 'ordered' then v_member.id
      when v_status in ('requested','on_hold') then null
      else r.ordered_by_member_id
    end,
    arrived_at = case
      when v_status = 'arrived' then coalesce(r.arrived_at, now())
      else null
    end,
    arrived_by_member_id = case
      when v_status = 'arrived' then v_member.id
      else null
    end,
    revision = r.revision + 1,
    updated_at = now()
  where r.id = p_request_id
    and r.academy_id = p_academy_id
    and r.deleted_at is null
    and r.revision = p_expected_revision
  returning r.* into v_request;

  if v_request.id is null then
    if exists (
      select 1
      from public.olli_team_material_requests r
      where r.id = p_request_id
        and r.academy_id = p_academy_id
        and r.deleted_at is null
    ) then
      raise exception '다른 기기에서 재료 상태가 먼저 변경되었습니다. 최신 상태를 다시 불러와 주세요.';
    end if;
    raise exception '재료 요청을 찾지 못했습니다.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request.id,
    'status', v_request.status,
    'revision', v_request.revision,
    'updated_at', v_request.updated_at
  );
end;
$function$;

create or replace function private.olli_team_material_render_requests(
  p_academy_id uuid,
  p_request_ids uuid[]
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
        'item_name', x.item_name,
        'quantity_text', x.quantity_text,
        'needed_on', x.needed_on,
        'use_context', x.use_context,
        'purchase_url', x.purchase_url,
        'memo', x.memo,
        'status', x.status,
        'hold_reason', x.hold_reason,
        'requested_by_member_id', x.requested_by_member_id,
        'requested_by_name', x.requested_by_name_snapshot,
        'status_changed_by_member_id', x.status_changed_by_member_id,
        'status_changed_by_name', changed.display_name,
        'status_changed_at', x.status_changed_at,
        'ordered_at', x.ordered_at,
        'arrived_at', x.arrived_at,
        'revision', x.revision,
        'created_at', x.created_at,
        'updated_at', x.updated_at
      )
      order by
        case x.status
          when 'requested' then 1
          when 'on_hold' then 2
          when 'ordered' then 3
          when 'arrived' then 4
          else 5
        end,
        x.needed_on nulls last,
        x.created_at desc
    ),
    '[]'::jsonb
  )
  from public.olli_team_material_requests x
  left join public.academy_members changed
    on changed.id = x.status_changed_by_member_id
  where x.academy_id = p_academy_id
    and x.deleted_at is null
    and x.id = any(coalesce(p_request_ids, array[]::uuid[]));
$function$;

revoke all on function private.olli_team_material_render_requests(uuid, uuid[])
  from public, anon, authenticated;

create or replace function public.olli_team_material_requests_delta(
  p_session_token text,
  p_academy_id uuid,
  p_after_event_id bigint default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
  v_cursor bigint := greatest(coalesce(p_after_event_id, 0), 0);
  v_latest_event_id bigint := 0;
  v_next_event_id bigint := 0;
  v_event_ids bigint[] := array[]::bigint[];
  v_request_ids uuid[] := array[]::uuid[];
  v_items jsonb := '[]'::jsonb;
  v_deleted_request_ids jsonb := '[]'::jsonb;
  v_change_types jsonb := '[]'::jsonb;
  v_summary jsonb := '{}'::jsonb;
  v_has_more boolean := false;
  v_baseline boolean := p_after_event_id is null;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.*
    into v_member
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and a.status = 'active'
    and a.deleted_at is null
  order by
    case m.role when 'owner' then 1 when 'manager' then 2 when 'teacher' then 3 else 4 end,
    m.created_at
  limit 1;

  if v_member.id is null then
    raise exception '현재 계정은 이 학원의 재료주문을 사용할 수 없습니다.';
  end if;

  select coalesce(max(e.id), 0)
    into v_latest_event_id
  from public.olli_team_material_request_events e
  where e.academy_id = p_academy_id;

  select jsonb_build_object(
    'requested', count(*) filter (where r.status = 'requested'),
    'on_hold', count(*) filter (where r.status = 'on_hold'),
    'ordered', count(*) filter (where r.status = 'ordered'),
    'arrived', count(*) filter (where r.status = 'arrived')
  )
    into v_summary
  from public.olli_team_material_requests r
  where r.academy_id = p_academy_id
    and r.deleted_at is null;

  if v_baseline then
    return jsonb_build_object(
      'ok', true,
      'protocol', 1,
      'baseline', true,
      'academy_id', p_academy_id,
      'current_member_id', v_member.id,
      'current_role', v_member.role,
      'can_process', v_member.role in ('owner','manager'),
      'summary', coalesce(v_summary, '{}'::jsonb),
      'latest_event_id', v_latest_event_id,
      'next_event_id', v_latest_event_id,
      'has_more', false,
      'items', '[]'::jsonb,
      'deleted_request_ids', '[]'::jsonb,
      'change_types', '[]'::jsonb
    );
  end if;

  select
    coalesce(array_agg(q.id order by q.id), array[]::bigint[]),
    coalesce(max(q.id), v_cursor)
  into v_event_ids, v_next_event_id
  from (
    select e.id
    from public.olli_team_material_request_events e
    where e.academy_id = p_academy_id
      and e.id > v_cursor
    order by e.id asc
    limit v_limit
  ) q;

  select coalesce(array_agg(q.request_id), array[]::uuid[])
    into v_request_ids
  from (
    select distinct e.request_id
    from public.olli_team_material_request_events e
    where e.academy_id = p_academy_id
      and e.id = any(v_event_ids)
      and e.request_id is not null
  ) q;

  v_items := private.olli_team_material_render_requests(
    p_academy_id,
    v_request_ids
  );

  select coalesce(jsonb_agg(q.request_id order by q.request_id), '[]'::jsonb)
    into v_deleted_request_ids
  from (
    select distinct ids.request_id
    from unnest(v_request_ids) as ids(request_id)
    left join public.olli_team_material_requests r
      on r.academy_id = p_academy_id
     and r.id = ids.request_id
    where r.id is null
       or r.deleted_at is not null
  ) q;

  select coalesce(
    to_jsonb(array_agg(distinct e.event_type order by e.event_type)),
    '[]'::jsonb
  )
    into v_change_types
  from public.olli_team_material_request_events e
  where e.academy_id = p_academy_id
    and e.id = any(v_event_ids);

  v_has_more := v_latest_event_id > v_next_event_id;

  return jsonb_build_object(
    'ok', true,
    'protocol', 1,
    'baseline', false,
    'academy_id', p_academy_id,
    'current_member_id', v_member.id,
    'current_role', v_member.role,
    'can_process', v_member.role in ('owner','manager'),
    'summary', coalesce(v_summary, '{}'::jsonb),
    'latest_event_id', v_latest_event_id,
    'next_event_id', v_next_event_id,
    'has_more', v_has_more,
    'items', coalesce(v_items, '[]'::jsonb),
    'deleted_request_ids', coalesce(v_deleted_request_ids, '[]'::jsonb),
    'change_types', coalesce(v_change_types, '[]'::jsonb)
  );
end;
$function$;

comment on function public.olli_team_material_requests_delta(text, uuid, bigint, integer) is
  'Forward material-request delta using durable material event id. Full list RPC remains the fallback.';

revoke all on function public.olli_team_material_requests_delta(text, uuid, bigint, integer)
  from public;
grant execute on function public.olli_team_material_requests_delta(text, uuid, bigint, integer)
  to anon, authenticated;

-- Keep the existing public write/read grants unchanged.
revoke all on function public.olli_team_material_request_create(text, uuid, text, text, date, text, text, text, uuid)
  from public;
revoke all on function public.olli_team_material_request_set_status(text, uuid, uuid, text, bigint, text)
  from public;
grant execute on function public.olli_team_material_request_create(text, uuid, text, text, date, text, text, text, uuid)
  to anon, authenticated;
grant execute on function public.olli_team_material_request_set_status(text, uuid, uuid, text, bigint, text)
  to anon, authenticated;
