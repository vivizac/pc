-- Read-only new-card markers for PC timetable. The 14-day window is based on
-- actual insert timestamps, not scheduled effective_from dates. No existing
-- timetable, pickup, student rows or write paths are changed.
create or replace function public.olli_schedule_recent_card_badges(
  p_session_token text,
  p_academy_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_enrollments jsonb;
  v_pickups jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표를 볼 권한이 없습니다.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'created_at', e.created_at
  )), '[]'::jsonb)
  into v_enrollments
  from public.olli_schedule_enrollments e
  join public.students s on s.id = e.student_id
  where e.academy_id = p_academy_id
    and e.status = 'active'
    and e.created_at <= now()
    and e.created_at > now() - interval '14 days'
    and s.academy_id = p_academy_id
    and s.status = 'active'
    and coalesce(s.is_deleted, false) = false;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'created_at', p.created_at
  )), '[]'::jsonb)
  into v_pickups
  from public.olli_schedule_pickups p
  join public.students s on s.id = p.student_id
  where p.academy_id = p_academy_id
    and p.status = 'active'
    and p.created_at <= now()
    and p.created_at > now() - interval '14 days'
    and s.academy_id = p_academy_id
    and s.status = 'active'
    and coalesce(s.is_deleted, false) = false;

  return jsonb_build_object(
    'ok', true,
    'enrollments', v_enrollments,
    'pickups', v_pickups
  );
end;
$function$;

revoke all on function public.olli_schedule_recent_card_badges(text, uuid) from public, anon, authenticated;
grant execute on function public.olli_schedule_recent_card_badges(text, uuid) to anon, authenticated;
comment on function public.olli_schedule_recent_card_badges(text, uuid)
  is 'Read-only 14-day timetable enrollment/pickup creation indicators after existing academy/session auth.';
