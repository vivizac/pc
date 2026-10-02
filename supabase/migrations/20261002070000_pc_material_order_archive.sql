begin;

create index if not exists olli_team_material_requests_archive_idx
  on public.olli_team_material_requests (academy_id, ordered_at desc)
  where deleted_at is null
    and status = 'arrived'
    and ordered_at is not null;

create or replace function public.olli_team_material_requests_archive(
  p_session_token text,
  p_academy_id uuid,
  p_year integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
      extract(year from r.ordered_at)::integer as archive_year,
      count(*)::integer as archive_count
    from public.olli_team_material_requests r
    where r.academy_id = p_academy_id
      and r.deleted_at is null
      and r.status = 'arrived'
      and r.ordered_at is not null
      and r.ordered_at <= now() - interval '1 month'
    group by extract(year from r.ordered_at)::integer
  ) grouped;

  if v_year is not null then
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
        order by x.ordered_at desc, x.created_at desc
      ),
      '[]'::jsonb
    )
      into v_items
    from (
      select
        r.*,
        changed.display_name as status_changed_by_name
      from public.olli_team_material_requests r
      left join public.academy_members changed
        on changed.id = r.status_changed_by_member_id
      where r.academy_id = p_academy_id
        and r.deleted_at is null
        and r.status = 'arrived'
        and r.ordered_at is not null
        and r.ordered_at <= now() - interval '1 month'
        and extract(year from r.ordered_at)::integer = v_year
      order by r.ordered_at desc, r.created_at desc
    ) x;
  end if;

  return jsonb_build_object(
    'ok', true,
    'academy_id', p_academy_id,
    'current_member_id', v_member.id,
    'archive_after', '1 month',
    'years', coalesce(v_years, '[]'::jsonb),
    'selected_year', v_year,
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.olli_team_material_requests_archive(text, uuid, integer) from public;
grant execute on function public.olli_team_material_requests_archive(text, uuid, integer) to anon, authenticated;

commit;
