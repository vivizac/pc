from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old in text:
        return text.replace(old, new, 1)
    if new in text:
        return text
    raise SystemExit(f'{label} anchor not found')

# -----------------------------------------------------------------------------
# 1. Timetable service: legacy bootstrap only once per academy, and persist/load
#    the clicked class-group for cell memos.
# -----------------------------------------------------------------------------
service_path = Path('pc-timetable-service.js')
service = service_path.read_text(encoding='utf-8')

service = replace_once(
    service,
    "  async function loadCalendarRange(startDate, endDate) {",
    """  let legacyBootstrapAcademyId = '';
  let legacyBootstrapPromise = null;
  let legacyBootstrapPromiseAcademyId = '';

  async function ensureLegacyBootstrap() {
    const academyId = currentAcademyId();
    if (!academyId || legacyBootstrapAcademyId === academyId) return;
    if (legacyBootstrapPromise && legacyBootstrapPromiseAcademyId === academyId) {
      await legacyBootstrapPromise;
      return;
    }
    legacyBootstrapPromiseAcademyId = academyId;
    legacyBootstrapPromise = (async () => {
      await bootstrapLegacy();
      legacyBootstrapAcademyId = academyId;
    })();
    try {
      await legacyBootstrapPromise;
    } finally {
      if (legacyBootstrapPromiseAcademyId === academyId) {
        legacyBootstrapPromise = null;
        legacyBootstrapPromiseAcademyId = '';
      }
    }
  }

  async function loadCalendarRange(startDate, endDate) {""",
    'ensureLegacyBootstrap insert'
)

service = replace_once(
    service,
    "  async function loadWeek(weekStart) {\n    await bootstrapLegacy();",
    "  async function loadWeek(weekStart) {\n    await ensureLegacyBootstrap();",
    'loadWeek bootstrap once'
)

old_promise = """    const [data, kinderLayout, calendarDays, teacherContext] = await Promise.all([
      rpc('olli_schedule_week', contextPayload({ p_week_start: weekStart })),
      rpc('olli_schedule_kinder_class_layouts', contextPayload()),
      loadCalendarRange(start, end),
      rpc('olli_schedule_class_teacher_context', contextPayload())
    ]);"""
new_promise = """    const [data, kinderLayout, calendarDays, teacherContext, memoContext] = await Promise.all([
      rpc('olli_schedule_week', contextPayload({ p_week_start: weekStart })),
      rpc('olli_schedule_kinder_class_layouts', contextPayload()),
      loadCalendarRange(start, end),
      rpc('olli_schedule_class_teacher_context', contextPayload()),
      rpc('olli_schedule_cell_memos_week_v2', contextPayload({ p_week_start: start }))
    ]);"""
service = replace_once(service, old_promise, new_promise, 'loadWeek memo context')

service = replace_once(
    service,
    """    data.teacher_members = Array.isArray(teacherContext && teacherContext.teachers) ? teacherContext.teachers : [];
    cacheWeek(weekStart, data);""",
    """    data.teacher_members = Array.isArray(teacherContext && teacherContext.teachers) ? teacherContext.teachers : [];
    data.cell_memos = Array.isArray(memoContext && memoContext.memos) ? memoContext.memos : (Array.isArray(data.cell_memos) ? data.cell_memos : []);
    cacheWeek(weekStart, data);""",
    'loadWeek memo override'
)

service = replace_once(
    service,
    """  async function syncLegacyStudents() {
    return bootstrapLegacy();
  }""",
    """  async function syncLegacyStudents() {
    const result = await bootstrapLegacy();
    legacyBootstrapAcademyId = currentAcademyId();
    return result;
  }""",
    'sync legacy mark complete'
)

service = replace_once(
    service,
    """  async function saveCellMemo(division, sessionDate, timeSlot, note) {
    return executeScheduleAction('save_cell_memo', {
      division,
      session_date: sessionDate,
      time_slot: Number(timeSlot),
      note: note || ''
    });
  }""",
    """  async function saveCellMemo(division, sessionDate, timeSlot, note, classGroup) {
    return rpc('olli_schedule_save_cell_memo_v2', contextPayload({
      p_division: clean(division),
      p_session_date: clean(sessionDate),
      p_time_slot: Number(timeSlot),
      p_note: note || '',
      p_class_group: clean(classGroup || 'A').toUpperCase() === 'B' ? 'B' : 'A'
    }));
  }""",
    'saveCellMemo v2'
)
service_path.write_text(service, encoding='utf-8')

# -----------------------------------------------------------------------------
# 2. Timetable UI: do not redraw while merely checking the server; place memo in
#    clicked split lane; show a floating full memo preview on hover.
# -----------------------------------------------------------------------------
tt_path = Path('pc-timetable.js')
tt = tt_path.read_text(encoding='utf-8')

tt = replace_once(
    tt,
    "      const shouldRefresh = !!forceRefresh || !previous || version !== previous;",
    "      const shouldRefresh = previous > 0 && version !== previous;",
    'live sync refresh condition'
)

tt = replace_once(
    tt,
    """    const requestedWeek = dateKey(state.weekStart);
    const requestedAcademyId = typeof service.currentAcademyId === 'function' ? service.currentAcademyId() : '';""",
    """    const requestedWeek = dateKey(state.weekStart);
    const requestedAcademyId = typeof service.currentAcademyId === 'function' ? service.currentAcademyId() : '';
    const wasShowingRequestedWeek = state.dataWeek === requestedWeek && state.dataAcademyId === requestedAcademyId;""",
    'loadWeek displayed week marker'
)

tt = replace_once(
    tt,
    """    state.loading = true;
    state.loadingWeek = requestedWeek;
    renderTimetable();""",
    """    state.loading = true;
    state.loadingWeek = requestedWeek;
    const hasRenderedGrid = !!document.querySelector('#olliTtRoot .olliTtGrid');
    if (!wasShowingRequestedWeek || !hasRenderedGrid) renderTimetable();""",
    'loadWeek no needless redraw'
)

old_memo_lookup = """  function cellMemoText(division, date, time) {
    const keyDate = date instanceof Date ? dateKey(date) : clean(date);
    const memo = cellMemos().find((item) => clean(item.division) === clean(division)
      && clean(item.session_date) === keyDate
      && Number(item.time_slot) === Number(time));
    return clean(memo && memo.note);
  }

  async function saveCellMemoText(division, date, time, note) {
    if (typeof service.saveCellMemo !== 'function') throw new Error('시간표 메모 서버 연결을 찾지 못했습니다.');
    const keyDate = date instanceof Date ? dateKey(date) : clean(date);
    return service.saveCellMemo(clean(division), keyDate, Number(time), clean(note));
  }"""
new_memo_lookup = """  function cellMemoInfo(division, date, time) {
    const keyDate = date instanceof Date ? dateKey(date) : clean(date);
    return cellMemos().find((item) => clean(item.division) === clean(division)
      && clean(item.session_date) === keyDate
      && Number(item.time_slot) === Number(time)) || null;
  }

  function cellMemoText(division, date, time) {
    return clean(cellMemoInfo(division, date, time)?.note);
  }

  function cellMemoClassGroup(division, date, time) {
    const raw = clean(cellMemoInfo(division, date, time)?.class_group).toUpperCase();
    return raw === 'B' ? 'B' : 'A';
  }

  async function saveCellMemoText(division, date, time, note, classGroup) {
    if (typeof service.saveCellMemo !== 'function') throw new Error('시간표 메모 서버 연결을 찾지 못했습니다.');
    const keyDate = date instanceof Date ? dateKey(date) : clean(date);
    return service.saveCellMemo(clean(division), keyDate, Number(time), clean(note), classGroupOf({ class_group: classGroup }));
  }"""
tt = replace_once(tt, old_memo_lookup, new_memo_lookup, 'memo info + group')

old_memo_html = """    const memo = clean(memoText);
    const memoHtml = memo ? `<button type=\"button\" class=\"olliTtCellMemoCard\" data-tt-memo-card=\"1\" data-division=\"${esc(division)}\" data-date=\"${dateKey(date)}\" data-time=\"${Number(time)}\" aria-label=\"시간표 메모 관리\"><span aria-hidden=\"true\">📝</span><strong>${esc(memo)}</strong></button>` : '';"""
new_memo_html = """    const memo = clean(memoText);
    const memoHtml = memo ? `<button type=\"button\" class=\"olliTtCellMemoCard\" data-tt-memo-card=\"1\" data-division=\"${esc(division)}\" data-date=\"${dateKey(date)}\" data-time=\"${Number(time)}\" data-class-group=\"${esc(classGroupOf({ class_group: classGroup }))}\" aria-label=\"시간표 메모 관리\"><span aria-hidden=\"true\">📝</span><strong>${esc(memo)}</strong></button>` : '';"""
tt = replace_once(tt, old_memo_html, new_memo_html, 'memo card class group dataset')

split_pattern = re.compile(r"""    const counts = \{\n      A: slotEntryCount\(division, date, time, 'A'\),\n      B: slotEntryCount\(division, date, time, 'B'\)\n    \};\n    const memoGroup = counts\.A <= counts\.B \? 'A' : 'B';""")
if split_pattern.search(tt):
    tt = split_pattern.sub("    const memoGroup = cellMemoClassGroup(division, date, time);", tt, count=1)
elif "const memoGroup = cellMemoClassGroup(division, date, time);" not in tt:
    raise SystemExit('split memoGroup anchor not found')

tt = replace_once(
    tt,
    """    const existingMemo = cellMemoText(division, targetDate, time);
    const teacher = classTeacherFor(division, Number(dataset.weekday), time, targetClassGroup);""",
    """    const existingMemo = cellMemoText(division, targetDate, time);
    const existingMemoGroup = existingMemo ? cellMemoClassGroup(division, targetDate, time) : '';
    const teacher = classTeacherFor(division, Number(dataset.weekday), time, targetClassGroup);""",
    'openAdd existing memo group'
)

tt = replace_once(
    tt,
    """      query: '', note: existingMemo, originalNote: existingMemo, addType: 'wait', targetClassGroup,
      teacherMemberId, originalTeacherMemberId: teacherMemberId,""",
    """      query: '', note: existingMemo, originalNote: existingMemo, originalMemoGroup: existingMemoGroup, addType: 'wait', targetClassGroup,
      teacherMemberId, originalTeacherMemberId: teacherMemberId,""",
    'openAdd store original memo group'
)

tt = replace_once(
    tt,
    """  async function persistDialogCellMemo(dialog) {
    if (!dialog || dialog.kind !== 'add') return null;
    return saveCellMemoText(dialog.division, dialog.date, dialog.time, dialog.note);
  }""",
    """  async function persistDialogCellMemo(dialog) {
    if (!dialog || dialog.kind !== 'add') return null;
    const unchanged = clean(dialog.note) === clean(dialog.originalNote);
    const classGroup = unchanged && clean(dialog.originalMemoGroup)
      ? dialog.originalMemoGroup
      : dialog.targetClassGroup;
    return saveCellMemoText(dialog.division, dialog.date, dialog.time, dialog.note, classGroup);
  }""",
    'persist clicked memo group'
)

tt = replace_once(
    tt,
    """    state.dialog = { kind: 'memoManage', division, date, time, memo, originalMemo: memo };""",
    """    state.dialog = { kind: 'memoManage', division, date, time, classGroup: classGroupOf({ class_group: dataset.classGroup }), memo, originalMemo: memo };""",
    'memo manage class group'
)

tt = tt.replace(
    "saveCellMemoText(dialog.division, dialog.date, dialog.time, dialog.memo)",
    "saveCellMemoText(dialog.division, dialog.date, dialog.time, dialog.memo, dialog.classGroup)",
    1
)
tt = tt.replace(
    "saveCellMemoText(dialog.division, dialog.date, dialog.time, '')",
    "saveCellMemoText(dialog.division, dialog.date, dialog.time, '', dialog.classGroup)",
    1
)

# Floating memo preview: body-level fixed layer, so timetable/lane overflow cannot clip it.
preview_marker = 'function showTimetableMemoHoverPreview(card) {'
if preview_marker not in tt:
    anchor = "  function ensureUi() {"
    if anchor not in tt:
        raise SystemExit('ensureUi anchor not found')
    preview_code = r'''  let timetableMemoHoverPreview = null;

  function hideTimetableMemoHoverPreview() {
    if (timetableMemoHoverPreview) timetableMemoHoverPreview.remove();
    timetableMemoHoverPreview = null;
  }

  function showTimetableMemoHoverPreview(card) {
    if (!card || !card.isConnected) return;
    const host = card.closest('.olliTtClassLane, .olliTtCell');
    if (!host) return;
    const cardRect = card.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const isClipped = cardRect.bottom > hostRect.bottom + 1 || cardRect.top < hostRect.top - 1;
    if (!isClipped) return;
    const text = clean(card.querySelector('strong')?.textContent);
    if (!text) return;

    hideTimetableMemoHoverPreview();
    const preview = document.createElement('div');
    preview.className = 'olliTtMemoHoverPreview';
    preview.innerHTML = `<span aria-hidden="true">📝</span><strong>${esc(text)}</strong>`;
    document.body.appendChild(preview);
    timetableMemoHoverPreview = preview;

    const width = Math.min(Math.max(cardRect.width, 190), Math.max(190, window.innerWidth - 24));
    preview.style.width = `${width}px`;
    const previewRect = preview.getBoundingClientRect();
    let left = cardRect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - previewRect.width - 8));
    let top = cardRect.top - previewRect.height - 6;
    if (top < 8) top = Math.min(window.innerHeight - previewRect.height - 8, cardRect.bottom + 6);
    preview.style.left = `${left}px`;
    preview.style.top = `${Math.max(8, top)}px`;
  }

  function bindTimetableMemoHoverPreview(root) {
    if (!root || root.__olliMemoHoverPreviewBound) return;
    root.__olliMemoHoverPreviewBound = true;
    root.addEventListener('pointerover', (event) => {
      const card = event.target.closest('.olliTtCellMemoCard');
      if (!card || !root.contains(card)) return;
      if (event.relatedTarget && card.contains(event.relatedTarget)) return;
      showTimetableMemoHoverPreview(card);
    });
    root.addEventListener('pointerout', (event) => {
      const card = event.target.closest('.olliTtCellMemoCard');
      if (!card || !root.contains(card)) return;
      if (event.relatedTarget && card.contains(event.relatedTarget)) return;
      hideTimetableMemoHoverPreview();
    });
    root.addEventListener('scroll', hideTimetableMemoHoverPreview, true);
  }

'''
    tt = tt.replace(anchor, preview_code + anchor, 1)

tt = replace_once(
    tt,
    """    ensureDialog();
    return { host, root };""",
    """    bindTimetableMemoHoverPreview(root);
    ensureDialog();
    return { host, root };""",
    'bind memo hover preview'
)
tt_path.write_text(tt, encoding='utf-8')

# -----------------------------------------------------------------------------
# 3. Timetable CSS: no inner scrollbars for split lanes; body-level memo preview.
# -----------------------------------------------------------------------------
css_path = Path('pc-timetable.css')
css = css_path.read_text(encoding='utf-8')
css = css.replace(
    "#recordRoomScreen .olliTtCell.split .olliTtClassLane.kinder {\n  min-height: 0;\n  height: auto;\n  align-self: stretch;\n  padding: 4px 2px;\n  border: 0;\n  border-radius: 0;\n  box-sizing: border-box;\n  overflow-y: auto;\n}",
    "#recordRoomScreen .olliTtCell.split .olliTtClassLane.kinder {\n  min-height: 0;\n  height: auto;\n  align-self: stretch;\n  padding: 4px 2px;\n  border: 0;\n  border-radius: 0;\n  box-sizing: border-box;\n  overflow: hidden;\n}",
    1
)
# The latest shared selector may cover both divisions instead.
css = css.replace(
    "  box-sizing: border-box;\n  overflow-y: auto;\n}\n#recordRoomScreen .olliTtCell.split .olliTtClassLane.kinder +",
    "  box-sizing: border-box;\n  overflow: hidden;\n}\n#recordRoomScreen .olliTtCell.split .olliTtClassLane.kinder +",
    1
)

if '.olliTtMemoHoverPreview {' not in css:
    css += r'''

/* 잘린 시간표 메모는 hover 시 body 레이어에서 전체 내용을 표시 */
.olliTtMemoHoverPreview {
  position: fixed;
  z-index: 100000;
  min-height: 38px;
  max-height: none;
  padding: 7px 9px;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  box-sizing: border-box;
  border: 1px solid #ffed85;
  border-radius: 9px;
  background: #fff3a6;
  color: #544918;
  box-shadow: 0 8px 24px rgba(20,24,30,.18);
  pointer-events: none;
  overflow: visible;
  white-space: normal;
}
.olliTtMemoHoverPreview > span { flex: 0 0 auto; line-height: 1.25; }
.olliTtMemoHoverPreview > strong {
  min-width: 0;
  font: 760 calc(12px * var(--olli-text-scale, 1)) 'Pretendard', sans-serif;
  line-height: 1.35;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
'''
css_path.write_text(css, encoding='utf-8')

# -----------------------------------------------------------------------------
# 4. Embedded observation editor: do not call page-navigation openers that hide
#    recordRoomScreen. This is the real cause of the roster scroll reset.
# -----------------------------------------------------------------------------
editor_path = Path('pc-record-editor.js')
editor = editor_path.read_text(encoding='utf-8')
helper_marker = 'function openEmbeddedElementaryRecord(student) {'
if helper_marker not in editor:
    anchor = '  function mount(host, student) {'
    if anchor not in editor:
        raise SystemExit('pc-record-editor mount anchor not found')
    helpers = r'''  function openEmbeddedElementaryRecord(student) {
    const session = typeof global.beginObservationMemoSession === 'function'
      ? global.beginObservationMemoSession(student.id)
      : null;
    if (!session || session.type !== 'elementary') return false;
    try { if (typeof global.closeMemoModeMenu === 'function') global.closeMemoModeMenu(); } catch (_) {}
    try { if (typeof global.closeMemoStudentSelectPopup === 'function') global.closeMemoStudentSelectPopup(); } catch (_) {}
    if (state.screen) {
      state.screen.style.display = 'flex';
      state.screen.setAttribute('data-current-memo-type', 'elementary');
    }
    if (typeof global.renderObservationMemoScreenChrome === 'function') global.renderObservationMemoScreenChrome(session);
    if (typeof global.renderObservationMemoInitialView === 'function') global.renderObservationMemoInitialView(session);
    if (typeof global.refreshObservationMemoVersionHistoryButton === 'function') {
      requestAnimationFrame(global.refreshObservationMemoVersionHistoryButton);
    }
    restoreRecordRoomVisibility();
    return true;
  }

  function openEmbeddedKinderRecord() {
    if (state.screen) state.screen.style.display = 'flex';
    try { if (typeof global.bindKinderChatFeedbackKeyboardOffset === 'function') global.bindKinderChatFeedbackKeyboardOffset(); } catch (_) {}
    try { if (typeof global.loadKinderChatFeedbackDraft === 'function') global.loadKinderChatFeedbackDraft(); } catch (_) {}
    try { if (typeof global.updateKinderChatFeedbackBadge === 'function') global.updateKinderChatFeedbackBadge(); } catch (_) {}
    try { if (typeof global.updateKinderChatFeedbackKeyboardOffset === 'function') global.updateKinderChatFeedbackKeyboardOffset(); } catch (_) {}
    restoreRecordRoomVisibility();
    return true;
  }

'''
    editor = editor.replace(anchor, helpers + anchor, 1)

editor = editor.replace('        global.openStudentMemoPageById(student.id);', '        openEmbeddedElementaryRecord(student);', 1)
editor = editor.replace('        global.openKinderChatFeedbackPage();', '        openEmbeddedKinderRecord();', 1)
editor_path.write_text(editor, encoding='utf-8')

# -----------------------------------------------------------------------------
# 5. Student-management Todo: preserve focus/draft if a background dashboard
#    refresh replaces the input node.
# -----------------------------------------------------------------------------
mgmt_path = Path('pc-student-management.js')
mgmt = mgmt_path.read_text(encoding='utf-8')

mgmt = replace_once(
    mgmt,
    """  function renderDashboard() {
    const dashboard = document.getElementById('recordAcademyDashboard');
    if (!dashboard) return;
    const allStudents = students();""",
    """  function renderDashboard() {
    const dashboard = document.getElementById('recordAcademyDashboard');
    if (!dashboard) return;
    const activeElement = document.activeElement;
    const todoFocus = activeElement && activeElement.id === 'pcAcademyTodoInput'
      ? {
          value: activeElement.value || '',
          start: Number.isInteger(activeElement.selectionStart) ? activeElement.selectionStart : null,
          end: Number.isInteger(activeElement.selectionEnd) ? activeElement.selectionEnd : null
        }
      : null;
    const allStudents = students();""",
    'todo focus capture'
)

mgmt = replace_once(
    mgmt,
    """    renderTodoCard();
    renderConsultationPanel(due);
    filter(core().state.academyFilter);
    handleSearch(core().state.searchValues.academy);
  }""",
    """    renderTodoCard();
    renderConsultationPanel(due);
    filter(core().state.academyFilter);
    handleSearch(core().state.searchValues.academy);
    if (todoFocus) {
      const nextInput = document.getElementById('pcAcademyTodoInput');
      if (nextInput) {
        nextInput.value = todoFocus.value;
        try { nextInput.focus({ preventScroll: true }); } catch (_) { nextInput.focus(); }
        if (todoFocus.start !== null && todoFocus.end !== null) {
          try { nextInput.setSelectionRange(todoFocus.start, todoFocus.end); } catch (_) {}
        }
      }
    }
  }""",
    'todo focus restore'
)
mgmt_path.write_text(mgmt, encoding='utf-8')

print('PC rerender/focus/timetable memo fixes applied')
