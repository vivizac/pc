-- PC student NEW badges follow each rendered lesson date. Read-only badge
-- metadata must remain available for historical and future calendar weeks.
-- This is read-only badge classification. Preserve all schedule writes,
-- saved/legacy enrollment rows, attendance, and pickup NEW/N behavior.
-- Correct the PC student NEW marker: only new registrations/new weekly classes,
-- not moved classes. Prior moves remain in the DB unchanged. The 14-day clock
-- still uses created_at; no timetable or pickup write path is modified.
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
    'created_at', e.created_at,
    'effective_from', e.effective_from,
    'weekday', e.weekday
  )), '[]'::jsonb)
  into v_enrollments
  from public.olli_schedule_enrollments e
  join public.students s on s.id = e.student_id
  where e.academy_id = p_academy_id
    and e.status = 'active'
    and e.created_at <= now()
    -- Only a newly added class/slot (or the original slot of a newly
    -- registered student) is eligible. A move creates a new row too, but
    -- must never restart the NEW badge for the destination.
    and (
      e.source in ('add', 'manual')
      or (
        e.source = 'waitlist'
        and exists (
          select 1 from public.olli_schedule_changes added
          where added.academy_id = e.academy_id
            and added.target_enrollment_id = e.id
            and added.change_type = 'add'
        )
      )
      or (
        e.source = 'legacy'
        and s.created_at >= e.created_at - interval '14 days'
        and s.created_at <= e.created_at
      )
    )
    -- Some accepted waitlist moves are stored with source='waitlist',
    -- so the authoritative change history must exclude those as well.
    and not exists (
      select 1 from public.olli_schedule_changes moved
      where moved.academy_id = e.academy_id
        and moved.target_enrollment_id = e.id
        and moved.change_type = 'move'
    )
    -- Re-registering an old weekly seat is NOT a new lesson even if the
    -- schedule action was recorded as 'add' after deletion/cancellation.
    -- Keep the test independent of A/B class-group and session-order changes.
    and not exists (
      select 1 from public.olli_schedule_enrollments previous
      where previous.academy_id = e.academy_id
        and previous.student_id = e.student_id
        and previous.id <> e.id
        and previous.created_at < e.created_at
        and previous.weekday = e.weekday
        and previous.time_slot = e.time_slot
    )
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
  is 'Read-only historical/future eligible student NEW metadata, excluding moves and re-adds; pickup N unchanged.';
