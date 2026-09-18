create or replace function public.olli_schedule_attendance_session_overrides_range(
  p_session_token text,
  p_academy_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_start date := coalesce(p_start_date, current_date);
  v_end date := coalesce(p_end_date, p_start_date, current_date);
  v_rows jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '출석 상태를 볼 권한이 없습니다.');
  end if;

  if v_end < v_start or v_end > v_start + 62 then
    return jsonb_build_object('ok', false, 'message', '출석 상태 조회 기간을 확인해 주세요.');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'student_id', o.student_id,
        'session_date', o.session_date,
        'time_slot', o.time_slot,
        'class_group', o.class_group,
        'session_kind', 'register_override',
        'register_session_kind', o.session_kind,
        'register_status', o.status,
        'attended', (o.status in ('present','makeup')),
        'marked_at', o.updated_at
      )
      order by o.session_date, o.student_id, o.time_slot, o.class_group, o.session_kind
    ),
    '[]'::jsonb
  )
  into v_rows
  from private.olli_schedule_attendance_session_overrides o
  where o.academy_id = p_academy_id
    and o.session_date between v_start and v_end;

  return jsonb_build_object('ok', true, 'overrides', v_rows);
end;
$function$;

revoke all on function public.olli_schedule_attendance_session_overrides_range(text, uuid, date, date) from public;
grant execute on function public.olli_schedule_attendance_session_overrides_range(text, uuid, date, date) to anon, authenticated;

drop trigger if exists olli_schedule_sync_revision_trg on private.olli_schedule_attendance_session_overrides;
create trigger olli_schedule_sync_revision_trg
after insert or update or delete on private.olli_schedule_attendance_session_overrides
for each row execute function private.olli_schedule_bump_sync_revision();
