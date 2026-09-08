from pathlib import Path
import re


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    if old not in text:
        if new in text:
            print(f'{label}: already applied')
            return text
        raise SystemExit(f'{label}: anchor not found')
    return text.replace(old, new, 1)


# 1) 성향기록부: 휴원/퇴원 학생 재등록 UI + 동작
path = 'pc-attendance.js'
s = read(path)

old_icon = '''      + '<span class="pcAttendanceDetailEmptyIcon pcAttendanceReenrollIcon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"></path><path d="M5.5 18.5c.8-3 2.8-4.5 5.5-4.5 1.2 0 2.3.3 3.2.8"></path><path d="M17 12.5h3v3"></path><path d="M20 15.5a4.5 4.5 0 0 1-7.3 3.5"></path><path d="M14 20h-3v-3"></path></svg></span>'
      + '<strong>재등록 후 관찰기록을 이용할 수 있어요.</strong>'
      + '<span>'+studentName+' 학생은 현재 '+statusLabel+' 상태입니다.<br>학생관리에서 재등록하면 관찰기록 작성과 수정 기능이 다시 활성화됩니다.</span>'
'''
new_icon = '''      + '<button type="button" class="pcAttendanceDetailEmptyIcon pcAttendanceReenrollIcon" aria-label="'+studentName+' 학생 재등록" onclick="pcReenrollAttendanceStudent(\\\''+escape(student?.id || '')+'\\\')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"></path><path d="M5.5 18.5c.8-3 2.8-4.5 5.5-4.5 1.2 0 2.3.3 3.2.8"></path><path d="M17 12.5h3v3"></path><path d="M20 15.5a4.5 4.5 0 0 1-7.3 3.5"></path><path d="M14 20h-3v-3"></path></svg></button>'
      + '<strong>재등록 후 관찰기록을 이용할 수 있어요.</strong>'
      + '<span>'+studentName+' 학생은 현재 '+statusLabel+' 상태입니다.</span>'
'''
s = replace_once(s, old_icon, new_icon, 'inactive guide + clickable icon')

anchor = '''  function renderLoadingDetail(student) {
    const body = ensureRecordWorkspace(student);
    if (body) body.innerHTML = recordQuietLoadingHtml();
  }
'''
helper = '''  async function reenrollInactiveStudent(studentOrId) {
    const student = typeof studentOrId === 'object'
      ? studentOrId
      : (typeof findStudentById === 'function' ? findStudentById(studentOrId) : null);
    if (!student || !inactiveStudentStatus(student)) return;
    if (!global.confirm('재등록 하시겠습니까?')) return;
    if (typeof global.reactivateStudentById !== 'function') {
      alert('재등록 기능을 불러오지 못했습니다. 학생관리에서 다시 시도해 주세요.');
      return;
    }
    try {
      await global.reactivateStudentById(student.id);
      state.selectedStudentId = '';
      state.loadToken += 1;
      renderList();
      renderEmptyDetail();
      if (typeof global.showPushToast === 'function') global.showPushToast(`${student.name} 학생을 재등록했어요.`);
    } catch (error) {
      alert(`재등록에 실패했어요.\\n\\n${error?.message || error}`);
    }
  }

'''
if 'async function reenrollInactiveStudent' not in s:
    s = replace_once(s, anchor, helper + anchor, 'reenroll handler')

old_export = '''  global.pcSelectAttendanceStudent = selectStudent;
  global.pcSetAttendanceSortMode = setSortMode;
'''
new_export = '''  global.pcSelectAttendanceStudent = selectStudent;
  global.pcReenrollAttendanceStudent = reenrollInactiveStudent;
  global.pcSetAttendanceSortMode = setSortMode;
'''
s = replace_once(s, old_export, new_export, 'reenroll export')
write(path, s)


# 2) 학생 상태 저장: 학생관리/성향기록부가 같은 상태 저장 함수 사용
path = 'olli-data-student-operations.js'
s = read(path)
pattern = re.compile(r'''async function setSelectedStudentStatus\(status\) \{.*?\n\}\n\nasync function deleteSelectedStudents\(\) \{''', re.S)
replacement = '''async function setStudentStatusById(studentId, status, options = {}) {
  const targetId = String(studentId || '').trim();
  if (!targetId) return null;
  const student = findStudentById(targetId);
  if (!student) return null;

  const nextStatus = status === 'active' ? 'active' : status;
  const changedAt = new Date().toISOString();
  const statusDates = nextStatus === 'withdrawn'
    ? { withdrawn_at: changedAt, paused_at: '' }
    : (nextStatus === 'paused'
      ? { paused_at: changedAt, withdrawn_at: '' }
      : { withdrawn_at: '', paused_at: '' });

  const nextStudent = normalizeStudentObject({
    ...student,
    status: nextStatus,
    ...statusDates,
    status_changed_at: changedAt,
    updated_at: changedAt
  }, student.type || 'elementary');

  setPendingStudentStatus(nextStudent);
  await saveStudent(nextStudent, { skipRemote: true });

  if (nextStudent.type === 'elementary' || nextStudent.type === 'kinder') {
    const sectionState = recordStatusSectionOpenState[nextStudent.type];
    if (sectionState && (nextStatus === 'paused' || nextStatus === 'withdrawn')) {
      sectionState[nextStatus] = true;
    }
  }

  if (currentMemoStudent && String(currentMemoStudent.id) === String(nextStudent.id)) {
    currentMemoStudent = nextStudent;
  }

  if (options.closeActionMenu !== false) closeStudentActionMenu();
  const searchValue = document.getElementById('searchName')?.value.trim() || '';

  // 서버를 다시 읽기 전에 로컬 상태를 즉시 반영합니다.
  if (currentRecordView === 'elementary' || currentRecordView === 'kinder') renderCurrentStudentRecords(searchValue);
  else if (currentRecordView === 'academy') renderRecordAcademyManagementDashboard();

  try {
    await updateStudentStatusInSupabase(nextStudent);
  } catch (err) {
    // 실패해도 로컬 상태와 재동기화 대기값은 유지합니다.
    console.warn('student status remote sync pending:', err.message || err);
  }

  await loadRecords(searchValue);
  if (currentRecordView === 'academy') renderRecordAcademyManagementDashboard();
  return findStudentById(targetId) || nextStudent;
}

async function setSelectedStudentStatus(status) {
  if (!selectedStudentActionId) return null;
  return setStudentStatusById(selectedStudentActionId, status, { closeActionMenu: true });
}

async function reactivateStudentById(studentId) {
  return setStudentStatusById(studentId, 'active', { closeActionMenu: false });
}

if (typeof window !== 'undefined') window.reactivateStudentById = reactivateStudentById;

async function deleteSelectedStudents() {'''
if 'async function setStudentStatusById' not in s:
    s2, count = pattern.subn(lambda _m: replacement, s, count=1)
    if count != 1:
        raise SystemExit('student status shared helper: anchor not found')
    s = s2
write(path, s)


# 3) 시간표: 1시/6시 적응형 높이 계산
path = 'pc-timetable.js'
s = read(path)
anchor = '''  function sectionHtml(division) {
    const times = TIME_SLOTS[division];
    const dates = DAYS.map((_, index) => addDays(state.weekStart, index));
    let grid = `<div class="olliTtGrid" style="--olli-tt-rows:${times.length}"><div class="olliTtCorner"></div>`;
'''
replacement = '''  function elementaryAdaptiveEdgeRowHeight(displayTime, dates) {
    let required = 64;
    dates.forEach((date) => {
      if (date.getDay() === 6 && Number(displayTime) > 3) return;
      const storedTime = storedTimeForCell('elementary', date, displayTime);
      const hasMemo = !!cellMemoText('elementary', date, storedTime);
      let contentRows = 0;
      let headerHeight = 0;

      if (isClassSplit('elementary', date.getDay(), storedTime)) {
        contentRows = Math.ceil(slotEntryCount('elementary', date, storedTime, 'A') / 2)
          + Math.ceil(slotEntryCount('elementary', date, storedTime, 'B') / 2);
        if (classTeacherLabel('elementary', date.getDay(), storedTime, 'A')) headerHeight += 14;
        if (classTeacherLabel('elementary', date.getDay(), storedTime, 'B')) headerHeight += 14;
      } else {
        contentRows = Math.ceil(slotEntryCount('elementary', date, storedTime, '') / 2);
        if (classTeacherLabel('elementary', date.getDay(), storedTime, 'A')) headerHeight += 14;
      }

      const memoHeight = hasMemo ? 41 : 0;
      required = Math.max(required, 18 + headerHeight + (contentRows * 27) + memoHeight);
    });
    return Math.max(64, Math.min(220, Math.ceil(required)));
  }

  function sectionHtml(division) {
    const times = TIME_SLOTS[division];
    const dates = DAYS.map((_, index) => addDays(state.weekStart, index));
    const adaptiveClass = division === 'elementary' ? ' olliTtAdaptiveEdgeRows' : '';
    const adaptiveVars = division === 'elementary'
      ? `;--olli-tt-edge-row-1:${elementaryAdaptiveEdgeRowHeight(1, dates)}px;--olli-tt-edge-row-6:${elementaryAdaptiveEdgeRowHeight(6, dates)}px`
      : '';
    let grid = `<div class="olliTtGrid${adaptiveClass}" style="--olli-tt-rows:${times.length}${adaptiveVars}"><div class="olliTtCorner"></div>`;
'''
if 'function elementaryAdaptiveEdgeRowHeight' not in s:
    s = replace_once(s, anchor, replacement, 'adaptive elementary edge rows')
write(path, s)


# 4) 시간표 CSS: 메모 기본 높이 + 1/6시 적응형 트랙
path = 'pc-timetable.css'
s = read(path)
memo_old = '''#recordRoomScreen .olliTtCellMemoCard {
  grid-column: 1 / -1;
  width: 100%;
  min-width: 0;
  min-height: 24px;
'''
memo_new = '''#recordRoomScreen .olliTtCellMemoCard {
  grid-column: 1 / -1;
  width: 100%;
  min-width: 0;
  min-height: 38px;
'''
s = replace_once(s, memo_old, memo_new, 'memo two-line default height')

adaptive_css = '''

/* 초등부 1시·6시: 학생 카드 수에 맞춰 줄고, 남는 높이는 2~5시가 나눠 사용 */
#recordRoomScreen .olliTtSection.elementary .olliTtGrid.olliTtAdaptiveEdgeRows {
  grid-template-rows:
    52px
    min(var(--olli-tt-edge-row-1, 108px), calc(16.6667% - 8.6667px))
    repeat(4, minmax(108px, 1fr))
    min(var(--olli-tt-edge-row-6, 108px), calc(16.6667% - 8.6667px));
}
'''
if 'olliTtAdaptiveEdgeRows' not in s:
    s = s.rstrip() + adaptive_css + '\n'
write(path, s)


# 5) 재등록 아이콘 버튼 스타일
path = 'pc-record-editor.css'
s = read(path)
reenroll_css = '''

/* 성향기록부 휴원·퇴원 학생 재등록 아이콘 */
#recordRoomScreen .pcAttendanceDetailInactive .pcAttendanceReenrollIcon {
  appearance: none;
  -webkit-appearance: none;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  cursor: pointer;
  transition: transform .15s ease, opacity .15s ease;
}
#recordRoomScreen .pcAttendanceDetailInactive .pcAttendanceReenrollIcon:hover { transform: translateY(-2px); }
#recordRoomScreen .pcAttendanceDetailInactive .pcAttendanceReenrollIcon:active { transform: translateY(0) scale(.97); }
#recordRoomScreen .pcAttendanceDetailInactive .pcAttendanceReenrollIcon:focus-visible {
  outline: 2px solid rgba(10,132,255,.34);
  outline-offset: 5px;
  border-radius: 12px;
}
'''
if '성향기록부 휴원·퇴원 학생 재등록 아이콘' not in s:
    s = s.rstrip() + reenroll_css + '\n'
write(path, s)

print('patch applied')
