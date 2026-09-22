-- Convert an existing pickup card into a dropoff entry with a saved dropoff location.
-- Reuses pickup_label for the location and clears pickup_time because dropoff does not need a time.

create or replace function public.olli_schedule_register_pickup_dropoff(
  p_session_token text,
  p_academy_id uuid,
  p_pickup_id uuid,
  p_dropoff_label text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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

  v_account_id := public.olli_account_id_from_session(p_session_token);
  perform set_config('olli.actor_account_id', coalesce(v_account_id::text, ''), true);
  perform set_config('olli.schedule_action', 'pickup_dropoff', true);

  update public.olli_schedule_pickups
  set pickup_label = v_label,
      pickup_time = null,
      is_dropoff = true,
      updated_at = now()
  where id = v_pickup.id;

  return jsonb_build_object(
    'ok', true,
    'result', 'updated',
    'pickup_id', v_pickup.id,
    'pickup_label', v_label,
    'pickup_time', null,
    'is_dropoff', true
  );
end;
$function$;

revoke all on function public.olli_schedule_register_pickup_dropoff(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.olli_schedule_register_pickup_dropoff(text, uuid, uuid, text) to anon, authenticated;
