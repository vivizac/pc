
do $$
begin
  if to_regprocedure('public.olli_schedule_execute_legacy_ab_v2(text,uuid,text,jsonb)') is null then
    alter function public.olli_schedule_execute(text,uuid,text,jsonb)
      rename to olli_schedule_execute_legacy_ab_v2;
  end if;
end;
$$;

create or replace function public.olli_schedule_execute(
  p_session_token text,
  p_academy_id uuid,
  p_action text,
  p_params jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_params jsonb := coalesce(p_params,'{}'::jsonb);
  v_context_date text;
begin
  v_context_date := coalesce(
    nullif(v_params->>'effective_date',''),
    nullif(v_params->>'session_date',''),
    ''
  );
  perform set_config('olli.schedule_effective_date',v_context_date,true);
  return public.olli_schedule_execute_legacy_ab_v2(
    p_session_token,p_academy_id,p_action,p_params
  );
end;
$$;

revoke all on function public.olli_schedule_execute_legacy_ab_v2(text,uuid,text,jsonb)
  from public,anon,authenticated;
revoke all on function public.olli_schedule_execute(text,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.olli_schedule_execute(text,uuid,text,jsonb)
  to anon,authenticated;
