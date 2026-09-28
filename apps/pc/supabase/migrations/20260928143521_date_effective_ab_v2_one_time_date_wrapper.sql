
do $$
begin
  if to_regprocedure('public.olli_schedule_update_one_time_date_legacy_ab_v2(text,uuid,uuid,date)') is null then
    alter function public.olli_schedule_update_one_time_date(text,uuid,uuid,date)
      rename to olli_schedule_update_one_time_date_legacy_ab_v2;
  end if;
end;
$$;

create or replace function public.olli_schedule_update_one_time_date(
  p_session_token text,
  p_academy_id uuid,
  p_one_time_session_id uuid,
  p_session_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('olli.schedule_effective_date',coalesce(p_session_date,current_date)::text,true);
  return public.olli_schedule_update_one_time_date_legacy_ab_v2(
    p_session_token,p_academy_id,p_one_time_session_id,p_session_date
  );
end;
$$;

revoke all on function public.olli_schedule_update_one_time_date_legacy_ab_v2(text,uuid,uuid,date)
  from public,anon,authenticated;
revoke all on function public.olli_schedule_update_one_time_date(text,uuid,uuid,date)
  from public,anon,authenticated;
grant execute on function public.olli_schedule_update_one_time_date(text,uuid,uuid,date)
  to anon,authenticated;
