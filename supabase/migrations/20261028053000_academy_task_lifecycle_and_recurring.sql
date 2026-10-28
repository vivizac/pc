-- Academy task lifecycle: keep unfinished work, retain completed items for 24 hours,
-- retain explicitly deleted items for 7 days, and preserve recurring *rules*.
-- No task rows are deleted by this migration itself. Housekeeping runs after DB deployment.
-- Rules below are deliberately seeded for the VIVI-5578 academy only.
-- Per-task visibility is explicit. Existing tasks remain team-visible by default.
alter table public.olli_academy_tasks
  add column if not exists owner_only boolean not null default false;

create table if not exists private.olli_academy_task_rules (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  rule_key text not null,
  task_text text not null,
  repeat_kind text not null check (repeat_kind in ('monthly_day','monthly_first_monday','weekly_friday','teacher_payday')),
  day_of_month smallint check (day_of_month between 1 and 31),
  teacher_member_id uuid references public.academy_members(id) on delete cascade,
  active_from date not null default (timezone('Asia/Seoul',now())::date),
  enabled boolean not null default true,
  last_generated_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id,rule_key),
  check ((repeat_kind='monthly_day' and day_of_month is not null and teacher_member_id is null)
    or (repeat_kind='teacher_payday' and teacher_member_id is not null and day_of_month is null)
    or (repeat_kind in ('monthly_first_monday','weekly_friday') and day_of_month is null and teacher_member_id is null))
);
alter table private.olli_academy_task_rules enable row level security;
revoke all on private.olli_academy_task_rules from public,anon,authenticated;

-- Fixed rules are selected by the primary academy code, never applied to other tenants.
insert into private.olli_academy_task_rules
  (academy_id,rule_key,task_text,repeat_kind,day_of_month,active_from)
select a.id,v.rule_key,v.task_text,v.repeat_kind,v.day_of_month,'2026-10-28'::date
from public.academies a
cross join (values
 ('fee-notice','교육비 안내문 발송','monthly_day',1),
 ('ads-management','광고관리 (신규 게시물 또는 이달 자동 게시물 설정)','monthly_day',1),
 ('lobby-windows','로비 유리문 / 로비 창문 청소','monthly_day',2),
 ('feedback-review','선생님들이 보내는 피드백 점검','monthly_day',3),
 ('elementary-feedback','초등부 수업 사진 및 피드백 발송','monthly_day',8),
 ('overdue-fee-message','교육비 미납 안내 문자 발송','monthly_day',20),
 ('weekly-preparation','다음 주 수업 재료와 준비 상태 확인','weekly_friday',null),
 ('monthly-registrations','지난달 입학생·퇴원생 현황 분석','monthly_first_monday',null),
 ('monthly-consultations','이번 달 정기상담 대상 및 예약 누락 확인','monthly_first_monday',null),
 ('unregistered-followup','지난달 신규 상담자 중 미등록 학부모 후속 관리','monthly_day',5),
 ('material-stock','교재·미술 재료 재고 확인 및 발주','monthly_day',10),
 ('academy-performance','학원 운영 성과 분석','monthly_day',15)
) as v(rule_key,task_text,repeat_kind,day_of_month)
where a.academy_code='VIVI-5578' and a.academy_name='비비작아이성향미술학원'
  and a.deleted_at is null and a.status='active'
on conflict (academy_id,rule_key) do nothing;

-- Called by a single server-side cron; no user session token is retained by the scheduler.
-- Routine progress is a single date per rule, so deleting completed occurrences cannot
-- accidentally regenerate already-finished tasks.
create or replace function private.olli_academy_tasks_maintenance(
  p_today date default (timezone('Asia/Seoul',now())::date)
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_rule record;
  v_first date;
  v_last date;
  v_due date;
  v_payday integer;
  v_teacher_name text;
  v_teacher_active boolean;
  v_text text;
  v_created integer := 0;
  v_purged integer := 0;
  v_n integer;
begin
  if p_today is null then raise exception 'Task date must not be null'; end if;
  -- The source of truth for teacher payday remains the existing private payroll settings.
  -- Do not modify payroll periods, snapshots, payment amounts or statements.
  insert into private.olli_academy_task_rules
    (academy_id,rule_key,task_text,repeat_kind,teacher_member_id,active_from)
  select p.academy_id,'payroll:'||p.teacher_member_id::text,
         m.display_name||' 선생님 급여 지급하기','teacher_payday',p.teacher_member_id,p_today
  from private.olli_teacher_payroll_settings p
  join public.academy_members m on m.id=p.teacher_member_id
    and m.academy_id=p.academy_id and m.status='active'
  join public.academies a on a.id=p.academy_id
    and a.academy_code='VIVI-5578' and a.academy_name='비비작아이성향미술학원'
    and a.status='active' and a.deleted_at is null
  where p.is_enabled
  on conflict (academy_id,rule_key) do nothing;

  v_first := date_trunc('month',p_today)::date;
  v_last := (v_first + interval '1 month')::date - 1;
  for v_rule in
    select r.* from private.olli_academy_task_rules r
    join public.academies a on a.id=r.academy_id
      and a.status='active' and a.deleted_at is null
    where r.enabled
    order by r.academy_id,r.rule_key
    for update of r
  loop
    v_due := null;
    v_text := v_rule.task_text;
    if v_rule.repeat_kind='monthly_day' then
      v_due := make_date(extract(year from p_today)::integer,
                        extract(month from p_today)::integer,
                        least(v_rule.day_of_month::integer,extract(day from v_last)::integer));
    elsif v_rule.repeat_kind='monthly_first_monday' then
      v_due := v_first + ((8 - extract(dow from v_first)::integer) % 7);
    elsif v_rule.repeat_kind='weekly_friday' then
      v_due := date_trunc('week',p_today)::date + 4;
    elsif v_rule.repeat_kind='teacher_payday' then
      select p.payday,m.display_name,(m.status='active' and p.is_enabled)
      into v_payday,v_teacher_name,v_teacher_active
      from private.olli_teacher_payroll_settings p
      join public.academy_members m on m.id=p.teacher_member_id
        and m.academy_id=p.academy_id
      where p.academy_id=v_rule.academy_id
        and p.teacher_member_id=v_rule.teacher_member_id;
      if not coalesce(v_teacher_active,false) or v_payday is null then continue; end if;
      v_due := make_date(extract(year from p_today)::integer,
                         extract(month from p_today)::integer,
                         least(v_payday,extract(day from v_last)::integer));
      v_text := v_teacher_name||' 선생님 급여 지급하기';
    end if;
    if v_due is null or v_due > p_today or v_due < v_rule.active_from then continue; end if;
    if v_rule.last_generated_on is not null then
      if v_rule.last_generated_on >= v_due then continue; end if;
      if v_rule.repeat_kind<>'weekly_friday'
        and date_trunc('month',v_rule.last_generated_on)=date_trunc('month',v_due)
      then continue; end if;
    end if;

    insert into public.olli_academy_tasks (academy_id,text,origin,owner_only)
    values(v_rule.academy_id,to_char(v_due,'MM/DD')||' · '||v_text,'pc',
           v_rule.repeat_kind='teacher_payday');
    update private.olli_academy_task_rules
      set last_generated_on=v_due,updated_at=now()
      where id=v_rule.id;
    v_created := v_created+1;
  end loop;

  -- Never purge unfinished work. The seven-day manual-delete recovery window
  -- wins if a row was both completed and explicitly deleted.
  delete from public.olli_academy_tasks t
  where exists (
    select 1 from private.olli_academy_task_rules scope
    where scope.academy_id=t.academy_id
  ) and ((t.deleted_at is null and t.completed
            and coalesce(t.completed_at,t.created_at) <= now()-interval '24 hours')
     or (t.deleted_at is not null and t.deleted_at <= now()-interval '7 days'));
  get diagnostics v_purged = row_count;
  return jsonb_build_object('ok',true,'created',v_created,'purged',v_purged);
end;
$function$;

revoke all on function private.olli_academy_tasks_maintenance(date)
from public,anon,authenticated;

-- Preserve the existing session, academy and team permission checks and JSON contract.
-- Filter before LIMIT so old completions never displace pending tasks from the response.
create or replace function public.olli_academy_tasks_list(
  p_session_token text,p_academy_id uuid,p_limit integer default 200
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_account_id uuid;
  v_member_id uuid;
  v_role text;
  v_tasks jsonb;
  v_limit integer := greatest(1,least(coalesce(p_limit,200),500));
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.';
  end if;
  select m.id,m.role into v_member_id,v_role
  from public.academy_members m
  where m.academy_id=p_academy_id and m.account_id=v_account_id and m.status='active'
  order by m.created_at limit 1;
  if v_member_id is null then
    raise exception '현재 계정은 이 학원의 할 일을 사용할 수 없습니다.';
  end if;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',t.id,'text',t.text,'completed',t.completed,'created_at',t.created_at,
      'completed_at',t.completed_at,'origin',t.origin,
      'source_chat_message_id',t.source_chat_message_id,
      'created_by_member_id',t.created_by_member_id,'created_by_name',creator.display_name,
      'assigned_to_member_id',t.assigned_to_member_id,'assigned_to_name',assignee.display_name
    ) order by t.completed asc,t.created_at desc
  ),'[]'::jsonb) into v_tasks
  from (
    select * from public.olli_academy_tasks
    where academy_id=p_academy_id and deleted_at is null
      and (not owner_only or v_role='owner')
      and (not completed or coalesce(completed_at,created_at)>now()-interval '24 hours')
    order by completed asc,created_at desc limit v_limit
  ) t
  left join public.academy_members creator on creator.id=t.created_by_member_id
  left join public.academy_members assignee on assignee.id=t.assigned_to_member_id;
  return jsonb_build_object('ok',true,'tasks',v_tasks);
end;
$function$;


-- Keep owner-only tasks private on the write paths too, not just in the list.
-- Same function signatures, success payload and error behavior as the existing RPCs.
create or replace function public.olli_academy_task_set_completed(
  p_session_token text,p_academy_id uuid,p_task_id uuid,p_completed boolean
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare v_account_id uuid; v_member_id uuid; v_role text; v_updated uuid;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;
  select m.id,m.role into v_member_id,v_role from public.academy_members m
  where m.academy_id=p_academy_id and m.account_id=v_account_id and m.status='active'
  order by m.created_at limit 1;
  if v_member_id is null then raise exception '현재 계정은 이 학원의 할 일을 사용할 수 없습니다.'; end if;
  update public.olli_academy_tasks
  set completed=coalesce(p_completed,false),
      completed_at=case when coalesce(p_completed,false) then now() else null end
  where id=p_task_id and academy_id=p_academy_id and deleted_at is null
    and (not owner_only or v_role='owner')
  returning id into v_updated;
  if v_updated is null then raise exception '할 일을 찾지 못했습니다.'; end if;
  return jsonb_build_object('ok',true,'task_id',v_updated);
end;
$function$;

create or replace function public.olli_academy_task_delete(
  p_session_token text,p_academy_id uuid,p_task_id uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare v_account_id uuid; v_member_id uuid; v_role text; v_updated uuid;
begin
  v_account_id := public.olli_account_id_from_session(p_session_token);
  if v_account_id is null then raise exception '로그인 세션이 만료되었거나 올바르지 않습니다.'; end if;
  select m.id,m.role into v_member_id,v_role from public.academy_members m
  where m.academy_id=p_academy_id and m.account_id=v_account_id and m.status='active'
  order by m.created_at limit 1;
  if v_member_id is null then raise exception '현재 계정은 이 학원의 할 일을 사용할 수 없습니다.'; end if;
  update public.olli_academy_tasks
  set deleted_at=now()
  where id=p_task_id and academy_id=p_academy_id and deleted_at is null
    and (not owner_only or v_role='owner')
  returning id into v_updated;
  if v_updated is null then raise exception '할 일을 찾지 못했습니다.'; end if;
  return jsonb_build_object('ok',true,'task_id',v_updated);
end;
$function$;

-- Hourly: keeps the active list responsive and purges expired rows independently of PC logins.
-- pg_cron is already installed in this project; do not schedule from the browser.
select cron.schedule(
  'olli-academy-task-maintenance-v1',
  '15 * * * *',
  'select private.olli_academy_tasks_maintenance();'
);
