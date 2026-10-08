-- Trial guests are intentionally not registered students. Their stable identity is the
-- one-time trial session UUID, never a fabricated students.id.
-- Retain trial-only records for six months after the scheduled class date.
begin;

create table if not exists public.olli_trial_feedbacks (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete cascade,
  trial_session_id uuid not null references public.olli_schedule_one_time_sessions(id) on delete cascade,
  client_job_id text not null,
  content text not null check (length(btrim(content)) between 1 and 12000),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint olli_trial_feedbacks_unique_job unique(academy_id,client_job_id)
);
create index if not exists olli_trial_feedbacks_session_idx
  on public.olli_trial_feedbacks(academy_id,trial_session_id);

alter table public.olli_trial_feedbacks enable row level security;
revoke all on public.olli_trial_feedbacks from public,anon,authenticated;

create or replace function public.olli_trial_feedback_save(
  p_session_token text,
  p_academy_id uuid,
  p_trial_session_id uuid,
  p_client_job_id text,
  p_content text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_account uuid;
  v_row public.olli_trial_feedbacks%rowtype;
  v_content text := btrim(coalesce(p_content,''));
  v_job text := btrim(coalesce(p_client_job_id,''));
begin
  v_account := public.olli_account_id_from_session(p_session_token);
  if v_account is null or not exists (
    select 1 from public.academy_members m
    where m.account_id = v_account and m.academy_id = p_academy_id
      and m.status='active' and m.role in ('owner','manager','teacher')
  ) then
    return jsonb_build_object('ok',false,'message','체험 피드백 저장 권한이 없습니다.');
  end if;
  if p_academy_id is null or p_trial_session_id is null
      or length(v_job) not between 1 and 160
      or length(v_content) not between 1 and 12000 then
    return jsonb_build_object('ok',false,'message','체험 피드백 저장 값이 올바르지 않습니다.');
  end if;
  if not exists (
    select 1 from public.olli_schedule_one_time_sessions s
    where s.id=p_trial_session_id and s.academy_id=p_academy_id
      and s.student_id is null and s.session_type='trial' and s.status <> 'cancelled'
  ) then
    return jsonb_build_object('ok',false,'message','체험수업 기록을 찾지 못했습니다.');
  end if;

  insert into public.olli_trial_feedbacks
    (academy_id,trial_session_id,client_job_id,content,created_by)
  values (p_academy_id,p_trial_session_id,v_job,v_content,v_account)
  on conflict (academy_id,client_job_id) do update
    set updated_at=now()
    where public.olli_trial_feedbacks.trial_session_id=excluded.trial_session_id
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('ok',false,'message','체험 피드백 ID가 일치하지 않습니다.');
  end if;
  return jsonb_build_object('ok',true,'id',v_row.id,
    'trial_session_id',v_row.trial_session_id,'academy_id',v_row.academy_id);
end;
$$;

create or replace function public.olli_trial_feedback_update(
  p_session_token text,
  p_academy_id uuid,
  p_trial_feedback_id uuid,
  p_content text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_account uuid;
  v_row public.olli_trial_feedbacks%rowtype;
  v_content text := btrim(coalesce(p_content,''));
begin
  v_account := public.olli_account_id_from_session(p_session_token);
  if v_account is null or not exists (
    select 1 from public.academy_members m
    where m.account_id=v_account and m.academy_id=p_academy_id
      and m.status='active' and m.role in ('owner','manager','teacher')
  ) then
    return jsonb_build_object('ok',false,'message','체험 피드백 수정 권한이 없습니다.');
  end if;
  if length(v_content) not between 1 and 12000 then
    return jsonb_build_object('ok',false,'message','피드백 내용을 확인해 주세요.');
  end if;
  update public.olli_trial_feedbacks f
  set content=v_content,updated_at=now()
  where f.id=p_trial_feedback_id and f.academy_id=p_academy_id
  returning * into v_row;
  if v_row.id is null then
    return jsonb_build_object('ok',false,'message','수정할 체험 피드백이 없습니다.');
  end if;
  return jsonb_build_object('ok',true,'id',v_row.id,
    'trial_session_id',v_row.trial_session_id,'academy_id',v_row.academy_id);
end;
$$;

revoke all on function public.olli_trial_feedback_save(text,uuid,uuid,text,text) from public;
revoke all on function public.olli_trial_feedback_update(text,uuid,uuid,text) from public;
grant execute on function public.olli_trial_feedback_save(text,uuid,uuid,text,text) to anon,authenticated,service_role;
grant execute on function public.olli_trial_feedback_update(text,uuid,uuid,text) to anon,authenticated,service_role;

-- A DELETE writes a fresh schedule audit row through existing triggers. Purge that
-- trial-only audit chain AFTER deleting the session, without touching ordinary students.
create or replace function private.olli_purge_expired_trial_data()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_academy_id uuid;
  v_removed integer := 0;
  v_cutoff date := ((now() at time zone 'Asia/Seoul')::date - interval '6 months')::date;
begin
  for v_id, v_academy_id in
    select s.id,s.academy_id
    from public.olli_schedule_one_time_sessions s
    where s.session_type='trial' and s.student_id is null
      and s.session_date <= v_cutoff
    for update skip locked
  loop
    delete from public.olli_schedule_one_time_sessions s
    where s.id=v_id and s.academy_id=v_academy_id
      and s.session_type='trial' and s.student_id is null;
    if found then
      v_removed := v_removed+1;
      -- The trigger also records this deletion; remove all guest-only snapshots.
      delete from public.olli_schedule_audit_log a
      where a.academy_id=v_academy_id
        and a.table_name='olli_schedule_one_time_sessions' and a.row_id=v_id;
    end if;
  end loop;
  return v_removed;
end;
$$;
revoke all on function private.olli_purge_expired_trial_data() from public,anon,authenticated;

do $$
begin
  if not exists(select 1 from cron.job where jobname='olli_purge_expired_trial_data') then
    perform cron.schedule(
      'olli_purge_expired_trial_data',
      '30 18 * * *',
      'select private.olli_purge_expired_trial_data();'
    );
  end if;
end;
$$;

commit;
