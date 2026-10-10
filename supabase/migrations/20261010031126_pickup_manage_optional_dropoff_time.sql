-- Applied to production: optional dropoff time, preserving the existing label-only RPC.
CREATE OR REPLACE FUNCTION public.olli_schedule_register_pickup_dropoff_v2(p_session_token text, p_academy_id uuid, p_pickup_id uuid, p_dropoff_label text, p_dropoff_time time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_label text := btrim(coalesce(p_dropoff_label, ''));
  v_pickup public.olli_schedule_pickups%rowtype;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '픽업 시간표를 변경할 권한이 없습니다.');
  end if;

  if char_length(v_label) not between 1 and 80 then
    return jsonb_build_object('ok', false, 'message', '하원 장소를 1~80자로 입력해 주세요.');
  end if;

  select * into v_pickup
  from public.olli_schedule_pickups p
  where p.id = p_pickup_id
    and p.academy_id = p_academy_id
    and p.status = 'active'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', '픽업 일정을 찾을 수 없습니다.');
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  perform set_config('olli.actor_account_id', coalesce(v_account_id::text, ''), true);
  perform set_config('olli.schedule_action', 'pickup_dropoff', true);

  if v_pickup.is_dropoff = true then
    update public.olli_schedule_pickups
    set pickup_label = v_label,
        dropoff_label = v_label,
        dropoff_time = p_dropoff_time,
        updated_at = now()
    where id = v_pickup.id;
  else
    update public.olli_schedule_pickups
    set dropoff_label = v_label,
        dropoff_time = p_dropoff_time,
        updated_at = now()
    where id = v_pickup.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'result', 'updated',
    'pickup_id', v_pickup.id,
    'pickup_label', case when v_pickup.is_dropoff then v_label else v_pickup.pickup_label end,
    'pickup_time', v_pickup.pickup_time,
    'dropoff_label', v_label,
    'dropoff_time', p_dropoff_time,
    'is_dropoff', v_pickup.is_dropoff
  );
end;
$function$


revoke all on function public.olli_schedule_register_pickup_dropoff_v2(text, uuid, uuid, text, time without time zone) from public, anon, authenticated;
grant execute on function public.olli_schedule_register_pickup_dropoff_v2(text, uuid, uuid, text, time without time zone) to anon, authenticated;
