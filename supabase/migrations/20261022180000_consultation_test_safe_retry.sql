-- Atomic test-only reservation. A clear HTTP 4xx rejection without provider id may retry.
-- Submissions, unknown results and any provider-id record remain protected.
alter table public.olli_consultation_test_sends add column if not exists attempt_count integer not null default 1;
create or replace function public.olli_consultation_test_reserve(p_academy_id uuid,p_student_id uuid,p_template_id text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
 insert into public.olli_consultation_test_sends(academy_id,student_id,template_id,status)
 values(p_academy_id,p_student_id,p_template_id,'reserved')
 on conflict(academy_id,student_id,template_id) do update
 set status='reserved',provider_code=null,attempt_count=public.olli_consultation_test_sends.attempt_count+1
 where public.olli_consultation_test_sends.status='failed'
   and public.olli_consultation_test_sends.provider_message_id is null
   and (public.olli_consultation_test_sends.provider_code='PROVIDER_REJECTED'
     or public.olli_consultation_test_sends.provider_code ~ '^HTTP_4[0-9]{2}(_[A-Za-z0-9_-]{1,30})?$')
 returning id into v_id;
 return v_id;
end $$;
revoke all on function public.olli_consultation_test_reserve(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.olli_consultation_test_reserve(uuid,uuid,text) to service_role;
