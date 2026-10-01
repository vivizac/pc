-- Align timetable memo reads/writes with the shared half-hour timetable source of truth.
-- Backward compatible for hourly academies. Existing memo rows are not rewritten.

create or replace function public.olli_schedule_week(
  p_session_token text,
  p_academy_id uuid,
  p_week_start date
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_base jsonb;
  v_periods jsonb;
  v_legacy_snapshot jsonb;
  v_start date := p_week_start;
  v_end date := p_week_start + 6;
begin
  v_base := public.olli_schedule_week_legacy_v1(p_session_token,p_academy_id,p_week_start);
  if not coalesce((v_base->>'ok')::boolean,false) then return v_base; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'weekday',s.weekday,'time_slot',s.time_slot,
    'effective_from',s.effective_from,'effective_to',s.effective_to
  ) order by s.weekday,s.time_slot,s.effective_from),'[]'::jsonb)
  into v_periods
  from public.olli_schedule_class_splits s
  where s.academy_id=p_academy_id
    and s.effective_from<=v_end
    and (s.effective_to is null or s.effective_to>=v_start);

  select coalesce(jsonb_agg(jsonb_build_object(
    'weekday',x.weekday,'time_slot',x.time_slot
  ) order by x.weekday,x.time_slot),'[]'::jsonb)
  into v_legacy_snapshot
  from (
    select distinct s.weekday,s.time_slot
    from public.olli_schedule_class_splits s
    where s.academy_id=p_academy_id
      and s.effective_from<=current_date
      and (s.effective_to is null or s.effective_to>=current_date)
  ) x;

  return v_base || jsonb_build_object(
    'class_layout_version',2,
    'class_split_periods',v_periods,
    'class_splits',v_legacy_snapshot,
    'timetable_mode',private.olli_schedule_timetable_mode(p_academy_id)
  );
end;
$function$;

create or replace function public.olli_schedule_save_cell_memo_v3(
  p_session_token text,
  p_academy_id uuid,
  p_division text,
  p_session_date date,
  p_time_slot integer,
  p_note text,
  p_class_group text default null,
  p_memo_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_division text := lower(btrim(coalesce(p_division, '')));
  v_note text := btrim(coalesce(p_note, ''));
  v_group text := case when upper(btrim(coalesce(p_class_group, 'A'))) = 'B' then 'B' else 'A' end;
  v_weekday integer;
  v_memo public.olli_schedule_cell_memos%rowtype;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표 메모를 변경할 권한이 없습니다.');
  end if;

  if v_division not in ('elementary', 'kinder') or p_session_date is null then
    return jsonb_build_object('ok', false, 'message', '메모의 수업 정보를 확인해 주세요.');
  end if;

  v_weekday := extract(isodow from p_session_date)::integer;
  if not private.olli_schedule_slot_is_valid(
    p_academy_id,
    v_division,
    v_weekday,
    p_time_slot
  ) then
    return jsonb_build_object('ok', false, 'message', '메모를 저장할 시간표 칸을 확인해 주세요.');
  end if;

  if private.olli_schedule_timetable_mode(p_academy_id) = 'half_hour' then
    v_group := 'A';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':cell-memo-v3:' || v_division || ':' || p_session_date::text || ':' || p_time_slot::text,
    0
  ));

  v_account_id := public.olli_account_id_from_session(p_session_token);
  v_note := left(v_note, 5000);

  if p_memo_id is null then
    if v_note = '' then
      return jsonb_build_object('ok', true, 'created', false, 'deleted', false, 'memo', null);
    end if;

    insert into public.olli_schedule_cell_memos (
      academy_id, division, session_date, time_slot, class_group, note, updated_by_account_id
    ) values (
      p_academy_id, v_division, p_session_date, p_time_slot, v_group, v_note, v_account_id
    ) returning * into v_memo;

    return jsonb_build_object(
      'ok', true,
      'created', true,
      'deleted', false,
      'memo', jsonb_build_object(
        'id', v_memo.id,
        'division', v_memo.division,
        'session_date', v_memo.session_date,
        'time_slot', v_memo.time_slot,
        'class_group', v_memo.class_group,
        'note', v_memo.note,
        'created_at', v_memo.created_at,
        'updated_at', v_memo.updated_at
      )
    );
  end if;

  select m.* into v_memo
  from public.olli_schedule_cell_memos m
  where m.id = p_memo_id
    and m.academy_id = p_academy_id
    and m.division = v_division
    and m.session_date = p_session_date
    and m.time_slot = p_time_slot
  for update;

  if v_memo.id is null then
    return jsonb_build_object('ok', false, 'message', '수정할 메모를 찾지 못했습니다.');
  end if;

  if v_note = '' then
    delete from public.olli_schedule_cell_memos m
    where m.id = p_memo_id;
    return jsonb_build_object('ok', true, 'created', false, 'deleted', true, 'memo', null);
  end if;

  update public.olli_schedule_cell_memos m
     set class_group = v_group,
         note = v_note,
         updated_by_account_id = v_account_id,
         updated_at = now()
   where m.id = p_memo_id
  returning m.* into v_memo;

  return jsonb_build_object(
    'ok', true,
    'created', false,
    'deleted', false,
    'memo', jsonb_build_object(
      'id', v_memo.id,
      'division', v_memo.division,
      'session_date', v_memo.session_date,
      'time_slot', v_memo.time_slot,
      'class_group', v_memo.class_group,
      'note', v_memo.note,
      'created_at', v_memo.created_at,
      'updated_at', v_memo.updated_at
    )
  );
end;
$function$;

revoke all on function public.olli_schedule_save_cell_memo_v3(text, uuid, text, date, integer, text, text, uuid) from public;
grant execute on function public.olli_schedule_save_cell_memo_v3(text, uuid, text, date, integer, text, text, uuid) to anon, authenticated;
