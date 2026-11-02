-- Restore manual consultation booking from the owner dashboard.
-- New RPC only: existing booking, cancellation, reschedule and consultation feedback are untouched.
begin;

create function public.olli_booking_staff_manual_manage(
  p_session_token text,
  p_academy_id uuid,
  p_action text,
  p_student_id uuid default null,
  p_start_at timestamptz default null,
  p_request_key uuid default null
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_students jsonb;
  v_id uuid;
begin
  perform olli_consultation_private.require_owner(p_session_token,p_academy_id);
  if p_action='students' then
    if p_student_id is not null or p_start_at is not null or p_request_key is not null then
      raise exception 'INVALID_STUDENT_LIST_REQUEST' using errcode='22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name)
      order by s.name,s.id),'[]'::jsonb)
      into v_students
    from public.students s
    where s.academy_id=p_academy_id and s.status='active' and s.is_deleted=false;
    return jsonb_build_object('ok',true,'students',v_students);
  end if;
  if p_action<>'create' then
    raise exception 'INVALID_ACTION' using errcode='22023';
  end if;
  if p_student_id is null or p_start_at is null or p_request_key is null then
    raise exception 'MANUAL_BOOKING_FIELDS_REQUIRED' using errcode='22023';
  end if;

  -- Reuse existing slot restrictions, one-live-booking uniqueness, request-key
  -- idempotency and audit records without modifying the existing RPCs.
  insert into public.olli_booking_settings(academy_id) values(p_academy_id)
    on conflict(academy_id) do nothing;
  perform olli_booking_private.assert_slot(p_academy_id,p_start_at);
  v_id:=public.olli_booking_server_reserve(
    p_academy_id,p_student_id,null,p_start_at,p_request_key,null,null);
  update public.olli_booking_events set actor='staff'
    where reservation_id=v_id and academy_id=p_academy_id
      and action='created' and actor='system';
  return jsonb_build_object('ok',true,'reservation_id',v_id);
end;
$function$;

revoke all on function public.olli_booking_staff_manual_manage(
  text,uuid,text,uuid,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.olli_booking_staff_manual_manage(
  text,uuid,text,uuid,timestamptz,uuid) to anon,authenticated,service_role;

commit;
