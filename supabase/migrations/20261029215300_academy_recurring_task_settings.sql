-- Configurable per-academy PC recurring tasks.
-- Existing VIVI-5578 task rules and every generated/completed task are retained.
-- A new academy starts with no rules. Rules are never copied between tenants.
alter table private.olli_academy_task_rules
  add column if not exists weekday smallint,
  add column if not exists week_of_month smallint,
  add column if not exists archived_at timestamptz;

-- Replace only the legacy recurrence-shape checks; retain unrelated constraints.
do $migration$
declare v_check record;
begin
  for v_check in
    select conname from pg_constraint
    where conrelid='private.olli_academy_task_rules'::regclass
      and contype='c' and pg_get_constraintdef(oid) ilike '%repeat_kind%'
  loop
    execute format('alter table private.olli_academy_task_rules drop constraint %I',v_check.conname);
  end loop;
end
$migration$;

-- Preserve current dates and generation cursors while normalizing old preset kinds.
update private.olli_academy_task_rules
set repeat_kind='weekly_day',weekday=5,week_of_month=null,updated_at=now()
where repeat_kind='weekly_friday';
update private.olli_academy_task_rules
set repeat_kind='monthly_weekday',weekday=1,week_of_month=1,updated_at=now()
where repeat_kind='monthly_first_monday';

alter table private.olli_academy_task_rules
  add constraint olli_task_rule_kind check (repeat_kind in ('monthly_day','weekly_day','monthly_weekday','teacher_payday')),
  add constraint olli_task_rule_schedule_shape check (
    (repeat_kind='monthly_day' and day_of_month between 1 and 31
      and weekday is null and week_of_month is null and teacher_member_id is null)
    or (repeat_kind='weekly_day' and day_of_month is null
      and weekday between 0 and 6 and week_of_month is null and teacher_member_id is null)
    or (repeat_kind='monthly_weekday' and day_of_month is null
      and weekday between 0 and 6 and week_of_month in (0,1,2,3,4)
      and teacher_member_id is null)
    or (repeat_kind='teacher_payday' and day_of_month is null
      and weekday is null and week_of_month is null and teacher_member_id is not null)
  );

-- Existing routine maintenance remains server-side and retains its original
-- 24-hour completion / 7-day soft-delete policies and payroll source.

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
    where r.enabled and r.archived_at is null
    order by r.academy_id,r.rule_key
    for update of r
  loop
    v_due := null;
    v_text := v_rule.task_text;
    if v_rule.repeat_kind='monthly_day' then
      v_due := make_date(extract(year from p_today)::integer,
                        extract(month from p_today)::integer,
                        least(v_rule.day_of_month::integer,extract(day from v_last)::integer));
    elsif v_rule.repeat_kind='monthly_weekday' then
      if v_rule.week_of_month=0 then
        v_due := v_last - ((extract(dow from v_last)::integer - v_rule.weekday::integer + 7) % 7);
      else
        v_due := v_first + ((v_rule.weekday::integer - extract(dow from v_first)::integer + 7) % 7)
                            + (v_rule.week_of_month::integer-1)*7;
      end if;
    elsif v_rule.repeat_kind='weekly_day' then
      v_due := date_trunc('week',p_today)::date + ((v_rule.weekday::integer+6) % 7);
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
      if v_rule.repeat_kind='weekly_day' then
        if date_trunc('week',v_rule.last_generated_on)=date_trunc('week',v_due) then continue; end if;
      elsif date_trunc('month',v_rule.last_generated_on)=date_trunc('month',v_due) then
        continue;
      end if;
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



-- All rule endpoints verify the custom account session AND active academy OWNER.
-- The private rules table stays non-exposed; anon cannot directly select/update it.
create or replace function public.olli_academy_task_rules_list(
 p_session_token text,p_academy_id uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare v_account uuid; v_rules jsonb;
begin
 v_account := public.olli_account_id_from_session(p_session_token);
 if v_account is null or p_academy_id is null or not exists (
   select 1 from public.academy_members m join public.academies a on a.id=m.academy_id
   where m.account_id=v_account and m.academy_id=p_academy_id
     and m.status='active' and m.role='owner'
     and a.status='active' and a.deleted_at is null
 ) then raise exception '원장 계정만 반복 업무를 관리할 수 있습니다.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'text',r.task_text,'repeat_kind',r.repeat_kind,
    'day_of_month',r.day_of_month,'weekday',r.weekday,
    'week_of_month',r.week_of_month,'enabled',r.enabled,
    'last_generated_on',r.last_generated_on
 ) order by r.created_at,r.id),'[]'::jsonb)
 into v_rules from private.olli_academy_task_rules r
 where r.academy_id=p_academy_id and r.archived_at is null
   and r.repeat_kind<>'teacher_payday';
 return jsonb_build_object('ok',true,'rules',v_rules);
end;
$function$;

create or replace function public.olli_academy_task_rule_save(
 p_session_token text,p_academy_id uuid,p_rule_id uuid,
 p_task_text text,p_repeat_kind text,p_day_of_month integer,
 p_weekday integer,p_week_of_month integer,p_enabled boolean
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare v_account uuid; v_id uuid; v_text text := btrim(coalesce(p_task_text,''));
begin
 v_account := public.olli_account_id_from_session(p_session_token);
 if v_account is null or p_academy_id is null or not exists (
   select 1 from public.academy_members m join public.academies a on a.id=m.academy_id
   where m.account_id=v_account and m.academy_id=p_academy_id
     and m.status='active' and m.role='owner'
     and a.status='active' and a.deleted_at is null
 ) then raise exception '원장 계정만 반복 업무를 관리할 수 있습니다.'; end if;
 if char_length(v_text)<1 or char_length(v_text)>80 then
   raise exception '업무 제목을 1~80자로 입력해 주세요.';
 end if;
 if not (
   (p_repeat_kind='monthly_day' and p_day_of_month between 1 and 31 and p_weekday is null and p_week_of_month is null)
   or (p_repeat_kind='weekly_day' and p_day_of_month is null and p_weekday between 0 and 6 and p_week_of_month is null)
   or (p_repeat_kind='monthly_weekday' and p_day_of_month is null and p_weekday between 0 and 6 and p_week_of_month in (0,1,2,3,4))
 ) then raise exception '올바른 반복 주기와 날짜를 설정해 주세요.'; end if;
 if p_rule_id is null then
   insert into private.olli_academy_task_rules
    (academy_id,rule_key,task_text,repeat_kind,day_of_month,weekday,week_of_month,enabled)
   values (p_academy_id,'user:'||gen_random_uuid()::text,v_text,p_repeat_kind,
    p_day_of_month,p_weekday,p_week_of_month,coalesce(p_enabled,true))
   returning id into v_id;
 else
   update private.olli_academy_task_rules r
   set task_text=v_text,repeat_kind=p_repeat_kind,day_of_month=p_day_of_month,
       weekday=p_weekday,week_of_month=p_week_of_month,
       enabled=coalesce(p_enabled,true),updated_at=now()
   where r.id=p_rule_id and r.academy_id=p_academy_id
     and r.archived_at is null and r.repeat_kind<>'teacher_payday'
   returning id into v_id;
   if v_id is null then raise exception '수정할 반복 업무가 없습니다.'; end if;
 end if;
 -- last_generated_on deliberately remains unchanged: edits cannot resurrect
 -- previously completed or removed occurrences within the current cycle.
 return jsonb_build_object('ok',true,'id',v_id);
end;
$function$;

create or replace function public.olli_academy_task_rule_archive(
 p_session_token text,p_academy_id uuid,p_rule_id uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare v_account uuid; v_id uuid;
begin
 v_account := public.olli_account_id_from_session(p_session_token);
 if v_account is null or p_academy_id is null or not exists (
   select 1 from public.academy_members m join public.academies a on a.id=m.academy_id
   where m.account_id=v_account and m.academy_id=p_academy_id
     and m.status='active' and m.role='owner'
     and a.status='active' and a.deleted_at is null
 ) then raise exception '원장 계정만 반복 업무를 관리할 수 있습니다.'; end if;
 update private.olli_academy_task_rules r
 set enabled=false,archived_at=now(),updated_at=now()
 where r.id=p_rule_id and r.academy_id=p_academy_id
   and r.archived_at is null and r.repeat_kind<>'teacher_payday'
 returning id into v_id;
 if v_id is null then raise exception '삭제할 반복 업무가 없습니다.'; end if;
 -- Historical generated tasks remain unchanged and available in task history.
 return jsonb_build_object('ok',true,'id',v_id);
end;
$function$;

revoke all on function public.olli_academy_task_rules_list(text,uuid) from public,anon,authenticated;
revoke all on function public.olli_academy_task_rule_save(text,uuid,uuid,text,text,integer,integer,integer,boolean) from public,anon,authenticated;
revoke all on function public.olli_academy_task_rule_archive(text,uuid,uuid) from public,anon,authenticated;
-- Olli's custom session is passed as a token over anon-key RPC; each function
-- validates it and the active owner membership before accessing private data.
grant execute on function public.olli_academy_task_rules_list(text,uuid) to anon,authenticated;
grant execute on function public.olli_academy_task_rule_save(text,uuid,uuid,text,text,integer,integer,integer,boolean) to anon,authenticated;
grant execute on function public.olli_academy_task_rule_archive(text,uuid,uuid) to anon,authenticated;
