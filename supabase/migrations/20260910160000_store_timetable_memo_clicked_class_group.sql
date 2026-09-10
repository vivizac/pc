alter table public.olli_schedule_cell_memos
  add column if not exists class_group text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'olli_schedule_cell_memos_class_group_check'
      and conrelid = 'public.olli_schedule_cell_memos'::regclass
  ) then
    alter table public.olli_schedule_cell_memos
      add constraint olli_schedule_cell_memos_class_group_check
      check (class_group is null or class_group in ('A','B'));
  end if;
end $$;

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
as $$
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
    p_academy_id::text || ':cell-memo:' || v_division || ':' || p_session_date::text || ':' || p_time_slot::text,
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
  perform set_config('olli.actor_account_id', coalesce(v_account_id::text, ''), true);
  perform set_config('olli.schedule_action', 'memo_save', true);
  v_note := left(v_note, 5000);

  insert into public.olli_schedule_cell_memos as m (
    academy_id, division, session_date, time_slot, class_group, note, updated_by_account_id
  ) values (
    p_academy_id, v_division, p_session_date, p_time_slot, v_group, v_note, v_account_id
  )
  on conflict (academy_id, division, session_date, time_slot)
  do update set
    class_group = excluded.class_group,
    note = excluded.note,
    updated_by_account_id = excluded.updated_by_account_id,
    updated_at = now()
  returning m.* into v_memo;

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
      'updated_at', v_memo.updated_at
    )
  );
end;
$$;

create or replace function public.olli_schedule_cell_memos_week_v2(
  p_session_token text,
  p_academy_id uuid,
  p_week_start date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    'updated_at', m.updated_at
  ) order by m.session_date, m.time_slot, m.division), '[]'::jsonb)
  into v_items
  from public.olli_schedule_cell_memos m
  where m.academy_id = p_academy_id
    and m.session_date between v_start and v_start + 5;

  return jsonb_build_object('ok', true, 'memos', v_items);
end;
$$;

revoke all on function public.olli_schedule_save_cell_memo_v2(text, uuid, text, date, integer, text, text) from public;
revoke all on function public.olli_schedule_cell_memos_week_v2(text, uuid, date) from public;
grant execute on function public.olli_schedule_save_cell_memo_v2(text, uuid, text, date, integer, text, text) to anon, authenticated;
grant execute on function public.olli_schedule_cell_memos_week_v2(text, uuid, date) to anon, authenticated;