alter table public.olli_schedule_cell_memos
  drop constraint if exists olli_schedule_cell_memos_slot_unique;

create index if not exists olli_schedule_cell_memos_slot_order_idx
  on public.olli_schedule_cell_memos (academy_id, division, session_date, time_slot, class_group, created_at, id);

create or replace function public.olli_schedule_cell_memos_week_v2(
  p_session_token text,
  p_academy_id uuid,
  p_week_start date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_start date := coalesce(p_week_start, current_date - (extract(isodow from current_date)::integer - 1));
  v_items jsonb;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표를 볼 권한이 없습니다.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'division', m.division,
    'session_date', m.session_date,
    'time_slot', m.time_slot,
    'class_group', m.class_group,
    'note', m.note,
    'created_at', m.created_at,
    'updated_at', m.updated_at
  ) order by m.session_date, m.time_slot, m.division, coalesce(m.class_group, 'A'), m.created_at, m.id), '[]'::jsonb)
  into v_items
  from public.olli_schedule_cell_memos m
  where m.academy_id = p_academy_id
    and m.session_date between v_start and v_start + 5;

  return jsonb_build_object('ok', true, 'memos', v_items);
end;
$function$;

create or replace function public.olli_schedule_add_cell_memo_v3(
  p_session_token text,
  p_academy_id uuid,
  p_division text,
  p_session_date date,
  p_time_slot integer,
  p_note text,
  p_class_group text default null
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
    return jsonb_build_object('ok', false, 'message', '시간표 메모를 추가할 권한이 없습니다.');
  end if;
  if v_division not in ('elementary', 'kinder') or p_session_date is null then
    return jsonb_build_object('ok', false, 'message', '메모의 수업 정보를 확인해 주세요.');
  end if;

  v_weekday := extract(isodow from p_session_date)::integer;
  if v_weekday not between 1 and 6
     or (v_division = 'elementary' and v_weekday = 6 and p_time_slot not in (10, 11, 12))
     or (v_division = 'elementary' and v_weekday <> 6 and p_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_time_slot not in (4, 5)) then
    return jsonb_build_object('ok', false, 'message', '메모를 저장할 시간표 칸을 확인해 주세요.');
  end if;
  if v_note = '' then
    return jsonb_build_object('ok', false, 'message', '메모 내용을 입력해 주세요.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':cell-memo:' || v_division || ':' || p_session_date::text || ':' || p_time_slot::text || ':' || v_group,
    0
  ));

  v_account_id := public.olli_account_id_from_session(p_session_token);
  v_note := left(v_note, 5000);

  insert into public.olli_schedule_cell_memos (
    academy_id, division, session_date, time_slot, class_group, note, updated_by_account_id
  ) values (
    p_academy_id, v_division, p_session_date, p_time_slot, v_group, v_note, v_account_id
  )
  returning * into v_memo;

  return jsonb_build_object(
    'ok', true,
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

create or replace function public.olli_schedule_update_cell_memo_v3(
  p_session_token text,
  p_academy_id uuid,
  p_memo_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_note text := btrim(coalesce(p_note, ''));
  v_memo public.olli_schedule_cell_memos%rowtype;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표 메모를 수정할 권한이 없습니다.');
  end if;
  if p_memo_id is null or v_note = '' then
    return jsonb_build_object('ok', false, 'message', '메모 내용을 확인해 주세요.');
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  v_note := left(v_note, 5000);

  update public.olli_schedule_cell_memos m
     set note = v_note,
         updated_by_account_id = v_account_id,
         updated_at = now()
   where m.id = p_memo_id
     and m.academy_id = p_academy_id
  returning m.* into v_memo;

  if v_memo.id is null then
    return jsonb_build_object('ok', false, 'message', '수정할 메모를 찾지 못했습니다.');
  end if;

  return jsonb_build_object(
    'ok', true,
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

create or replace function public.olli_schedule_delete_cell_memo_v3(
  p_session_token text,
  p_academy_id uuid,
  p_memo_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_memo public.olli_schedule_cell_memos%rowtype;
begin
  if not private.olli_schedule_can_access(p_session_token, p_academy_id) then
    return jsonb_build_object('ok', false, 'message', '시간표 메모를 삭제할 권한이 없습니다.');
  end if;
  if p_memo_id is null then
    return jsonb_build_object('ok', false, 'message', '삭제할 메모를 확인해 주세요.');
  end if;

  delete from public.olli_schedule_cell_memos m
   where m.id = p_memo_id
     and m.academy_id = p_academy_id
  returning m.* into v_memo;

  if v_memo.id is null then
    return jsonb_build_object('ok', false, 'message', '삭제할 메모를 찾지 못했습니다.');
  end if;

  return jsonb_build_object('ok', true, 'deleted', true, 'memo_id', v_memo.id);
end;
$function$;

create or replace function public.olli_schedule_save_cell_memo_v2(
  p_session_token text,
  p_academy_id uuid,
  p_division text,
  p_session_date date,
  p_time_slot integer,
  p_note text,
  p_class_group text default null
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
  if v_weekday not between 1 and 6
     or (v_division = 'elementary' and v_weekday = 6 and p_time_slot not in (10, 11, 12))
     or (v_division = 'elementary' and v_weekday <> 6 and p_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_time_slot not in (4, 5)) then
    return jsonb_build_object('ok', false, 'message', '메모를 저장할 시간표 칸을 확인해 주세요.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':cell-memo-legacy:' || v_division || ':' || p_session_date::text || ':' || p_time_slot::text,
    0
  ));

  if v_note = '' then
    delete from public.olli_schedule_cell_memos m
     where m.academy_id = p_academy_id
       and m.division = v_division
       and m.session_date = p_session_date
       and m.time_slot = p_time_slot;
    return jsonb_build_object('ok', true, 'deleted', true, 'memo', null);
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  v_note := left(v_note, 5000);

  select m.* into v_memo
  from public.olli_schedule_cell_memos m
  where m.academy_id = p_academy_id
    and m.division = v_division
    and m.session_date = p_session_date
    and m.time_slot = p_time_slot
  order by m.created_at, m.id
  limit 1
  for update;

  if v_memo.id is null then
    insert into public.olli_schedule_cell_memos (
      academy_id, division, session_date, time_slot, class_group, note, updated_by_account_id
    ) values (
      p_academy_id, v_division, p_session_date, p_time_slot, v_group, v_note, v_account_id
    ) returning * into v_memo;
  else
    update public.olli_schedule_cell_memos m
       set class_group = v_group,
           note = v_note,
           updated_by_account_id = v_account_id,
           updated_at = now()
     where m.id = v_memo.id
    returning m.* into v_memo;
  end if;

  return jsonb_build_object(
    'ok', true,
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

create or replace function public.olli_schedule_save_cell_memo(
  p_session_token text,
  p_academy_id uuid,
  p_division text,
  p_session_date date,
  p_time_slot integer,
  p_note text
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
  if v_weekday not between 1 and 6
     or (v_division = 'elementary' and v_weekday = 6 and p_time_slot not in (10, 11, 12))
     or (v_division = 'elementary' and v_weekday <> 6 and p_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_time_slot not in (4, 5)) then
    return jsonb_build_object('ok', false, 'message', '메모를 저장할 시간표 칸을 확인해 주세요.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_academy_id::text || ':cell-memo-legacy-v1:' || v_division || ':' || p_session_date::text || ':' || p_time_slot::text,
    0
  ));

  if v_note = '' then
    delete from public.olli_schedule_cell_memos m
     where m.academy_id = p_academy_id
       and m.division = v_division
       and m.session_date = p_session_date
       and m.time_slot = p_time_slot;
    return jsonb_build_object('ok', true, 'deleted', true, 'memo', null);
  end if;

  v_account_id := public.olli_account_id_from_session(p_session_token);
  v_note := left(v_note, 5000);

  select m.* into v_memo
  from public.olli_schedule_cell_memos m
  where m.academy_id = p_academy_id
    and m.division = v_division
    and m.session_date = p_session_date
    and m.time_slot = p_time_slot
  order by m.created_at, m.id
  limit 1
  for update;

  if v_memo.id is null then
    insert into public.olli_schedule_cell_memos (
      academy_id, division, session_date, time_slot, class_group, note, updated_by_account_id
    ) values (
      p_academy_id, v_division, p_session_date, p_time_slot, 'A', v_note, v_account_id
    ) returning * into v_memo;
  else
    update public.olli_schedule_cell_memos m
       set note = v_note,
           updated_by_account_id = v_account_id,
           updated_at = now()
     where m.id = v_memo.id
    returning m.* into v_memo;
  end if;

  return jsonb_build_object(
    'ok', true,
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

revoke all on function public.olli_schedule_add_cell_memo_v3(text, uuid, text, date, integer, text, text) from public;
revoke all on function public.olli_schedule_update_cell_memo_v3(text, uuid, uuid, text) from public;
revoke all on function public.olli_schedule_delete_cell_memo_v3(text, uuid, uuid) from public;
grant execute on function public.olli_schedule_add_cell_memo_v3(text, uuid, text, date, integer, text, text) to anon, authenticated, service_role;
grant execute on function public.olli_schedule_update_cell_memo_v3(text, uuid, uuid, text) to anon, authenticated, service_role;
grant execute on function public.olli_schedule_delete_cell_memo_v3(text, uuid, uuid) to anon, authenticated, service_role;
