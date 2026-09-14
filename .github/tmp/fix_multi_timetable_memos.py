from pathlib import Path
import re


def sub_once(text, pattern, replacement, label, flags=0):
    out, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 replacement, got {count}')
    return out


js_path = Path('pc-timetable.js')
js = js_path.read_text(encoding='utf-8')

js = sub_once(
    js,
    r"\n  function escMemoLine\(value\) \{.*?\n  \}\n  function renderTimetableMemoLines\(value\) \{.*?\n  \}\n  function pad\(value\)",
    "\n  function pad(value)",
    'remove line icon helpers',
    re.S,
)

js = sub_once(
    js,
    r"    const memoLines = card\.querySelector\('\.olliTtMemoLines'\);\n    if \(!memoLines \|\| !clean\(memoLines\.textContent\)\) return;\n\n    hideTimetableMemoHoverPreview\(\);\n    const preview = document\.createElement\('div'\);\n    preview\.className = 'olliTtMemoHoverPreview';\n    preview\.innerHTML = `<span class=\"olliTtMemoLines\">\$\{memoLines\.innerHTML\}</span>`;",
    "    const text = clean(card.querySelector('strong')?.textContent);\n    if (!text) return;\n\n    hideTimetableMemoHoverPreview();\n    const preview = document.createElement('div');\n    preview.className = 'olliTtMemoHoverPreview';\n    preview.innerHTML = `<span aria-hidden=\"true\">📝</span><strong>${esc(text)}</strong>`;",
    'restore hover preview',
)

js = sub_once(
    js,
    r"    const existingMemo = cellMemoText\(division, targetDate, time\);\n    const existingMemoGroup = existingMemo \? cellMemoClassGroup\(division, targetDate, time\) : '';\n",
    "",
    'remove existing memo preload',
)
js = sub_once(
    js,
    r"      query: '', guestName: '', note: existingMemo, originalNote: existingMemo, originalMemoGroup: existingMemoGroup, addType: 'wait', targetClassGroup,",
    "      query: '', guestName: '', note: '', originalNote: '', originalMemoGroup: '', addType: 'wait', targetClassGroup,",
    'blank add popup memo',
)

js = sub_once(
    js,
    r"  async function saveCellMemoText\(division, date, time, note, classGroup\) \{\n    if \(typeof service\.saveCellMemo !== 'function'\) throw new Error\('시간표 메모 서버 연결을 찾지 못했습니다\.'\);\n    const keyDate = date instanceof Date \? dateKey\(date\) : clean\(date\);\n    return service\.saveCellMemo\(clean\(division\), keyDate, Number\(time\), clean\(note\), classGroupOf\(\{ class_group: classGroup \}\)\);\n  \}",
    "  async function saveCellMemoText(division, date, time, note, classGroup, memoId) {\n    if (typeof service.saveCellMemo !== 'function') throw new Error('시간표 메모 서버 연결을 찾지 못했습니다.');\n    const keyDate = date instanceof Date ? dateKey(date) : clean(date);\n    return service.saveCellMemo(clean(division), keyDate, Number(time), clean(note), classGroupOf({ class_group: classGroup }), clean(memoId) || null);\n  }",
    'memo save helper',
)

js = sub_once(
    js,
    r"    const memo = clean\(memoText\);\n    const memoHtml = memo \? `<button type=\"button\" class=\"olliTtCellMemoCard\".*?</button>` : '';\n    return `<div class=\"olliTtEntries\">\$\{regularHtml\}\$\{waitHtml\}\$\{makeupHtml\}\$\{memoHtml\}</div>`;",
    "    const memoGroup = classGroup ? classGroupOf({ class_group: classGroup }) : '';\n    const memoHtml = cellMemos().filter((item) => clean(item.division) === clean(division)\n      && clean(item.session_date) === dateKey(date)\n      && Number(item.time_slot) === Number(time)\n      && (!memoGroup || classGroupOf(item) === memoGroup))\n      .map((item) => `<button type=\"button\" class=\"olliTtCellMemoCard\" data-tt-memo-card=\"1\" data-memo-id=\"${esc(item.id)}\" data-division=\"${esc(division)}\" data-date=\"${dateKey(date)}\" data-time=\"${Number(time)}\" data-class-group=\"${esc(classGroupOf(item))}\" aria-label=\"시간표 메모 관리\"><span aria-hidden=\"true\">📝</span><strong>${esc(item.note)}</strong></button>`).join('');\n    return `<div class=\"olliTtEntries\">${regularHtml}${waitHtml}${makeupHtml}${memoHtml}</div>`;",
    'render multiple memo cards',
    re.S,
)

js = sub_once(
    js,
    r"  function openMemoManage\(dataset\) \{.*?\n  \}\n\n  function openWait",
    "  function openMemoManage(dataset) {\n    const memoId = clean(dataset && dataset.memoId);\n    const item = cellMemos().find((row) => clean(row.id) === memoId);\n    if (!item) return;\n    const division = clean(item.division);\n    const date = clean(item.session_date);\n    const time = Number(item.time_slot);\n    const memo = clean(item.note);\n    if (!division || !date || !time || !memo) return;\n    state.dialog = { kind: 'memoManage', memoId, division, date, time, classGroup: classGroupOf(item), memo, originalMemo: memo };\n    openOverlay();\n  }\n\n  function openWait",
    'open exact memo',
    re.S,
)

js = sub_once(
    js,
    r"  async function persistDialogCellMemo\(dialog\) \{.*?\n  \}\n\n  async function saveManagedMemo",
    "  async function persistDialogCellMemo(dialog) {\n    if (!dialog || dialog.kind !== 'add') return null;\n    const note = clean(dialog.note);\n    if (!note) return null;\n    return saveCellMemoText(dialog.division, dialog.date, dialog.time, note, dialog.targetClassGroup, null);\n  }\n\n  async function saveManagedMemo",
    'append add-popup memo',
    re.S,
)

js = sub_once(
    js,
    r"    const result = await withSaving\(\(\) => saveCellMemoText\(dialog\.division, dialog\.date, dialog\.time, dialog\.memo, dialog\.classGroup\)\);",
    "    const result = await withSaving(() => saveCellMemoText(dialog.division, dialog.date, dialog.time, dialog.memo, dialog.classGroup, dialog.memoId));",
    'update exact memo',
)
js = sub_once(
    js,
    r"    const result = await withSaving\(\(\) => saveCellMemoText\(dialog\.division, dialog\.date, dialog\.time, '', dialog\.classGroup\)\);",
    "    const result = await withSaving(() => saveCellMemoText(dialog.division, dialog.date, dialog.time, '', dialog.classGroup, dialog.memoId));",
    'delete exact memo',
)

js = sub_once(
    js,
    r"      const hasMemo = !!cellMemoText\('elementary', date, storedTime\);",
    "      const memoItems = cellMemos().filter((item) => clean(item.division) === 'elementary'\n        && clean(item.session_date) === dateKey(date)\n        && Number(item.time_slot) === Number(storedTime));",
    'adaptive memo items',
)
js = sub_once(
    js,
    r"      const memoHeight = hasMemo \? 41 : 0;",
    "      const memoHeight = memoItems.reduce((sum, item) => {\n        const lines = Math.max(1, String(item.note || '').replace(/\\r\\n?/g, '\\n').split('\\n').length);\n        return sum + Math.max(27, 8 + (lines * 15));\n      }, 0);",
    'adaptive memo height',
)

js_path.write_text(js, encoding='utf-8')

service_path = Path('pc-timetable-service.js')
service = service_path.read_text(encoding='utf-8')
service = sub_once(
    service,
    r"  async function saveCellMemo\(division, sessionDate, timeSlot, note, classGroup\) \{\n    return rpc\('olli_schedule_save_cell_memo_v2', contextPayload\(\{\n      p_division: clean\(division\),\n      p_session_date: clean\(sessionDate\),\n      p_time_slot: Number\(timeSlot\),\n      p_note: note \|\| '',\n      p_class_group: clean\(classGroup \|\| 'A'\)\.toUpperCase\(\) === 'B' \? 'B' : 'A'\n    \}\)\);\n  \}",
    "  async function saveCellMemo(division, sessionDate, timeSlot, note, classGroup, memoId) {\n    return rpc('olli_schedule_save_cell_memo_v3', contextPayload({\n      p_division: clean(division),\n      p_session_date: clean(sessionDate),\n      p_time_slot: Number(timeSlot),\n      p_note: note || '',\n      p_class_group: clean(classGroup || 'A').toUpperCase() === 'B' ? 'B' : 'A',\n      p_memo_id: clean(memoId) || null\n    }));\n  }",
    'service v3 memo rpc',
)
service_path.write_text(service, encoding='utf-8')

css_path = Path('pc-timetable.css')
css = css_path.read_text(encoding='utf-8')
css = sub_once(
    css,
    r"#recordRoomScreen \.olliTtCellMemoCard \{.*?#recordRoomScreen \.olliTtStudent \{",
    "#recordRoomScreen .olliTtCellMemoCard {\n  grid-column: 1 / -1;\n  width: 100%;\n  min-width: 0;\n  min-height: 24px;\n  margin: 0;\n  padding: 3px 5px;\n  border: 1px solid #fff3a6;\n  border-radius: 8px;\n  display: flex;\n  align-items: flex-start;\n  gap: 5px;\n  color: #544918;\n  background: #fff3a6;\n  box-sizing: border-box;\n  text-align: left;\n  font-family: 'Pretendard', sans-serif;\n  cursor: pointer;\n  box-shadow: none;\n}\n#recordRoomScreen .olliTtCellMemoCard:hover { border-color: #ffed85; background: #ffed85; box-shadow: none; }\n#recordRoomScreen .olliTtCellMemoCard > span { flex: 0 0 auto; margin-top: 1px; font-size: calc(11px * var(--olli-text-scale)); line-height: 1; }\n#recordRoomScreen .olliTtCellMemoCard > strong { min-width: 0; overflow: visible; text-overflow: clip; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; font-size: calc(12px * var(--olli-text-scale)); font-weight: 760; line-height: 1.2; }\n#recordRoomScreen .olliTtStudent {",
    'memo card css',
    re.S,
)

hover_start = css.index('/* 잘린 시간표 메모는 hover 시 body 레이어에서 전체 내용을 표시 */')
hover_prefix = css[:hover_start]
hover_tail = css[hover_start:]
hover_tail = sub_once(
    hover_tail,
    r"\.olliTtMemoHoverPreview \{.*?\n\}(?:\n\.olliTtMemoHoverPreview[^\n]*\{.*?\n\})*",
    ".olliTtMemoHoverPreview {\n  position: fixed;\n  z-index: 100000;\n  min-height: 24px;\n  max-height: none;\n  padding: 5px 7px;\n  display: flex;\n  align-items: flex-start;\n  gap: 6px;\n  box-sizing: border-box;\n  border: 1px solid #ffed85;\n  border-radius: 9px;\n  background: #fff3a6;\n  color: #544918;\n  box-shadow: 0 8px 24px rgba(20,24,30,.18);\n  pointer-events: none;\n  overflow: visible;\n  white-space: normal;\n}\n.olliTtMemoHoverPreview > span { flex: 0 0 auto; margin-top: 1px; line-height: 1; }\n.olliTtMemoHoverPreview > strong { min-width: 0; font: 760 calc(12px * var(--olli-text-scale, 1)) 'Pretendard', sans-serif; line-height: 1.2; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }",
    'hover preview css',
    re.S,
)
css_path.write_text(hover_prefix + hover_tail, encoding='utf-8')

migration = Path('supabase/migrations/20260914092601_timetable_multi_cell_memos.sql')
migration.parent.mkdir(parents=True, exist_ok=True)
migration.write_text("""create or replace function public.olli_schedule_save_cell_memo_v3(
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
  if v_weekday not between 1 and 6
     or (v_division = 'elementary' and v_weekday = 6 and p_time_slot not in (10, 11, 12))
     or (v_division = 'elementary' and v_weekday <> 6 and p_time_slot not between 1 and 6)
     or (v_division = 'kinder' and p_time_slot not in (4, 5)) then
    return jsonb_build_object('ok', false, 'message', '메모를 저장할 시간표 칸을 확인해 주세요.');
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
    return jsonb_build_object('ok', true, 'created', true, 'deleted', false, 'memo', to_jsonb(v_memo) - 'academy_id' - 'updated_by_account_id');
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
    delete from public.olli_schedule_cell_memos m where m.id = p_memo_id;
    return jsonb_build_object('ok', true, 'created', false, 'deleted', true, 'memo', null);
  end if;
  update public.olli_schedule_cell_memos m
     set class_group = v_group,
         note = v_note,
         updated_by_account_id = v_account_id,
         updated_at = now()
   where m.id = p_memo_id
  returning m.* into v_memo;
  return jsonb_build_object('ok', true, 'created', false, 'deleted', false, 'memo', to_jsonb(v_memo) - 'academy_id' - 'updated_by_account_id');
end;
$function$;

revoke all on function public.olli_schedule_save_cell_memo_v3(text, uuid, text, date, integer, text, text, uuid) from public;
grant execute on function public.olli_schedule_save_cell_memo_v3(text, uuid, text, date, integer, text, text, uuid) to anon, authenticated;
""", encoding='utf-8')
