-- Preserve the selected A/B group when an elementary split-class waitlist entry is accepted.

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
declare
  v_wait public.olli_schedule_waitlist%rowtype;
  v_source public.olli_schedule_enrollments%rowtype;
  v_division text;
  v_class_group text;
  v_capacity integer;
  v_occupancy integer;
  v_effective date := coalesce(p_effective_date, current_date);
  v_target_id uuid;
  v_change_id uuid;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '대기 명단을 변경할 권한이 없습니다.');
  end if;
  select * into v_wait from public.olli_schedule_waitlist w
  where w.id = p_waitlist_id and w.academy_id = p_academy_id and w.status in ('waiting','offered') for update;
  if not found then return jsonb_build_object('ok', false, 'message', '대기 정보를 찾을 수 없습니다.'); end if;
  if p_action = 'cancel' then
    update public.olli_schedule_waitlist set status = 'cancelled', resolved_at = now(), updated_at = now() where id = v_wait.id;
    return jsonb_build_object('ok', true, 'result', 'cancelled');
  end if;
  if p_action <> 'accept' then return jsonb_build_object('ok', false, 'message', '대기 처리 방법을 확인해 주세요.'); end if;
  if v_effective < current_date then return jsonb_build_object('ok', false, 'message', '지난 날짜로는 입장시킬 수 없습니다.'); end if;

  select s.division into v_division from public.students s
  where s.id = v_wait.student_id and s.academy_id = p_academy_id and s.status = 'active';
  if v_division is null then return jsonb_build_object('ok', false, 'message', '학생을 찾을 수 없습니다.'); end if;
  v_class_group := case
    when private.olli_schedule_group_is_enabled(p_academy_id, v_division, v_wait.target_weekday, v_wait.target_time_slot)
      then coalesce(v_wait.target_class_group, 'A')
    else 'A'
  end;
  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':' || v_wait.target_weekday::text || ':' || v_wait.target_time_slot::text || ':' || v_class_group,
    0
  ));
  v_capacity := private.olli_schedule_capacity(p_academy_id, v_division);
  select count(*) into v_occupancy from public.olli_schedule_enrollments e
  join public.students s on s.id = e.student_id
  where e.academy_id = p_academy_id and s.division = v_division
    and e.weekday = v_wait.target_weekday and e.time_slot = v_wait.target_time_slot
    and e.class_group = v_class_group and e.status = 'active'
    and e.effective_from <= v_effective and (e.effective_to is null or e.effective_to >= v_effective);
  if v_occupancy >= v_capacity then return jsonb_build_object('ok', false, 'message', '아직 입장 가능한 자리가 없습니다.', 'full', true); end if;

  if v_wait.request_type = 'move' then
    select * into v_source from public.olli_schedule_enrollments e
    where e.id = v_wait.source_enrollment_id and e.academy_id = p_academy_id and e.student_id = v_wait.student_id and e.status = 'active';
    if not found then return jsonb_build_object('ok', false, 'message', '기존 수업 정보를 찾을 수 없습니다.'); end if;
    if v_effective <= v_source.effective_from then
      update public.olli_schedule_enrollments set status = 'cancelled', updated_at = now() where id = v_source.id;
    else
      update public.olli_schedule_enrollments set effective_to = v_effective - 1, updated_at = now() where id = v_source.id;
    end if;
  end if;
  insert into public.olli_schedule_enrollments (academy_id, student_id, weekday, time_slot, class_group, effective_from, source)
  values (p_academy_id, v_wait.student_id, v_wait.target_weekday, v_wait.target_time_slot, v_class_group, v_effective, 'waitlist')
  returning id into v_target_id;
  insert into public.olli_schedule_changes (
    academy_id, student_id, change_type, source_enrollment_id, target_enrollment_id,
    target_class_group, effective_date, status, waitlist_id
  ) values (
    p_academy_id, v_wait.student_id, v_wait.request_type,
    case when v_wait.request_type = 'move' then v_wait.source_enrollment_id else null end,
    v_target_id, v_class_group, v_effective,
    case when v_effective <= current_date then 'applied' else 'scheduled' end, v_wait.id
  ) returning id into v_change_id;
  update public.olli_schedule_waitlist set status = 'accepted', resolved_at = now(), updated_at = now() where id = v_wait.id;
  if v_effective <= current_date then perform private.olli_schedule_sync_student(v_wait.student_id, current_date); end if;
  return jsonb_build_object('ok', true, 'result', 'accepted', 'change_id', v_change_id);
end;
$$;

revoke all on function public.olli_schedule_resolve_waitlist(text, uuid, uuid, text, date) from public, anon, authenticated;
