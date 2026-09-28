create or replace function public.olli_team_material_request_delete(
  p_session_token text,
  p_academy_id uuid,
  p_request_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_member public.academy_members%rowtype;
  v_request public.olli_team_material_requests%rowtype;
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
  order by case m.role when 'owner' then 1 when 'manager' then 2 else 3 end, m.created_at
  limit 1;

  if v_member.id is null or v_member.role not in ('owner','manager') then
    raise exception '재료 요청은 원장 또는 관리자만 삭제할 수 있습니다.';
  end if;

  update public.olli_team_material_requests r
  set deleted_at = now(), revision = r.revision + 1, updated_at = now()
  where r.id = p_request_id
    and r.academy_id = p_academy_id
    and r.deleted_at is null
    and r.revision = p_expected_revision
  returning r.* into v_request;

  if v_request.id is null then
    if exists (
      select 1 from public.olli_team_material_requests r
      where r.id = p_request_id
        and r.academy_id = p_academy_id
        and r.deleted_at is null
    ) then
      raise exception '다른 기기에서 재료 요청이 먼저 변경되었습니다. 최신 상태를 다시 불러와 주세요.';
    end if;
    raise exception '재료 요청을 찾지 못했습니다.';
  end if;

  insert into public.olli_team_material_request_events (
    academy_id, request_id, member_id, event_type, from_status, to_status, note
  ) values (
    p_academy_id, v_request.id, v_member.id, 'deleted',
    v_request.status, v_request.status, '재료 요청 삭제'
  );

  perform private.olli_realtime_send_signal(p_academy_id, 'chat', v_request.revision);

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request.id,
    'revision', v_request.revision,
    'deleted_at', v_request.deleted_at
  );
end;
$$;

revoke all on function public.olli_team_material_request_delete(text, uuid, uuid, bigint) from public;
grant execute on function public.olli_team_material_request_delete(text, uuid, uuid, bigint)
to anon, authenticated, service_role;
