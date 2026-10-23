-- 상담완료 단일 원본 및 종합피드백 생성 선점. 기존 기록 수정/삭제 없음.
-- 1. 상담 상태를 키별 원자적 변경으로 저장하여 서로 다른 기기의 완료 상태가 서로 덮어쓰이지 않게 한다.
-- 2. 종합피드백은 academy/student/rule/due-month 단위 한 개의 서버 작업만 선점한다.

create table if not exists public.olli_consultation_summary_jobs (
  academy_id uuid not null references public.academies(id) on delete cascade,
  student_id uuid not null,
  rule_key text not null check (rule_key in ('after_1','after_3','every_6','every_12')),
  due_month text not null check (due_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  status text not null default 'pending' check (status in ('pending','generating','ready','error')),
  claim_token uuid,
  leased_until timestamptz,
  feedback_id bigint references public.summary_feedbacks(id) on delete set null,
  last_error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (academy_id, student_id, rule_key, due_month),
  foreign key (student_id, academy_id) references public.students(id,academy_id) on delete cascade
);
alter table public.olli_consultation_summary_jobs enable row level security;
revoke all on public.olli_consultation_summary_jobs from public, anon, authenticated;
-- 서비스 계정과 인증된 전용 RPC 외에는 작업 잠금 테이블에 접근할 수 없다.

create or replace function public.olli_consultation_progress_access(
  p_session_token text, p_academy_id uuid,
  p_action text default 'read', p_task_keys text[] default null,
  p_completed boolean default null, p_todos jsonb default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_account uuid; v_role text; v_progress jsonb;
  v_completed jsonb; v_task text; v_student_text text; v_student_id uuid;
  v_now text := to_char(now() at time zone 'Asia/Seoul','YYYY-MM');
  v_completed_at text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_academy_id is null then return jsonb_build_object('ok',false,'code','ACADEMY_REQUIRED'); end if;
  v_account := public.olli_account_id_from_session(p_session_token);
  if v_account is null then return jsonb_build_object('ok',false,'code','SESSION_INVALID'); end if;
  select m.role into v_role
  from public.academy_members m join public.academies a on a.id=m.academy_id
  where m.account_id=v_account and m.academy_id=p_academy_id
    and m.status='active' and a.status='active' and a.deleted_at is null
    and m.role in ('owner','manager','teacher','super_admin')
  limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'code','PERMISSION_DENIED'); end if;
  if p_action not in ('read','set_completed','set_todos') then
    return jsonb_build_object('ok',false,'code','ACTION_INVALID');
  end if;
  if p_action <> 'read' and v_role not in ('owner','manager','super_admin') then
    return jsonb_build_object('ok',false,'code','WRITE_DENIED');
  end if;

  -- 대상 한 행 잠금: 별개 기기가 같은 시각에 서로 다른 학생을 완료 처리해도 기록을 보존한다.
  select coalesce(a.consultation_progress,'{}'::jsonb) into v_progress
  from public.academy_settings a where a.academy_id=p_academy_id for update;
  if not found then return jsonb_build_object('ok',false,'code','SETTINGS_NOT_FOUND'); end if;
  if jsonb_typeof(v_progress) <> 'object' then v_progress := '{}'::jsonb; end if;
  if p_action='read' then return jsonb_build_object('ok',true,'progress',v_progress); end if;

  if p_action='set_completed' then
    if p_completed is null or coalesce(array_length(p_task_keys,1),0) not between 1 and 24 then
      return jsonb_build_object('ok',false,'code','TASK_KEYS_INVALID');
    end if;
    v_completed := coalesce(v_progress->'completed','{}'::jsonb);
    if jsonb_typeof(v_completed) <> 'object' then v_completed := '{}'::jsonb; end if;
    foreach v_task in array p_task_keys loop
      if v_task !~ '^id:[0-9a-fA-F-]{36}\|(after_1|after_3|every_6|every_12)\|20[0-9]{2}-(0[1-9]|1[0-2])$' then
        return jsonb_build_object('ok',false,'code','TASK_FORMAT_INVALID');
      end if;
      v_student_text := split_part(split_part(v_task,'|',1),':',2);
      v_student_id := v_student_text::uuid;
      if not exists(select 1 from public.students s where s.id=v_student_id and s.academy_id=p_academy_id and coalesce(s.is_deleted,false)=false) then
        return jsonb_build_object('ok',false,'code','STUDENT_NOT_IN_ACADEMY');
      end if;
      if p_completed then
        v_completed := jsonb_set(v_completed,array[v_task],
          jsonb_build_object('completed_at',v_completed_at,'completed_month',v_now),true);
      else
        v_completed := v_completed - v_task;
      end if;
    end loop;
    v_progress := jsonb_set(v_progress,'{completed}',v_completed,true);
  elsif p_action='set_todos' then
    if jsonb_typeof(p_todos) <> 'array' or jsonb_array_length(p_todos)>100 then
      return jsonb_build_object('ok',false,'code','TODOS_INVALID');
    end if;
    v_progress := jsonb_set(v_progress,'{todos}',p_todos,true);
  end if;
  if coalesce(v_progress->>'tracking_started_month','')='' then
    v_progress := jsonb_set(v_progress,'{tracking_started_month}',to_jsonb(v_now),true);
  end if;
  v_progress := jsonb_set(v_progress,'{version}','1'::jsonb,true);
  update public.academy_settings a
  set consultation_progress=v_progress,updated_at=now() where a.academy_id=p_academy_id;
  return jsonb_build_object('ok',true,'progress',v_progress);
end;
$$;
revoke all on function public.olli_consultation_progress_access(text,uuid,text,text[],boolean,jsonb) from public,anon,authenticated;
grant execute on function public.olli_consultation_progress_access(text,uuid,text,text[],boolean,jsonb) to anon,authenticated,service_role;

create or replace function public.olli_consultation_summary_job_access(
  p_session_token text, p_academy_id uuid, p_student_id uuid,
  p_rule_key text, p_due_month text, p_action text default 'claim',
  p_claim_token uuid default null, p_content text default null,
  p_error text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_account uuid; v_role text; v_member_id uuid; v_job public.olli_consultation_summary_jobs%rowtype;
  v_summary_id bigint; v_summary_months integer; v_student_name text;
  v_token uuid; v_due_date date;
begin
  v_account := public.olli_account_id_from_session(p_session_token);
  if v_account is null then return jsonb_build_object('ok',false,'code','SESSION_INVALID'); end if;
  select m.id,m.role into v_member_id,v_role
  from public.academy_members m join public.academies a on a.id=m.academy_id
  where m.account_id=v_account and m.academy_id=p_academy_id
    and m.status='active' and a.status='active' and a.deleted_at is null
    and m.role in ('owner','manager','super_admin') limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'code','PERMISSION_DENIED'); end if;
  if p_rule_key not in ('after_1','after_3','every_6','every_12')
    or p_due_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
    or p_action not in ('claim','finish','fail','read') then
    return jsonb_build_object('ok',false,'code','PARAM_INVALID');
  end if;
  select s.name into v_student_name from public.students s
  where s.id=p_student_id and s.academy_id=p_academy_id
    and s.status='active' and not coalesce(s.is_deleted,false);
  if not found then return jsonb_build_object('ok',false,'code','STUDENT_NOT_FOUND'); end if;
  v_due_date := (p_due_month||'-01')::date;
  v_summary_months := case p_rule_key when 'after_1' then 1 when 'after_3' then 3
    when 'every_6' then 6 else 12 end;

  insert into public.olli_consultation_summary_jobs
    (academy_id,student_id,rule_key,due_month)
  values (p_academy_id,p_student_id,p_rule_key,p_due_month)
  on conflict do nothing;

  select * into v_job from public.olli_consultation_summary_jobs
  where academy_id=p_academy_id and student_id=p_student_id
    and rule_key=p_rule_key and due_month=p_due_month for update;

  if p_action='read' then
    return jsonb_build_object('ok',true,'status',v_job.status,'feedback_id',v_job.feedback_id);
  end if;
  if p_action='claim' then
    if v_job.status='ready' and v_job.feedback_id is not null
      and exists(select 1 from public.summary_feedbacks sf where sf.id=v_job.feedback_id and not coalesce(sf.is_deleted,false))
    then return jsonb_build_object('ok',true,'status','ready','feedback_id',v_job.feedback_id); end if;

    -- 이전 저장본도 서버에서 먼저 확인한다. 기존 수동/자동 결과를 새로 생성하지 않는다.
    select sf.id into v_summary_id from public.summary_feedbacks sf
    where sf.academy_id=p_academy_id and sf.student_id=p_student_id
      and coalesce(sf.is_deleted,false)=false and sf.summary_months=v_summary_months
      and sf.year=extract(year from v_due_date)::integer
      and sf.created_at >= (v_due_date - interval '1 month')
      and sf.created_at < (v_due_date + interval '2 months')
    order by sf.created_at desc limit 1;
    if v_summary_id is not null then
      update public.olli_consultation_summary_jobs
      set status='ready',feedback_id=v_summary_id,claim_token=null,leased_until=null,updated_at=now()
      where academy_id=p_academy_id and student_id=p_student_id
        and rule_key=p_rule_key and due_month=p_due_month;
      return jsonb_build_object('ok',true,'status','ready','feedback_id',v_summary_id);
    end if;

    if v_job.status='generating' and v_job.leased_until>now() then
      return jsonb_build_object('ok',true,'status','generating');
    end if;
    v_token := gen_random_uuid();
    update public.olli_consultation_summary_jobs
    set status='generating',claim_token=v_token,leased_until=now()+interval '8 minutes',
      attempts=attempts+1,last_error=null,updated_at=now()
    where academy_id=p_academy_id and student_id=p_student_id
      and rule_key=p_rule_key and due_month=p_due_month;
    return jsonb_build_object('ok',true,'status','claimed','claim_token',v_token);
  end if;
  if p_claim_token is null or v_job.status<>'generating'
    or v_job.claim_token is distinct from p_claim_token then
    return jsonb_build_object('ok',false,'code','CLAIM_MISMATCH');
  end if;
  if p_action='fail' then
    update public.olli_consultation_summary_jobs
    set status='error',last_error=left(coalesce(p_error,'error'),500),
      claim_token=null,leased_until=null,updated_at=now()
    where academy_id=p_academy_id and student_id=p_student_id
      and rule_key=p_rule_key and due_month=p_due_month;
    return jsonb_build_object('ok',true,'status','error');
  end if;
  if p_action='finish' then
    if length(btrim(coalesce(p_content,'')))<40 then
      return jsonb_build_object('ok',false,'code','CONTENT_INVALID');
    end if;
    insert into public.summary_feedbacks
      (academy_id,student_id,student_name,content,feedback_type,date,
       period_months,created_by,year,summary_months,client_mutation_id)
    values
      (p_academy_id,p_student_id,v_student_name,p_content,'summary',
       to_char(now() at time zone 'Asia/Seoul','YYYY. MM. DD.'),
       v_summary_months,v_member_id,extract(year from v_due_date)::int,v_summary_months,
       'consultation:'||p_academy_id||':'||p_student_id||':'||p_rule_key||':'||p_due_month)
    on conflict (academy_id,client_mutation_id) do nothing
    returning id into v_summary_id;
    if v_summary_id is null then
      select id into v_summary_id from public.summary_feedbacks
      where academy_id=p_academy_id
        and client_mutation_id='consultation:'||p_academy_id||':'||p_student_id||':'||p_rule_key||':'||p_due_month;
    end if;
    update public.olli_consultation_summary_jobs
    set status='ready',feedback_id=v_summary_id,claim_token=null,leased_until=null,updated_at=now()
    where academy_id=p_academy_id and student_id=p_student_id
      and rule_key=p_rule_key and due_month=p_due_month;
    return jsonb_build_object('ok',true,'status','ready','feedback_id',v_summary_id);
  end if;
  return jsonb_build_object('ok',false,'code','ACTION_INVALID');
end;
$$;
revoke all on function public.olli_consultation_summary_job_access(text,uuid,uuid,text,text,text,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.olli_consultation_summary_job_access(text,uuid,uuid,text,text,text,uuid,text,text)
  to anon,authenticated,service_role;
