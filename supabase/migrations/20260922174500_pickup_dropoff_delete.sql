-- Remove only the supplemental dropoff setting from a normal arrival pickup.
-- The arrival pickup place/time stay unchanged.

create or replace function public.olli_schedule_remove_pickup_dropoff(
  p_session_token text,
  p_academy_id uuid,
  p_pickup_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_pickup public.olli_schedule_pickups%rowtype;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '픽업 시간표를 변경할 권한이 없습니다.');
  end if;

  select *
    into v_pickup
  from public.olli_schedule_pickups p
  where p.id = p_pickup_id
    and p.academy_id = p_academy_id
    and p.status = 'active'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', '픽업 일정을 찾을 수 없습니다.');
  end if;

  if v_pickup.is_dropoff = true then
    return jsonb_build_object('ok', false, 'message', '하원 전용 일정은 픽업 삭제를 이용해 주세요.');
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  perform set_config('olli.actor_account_id', coalesce(v_account_id::text, ''), true);
  perform set_config('olli.schedule_action', 'pickup_dropoff_remove', true);

  update public.olli_schedule_pickups
  set dropoff_label = null,
      updated_at = now()
  where id = v_pickup.id;

  return jsonb_build_object(
    'ok', true,
    'result', 'updated',
    'pickup_id', v_pickup.id,
    'pickup_label', v_pickup.pickup_label,
    'pickup_time', v_pickup.pickup_time,
    'dropoff_label', null,
    'is_dropoff', false
  );
end;
$function$;

revoke all on function public.olli_schedule_remove_pickup_dropoff(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.olli_schedule_remove_pickup_dropoff(text, uuid, uuid) to anon, authenticated;
