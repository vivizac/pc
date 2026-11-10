-- Move individual arrived material requests to the existing archive without changing needed_on.
-- Automatic archive (needed_on before today's Korea-local date) is preserved.
-- This migration does not modify existing rows; only successful owner/manager action sets the marker.
begin;

alter table public.olli_team_material_requests
  add column if not exists manually_archived_at timestamptz,
  add column if not exists manually_archived_by_member_id uuid references public.academy_members(id);

comment on column public.olli_team_material_requests.manually_archived_at
  is 'Nullable manual archive marker for arrived requests; auto archive by needed_on still applies.';

CREATE OR REPLACE FUNCTION public.olli_team_material_requests_list(p_session_token text, p_academy_id uuid, p_limit integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_limit integer := greatest(1, least(coalesce(p_limit, 300), 500));
  v_items jsonb;
  v_summary jsonb;
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

  select jsonb_build_object(
    'requested', count(*) filter (where r.status = 'requested'),
    'on_hold', count(*) filter (where r.status = 'on_hold'),
    'ordered', count(*) filter (where r.status = 'ordered'),
    'arrived', count(*) filter (where r.status = 'arrived')
  )
    into v_summary
  from public.olli_team_material_requests r
  where r.academy_id = p_academy_id
    and r.deleted_at is null
    and r.manually_archived_at is null
    and (r.needed_on is null or r.needed_on >= (now() at time zone 'Asia/Seoul')::date);

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
        'status_changed_by_name', x.status_changed_by_name,
        'status_changed_at', x.status_changed_at,
        'ordered_at', x.ordered_at,
        'arrived_at', x.arrived_at,
        'revision', x.revision,
        'created_at', x.created_at,
        'updated_at', x.updated_at
      )
      order by
        case x.status when 'requested' then 1 when 'on_hold' then 2 when 'ordered' then 3 when 'arrived' then 4 else 5 end,
        x.needed_on nulls last,
        x.created_at desc
    ),
    '[]'::jsonb
  )
    into v_items
  from (
    select
      r.*,
      changed.display_name as status_changed_by_name
    from public.olli_team_material_requests r
    left join public.academy_members changed on changed.id = r.status_changed_by_member_id
    where r.academy_id = p_academy_id
      and r.deleted_at is null
      and r.manually_archived_at is null
    and (r.needed_on is null or r.needed_on >= (now() at time zone 'Asia/Seoul')::date)
    order by
      case r.status when 'requested' then 1 when 'on_hold' then 2 when 'ordered' then 3 when 'arrived' then 4 else 5 end,
      r.needed_on nulls last,
      r.created_at desc
    limit v_limit
  ) x;

  return jsonb_build_object(
    'ok', true,
    'academy_id', p_academy_id,
    'current_member_id', v_member.id,
    'current_role', v_member.role,
    'can_process', v_member.role in ('owner','manager'),
    'summary', coalesce(v_summary, '{}'::jsonb),
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.olli_team_material_requests_archive(p_session_token text, p_academy_id uuid, p_year integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_year integer := p_year;
  v_years jsonb;
  v_items jsonb := '[]'::jsonb;
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
    raise exception '현재 계정은 이 학원의 재료주문 보관함을 사용할 수 없습니다.';
  end if;

  if v_year is not null and (v_year < 2000 or v_year > 2100) then
    raise exception '보관함 연도를 확인해 주세요.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'year', grouped.archive_year,
        'count', grouped.archive_count
      )
      order by grouped.archive_year desc
    ),
    '[]'::jsonb
  )
    into v_years
  from (
    select
      extract(year from (case when r.manually_archived_at is not null then (r.manually_archived_at at time zone 'Asia/Seoul')::date else r.needed_on end))::integer as archive_year,
      count(*)::integer as archive_count
    from public.olli_team_material_requests r
    where r.academy_id = p_academy_id
      and r.deleted_at is null
      and (r.manually_archived_at is not null
      or (r.needed_on is not null and r.needed_on < (now() at time zone 'Asia/Seoul')::date))
    group by extract(year from (case when r.manually_archived_at is not null then (r.manually_archived_at at time zone 'Asia/Seoul')::date else r.needed_on end))::integer
  ) grouped;

  if v_year is not null then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', x.id,
          'item_name', x.item_name,
          'quantity_text', x.quantity_text,
          'needed_on', x.needed_on,
          'archive_date', x.archive_date,
          'use_context', x.use_context,
          'purchase_url', x.purchase_url,
          'memo', x.memo,
          'status', x.status,
          'hold_reason', x.hold_reason,
          'requested_by_member_id', x.requested_by_member_id,
          'requested_by_name', x.requested_by_name_snapshot,
          'status_changed_by_member_id', x.status_changed_by_member_id,
          'status_changed_by_name', x.status_changed_by_name,
          'status_changed_at', x.status_changed_at,
          'ordered_at', x.ordered_at,
          'arrived_at', x.arrived_at,
          'revision', x.revision,
          'created_at', x.created_at,
          'updated_at', x.updated_at
        )
        order by x.archive_date desc, x.created_at desc
      ),
      '[]'::jsonb
    )
      into v_items
    from (
      select
        r.*,
        (case when r.manually_archived_at is not null then (r.manually_archived_at at time zone 'Asia/Seoul')::date else r.needed_on end) as archive_date,
        changed.display_name as status_changed_by_name
      from public.olli_team_material_requests r
      left join public.academy_members changed
        on changed.id = r.status_changed_by_member_id
      where r.academy_id = p_academy_id
        and r.deleted_at is null
        and (r.manually_archived_at is not null
      or (r.needed_on is not null and r.needed_on < (now() at time zone 'Asia/Seoul')::date))
        and extract(year from (case when r.manually_archived_at is not null then (r.manually_archived_at at time zone 'Asia/Seoul')::date else r.needed_on end))::integer = v_year
      order by (case when r.manually_archived_at is not null then (r.manually_archived_at at time zone 'Asia/Seoul')::date else r.needed_on end) desc, r.created_at desc
    ) x;
  end if;

  return jsonb_build_object(
    'ok', true,
    'academy_id', p_academy_id,
    'current_member_id', v_member.id,
    'archive_basis', 'needed_on_past_or_manual',
    'years', coalesce(v_years, '[]'::jsonb),
    'selected_year', v_year,
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$function$;


create or replace function public.olli_team_material_request_archive(
  p_session_token text,
  p_academy_id uuid,
  p_request_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_request public.olli_team_material_requests%rowtype;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  select m.* into v_member
  from public.academy_members m
  join public.academies a on a.id = m.academy_id
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.status = 'active'
    and a.status = 'active'
    and a.deleted_at is null
  order by case m.role when 'owner' then 1 when 'manager' then 2 else 3 end, m.created_at
  limit 1;

  if v_member.id is null or v_member.role not in ('owner', 'manager') then
    raise exception '지난 주문내역 보관은 원장 또는 관리자만 할 수 있습니다.';
  end if;

  update public.olli_team_material_requests r
  set manually_archived_at = now(),
      manually_archived_by_member_id = v_member.id,
      revision = r.revision + 1,
      updated_at = now()
  where r.academy_id = p_academy_id
    and r.id = p_request_id
    and r.deleted_at is null
    and r.status = 'arrived'
    and r.manually_archived_at is null
    and r.revision = p_expected_revision
  returning r.* into v_request;

  if v_request.id is null then
    if not exists (
      select 1 from public.olli_team_material_requests r
      where r.academy_id = p_academy_id
        and r.id = p_request_id
        and r.deleted_at is null
    ) then
      raise exception '재료 요청을 찾지 못했습니다.';
    end if;
    if exists (
      select 1 from public.olli_team_material_requests r
      where r.academy_id = p_academy_id
        and r.id = p_request_id
        and r.status <> 'arrived'
        and r.deleted_at is null
    ) then
      raise exception '도착한 주문만 지난 주문내역으로 옮길 수 있습니다.';
    end if;
    raise exception '다른 기기에서 주문이 먼저 변경되거나 보관되었습니다. 목록을 다시 불러와 주세요.';
  end if;

  perform private.olli_realtime_send_signal(p_academy_id, 'chat', v_request.revision);

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request.id,
    'revision', v_request.revision,
    'manually_archived_at', v_request.manually_archived_at
  );
end;
$function$;

revoke all on function public.olli_team_material_request_archive(text,uuid,uuid,bigint) from public;
grant execute on function public.olli_team_material_request_archive(text,uuid,uuid,bigint) to anon, authenticated;

commit;
