
do $$
begin
  if to_regprocedure('public.olli_schedule_resolve_waitlist_legacy_ab_v2(text,uuid,uuid,text,date)') is null then
    alter function public.olli_schedule_resolve_waitlist(text,uuid,uuid,text,date)
      rename to olli_schedule_resolve_waitlist_legacy_ab_v2;
  end if;
end;
$$;

create or replace function public.olli_schedule_resolve_waitlist(
  p_session_token text,
  p_academy_id uuid,
  p_waitlist_id uuid,
  p_action text,
  p_effective_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config(
    'olli.schedule_effective_date',
    coalesce(p_effective_date,current_date)::text,
    true
  );
  return public.olli_schedule_resolve_waitlist_legacy_ab_v2(
    p_session_token,p_academy_id,p_waitlist_id,p_action,p_effective_date
  );
end;
$$;

revoke all on function public.olli_schedule_resolve_waitlist_legacy_ab_v2(text,uuid,uuid,text,date)
  from public,anon,authenticated;
revoke all on function public.olli_schedule_resolve_waitlist(text,uuid,uuid,text,date)
  from public,anon,authenticated;
grant execute on function public.olli_schedule_resolve_waitlist(text,uuid,uuid,text,date)
  to anon,authenticated;
