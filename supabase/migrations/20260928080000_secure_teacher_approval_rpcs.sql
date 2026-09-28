-- Secure owner-scoped teacher approval/member management RPCs.
-- This is the expand step. Legacy test_* RPC grants are removed only after
-- PC/Mobile production has switched to these authenticated contracts.

create or replace function public.olli_list_academy_members(
  p_session_token text,
  p_academy_id uuid
)
returns table(
  id uuid,
  academy_id uuid,
  display_name text,
  role text,
  status text,
  device_status text,
  device_id text,
  account_id uuid,
  last_login_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);

  if v_account_id is null then
    raise exception '계정 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  if not exists (
    select 1
    from public.academy_members current_member
    where current_member.academy_id = p_academy_id
      and current_member.account_id = v_account_id
      and current_member.status = 'active'
  ) then
    raise exception '현재 계정에는 이 학원 접근 권한이 없습니다.';
  end if;

  return query
  select
    m.id,
    m.academy_id,
    m.display_name,
    m.role,
    m.status,
    m.device_status,
    m.device_id,
    m.account_id,
    m.last_login_at,
    m.created_at,
    m.updated_at
  from public.academy_members m
  where m.academy_id = p_academy_id
  order by
    case m.role
      when 'owner' then 1
      when 'manager' then 2
      when 'teacher' then 3
      else 4
    end,
    m.created_at;
end;
$$;

create or replace function public.olli_list_teacher_approval_requests(
  p_session_token text,
  p_academy_id uuid
)
returns table(
  id uuid,
  academy_id uuid,
  teacher_name text,
  requested_role text,
  requested_device_name text,
  requested_device_id text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);

  if v_account_id is null then
    raise exception '계정 세션이 만료되었거나 올바르지 않습니다.';
  end if;

  if not exists (
    select 1
    from public.academy_members owner_member
    where owner_member.academy_id = p_academy_id
      and owner_member.account_id = v_account_id
      and owner_member.role = 'owner'
      and owner_member.status = 'active'
  ) then
    raise exception '현재 계정에는 이 학원의 원장 권한이 없습니다.';
  end if;

  return query
  select
    r.id,
    r.academy_id,
    r.teacher_name,
    r.requested_role,
    r.requested_device_name,
    r.requested_device_id,
    r.status,
    r.created_at
  from public.teacher_approval_requests r
  where r.academy_id = p_academy_id
    and r.status = 'pending'
  order by r.created_at desc;
end;
$$;

create or replace function public.olli_approve_teacher_request(
  p_session_token text,
  p_academy_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_owner_member_id uuid;
  v_request public.teacher_approval_requests%rowtype;
  v_member_id uuid;
  v_role text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);

  if v_account_id is null then
    return jsonb_build_object(
      'ok', false,
      'message', '계정 세션이 만료되었거나 올바르지 않습니다.'
    );
  end if;

  select m.id
  into v_owner_member_id
  from public.academy_members m
  where m.academy_id = p_academy_id
    and m.account_id = v_account_id
    and m.role = 'owner'
    and m.status = 'active'
  limit 1;

  if v_owner_member_id is null then
    return jsonb_build_object(
      'ok', false,
      'message', '현재 계정에는 이 학원의 원장 권한이 없습니다.'
    );
  end if;

  select r.*
  into v_request
  from public.teacher_approval_requests r
  where r.id = p_request_id
    and r.academy_id = p_academy_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', '현재 학원의 승인 요청을 찾지 못했습니다.'
    );
  end if;

  if v_request.status <> 'pending' then
    return jsonb_build_object(
      'ok', false,
      'message', '이미 처리된 승인 요청입니다.'
    );
  end if;

  v_role := case
    when v_request.requested_role in ('teacher', 'manager') then v_request.requested_role
    else 'teacher'
  end;

  select m.id
  into v_member_id
  from public.academy_members m
  where m.academy_id = p_academy_id
    and m.display_name = v_request.teacher_name
    and m.role in ('teacher', 'manager')
  order by m.created_at
  limit 1
  for update;

  if v_member_id is null then
    insert into public.academy_members (
      academy_id,
      display_name,
      role,
      status,
      device_status,
      device_id,
      last_login_at
    ) values (
      p_academy_id,
      v_request.teacher_name,
      v_role,
      'active',
      'registered',
      nullif(btrim(coalesce(v_request.requested_device_id, '')), ''),
      now()
    )
    returning id into v_member_id;
  else
    update public.academy_members
    set
      role = v_role,
      status = 'active',
      device_status = 'registered',
      device_id = nullif(btrim(coalesce(v_request.requested_device_id, '')), ''),
      last_login_at = now(),
      updated_at = now()
    where id = v_member_id
      and academy_id = p_academy_id;
  end if;

  update public.teacher_approval_requests
  set
    status = 'approved',
    approved_member_id = v_member_id,
    approved_at = now()
  where id = p_request_id
    and academy_id = p_academy_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'approved',
    'request_id', p_request_id,
    'academy_id', p_academy_id,
    'member_id', v_member_id
  );
end;
$$;

create or replace function public.olli_reject_teacher_request(
  p_session_token text,
  p_academy_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_request_status text;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);

  if v_account_id is null then
    return jsonb_build_object(
      'ok', false,
      'message', '계정 세션이 만료되었거나 올바르지 않습니다.'
    );
  end if;

  if not exists (
    select 1
    from public.academy_members owner_member
    where owner_member.academy_id = p_academy_id
      and owner_member.account_id = v_account_id
      and owner_member.role = 'owner'
      and owner_member.status = 'active'
  ) then
    return jsonb_build_object(
      'ok', false,
      'message', '현재 계정에는 이 학원의 원장 권한이 없습니다.'
    );
  end if;

  select r.status
  into v_request_status
  from public.teacher_approval_requests r
  where r.id = p_request_id
    and r.academy_id = p_academy_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', '현재 학원의 승인 요청을 찾지 못했습니다.'
    );
  end if;

  if v_request_status <> 'pending' then
    return jsonb_build_object(
      'ok', false,
      'message', '이미 처리된 승인 요청입니다.'
    );
  end if;

  update public.teacher_approval_requests
  set status = 'rejected'
  where id = p_request_id
    and academy_id = p_academy_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'rejected',
    'request_id', p_request_id,
    'academy_id', p_academy_id
  );
end;
$$;

revoke all on function public.olli_list_academy_members(text, uuid) from public;
revoke all on function public.olli_list_teacher_approval_requests(text, uuid) from public;
revoke all on function public.olli_approve_teacher_request(text, uuid, uuid) from public;
revoke all on function public.olli_reject_teacher_request(text, uuid, uuid) from public;

grant execute on function public.olli_list_academy_members(text, uuid) to anon, authenticated;
grant execute on function public.olli_list_teacher_approval_requests(text, uuid) to anon, authenticated;
grant execute on function public.olli_approve_teacher_request(text, uuid, uuid) to anon, authenticated;
grant execute on function public.olli_reject_teacher_request(text, uuid, uuid) to anon, authenticated;
