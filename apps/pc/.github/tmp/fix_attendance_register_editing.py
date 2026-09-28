from pathlib import Path

# 1) 학생명단 정렬 구분선/텍스트를 검정색으로 통일
start = Path('pc-start-page.js')
text = start.read_text(encoding='utf-8')
old_divider = '''      body.olliPcApp #recordRoomScreen .pcAttendanceSortDivider {
        gap: 7px;
        margin: 11px 0 7px;
        color: #aeb3bb;
        font-size: 9.5px;
        font-weight: 620;
        line-height: 1;
        letter-spacing: -.01em;
      }'''
new_divider = old_divider.replace('color: #aeb3bb;', 'color: #000;')
if old_divider in text:
    text = text.replace(old_divider, new_divider, 1)
old_lines = '''      body.olliPcApp #recordRoomScreen .pcAttendanceSortDivider::before,
      body.olliPcApp #recordRoomScreen .pcAttendanceSortDivider::after {
        min-width: 10px;
        background: #eceef1;
      }'''
new_lines = old_lines.replace('background: #eceef1;', 'background: #000;')
if old_lines in text:
    text = text.replace(old_lines, new_lines, 1)
start.write_text(text, encoding='utf-8')

# 2) 출석부 수동 상태 저장 API를 서비스에 추가
service = Path('pc-timetable-service.js')
text = service.read_text(encoding='utf-8')
if 'async function setAttendanceRegisterStatus(studentId, sessionDate, status)' not in text:
    anchor = '  async function loadAttendanceMonth(yearMonth) {'
    addition = '''  async function setAttendanceRegisterStatus(studentId, sessionDate, status) {
    const result = await rpc('olli_schedule_set_attendance_register_status', contextPayload({
      p_student_id: studentId,
      p_session_date: sessionDate,
      p_status: status
    }));
    invalidateAttendanceMonth(sessionDate);
    return result;
  }

'''
    if anchor not in text:
        raise SystemExit('service loadAttendanceMonth anchor not found')
    text = text.replace(anchor, addition + anchor, 1)
    export_anchor = '''    setAttendance,
    loadAttendanceMonth,'''
    if export_anchor not in text:
        raise SystemExit('service export anchor not found')
    text = text.replace(export_anchor, '''    setAttendance,
    setAttendanceRegisterStatus,
    loadAttendanceMonth,''', 1)
service.write_text(text, encoding='utf-8')

# 3) 출석부 셀을 클릭 편집 가능하게 변경
register = Path('pc-timetable-attendance-register.js')
text = register.read_text(encoding='utf-8')
old_fp = '''      Number(row && row.time_slot || 0), clean(row && row.class_group), clean(row && row.session_kind), row && row.attended !== false
    ]));'''
new_fp = '''      Number(row && row.time_slot || 0), clean(row && row.class_group), clean(row && row.session_kind),
      row && row.attended !== false, clean(row && row.register_status)
    ]));'''
if old_fp in text:
    text = text.replace(old_fp, new_fp, 1)

if 'const ATTENDANCE_REGISTER_STATUS_ORDER' not in text:
    anchor = '  function linkedAttendanceRegisterHtml() {'
    helpers = '''  const ATTENDANCE_REGISTER_STATUS_ORDER = ['blank', 'present', 'absent', 'makeup'];

  function attendanceRegisterStatus(records, sessionDate) {
    const rows = Array.isArray(records) ? records : [];
    const override = rows.find((row) => clean(row && row.session_kind) === 'register_override'
      && ATTENDANCE_REGISTER_STATUS_ORDER.includes(clean(row && row.register_status)));
    if (override) return clean(override.register_status);
    const makeup = rows.some((row) => clean(row && row.session_kind) === 'makeup' && row.attended !== false);
    if (makeup) return 'makeup';
    const present = rows.some((row) => clean(row && row.session_kind) === 'regular' && row.attended !== false);
    if (present) return 'present';
    const expected = rows.some((row) => clean(row && row.session_kind) === 'regular_expected');
    if (expected && clean(sessionDate) < todayKey()) return 'absent';
    return 'blank';
  }

  function nextAttendanceRegisterStatus(status) {
    const current = ATTENDANCE_REGISTER_STATUS_ORDER.includes(clean(status)) ? clean(status) : 'blank';
    const index = ATTENDANCE_REGISTER_STATUS_ORDER.indexOf(current);
    return ATTENDANCE_REGISTER_STATUS_ORDER[(index + 1) % ATTENDANCE_REGISTER_STATUS_ORDER.length];
  }

  function attendanceRegisterStatusMeta(status) {
    if (status === 'present') return { className: ' attendanceLinkedMark', mark: '<span aria-label="출석">✓</span>', label: '출석' };
    if (status === 'absent') return { className: ' attendanceAbsentMark', mark: '<span aria-label="결석">결</span>', label: '결석' };
    if (status === 'makeup') return { className: ' attendanceMakeupMark', mark: '<span aria-label="보강">보</span>', label: '보강' };
    return { className: '', mark: '', label: '빈칸' };
  }

'''
    if anchor not in text:
        raise SystemExit('attendance helper anchor not found')
    text = text.replace(anchor, helpers + anchor, 1)

old_cells = '''        const records = rowsByStudentDate.get(`${clean(student.id)}|${meta.key}`) || [];
        const makeupRows = records.filter((row) => clean(row.session_kind) === 'makeup');
        const regular = records.find((row) => clean(row.session_kind) === 'regular' && row.attended !== false);
        const expectedRegular = records.some((row) => clean(row.session_kind) === 'regular_expected');
        if (makeupRows.some((row) => row.attended !== false)) return '<td class="dateCol attendanceMakeupMark"><span aria-label="보강 출석">보</span></td>';
        if (regular) return '<td class="dateCol attendanceLinkedMark"><span aria-label="출석">✓</span></td>';
        if (expectedRegular && meta.key < todayKey()) return '<td class="dateCol attendanceAbsentMark"><span aria-label="결석">결</span></td>';
        return '<td class="dateCol"></td>';'''
new_cells = '''        const records = rowsByStudentDate.get(`${clean(student.id)}|${meta.key}`) || [];
        const status = attendanceRegisterStatus(records, meta.key);
        const statusMeta = attendanceRegisterStatusMeta(status);
        return `<td class="dateCol attendanceRegisterEditable${statusMeta.className}" data-tt-attendance-register-cell="1" data-student-id="${esc(student.id)}" data-session-date="${meta.key}" data-status="${status}" role="button" tabindex="0" title="클릭: 출석 → 결석 → 보강 → 빈칸" aria-label="${esc(student.name)} ${meta.day}일 ${statusMeta.label}">${statusMeta.mark}</td>`;'''
if old_cells in text:
    text = text.replace(old_cells, new_cells, 1)
elif 'data-tt-attendance-register-cell' not in text:
    raise SystemExit('attendance date cell block not found')

if 'async function cycleAttendanceRegisterCell(cell)' not in text:
    anchor = '  function renderAttendanceRegister() {'
    editor = '''  async function cycleAttendanceRegisterCell(cell) {
    if (!cell || cell.dataset.attendanceSaving === '1') return;
    const studentId = clean(cell.dataset.studentId);
    const sessionDate = clean(cell.dataset.sessionDate);
    const currentStatus = clean(cell.dataset.status) || 'blank';
    const nextStatus = nextAttendanceRegisterStatus(currentStatus);
    if (!studentId || !sessionDate) return;
    if (typeof service.setAttendanceRegisterStatus !== 'function') {
      notify('출석부 수정 모듈을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
      return;
    }

    cell.dataset.attendanceSaving = '1';
    try {
      await service.setAttendanceRegisterStatus(studentId, sessionDate, nextStatus);
      const rows = (Array.isArray(state.attendanceRows) ? state.attendanceRows : []).filter((row) => !(
        clean(row && row.student_id) === studentId
        && clean(row && row.session_date).slice(0, 10) === sessionDate
        && clean(row && row.session_kind) === 'register_override'
      ));
      rows.push({
        student_id: studentId,
        session_date: sessionDate,
        time_slot: 0,
        class_group: 'A',
        session_kind: 'register_override',
        attended: nextStatus === 'present' || nextStatus === 'makeup',
        register_status: nextStatus,
        marked_at: new Date().toISOString()
      });
      state.attendanceRows = rows;
      state.attendanceRowsMonth = state.attendanceMonth;
      lastAttendanceRenderSignature = '';
      renderAttendanceRegister();
    } catch (error) {
      notify(error && (error.message || error) || '출석부 상태를 저장하지 못했습니다.');
      cell.dataset.attendanceSaving = '';
    }
  }

  function bindAttendanceRegisterEditing(root) {
    if (!root || root.__olliAttendanceRegisterEditBound) return;
    root.__olliAttendanceRegisterEditBound = true;
    root.addEventListener('click', (event) => {
      const cell = event.target.closest('[data-tt-attendance-register-cell]');
      if (!cell || !root.contains(cell)) return;
      event.preventDefault();
      event.stopPropagation();
      cycleAttendanceRegisterCell(cell);
    });
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const cell = event.target.closest('[data-tt-attendance-register-cell]');
      if (!cell || !root.contains(cell)) return;
      event.preventDefault();
      event.stopPropagation();
      cycleAttendanceRegisterCell(cell);
    });
  }

'''
    if anchor not in text:
        raise SystemExit('attendance render anchor not found')
    text = text.replace(anchor, editor + anchor, 1)

text = text.replace('<span>시간표에서 체크한 출석이 자동으로 표시됩니다.</span>', '<span>시간표 출석이 자동 반영되며, 날짜 칸을 클릭해 출석 상태를 수정할 수 있습니다.</span>', 1)
bind_anchor = '''    lastAttendanceRenderSignature = signature;

    // 글자 맞춤은'''
if 'bindAttendanceRegisterEditing(ui.root);' not in text:
    if bind_anchor not in text:
        raise SystemExit('attendance bind anchor not found')
    text = text.replace(bind_anchor, '''    lastAttendanceRenderSignature = signature;
    bindAttendanceRegisterEditing(ui.root);

    // 글자 맞춤은''', 1)
register.write_text(text, encoding='utf-8')

# 4) 시간표 출석 클릭은 오늘 날짜에만 허용. hover/메뉴 등은 그대로 유지.
guard = Path('pc-timetable-attendance-day-guard.js')
guard.write_text("""(function timetableAttendanceDayGuard(global) {
  'use strict';
  if (global.__OLLI_TIMETABLE_ATTENDANCE_DAY_GUARD_V1__) return;
  global.__OLLI_TIMETABLE_ATTENDANCE_DAY_GUARD_V1__ = true;

  function pad(value) { return String(value).padStart(2, '0'); }
  function todayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  document.addEventListener('click', (event) => {
    const button = event.target && event.target.closest ? event.target.closest('[data-tt-attendance]') : null;
    if (!button) return;
    const sessionDate = String(button.dataset.sessionDate || '').trim();
    if (!sessionDate || sessionDate === todayKey()) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }, true);
})(window);
""", encoding='utf-8')

# 5) guard 모듈 로더 연결
loader = Path('consultation-survey.js')
text = loader.read_text(encoding='utf-8')
if "'pc-timetable-attendance-day-guard.js'" not in text:
    anchor = "const files=['pc-timetable-teacher-ui.js',"
    if anchor not in text:
        raise SystemExit('consultation loader anchor not found')
    text = text.replace(anchor, "const files=['pc-timetable-attendance-day-guard.js','pc-timetable-teacher-ui.js',", 1)
loader.write_text(text, encoding='utf-8')

print('attendance register editing patch applied')
