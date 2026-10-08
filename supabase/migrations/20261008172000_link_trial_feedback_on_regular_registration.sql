create or replace function public.olli_trial_feedback_link_student(p_session_token text,p_academy_id uuid,p_trial_session_id uuid,p_student_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.olli_schedule_one_time_sessions%rowtype; s public.students%rowtype; f public.olli_trial_feedbacks%rowtype; n integer:=0;
begin
 if not private.olli_schedule_can_access(p_session_token,p_academy_id) then return jsonb_build_object('ok',false,'message','권한이 없습니다.'); end if;
 select * into t from public.olli_schedule_one_time_sessions where id=p_trial_session_id and academy_id=p_academy_id and session_type='trial' and status<>'cancelled' for update;
 if not found then return jsonb_build_object('ok',false,'message','체험수업을 찾지 못했습니다.'); end if;
 select * into s from public.students where id=p_student_id and academy_id=p_academy_id and status='active' and coalesce(is_deleted,false)=false;
 if not found then return jsonb_build_object('ok',false,'message','정규 학생을 찾지 못했습니다.'); end if;
 if btrim(coalesce(t.guest_name,''))<>btrim(coalesce(s.name,'')) or coalesce(t.guest_division,'')<>coalesce(s.division,'') then
  return jsonb_build_object('ok',false,'message','체험 학생 이름이나 학부가 일치하지 않습니다.'); end if;
 if t.student_id is not null and t.student_id<>p_student_id then return jsonb_build_object('ok',false,'message','다른 학생과 연결된 체험수업입니다.'); end if;
 for f in select * from public.olli_trial_feedbacks where academy_id=p_academy_id and trial_session_id=p_trial_session_id order by created_at loop
  if not exists(select 1 from public.feedbacks x where x.academy_id=p_academy_id and x.student_id=p_student_id and x.client_mutation_id='trial:'||f.id::text) then
   insert into public.feedbacks(academy_id,student_id,student_name,content,feedback_type,date,year,lesson_date,client_mutation_id)
   values(p_academy_id,p_student_id,s.name,f.content,'수업 피드백',to_char(t.session_date,'MM/DD'),extract(year from t.session_date)::integer,t.session_date,'trial:'||f.id::text);
   n:=n+1;
  end if;
 end loop;
 update public.olli_schedule_one_time_sessions set student_id=p_student_id,updated_at=now() where id=p_trial_session_id and student_id is null;
 return jsonb_build_object('ok',true,'linked_count',n,'student_id',p_student_id);
end; $$;
revoke all on function public.olli_trial_feedback_link_student(text,uuid,uuid,uuid) from public;
grant execute on function public.olli_trial_feedback_link_student(text,uuid,uuid,uuid) to authenticated,anon,service_role;
