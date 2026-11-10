-- Preserve academy-specific conversations, material orders and audit history
-- when a teacher's account is unlinked from one academy.
-- Other academy memberships and the account session remain intact.
create or replace function public.olli_remove_account_membership(
  p_session_token text, p_academy_id uuid, p_member_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = 'public', 'extensions'
as $function$
declare
  v_reviewer_account_id uuid;
  v_target public.academy_members%rowtype;
  v_changed integer := 0;
begin
  v_reviewer_account_id := public.olli_account_id_from_session(p_session_token);
  if v_reviewer_account_id is null then
    return jsonb_build_object('ok',false,'message','계정 세션이 만료되었거나 올바르지 않습니다.');
  end if;
  if p_academy_id is null or p_member_id is null then
    return jsonb_build_object('ok',false,'message','학원과 선생님 연결 정보를 확인해 주세요.');
  end if;
  if not exists (
    select 1 from public.academy_members m
    where m.academy_id=p_academy_id
      and m.account_id=v_reviewer_account_id
      and m.role='owner' and m.status='active'
  ) then
    return jsonb_build_object('ok',false,'message','현재 계정에는 이 학원의 원장 권한이 없습니다.');
  end if;

  select m.* into v_target
  from public.academy_members m
  where m.id=p_member_id and m.academy_id=p_academy_id
    and m.account_id is not null
  for update;
  if not found then
    return jsonb_build_object('ok',false,'message','해제할 계정 연결을 찾지 못했습니다.');
  end if;
  if v_target.account_id=v_reviewer_account_id then
    return jsonb_build_object('ok',false,'message','현재 로그인한 원장 계정의 연결은 이 화면에서 해제할 수 없습니다.');
  end if;
  if v_target.role not in ('teacher','manager') then
    return jsonb_build_object('ok',false,'message','원장 연결은 선생님 관리에서 해제할 수 없습니다.');
  end if;
  if v_target.status='disabled' then
    return jsonb_build_object('ok',true,'member_id',v_target.id,
      'removed',true,'status','disabled','already_unlinked',true);
  end if;

  -- Do not delete academy_members: chat, material-order, action and payroll
  -- history contains foreign keys to the original teacher membership ID.
  update public.academy_members
  set status='disabled',
      device_status='not_registered',
      device_id=null,
      updated_at=now()
  where id=v_target.id and academy_id=p_academy_id and status='active';
  get diagnostics v_changed=row_count;
  if v_changed<>1 then
    raise exception '선생님 학원 연결을 안전하게 해제하지 못했습니다.';
  end if;

  -- Revoke only this academy's device/push access, not the teacher's
  -- account sessions or memberships in other academies.
  delete from public.device_sessions
  where academy_id=p_academy_id and member_id=v_target.id;
  update public.olli_team_chat_push_subscriptions
  set disabled_at=coalesce(disabled_at,now())
  where academy_id=p_academy_id and member_id=v_target.id
    and disabled_at is null;

  return jsonb_build_object('ok',true,'member_id',v_target.id,
    'removed',true,'status','disabled');
end;
$function$;
