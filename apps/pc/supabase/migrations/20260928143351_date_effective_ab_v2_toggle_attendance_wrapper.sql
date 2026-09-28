
do $$
begin
  if to_regprocedure('public.olli_schedule_toggle_attendance_legacy_ab_v2(text,uuid,uuid,date,integer,text,text)') is null then
    alter function public.olli_schedule_toggle_attendance(text,uuid,uuid,date,integer,text,text)
      rename to olli_schedule_toggle_attendance_legacy_ab_v2;
  end if;
end;
$$;

create or replace function public.olli_schedule_toggle_attendance(
  p_session_token text,
  p_academy_id uuid,
  p_student_id uuid,
  p_session_date date,
  p_time_slot integer,
  p_class_group text,
  p_session_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('olli.schedule_effective_date',coalesce(p_session_date,current_date)::text,true);
  return public.olli_schedule_toggle_attendance_legacy_ab_v2(
    p_session_token,p_academy_id,p_student_id,p_session_date,p_time_slot,p_class_group,p_session_kind
  );
end;
$$;

revoke all on function public.olli_schedule_toggle_attendance_legacy_ab_v2(text,uuid,uuid,date,integer,text,text)
  from public,anon,authenticated;
revoke all on function public.olli_schedule_toggle_attendance(text,uuid,uuid,date,integer,text,text)
  from public,anon,authenticated;
grant execute on function public.olli_schedule_toggle_attendance(text,uuid,uuid,date,integer,text,text)
  to anon,authenticated;
