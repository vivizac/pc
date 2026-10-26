-- Restore seven reviewed, exact-month legacy consultation links without touching any summary content.
-- Historical source_feedback_ids is uuid[] for fail_feedbacks.id. Do NOT cast or overwrite it:
-- feedbacks.id is bigint, so use a distinct additive column to retain compatibility.
alter table public.summary_feedbacks
  add column if not exists source_general_feedback_ids bigint[];
comment on column public.summary_feedbacks.source_general_feedback_ids is
  'Exact feedbacks.id bigint records supplied to the summary AI. NULL on legacy records with unknown provenance; [] when generated without ordinary feedbacks.';

with reviewed(summary_id, rule_key, due_month, months) as (
  values
    (25::bigint, 'after_1', '2026-08', 1),
    (27::bigint, 'every_6', '2026-09', 6),
    (33::bigint, 'every_6', '2026-09', 6),
    (29::bigint, 'every_6', '2026-09', 6),
    (30::bigint, 'every_6', '2026-09', 6),
    (34::bigint, 'after_1', '2026-09', 1),
    (31::bigint, 'every_6', '2026-09', 6)
), eligible as (
  select j.academy_id,j.student_id,j.rule_key,j.due_month,s.id summary_id
    from reviewed r
    join public.summary_feedbacks s on s.id=r.summary_id
    join public.olli_consultation_summary_jobs j
      on j.academy_id=s.academy_id and j.student_id=s.student_id
     and j.rule_key=r.rule_key and j.due_month=r.due_month
   where j.status='legacy_review_required' and j.feedback_id is null
     and coalesce(s.is_deleted,false)=false and s.summary_months=r.months
     and s.period_months=r.months
     and s.year=split_part(r.due_month,'-',1)::integer
     and to_char(s.created_at at time zone 'Asia/Seoul','YYYY-MM')=r.due_month
     and not exists (select 1 from public.olli_consultation_summary_jobs other_job
                      where other_job.feedback_id=s.id)
     and (select count(*) from public.summary_feedbacks candidate
          where candidate.academy_id=s.academy_id and candidate.student_id=s.student_id
            and not coalesce(candidate.is_deleted,false)
            and candidate.summary_months=r.months and candidate.period_months=r.months
            and to_char(candidate.created_at at time zone 'Asia/Seoul','YYYY-MM')=r.due_month)=1
)
update public.olli_consultation_summary_jobs j
   set status='ready', feedback_id=eligible.summary_id, last_error=null,
       claim_token=null, leased_until=null, updated_at=now()
  from eligible
 where j.academy_id=eligible.academy_id and j.student_id=eligible.student_id
   and j.rule_key=eligible.rule_key and j.due_month=eligible.due_month
   and j.status='legacy_review_required' and j.feedback_id is null;

-- Atomic finish, with a verified, typed snapshot of the exact input records.
-- Existing claim/read/revise RPC and client storage paths remain untouched.
create or replace function public.olli_consultation_summary_finish_with_sources(
  p_session_token text, p_academy_id uuid, p_student_id uuid,
  p_rule_key text, p_due_month text, p_claim_token uuid, p_content text,
  p_source_general_feedback_ids bigint[], p_source_feedback_ids uuid[]
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_member_id uuid;
  v_student_name text;
  v_job public.olli_consultation_summary_jobs%rowtype;
  v_general bigint[] := coalesce(p_source_general_feedback_ids, '{}'::bigint[]);
  v_retry uuid[] := coalesce(p_source_feedback_ids, '{}'::uuid[]);
  v_months integer;
  v_summary_id bigint;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    return jsonb_build_object('ok',false,'code','SERVICE_ROLE_REQUIRED');
  end if;
  if p_academy_id is null or p_student_id is null or p_claim_token is null
     or p_due_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
     or p_rule_key not in ('after_1','after_3','every_6','every_12',
                           'manual_1','manual_3','manual_6','manual_12') then
    return jsonb_build_object('ok',false,'code','INVALID_TASK');
  end if;
  if length(btrim(coalesce(p_content,'')))<40 then
    return jsonb_build_object('ok',false,'code','CONTENT_INVALID');
  end if;
  if p_session_token is distinct from '__olli_server_cron_internal__' then
    select m.id into v_member_id
      from public.academy_members m join public.academies a on a.id=m.academy_id
     where m.account_id=public.olli_account_id_from_session(p_session_token)
       and m.academy_id=p_academy_id and m.status='active'
       and m.role in ('owner','manager','super_admin')
       and a.status='active' and a.deleted_at is null
     limit 1;
    if v_member_id is null then
      return jsonb_build_object('ok',false,'code','PERMISSION_DENIED');
    end if;
  end if;
  select s.name into v_student_name
    from public.students s join public.academies a on a.id=s.academy_id
   where s.id=p_student_id and s.academy_id=p_academy_id
     and s.status='active' and not coalesce(s.is_deleted,false)
     and a.status='active' and a.deleted_at is null;
  if v_student_name is null then
    return jsonb_build_object('ok',false,'code','STUDENT_NOT_FOUND');
  end if;
  v_months := case p_rule_key
    when 'after_1' then 1 when 'manual_1' then 1
    when 'after_3' then 3 when 'manual_3' then 3
    when 'every_6' then 6 when 'manual_6' then 6 else 12 end;
  if cardinality(v_general)+cardinality(v_retry)<1
     or cardinality(v_general)+cardinality(v_retry)>300
     or exists(select 1 from unnest(v_general) as i(id) where id is null or id<=0)
     or exists(select 1 from unnest(v_retry) as i(id) where id is null)
     or (select count(distinct id) from unnest(v_general) as i(id))<>cardinality(v_general)
     or (select count(distinct id) from unnest(v_retry) as i(id))<>cardinality(v_retry) then
    return jsonb_build_object('ok',false,'code','INVALID_SOURCE_LIST');
  end if;
  if (select count(*) from public.feedbacks f
       where f.id=any(v_general) and f.academy_id=p_academy_id
         and f.student_id=p_student_id and not coalesce(f.is_deleted,false)
         and length(btrim(coalesce(f.content,'')))>0) <> cardinality(v_general)
     or (select count(*) from public.fail_feedbacks f
       where f.id=any(v_retry) and f.academy_id=p_academy_id
         and f.student_id=p_student_id and not coalesce(f.is_deleted,false)
         and length(btrim(coalesce(f.content,'')))>0) <> cardinality(v_retry) then
    return jsonb_build_object('ok',false,'code','SOURCE_MISMATCH');
  end if;
  select * into v_job from public.olli_consultation_summary_jobs j
   where j.academy_id=p_academy_id and j.student_id=p_student_id
     and j.rule_key=p_rule_key and j.due_month=p_due_month for update;
  if not found or v_job.status<>'generating'
     or v_job.claim_token is distinct from p_claim_token then
    return jsonb_build_object('ok',false,'code','CLAIM_MISMATCH');
  end if;
  insert into public.summary_feedbacks
    (academy_id,student_id,student_name,content,feedback_type,date,
     period_months,created_by,year,summary_months,client_mutation_id,
     source_general_feedback_ids,source_feedback_ids)
  values
    (p_academy_id,p_student_id,v_student_name,p_content,'summary',
     to_char(now() at time zone 'Asia/Seoul','YYYY. MM. DD.'),
     v_months,v_member_id,split_part(p_due_month,'-',1)::integer,v_months,
     'consultation:'||p_academy_id||':'||p_student_id||':'||p_rule_key||':'||p_due_month,
     v_general,v_retry)
  on conflict (academy_id,client_mutation_id) do nothing returning id into v_summary_id;
  if v_summary_id is null then
    select id into v_summary_id from public.summary_feedbacks
     where academy_id=p_academy_id and student_id=p_student_id
       and client_mutation_id='consultation:'||p_academy_id||':'||p_student_id||':'||p_rule_key||':'||p_due_month
       and not coalesce(is_deleted,false);
  end if;
  if v_summary_id is null then
    return jsonb_build_object('ok',false,'code','SUMMARY_INSERT_FAILED');
  end if;
  update public.olli_consultation_summary_jobs j
     set status='ready',feedback_id=v_summary_id,claim_token=null,
         leased_until=null,last_error=null,updated_at=now()
   where j.academy_id=p_academy_id and j.student_id=p_student_id
     and j.rule_key=p_rule_key and j.due_month=p_due_month;
  return jsonb_build_object('ok',true,'status','ready','feedback_id',v_summary_id);
end;
$function$;
revoke execute on function public.olli_consultation_summary_finish_with_sources(
  text,uuid,uuid,text,text,uuid,text,bigint[],uuid[]
) from public,anon,authenticated;
grant execute on function public.olli_consultation_summary_finish_with_sources(
  text,uuid,uuid,text,text,uuid,text,bigint[],uuid[]
) to service_role;