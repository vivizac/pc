from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


# 1) 성향기록부 카드 레이아웃
css_path = Path('pc-attendance.css')
css = css_path.read_text(encoding='utf-8')
css = replace_once(
    css,
    '.pcAttendanceDetailPanel .attendanceFeedbackSheetCardTitleWrap{display:flex;align-items:center;flex-wrap:wrap;gap:7px;min-width:0;padding-top:3px;}',
    '.pcAttendanceDetailPanel .attendanceFeedbackSheetCardTitleWrap{display:flex;align-items:center;flex-wrap:wrap;gap:7px;min-width:0;min-height:18px;padding-top:0;padding-right:158px;box-sizing:border-box;}',
    'record card title row'
)
css = replace_once(
    css,
    '.pcAttendanceDetailPanel .attendanceFeedbackSheetCardTopActions{position:absolute;top:7px;right:8px;z-index:3;display:inline-flex;align-items:center;justify-content:flex-end;gap:3px;margin:0;pointer-events:none;}',
    '.pcAttendanceDetailPanel .attendanceFeedbackSheetCardTopActions{position:absolute;top:50%;right:8px;z-index:3;display:inline-flex;align-items:center;justify-content:flex-end;gap:3px;margin:0;transform:translateY(-50%);pointer-events:none;}\n.pcAttendanceDetailPanel .attendanceFeedbackSheetCard.open .attendanceFeedbackSheetCardTopActions{top:7px;transform:none;}',
    'record card floating tools'
)
css = replace_once(
    css,
    '.pcAttendanceDetailPanel .attendanceFeedbackSheetCardDate{font-size:10.5px;margin-top:4px;margin-bottom:0;}',
    '.pcAttendanceDetailPanel .attendanceFeedbackSheetCardDate{position:absolute;top:16px;right:58px;z-index:2;margin:0;color:#9a9ea6;font-size:10.5px;line-height:1.2;white-space:nowrap;pointer-events:none;}\n.pcAttendanceDetailPanel .attendanceFeedbackSheetCard:has(.attendanceSummaryRegenerateBtn) .attendanceFeedbackSheetCardDate{right:98px;}',
    'record card date layer'
)
css_path.write_text(css, encoding='utf-8')


# 2) 성향기록부 학년/나이 정렬
attendance_path = Path('pc-attendance.js')
attendance = attendance_path.read_text(encoding='utf-8')
old_grade = """  function getStudentGradeNumber(student) {
    const raw = String(student?.grade || student?.school_grade || student?.studentGrade || student?.class_grade || '').trim();
    const match = raw.match(/\\d+/);
    const grade = match ? Number(match[0]) : NaN;
    return Number.isFinite(grade) && grade > 0 ? grade : 999;
  }
"""
new_grade = old_grade + """
  function getStudentAgeNumber(student) {
    const raw = String(student?.age || student?.student_age || student?.studentAge || '').trim();
    const match = raw.match(/\\d+/);
    const age = match ? Number(match[0]) : NaN;
    return Number.isFinite(age) && age > 0 ? age : 999;
  }
"""
attendance = replace_once(attendance, old_grade, new_grade, 'age sort helper')
old_grade_render = """    return renderGroupedRows(
      students,
      division,
      (student) => {
        const grade = getStudentGradeNumber(student);
        return grade === 999 ? '미지정' : String(grade);
      },
      (key) => key === '미지정' ? '학년 미지정' : `${key}학년`,
      (a, b) => {
        if (a === '미지정') return 1;
        if (b === '미지정') return -1;
        return Number(a) - Number(b);
      }
    );
"""
new_grade_render = """    const useAge = division === 'kinder';
    return renderGroupedRows(
      students,
      division,
      (student) => {
        const value = useAge ? getStudentAgeNumber(student) : getStudentGradeNumber(student);
        return value === 999 ? '미지정' : String(value);
      },
      (key) => key === '미지정'
        ? (useAge ? '나이 미지정' : '학년 미지정')
        : (useAge ? `${key}세` : `${key}학년`),
      (a, b) => {
        if (a === '미지정') return 1;
        if (b === '미지정') return -1;
        return Number(a) - Number(b);
      }
    );
"""
attendance = replace_once(attendance, old_grade_render, new_grade_render, 'grade/age grouped render')
attendance = replace_once(
    attendance,
    "      [PC_SORT_MODES.GRADE, '학년별'],",
    "      [PC_SORT_MODES.GRADE, '학년별 • 나이별'],",
    'grade/age sidebar label'
)
attendance_path.write_text(attendance, encoding='utf-8')


# 3) 월 출석부: 같은 날 여러 수업을 시간대별로 독립 체크
register_path = Path('pc-timetable-attendance-register.js')
register = register_path.read_text(encoding='utf-8')
helper_start = register.index("  const REGULAR_ATTENDANCE_STATUS_ORDER = ['blank', 'present', 'absent'];")
helper_end = register.index('  async function setAttendanceSessionStatus', helper_start)
new_helpers = r'''  const REGULAR_ATTENDANCE_STATUS_ORDER = ['blank', 'present', 'absent'];
  const MAKEUP_ATTENDANCE_STATUS_ORDER = ['blank', 'makeup'];
  const ATTENDANCE_SESSION_KINDS = ['regular', 'makeup'];

  function normalizeAttendanceClassGroup(value) {
    return clean(value).toUpperCase() === 'B' ? 'B' : 'A';
  }

  function attendanceRegisterOverrideKind(row) {
    const explicit = clean(row && row.register_session_kind).toLowerCase();
    if (ATTENDANCE_SESSION_KINDS.includes(explicit)) return explicit;
    return clean(row && row.register_status).toLowerCase() === 'makeup' ? 'makeup' : 'regular';
  }

  function attendanceRegisterSessions(records) {
    const rows = Array.isArray(records) ? records : [];
    const sessions = new Map();
    const addSession = (kind, timeSlot, classGroup, legacy = false) => {
      const slot = Number(timeSlot || 0);
      const normalizedKind = kind === 'makeup' ? 'makeup' : 'regular';
      const group = normalizeAttendanceClassGroup(classGroup);
      if (!legacy && (slot < 1 || slot > 12)) return;
      const key = `${normalizedKind}|${slot}|${group}`;
      if (!sessions.has(key)) sessions.set(key, { kind: normalizedKind, timeSlot: slot, classGroup: group, legacy: !!legacy });
    };

    rows.forEach((row) => {
      const rowKind = clean(row && row.session_kind).toLowerCase();
      if (rowKind === 'regular' || rowKind === 'regular_expected') {
        addSession('regular', row.time_slot, row.class_group);
      } else if (rowKind === 'makeup' || rowKind === 'makeup_expected') {
        addSession('makeup', row.time_slot, row.class_group);
      } else if (rowKind === 'register_override' && Number(row && row.time_slot || 0) > 0) {
        addSession(attendanceRegisterOverrideKind(row), row.time_slot, row.class_group);
      }
    });

    rows.forEach((row) => {
      if (clean(row && row.session_kind) !== 'register_override' || Number(row && row.time_slot || 0) > 0) return;
      const kind = attendanceRegisterOverrideKind(row);
      const hasExact = Array.from(sessions.values()).some((session) => session.kind === kind && session.timeSlot > 0);
      if (!hasExact) addSession(kind, 0, 'A', true);
    });

    return Array.from(sessions.values()).sort((a, b) => {
      const kindDelta = ATTENDANCE_SESSION_KINDS.indexOf(a.kind) - ATTENDANCE_SESSION_KINDS.indexOf(b.kind);
      if (kindDelta) return kindDelta;
      return a.timeSlot - b.timeSlot || a.classGroup.localeCompare(b.classGroup);
    });
  }

  function attendanceRegisterSessionStatus(records, sessionDate, session) {
    const rows = Array.isArray(records) ? records : [];
    const kind = session && session.kind === 'makeup' ? 'makeup' : 'regular';
    const timeSlot = Number(session && session.timeSlot || 0);
    const classGroup = normalizeAttendanceClassGroup(session && session.classGroup);
    const allowed = kind === 'makeup' ? MAKEUP_ATTENDANCE_STATUS_ORDER : REGULAR_ATTENDANCE_STATUS_ORDER;
    const timeOf = (row) => {
      const time = Date.parse(clean(row && row.marked_at));
      return Number.isFinite(time) ? time : 0;
    };
    const matchesExactSlot = (row) => Number(row && row.time_slot || 0) === timeSlot
      && normalizeAttendanceClassGroup(row && row.class_group) === classGroup;
    const overrides = rows
      .filter((row) => {
        if (clean(row && row.session_kind) !== 'register_override') return false;
        if (attendanceRegisterOverrideKind(row) !== kind || !allowed.includes(clean(row && row.register_status))) return false;
        const rowSlot = Number(row && row.time_slot || 0);
        return timeSlot > 0 ? (rowSlot === 0 || matchesExactSlot(row)) : rowSlot === 0;
      })
      .sort((a, b) => timeOf(b) - timeOf(a));
    const override = overrides[0] || null;
    const actual = rows
      .filter((row) => clean(row && row.session_kind) === kind
        && row.attended !== false
        && (timeSlot > 0 ? matchesExactSlot(row) : true))
      .sort((a, b) => timeOf(b) - timeOf(a))[0] || null;

    if (override && (!actual || timeOf(override) >= timeOf(actual))) return clean(override.register_status);
    if (actual) return kind === 'makeup' ? 'makeup' : 'present';

    if (kind === 'makeup') return 'blank';
    const expected = rows.some((row) => clean(row && row.session_kind) === 'regular_expected'
      && (timeSlot > 0 ? matchesExactSlot(row) : true));
    if (expected && clean(sessionDate) < todayKey()) return 'absent';
    return 'blank';
  }

  function nextAttendanceRegisterStatus(status, sessionKind) {
    const order = sessionKind === 'makeup' ? MAKEUP_ATTENDANCE_STATUS_ORDER : REGULAR_ATTENDANCE_STATUS_ORDER;
    const current = order.includes(clean(status)) ? clean(status) : 'blank';
    const index = order.indexOf(current);
    return order[(index + 1) % order.length];
  }

  function attendanceRegisterStatusMeta(status) {
    if (status === 'present') return { className: 'attendanceLinkedMark', mark: '<span aria-label="출석">✓</span>', label: '출석' };
    if (status === 'absent') return { className: 'attendanceAbsentMark', mark: '<span aria-label="결석">결</span>', label: '결석' };
    if (status === 'makeup') return { className: 'attendanceMakeupMark', mark: '<span aria-label="보강">보</span>', label: '보강' };
    return { className: '', mark: '', label: '빈칸' };
  }

  function ensureAttendanceSessionSplitStyles() {
    if (document.getElementById('olliPcAttendanceSessionSplitStyle')) return;
    const style = document.createElement('style');
    style.id = 'olliPcAttendanceSessionSplitStyle';
    style.textContent = `
#recordRoomScreen .olliTtAttendanceRegisterScroll td.attendanceRegisterSessionCell{position:relative;padding:0!important;overflow:hidden}
#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterCellInner{position:absolute;inset:0;display:flex;align-items:stretch;justify-content:stretch}
#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment{min-width:0;min-height:0;margin:0;padding:0;border:0;outline:0;display:flex;flex:1 1 0;align-items:center;justify-content:center;color:inherit;background:transparent;font:inherit;font-weight:900;cursor:default!important;box-sizing:border-box}
#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment+.attendanceRegisterSegment{border-left:1px solid rgba(50,57,66,.16)}
#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceLinkedMark{color:#fff;background:#43d878!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceAbsentMark{color:#fff;background:#e5484d!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceMakeupMark{color:#111;background:#ffd84d!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment span{display:block;font-size:10px;line-height:1}
#recordRoomScreen .olliTtAttendanceRegisterScroll td.attendanceRegisterSessionCell:not(.isSplit) .attendanceRegisterSegment{flex-basis:100%}
`;
    document.head.appendChild(style);
  }

  function renderAttendanceRegisterSegment(student, meta, session, status) {
    const kind = session && session.kind === 'makeup' ? 'makeup' : 'regular';
    const timeSlot = Number(session && session.timeSlot || 0);
    const classGroup = normalizeAttendanceClassGroup(session && session.classGroup);
    const statusMeta = attendanceRegisterStatusMeta(status);
    const cycleTitle = kind === 'makeup' ? '클릭: 보강 ↔ 빈칸' : '클릭: 출석 → 결석 → 빈칸';
    const kindLabel = kind === 'makeup' ? '보강' : '정규수업';
    const slotLabel = timeSlot > 0 ? ` ${timeSlot}시` : '';
    return `<button type="button" class="attendanceRegisterSegment ${kind}${statusMeta.className ? ` ${statusMeta.className}` : ''}" data-tt-attendance-register-cell="1" data-student-id="${esc(student.id)}" data-session-date="${meta.key}" data-session-kind="${kind}" data-time-slot="${timeSlot}" data-class-group="${classGroup}" data-status="${status}" title="${kindLabel}${slotLabel} · ${cycleTitle}" aria-label="${esc(student.name)} ${meta.day}일 ${kindLabel}${slotLabel} ${statusMeta.label}">${statusMeta.mark}</button>`;
  }

'''
register = register[:helper_start] + new_helpers + register[helper_end:]

set_start = register.index('  async function setAttendanceSessionStatus')
set_end = register.index('  function linkedAttendanceRegisterHtml()', set_start)
new_setter = r'''  async function setAttendanceSessionStatus(studentId, sessionDate, sessionKind, timeSlot, classGroup, status) {
    if (typeof global.supabase !== 'function') throw new Error('출석 서버 연결을 찾지 못했습니다.');
    const academyId = currentAcademyId();
    const sessionToken = clean(localStorage.getItem('olli_account_session_token_v1'));
    if (!academyId) throw new Error('현재 학원 정보를 찾지 못했습니다. 다시 로그인해 주세요.');
    if (!sessionToken) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
    const slot = Number(timeSlot || 0);
    const group = normalizeAttendanceClassGroup(classGroup);
    const rpcName = slot > 0
      ? 'rpc/olli_schedule_set_attendance_session_slot_status'
      : 'rpc/olli_schedule_set_attendance_session_status';
    const payload = {
      p_session_token: sessionToken,
      p_academy_id: academyId,
      p_student_id: studentId,
      p_session_date: sessionDate,
      p_session_kind: sessionKind,
      p_status: status
    };
    if (slot > 0) {
      payload.p_time_slot = slot;
      payload.p_class_group = group;
    }
    const result = await global.supabase('POST', rpcName, payload);
    const data = Array.isArray(result) && result.length === 1 ? result[0] : result;
    if (data && data.ok === false) throw new Error(data.message || '출석부 상태를 저장하지 못했습니다.');
    try {
      if (global.OlliAttendanceData && typeof global.OlliAttendanceData.invalidateMonth === 'function') {
        global.OlliAttendanceData.invalidateMonth(sessionDate);
      }
    } catch (_) {}
    return data || {};
  }

'''
register = register[:set_start] + new_setter + register[set_end:]

old_cell_block = r'''        const records = rowsByStudentDate.get(`${clean(student.id)}|${meta.key}`) || [];
        const hasRegular = attendanceRegisterHasSession(records, 'regular');
        const hasMakeup = attendanceRegisterHasSession(records, 'makeup');
        if (!hasRegular && !hasMakeup) return '<td class="dateCol"></td>';

        const regularStatus = hasRegular ? attendanceRegisterSessionStatus(records, meta.key, 'regular') : 'blank';
        const makeupStatus = hasMakeup ? attendanceRegisterSessionStatus(records, meta.key, 'makeup') : 'blank';
        const split = hasRegular && hasMakeup;
        const segments = [
          hasRegular ? renderAttendanceRegisterSegment(student, meta, 'regular', regularStatus) : '',
          hasMakeup ? renderAttendanceRegisterSegment(student, meta, 'makeup', makeupStatus) : ''
        ].join('');
        return `<td class="dateCol attendanceRegisterEditable attendanceRegisterSessionCell${split ? ' isSplit' : ''}"><div class="attendanceRegisterCellInner">${segments}</div></td>`;
'''
new_cell_block = r'''        const records = rowsByStudentDate.get(`${clean(student.id)}|${meta.key}`) || [];
        const sessions = attendanceRegisterSessions(records);
        if (!sessions.length) return '<td class="dateCol"></td>';

        const segments = sessions.map((session) => {
          const status = attendanceRegisterSessionStatus(records, meta.key, session);
          return renderAttendanceRegisterSegment(student, meta, session, status);
        }).join('');
        return `<td class="dateCol attendanceRegisterEditable attendanceRegisterSessionCell${sessions.length > 1 ? ' isSplit' : ''}"><div class="attendanceRegisterCellInner">${segments}</div></td>`;
'''
register = replace_once(register, old_cell_block, new_cell_block, 'multi-session attendance cell')

cycle_start = register.index('  async function cycleAttendanceRegisterCell(cell)')
cycle_end = register.index('  function bindAttendanceRegisterEditing(root)', cycle_start)
new_cycle = r'''  async function cycleAttendanceRegisterCell(cell) {
    if (!cell || cell.dataset.attendanceSaving === '1') return;
    const studentId = clean(cell.dataset.studentId);
    const sessionDate = clean(cell.dataset.sessionDate);
    const sessionKind = clean(cell.dataset.sessionKind) === 'makeup' ? 'makeup' : 'regular';
    const timeSlot = Number(cell.dataset.timeSlot || 0);
    const classGroup = normalizeAttendanceClassGroup(cell.dataset.classGroup);
    const currentStatus = clean(cell.dataset.status) || 'blank';
    const nextStatus = nextAttendanceRegisterStatus(currentStatus, sessionKind);
    if (!studentId || !sessionDate) return;

    cell.dataset.attendanceSaving = '1';
    state.attendanceSavingCount = Number(state.attendanceSavingCount || 0) + 1;
    try {
      await setAttendanceSessionStatus(studentId, sessionDate, sessionKind, timeSlot, classGroup, nextStatus);
      const rows = (Array.isArray(state.attendanceRows) ? state.attendanceRows : []).filter((row) => {
        if (clean(row && row.student_id) !== studentId
          || clean(row && row.session_date).slice(0, 10) !== sessionDate
          || clean(row && row.session_kind) !== 'register_override'
          || attendanceRegisterOverrideKind(row) !== sessionKind) return true;
        const rowSlot = Number(row && row.time_slot || 0);
        if (timeSlot > 0) {
          return rowSlot !== timeSlot || normalizeAttendanceClassGroup(row && row.class_group) !== classGroup;
        }
        return rowSlot !== 0;
      });
      rows.push({
        student_id: studentId,
        session_date: sessionDate,
        time_slot: timeSlot,
        class_group: classGroup,
        session_kind: 'register_override',
        register_session_kind: sessionKind,
        attended: nextStatus === 'present' || nextStatus === 'makeup',
        register_status: nextStatus,
        marked_at: new Date().toISOString()
      });
      state.attendanceRows = rows;
      state.attendanceRowsMonth = state.attendanceMonth;

      const statusMeta = attendanceRegisterStatusMeta(nextStatus);
      cell.dataset.status = nextStatus;
      cell.dataset.attendanceSaving = '';
      cell.classList.remove('attendanceLinkedMark', 'attendanceAbsentMark', 'attendanceMakeupMark');
      if (statusMeta.className) cell.classList.add(statusMeta.className);
      cell.innerHTML = statusMeta.mark;
      const kindLabel = sessionKind === 'makeup' ? '보강' : '정규수업';
      const slotLabel = timeSlot > 0 ? ` ${timeSlot}시` : '';
      const student = service.activeStudents().find((item) => clean(item && item.id) === studentId);
      const dayNumber = Number(sessionDate.slice(-2));
      cell.setAttribute('aria-label', `${clean(student && student.name)} ${dayNumber}일 ${kindLabel}${slotLabel} ${statusMeta.label}`.trim());
      lastAttendanceRenderSignature = attendanceRenderSignature();
    } catch (error) {
      notify(error && (error.message || error) || '출석부 상태를 저장하지 못했습니다.');
    } finally {
      cell.dataset.attendanceSaving = '';
      state.attendanceSavingCount = Math.max(0, Number(state.attendanceSavingCount || 0) - 1);
    }
  }

'''
register = register[:cycle_start] + new_cycle + register[cycle_end:]

old_active = r'''    const activeStudentId = activeCell ? clean(activeCell.dataset.studentId) : '';
    const activeSessionDate = activeCell ? clean(activeCell.dataset.sessionDate) : '';
    const activeSessionKind = activeCell ? clean(activeCell.dataset.sessionKind) : '';
'''
new_active = r'''    const activeStudentId = activeCell ? clean(activeCell.dataset.studentId) : '';
    const activeSessionDate = activeCell ? clean(activeCell.dataset.sessionDate) : '';
    const activeSessionKind = activeCell ? clean(activeCell.dataset.sessionKind) : '';
    const activeTimeSlot = activeCell ? Number(activeCell.dataset.timeSlot || 0) : 0;
    const activeClassGroup = activeCell ? normalizeAttendanceClassGroup(activeCell.dataset.classGroup) : 'A';
'''
register = replace_once(register, old_active, new_active, 'active attendance segment identity')
register = replace_once(
    register,
    '정규수업과 보강 출석이 각각 기록되며, 같은 날 두 수업이 있으면 날짜 칸이 좌우로 나뉩니다.',
    '같은 날 두 번 이상 수업이 있으면 날짜 칸을 수업별로 나눠 각각 출결을 체크합니다.',
    'attendance register help text'
)
old_restore = r'''        clean(item.dataset.studentId) === activeStudentId
        && clean(item.dataset.sessionDate) === activeSessionDate
        && (!activeSessionKind || clean(item.dataset.sessionKind) === activeSessionKind)
'''
new_restore = r'''        clean(item.dataset.studentId) === activeStudentId
        && clean(item.dataset.sessionDate) === activeSessionDate
        && (!activeSessionKind || clean(item.dataset.sessionKind) === activeSessionKind)
        && Number(item.dataset.timeSlot || 0) === activeTimeSlot
        && normalizeAttendanceClassGroup(item.dataset.classGroup) === activeClassGroup
'''
register = replace_once(register, old_restore, new_restore, 'active attendance segment restore')
register_path.write_text(register, encoding='utf-8')


# 최종 의도 검증
checks = {
    'pc-attendance.css': [
        'top:50%;right:8px',
        '.attendanceFeedbackSheetCard.open .attendanceFeedbackSheetCardTopActions{top:7px;transform:none;}',
        'position:absolute;top:16px;right:58px',
    ],
    'pc-attendance.js': [
        "[PC_SORT_MODES.GRADE, '학년별 • 나이별']",
        "const useAge = division === 'kinder';",
        "? (useAge ? '나이 미지정' : '학년 미지정')",
    ],
    'pc-timetable-attendance-register.js': [
        'function attendanceRegisterSessions(records)',
        'rpc/olli_schedule_set_attendance_session_slot_status',
        'data-time-slot="${timeSlot}"',
        'sessions.length > 1',
        '같은 날 두 번 이상 수업이 있으면 날짜 칸을 수업별로 나눠 각각 출결을 체크합니다.',
    ]
}
for filename, needles in checks.items():
    text = Path(filename).read_text(encoding='utf-8')
    for needle in needles:
        if needle not in text:
            raise RuntimeError(f'{filename}: missing expected change: {needle}')

print('PC personality-record and multi-session attendance patch applied.')
