-- Transitional hardening for legacy device authentication.
-- Registered-device restore remains available only for legacy teacher/manager
-- accounts that do not yet have an active password credential.
-- Direct execution of internal device/account helpers is removed.

create or replace function public.olli_restore_teacher_session_by_device(
  p_device_id text,
  p_device_name text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id text;
  v_member public.academy_members%rowtype;
  v_match_count integer := 0;
begin
  v_device_id := btrim(coalesce(p_device_id, ''));

  if length(v_device_id) = 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'MISSING_DEVICE',
      'message', '기기 정보가 없습니다.'
    );
  end if;

  select count(*)
  into v_match_count
  from public.academy_members m
  where m.status = 'active'
    and m.role in ('teacher', 'manager')
    and lower(coalesce(m.device_status, '')) = 'registered'
    and nullif(btrim(coalesce(m.device_id, '')), '') = v_device_id;

  if v_match_count = 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'NO_REGISTERED_DEVICE',
      'message', '등록된 선생님 기기를 찾지 못했습니다.'
    );
  end if;

  if v_match_count > 1 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'AMBIGUOUS_DEVICE',
      'message', '같은 기기 ID가 여러 선생님에게 연결되어 있어 자동 복구를 중단했습니다.'
    );
  end if;

  select m.*
  into v_member
  from public.academy_members m
  where m.status = 'active'
    and m.role in ('teacher', 'manager')
    and lower(coalesce(m.device_status, '')) = 'registered'
    and nullif(btrim(coalesce(m.device_id, '')), '') = v_device_id
  order by m.last_login_at desc nulls last, m.created_at
  limit 1;

  if v_member.account_id is not null
     and exists (
       select 1
       from public.olli_account_credentials c
       where c.account_id = v_member.account_id
         and c.status = 'active'
         and c.password_hash is not null
     ) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'PASSWORD_LOGIN_REQUIRED',
      'message', '개인계정 로그인이 필요한 기기입니다.'
    );
  end if;

  return public.olli_teacher_account_session(
    v_member.academy_id,
    v_member.id,
    v_device_id,
    p_device_name
  );
end;
$$;

revoke all on function public.olli_restore_teacher_session_by_device(text, text) from public;
grant execute on function public.olli_restore_teacher_session_by_device(text, text) to anon, authenticated;

revoke all on function public.olli_teacher_account_session(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.olli_validate_member_device(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.olli_reset_member_device(uuid, uuid) from public, anon, authenticated;
revoke all on function public.olli_ensure_member_account(uuid) from public, anon, authenticated;
