-- Harden platform academy access controls, prepare account-session risk signal RPCs,
-- and close legacy public/test RPC execution. Existing risk_signals rows and RLS policies are unchanged.

create or replace function public.olli_admin_set_academy_access(
  p_session_token text,
  p_academy_id text,
  p_plan_type text default null,
  p_access_status text default null,
  p_trial_started_at date default null,
  p_trial_expires_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.academies%rowtype;
  v_plan_type text := nullif(btrim(coalesce(p_plan_type,'')),'');
  v_access_status text := nullif(btrim(coalesce(p_access_status,'')),'');
  v_academy_id uuid;
begin
  if not public.olli_is_platform_admin(p_session_token) then
    return jsonb_build_object('ok',false,'code','PLATFORM_ADMIN_REQUIRED','message','올리 관리자 권한이 없습니다.');
  end if;
  begin v_academy_id := nullif(btrim(coalesce(p_academy_id,'')),'')::uuid;
  exception when others then return jsonb_build_object('ok',false,'code','ACADEMY_ID_INVALID','message','관리할 학원 ID가 올바르지 않습니다.'); end;
  if v_academy_id is null then return jsonb_build_object('ok',false,'code','ACADEMY_ID_MISSING','message','관리할 학원 ID가 없습니다.'); end if;
  if v_plan_type is not null and v_plan_type not in ('active','trial') then return jsonb_build_object('ok',false,'code','PLAN_TYPE_INVALID','message','허용되지 않은 이용 플랜입니다.'); end if;
  if v_access_status is not null and v_access_status not in ('active','expired','suspended','disabled') then return jsonb_build_object('ok',false,'code','ACCESS_STATUS_INVALID','message','허용되지 않은 이용 상태입니다.'); end if;
  if p_trial_started_at is not null and p_trial_expires_at is not null and p_trial_expires_at < p_trial_started_at then return jsonb_build_object('ok',false,'code','TRIAL_RANGE_INVALID','message','체험 종료일이 시작일보다 빠를 수 없습니다.'); end if;

  update public.academies
  set plan_type=coalesce(v_plan_type,plan_type,'active'),
      access_status=coalesce(v_access_status,access_status,'active'),
      trial_started_at=case when v_plan_type='active' then null when p_trial_started_at is not null then p_trial_started_at else trial_started_at end,
      trial_expires_at=case when v_plan_type='active' then null when p_trial_expires_at is not null then p_trial_expires_at else trial_expires_at end,
      updated_at=now()
  where id=v_academy_id
  returning * into v_row;

  if v_row.id is null then return jsonb_build_object('ok',false,'code','ACADEMY_NOT_FOUND','message','해당 학원을 찾지 못했습니다.'); end if;
  return jsonb_build_object('ok',true,'academy',jsonb_build_object(
    'academy_id',v_row.id,'id',v_row.id,'academy_code',v_row.academy_code,'academy_name',v_row.academy_name,
    'region',v_row.region,'status',v_row.status,'plan_type',coalesce(v_row.plan_type,'active'),
    'access_status',coalesce(v_row.access_status,'active'),
    'trial_started_at',case when v_row.trial_started_at is null then null else v_row.trial_started_at::text end,
    'trial_expires_at',case when v_row.trial_expires_at is null then null else v_row.trial_expires_at::text end));
end;
$function$;

create or replace function public.olli_mark_academy_trial_expired_if_due(p_session_token text,p_academy_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_account_id uuid; v_row public.academies%rowtype;
begin
  if p_academy_id is null then return jsonb_build_object('ok',false,'code','ACADEMY_ID_MISSING','message','학원 ID가 없습니다.'); end if;
  v_account_id:=public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then return jsonb_build_object('ok',false,'code','SESSION_INVALID','message','계정 세션이 만료되었거나 올바르지 않습니다.'); end if;
  if not exists(select 1 from public.academy_members m where m.academy_id=p_academy_id and m.account_id=v_account_id and m.status='active' and m.role in ('owner','manager','teacher','super_admin')) then
    return jsonb_build_object('ok',false,'code','PERMISSION_DENIED','message','현재 계정에는 이 학원 접근 권한이 없습니다.');
  end if;
  update public.academies a set access_status='expired',updated_at=now()
  where a.id=p_academy_id and a.status='active' and a.deleted_at is null and a.plan_type='trial'
    and a.access_status='active' and a.trial_expires_at is not null and a.trial_expires_at<current_date
  returning a.* into v_row;
  if v_row.id is null then select a.* into v_row from public.academies a where a.id=p_academy_id and a.status='active' and a.deleted_at is null limit 1; end if;
  if v_row.id is null then return jsonb_build_object('ok',false,'code','ACADEMY_NOT_FOUND','message','현재 학원을 찾을 수 없습니다.'); end if;
  return jsonb_build_object('ok',true,'academy',jsonb_build_object(
    'academy_id',v_row.id,'plan_type',v_row.plan_type,'access_status',v_row.access_status,
    'trial_started_at',case when v_row.trial_started_at is null then null else v_row.trial_started_at::text end,
    'trial_expires_at',case when v_row.trial_expires_at is null then null else v_row.trial_expires_at::text end));
end;
$function$;

create or replace function public.olli_risk_signals_list(p_session_token text,p_academy_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_account_id uuid; v_rows jsonb;
begin
  v_account_id:=public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then return jsonb_build_object('ok',false,'code','SESSION_INVALID','message','계정 세션이 만료되었거나 올바르지 않습니다.'); end if;
  if not exists(select 1 from public.academy_members m join public.academies a on a.id=m.academy_id
    where m.academy_id=p_academy_id and m.account_id=v_account_id and m.status='active'
      and m.role in ('owner','manager','teacher','super_admin') and a.status='active' and a.deleted_at is null) then
    return jsonb_build_object('ok',false,'code','PERMISSION_DENIED','message','위험신호를 조회할 권한이 없습니다.');
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]'::jsonb) into v_rows from public.risk_signals r where r.academy_id=p_academy_id;
  return jsonb_build_object('ok',true,'rows',v_rows);
end;
$function$;

create or replace function public.olli_risk_signal_save(
  p_session_token text,p_academy_id uuid,p_student_id uuid,p_student_name text,
  p_signal_1 text default null,p_signal_2 text default null,p_signal_3 text default null,p_memo text default null
)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_account_id uuid; v_member_id uuid; v_level int; v_id text; v_row public.risk_signals%rowtype;
begin
  v_account_id:=public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then return jsonb_build_object('ok',false,'code','SESSION_INVALID','message','계정 세션이 만료되었거나 올바르지 않습니다.'); end if;
  select m.id into v_member_id from public.academy_members m join public.academies a on a.id=m.academy_id
  where m.academy_id=p_academy_id and m.account_id=v_account_id and m.status='active'
    and m.role in ('owner','manager','teacher','super_admin') and a.status='active' and a.deleted_at is null limit 1;
  if v_member_id is null then return jsonb_build_object('ok',false,'code','PERMISSION_DENIED','message','위험신호를 저장할 권한이 없습니다.'); end if;
  if p_student_id is null or not exists(select 1 from public.students s where s.id=p_student_id and s.academy_id=p_academy_id and coalesce(s.is_deleted,false)=false) then
    return jsonb_build_object('ok',false,'code','STUDENT_NOT_FOUND','message','현재 학원의 학생을 찾을 수 없습니다.');
  end if;
  if btrim(coalesce(p_student_name,''))='' then return jsonb_build_object('ok',false,'code','STUDENT_NAME_MISSING','message','학생 이름이 없습니다.'); end if;
  v_level:=(case when nullif(btrim(coalesce(p_signal_1,'')),'') is not null then 1 else 0 end)
          +(case when nullif(btrim(coalesce(p_signal_2,'')),'') is not null then 1 else 0 end)
          +(case when nullif(btrim(coalesce(p_signal_3,'')),'') is not null then 1 else 0 end);
  if v_level<1 then v_level:=1; end if;
  v_id:='risk_'||substr(replace(gen_random_uuid()::text,'-',''),1,20);
  insert into public.risk_signals(id,academy_id,student_id,student_name,signal_level,signal_1,signal_2,signal_3,memo,created_by)
  values(v_id,p_academy_id,p_student_id,btrim(p_student_name),v_level,
    nullif(btrim(coalesce(p_signal_1,'')),''),nullif(btrim(coalesce(p_signal_2,'')),''),nullif(btrim(coalesce(p_signal_3,'')),''),
    nullif(btrim(coalesce(p_memo,'')),''),v_member_id) returning * into v_row;
  return jsonb_build_object('ok',true,'row',to_jsonb(v_row));
end;
$function$;

revoke all on function public.olli_admin_set_academy_access(text,text,text,text,date,date) from public;
revoke all on function public.olli_admin_set_academy_access(text,text,text,text,date,date) from anon,authenticated;
grant execute on function public.olli_admin_set_academy_access(text,text,text,text,date,date) to anon,authenticated;
revoke all on function public.olli_mark_academy_trial_expired_if_due(text,uuid) from public;
revoke all on function public.olli_mark_academy_trial_expired_if_due(text,uuid) from anon,authenticated;
grant execute on function public.olli_mark_academy_trial_expired_if_due(text,uuid) to anon,authenticated;
revoke all on function public.olli_risk_signals_list(text,uuid) from public;
revoke all on function public.olli_risk_signals_list(text,uuid) from anon,authenticated;
grant execute on function public.olli_risk_signals_list(text,uuid) to anon,authenticated;
revoke all on function public.olli_risk_signal_save(text,uuid,uuid,text,text,text,text,text) from public;
revoke all on function public.olli_risk_signal_save(text,uuid,uuid,text,text,text,text,text) from anon,authenticated;
grant execute on function public.olli_risk_signal_save(text,uuid,uuid,text,text,text,text,text) to anon,authenticated;

revoke all on function public.save_risk_signal_for_academy(uuid,uuid,text,text,text,text,text) from public;
revoke all on function public.save_risk_signal_for_academy(uuid,uuid,text,text,text,text,text) from anon,authenticated;
revoke all on function public.test_approve_teacher_request(text,text) from public;
revoke all on function public.test_approve_teacher_request(text,text) from anon,authenticated;
revoke all on function public.test_reject_teacher_request(text,text) from public;
revoke all on function public.test_reject_teacher_request(text,text) from anon,authenticated;
revoke all on function public.test_list_teacher_approval_requests(text) from public;
revoke all on function public.test_list_teacher_approval_requests(text) from anon,authenticated;
revoke all on function public.test_list_academy_members(text) from public;
revoke all on function public.test_list_academy_members(text) from anon,authenticated;
revoke all on function public.test_check_teacher_approval_status(text,text,text) from public;
revoke all on function public.test_check_teacher_approval_status(text,text,text) from anon,authenticated;
revoke all on function public.test_owner_login(text,text) from public;
revoke all on function public.test_owner_login(text,text) from anon,authenticated;
revoke all on function public.test_create_academy_with_password(text,text,text) from public;
revoke all on function public.test_create_academy_with_password(text,text,text) from anon,authenticated;
