-- Explicit owner-approved correction of saved growth feedback lesson month.
-- Existing feedback rows and their content are never inferred, replaced or deleted.
create table if not exists public.olli_growth_target_month_audit (
  id bigint generated always as identity primary key,
  academy_id uuid not null,
  student_id uuid not null,
  feedback_id bigint not null,
  account_id uuid not null,
  previous_month text,
  target_month text not null,
  changed_at timestamptz not null default now()
);
alter table public.olli_growth_target_month_audit enable row level security;
revoke all on table public.olli_growth_target_month_audit from public,anon,authenticated;

create or replace function public.olli_growth_feedback_target_month_access(
  p_session_token text, p_academy_id uuid, p_student_id uuid,
  p_feedback_id bigint, p_target_month text, p_expected_target_month text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_account uuid; v_role text; v_previous text; v_feedback public.feedbacks%rowtype;
begin
  if p_academy_id is null or p_student_id is null or p_feedback_id is null then
    return jsonb_build_object('ok',false,'code','INPUT_REQUIRED');
  end if;
  v_account := public.olli_account_id_from_session(p_session_token);
  if v_account is null then return jsonb_build_object('ok',false,'code','SESSION_INVALID'); end if;
  select m.role into v_role
  from public.academy_members m join public.academies a on a.id=m.academy_id
  where m.account_id=v_account and m.academy_id=p_academy_id
    and m.status='active' and a.status='active' and a.deleted_at is null
    and m.role in ('owner','manager','super_admin')
  limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'code','PERMISSION_DENIED'); end if;
  if p_target_month is null or p_target_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
    or p_target_month > to_char(now() at time zone 'Asia/Seoul','YYYY-MM') then
    return jsonb_build_object('ok',false,'code','TARGET_MONTH_INVALID');
  end if;
  if p_expected_target_month is not null and
    p_expected_target_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then
    return jsonb_build_object('ok',false,'code','EXPECTED_MONTH_INVALID');
  end if;
  if not exists (
    select 1 from public.students s where s.academy_id=p_academy_id
      and s.id=p_student_id and s.status='active' and not coalesce(s.is_deleted,false)
  ) then return jsonb_build_object('ok',false,'code','STUDENT_NOT_ACTIVE'); end if;
  select f.target_month into v_previous from public.feedbacks f
  where f.id=p_feedback_id and f.academy_id=p_academy_id and f.student_id=p_student_id
    and not coalesce(f.is_deleted,false) and lower(coalesce(f.feedback_type,''))='growth'
  for update;
  if not found then return jsonb_build_object('ok',false,'code','GROWTH_FEEDBACK_NOT_FOUND'); end if;
  if v_previous is distinct from p_expected_target_month then
    return jsonb_build_object('ok',false,'code','TARGET_MONTH_CHANGED',
      'message','다른 기기에서 대상 월을 변경했습니다. 기록을 새로 불러온 후 다시 확인해 주세요.');
  end if;
  if v_previous is not distinct from p_target_month then
    return jsonb_build_object('ok',true,'row',
      (select to_jsonb(f) from public.feedbacks f where f.id=p_feedback_id));
  end if;
  update public.feedbacks f set target_month=p_target_month,updated_at=now()
  where f.id=p_feedback_id and f.academy_id=p_academy_id and f.student_id=p_student_id
  returning * into v_feedback;
  insert into public.olli_growth_target_month_audit
    (academy_id,student_id,feedback_id,account_id,previous_month,target_month)
  values (p_academy_id,p_student_id,p_feedback_id,v_account,v_previous,p_target_month);
  return jsonb_build_object('ok',true,'row',to_jsonb(v_feedback));
end;
$$;
revoke all on function public.olli_growth_feedback_target_month_access(text,uuid,uuid,bigint,text,text)
  from public,anon,authenticated;
grant execute on function public.olli_growth_feedback_target_month_access(text,uuid,uuid,bigint,text,text)
  to anon,authenticated,service_role;
