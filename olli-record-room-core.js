const recordStatusSectionOpenState = {
  elementary: { paused: false, withdrawn: false },
  kinder: { paused: false, withdrawn: false }
};

function isWithdrawnVisibleInAttendance(student) {
  if (getStudentStatus(student) !== 'withdrawn') return false;
  const withdrawnDate = getStudentWithdrawalDateForStats(student);
  if (!withdrawnDate) return true;
  const elapsed = Date.now() - withdrawnDate.getTime();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  return elapsed >= 0 && elapsed <= thirtyDays;
}

function toggleRecordStatusSection(view, status) {
  if (!recordStatusSectionOpenState[view] || !(status in recordStatusSectionOpenState[view])) return;
  recordStatusSectionOpenState[view][status] = !recordStatusSectionOpenState[view][status];
  const searchValue = document.getElementById('searchName')?.value.trim() || '';
  if (view === currentRecordView && (view === 'elementary' || view === 'kinder')) renderCurrentStudentRecords(searchValue);
}

function renderRecordStatusSection(view, status, label, rowsHtml, emptyText) {
  const isOpen = !!recordStatusSectionOpenState[view]?.[status];
  const bodyHtml = rowsHtml || `<div class="recordStatusSectionEmpty">${escapeHtml(emptyText || '해당 학생이 없습니다.')}</div>`;
  return `<div class="recordStatusSection${isOpen ? ' open' : ''}">
    <button type="button" class="recordStatusSectionToggle" onclick="toggleRecordStatusSection('${view}','${status}')" aria-expanded="${isOpen ? 'true' : 'false'}">
      <span>${escapeHtml(label)}</span>
      <span class="recordStatusSectionTriangle" aria-hidden="true"></span>
    </button>
    <div class="recordStatusSectionBody">${bodyHtml}</div>
  </div>`;
}


const RECORD_DAILY_ATTENDANCE_KEY = 'olli_record_daily_attendance_v1';
function getRecordDailyAttendanceStorageKey() {
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || 'unscoped';
  return `${RECORD_DAILY_ATTENDANCE_KEY}_${academyId}`;
}
function readRecordDailyAttendanceStore() {
  try {
    const raw = localStorage.getItem(getRecordDailyAttendanceStorageKey());
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch(e) {
    return {};
  }
}
function writeRecordDailyAttendanceStore(store) {
  try {
    localStorage.setItem(getRecordDailyAttendanceStorageKey(), JSON.stringify(store && typeof store === 'object' ? store : {}));
  } catch(e) {
    console.warn('출석 체크 로컬 저장 보류:', e);
  }
}
function formatRecordAttendanceDateKey(dateValue = new Date()) {
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function getRecordAttendanceDateFromKey(dateKey) {
  const parts = String(dateKey || '').split('-').map(Number);
  if (parts.length < 3) return null;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return Number.isNaN(d.getTime()) ? null : d;
}
function getRecordAttendanceStatus(studentId, dateKey = formatRecordAttendanceDateKey()) {
  if (!studentId || !dateKey) return '';
  const store = readRecordDailyAttendanceStore();
  const item = store?.[dateKey]?.[String(studentId)];
  const status = String(item?.status || '');
  return (status === 'attended' || status === 'makeup') ? status : '';
}
function setRecordAttendanceStatus(student, dateKey, status) {
  if (!student || !student.id || !dateKey) return;
  const store = readRecordDailyAttendanceStore();
  if (!store[dateKey] || typeof store[dateKey] !== 'object') store[dateKey] = {};
  const studentId = String(student.id);
  if (status === 'attended' || status === 'makeup') {
    store[dateKey][studentId] = {
      student_id: studentId,
      student_name: student.name || '',
      division: student.type || '',
      status,
      date: dateKey,
      updated_at: new Date().toISOString()
    };
  } else {
    delete store[dateKey][studentId];
    if (!Object.keys(store[dateKey]).length) delete store[dateKey];
  }
  writeRecordDailyAttendanceStore(store);
}
function getRecordAttendanceKoreanDayName(dateValue = new Date()) {
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  return RECORD_SORT_DAY_NAMES[d.getDay()] || '';
}
function isRecordStudentLessonDate(student, dateValue = new Date()) {
  const dayName = getRecordAttendanceKoreanDayName(dateValue);
  const lessonDays = parseRecordSortDays(student);
  return !!dayName && lessonDays.includes(dayName);
}
function getRecordAttendanceExpectedStatus(student, dateValue = new Date()) {
  return isRecordStudentLessonDate(student, dateValue) ? 'attended' : 'makeup';
}
function getRecordAttendanceStatusClass(status) {
  if (status === 'attended') return 'attended';
  if (status === 'makeup') return 'makeup';
  return '';
}
function getRecordAttendanceStatusTitle(status, student) {
  const lessonText = normalizeLessonDayDisplay(student?.lesson_day || student?.lessonDay || student?.class_day || student?.classDay || '');
  if (status === 'attended') return '출석 체크됨';
  if (status === 'makeup') return '보강 체크됨';
  return lessonText ? `오늘 체크하기 · 등원요일 ${lessonText}` : '오늘 체크하기';
}
function isRecordStudentEnrollmentDateMissing(student) {
  const value = (typeof getStudentInfoDateValue === 'function')
    ? getStudentInfoDateValue(student)
    : (typeof getEnrolledAtFromStudent === 'function' ? getEnrolledAtFromStudent(student) : '');
  return !String(value || '').trim();
}
function renderRecordAttendanceLeadIcon(student) {
  const status = getRecordAttendanceStatus(student?.id);
  const missingEnrollment = isRecordStudentEnrollmentDateMissing(student);
  const stateClass = [getRecordAttendanceStatusClass(status), missingEnrollment ? 'missingEnrollment' : ''].filter(Boolean).join(' ');
  const baseTitle = getRecordAttendanceStatusTitle(status, student);
  const title = missingEnrollment ? `${baseTitle} · 등록일 미입력` : baseTitle;
  return `<span class="recordAttendanceLeadBtn ${escapeHtml(stateClass)}" role="button" tabindex="0" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" onclick="toggleRecordTodayAttendance(event,'${escapeTemplateLiteral(student?.id || '')}')" onkeydown="handleRecordAttendanceLeadKeydown(event,'${escapeTemplateLiteral(student?.id || '')}')">
    <svg class="recordAttendanceLeadSvg" xmlns="http://www.w3.org/2000/svg" width="36" height="35" viewBox="0 0 36 35" aria-hidden="true">
      <polygon class="recordAttendanceLeadFill" points="20.5,5.5 31,11.7 31,23.8 20.5,30.5 10,23.8 10,11.7" fill="transparent" stroke="#d9d9d9" stroke-width="2" stroke-linejoin="round"/>
      <path class="recordAttendanceLeadLine" d="M10 11.7 L20.5 17.8 L31 11.7" fill="none" stroke="#d9d9d9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path class="recordAttendanceLeadLine" d="M20.5 17.8 L20.5 30.5" fill="none" stroke="#d9d9d9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </span>`;
}
function handleRecordAttendanceLeadKeydown(event, studentId) {
  if (!event || (event.key !== 'Enter' && event.key !== ' ')) return;
  toggleRecordTodayAttendance(event, studentId);
}
function toggleRecordTodayAttendance(event, studentId) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (studentSelectionMode) return;
  const student = getAllStudents().find(item => String(item.id) === String(studentId));
  if (!student) return;
  const today = new Date();
  const dateKey = formatRecordAttendanceDateKey(today);
  const expectedStatus = getRecordAttendanceExpectedStatus(student, today);
  const currentStatus = getRecordAttendanceStatus(student.id, dateKey);
  const nextStatus = currentStatus === expectedStatus ? '' : expectedStatus;
  setRecordAttendanceStatus(student, dateKey, nextStatus);
  const searchValue = document.getElementById('searchName')?.value.trim() || '';
  if (currentRecordView === 'elementary' || currentRecordView === 'kinder') renderCurrentStudentRecords(searchValue);
}
function getRecordAttendanceMonthRange(baseDate = new Date()) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();
  return { year, month, lastDay };
}
function shouldCountRecordAttendanceDate(dateValue) {
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  const dKey = Number(formatRecordAttendanceDateKey(d).replace(/-/g, ''));
  const todayKey = Number(formatRecordAttendanceDateKey(today).replace(/-/g, ''));
  return dKey <= todayKey;
}
function getRecordAttendanceStudentMonthSummary(student, baseDate = new Date()) {
  const { year, month, lastDay } = getRecordAttendanceMonthRange(baseDate);
  const store = readRecordDailyAttendanceStore();
  const attended = [];
  const absent = [];
  const makeup = [];
  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(year, month - 1, day);
    const dateKey = formatRecordAttendanceDateKey(date);
    const status = String(store?.[dateKey]?.[String(student.id)]?.status || '');
    const isLessonDate = isRecordStudentLessonDate(student, date);
    const countable = shouldCountRecordAttendanceDate(date);
    if (status === 'attended') attended.push(day);
    if (status === 'makeup') makeup.push(day);
    if (isLessonDate && countable && status !== 'attended') absent.push(day);
  }
  const remainingMakeup = Math.max(absent.length - makeup.length, 0);
  return { attended, absent, makeup, remainingMakeup };
}
function formatRecordAttendanceDayList(days) {
  const list = Array.isArray(days) ? days.filter(v => Number(v) > 0).sort((a,b) => a - b) : [];
  return list.length ? list.map(day => `${day}일`).join(' ') : '-';
}
function renderRecordAttendanceSummary() {
  // 초등부/유치부 옆 출석부 요약 탭과 월별 출석부 내용은 삭제되었습니다.
  const list = document.getElementById('recordList');
  if (!list) return;
  currentRecordView = currentObservationView === 'kinder' ? 'kinder' : 'elementary';
  updateRecordHeaderUI();
  const searchValue = document.getElementById('searchName')?.value.trim() || '';
  renderCurrentStudentRecords(searchValue);
}

function renderElementaryStudentRows(students) {
  const cycleGroups = getElementaryCycleGroups(students);
  let previousSectionKey = '';
  return students.map((student, index) => {
    const metaBits = getElementaryMetaBits(student);
    const metaText = metaBits.join('\u00A0\u00A0|\u00A0\u00A0');
    const sectionKey = (typeof getRecordSortSectionKey === 'function') ? getRecordSortSectionKey(student, 'elementary', cycleGroups) : getElementaryGroupSectionKey(student, cycleGroups);
    const groupBreakClass = index > 0 && sectionKey !== previousSectionKey ? ' groupBreak' : '';
    previousSectionKey = sectionKey;
    const status = getStudentStatus(student);
    const statusClass = status === 'paused' ? ' studentStatusPaused' : (status === 'withdrawn' ? ' studentStatusWithdrawn' : '');
    return `
    <button class="elementaryStudentRow${groupBreakClass}${statusClass}" onclick="handleStudentRowClick(event,'${escapeTemplateLiteral(student.id)}')" onpointerdown="startStudentLongPress(event,'${escapeTemplateLiteral(student.id)}')" onpointermove="moveStudentLongPress(event)" onpointerup="cancelStudentLongPress()" onpointercancel="cancelStudentLongPress()" oncontextmenu="event.preventDefault()">
      <div class="elementaryRowInner">
        ${renderElementaryLeadIcon(student)}
        <span class="studentTextWrap">
          <span>${escapeHtml(student.name)}</span>
          ${metaText ? `<span class="studentMetaText">${escapeHtml(metaText)}</span>` : ''}
        </span>
      </div>
    </button>`;
  }).join('');
}

function renderKinderStudentRows(students) {
  let previousSectionKey = '';
  return students.map((student, index) => {
    const metaBits = getKinderMetaBits(student);
    const sectionKey = (typeof getRecordSortSectionKey === 'function') ? getRecordSortSectionKey(student, 'kinder') : `status:${getStudentStatus(student)}:${student.age || ''}`;
    const groupBreakClass = index > 0 && sectionKey !== previousSectionKey ? ' groupBreak' : '';
    previousSectionKey = sectionKey;
    const status = getStudentStatus(student);
    const statusClass = status === 'paused' ? ' studentStatusPaused' : (status === 'withdrawn' ? ' studentStatusWithdrawn' : '');
    return `
    <button class="kinderStudentRow${groupBreakClass}${statusClass}" onclick="handleStudentRowClick(event,'${escapeTemplateLiteral(student.id)}')" onpointerdown="startStudentLongPress(event,'${escapeTemplateLiteral(student.id)}')" onpointermove="moveStudentLongPress(event)" onpointerup="cancelStudentLongPress()" onpointercancel="cancelStudentLongPress()" oncontextmenu="event.preventDefault()">
      <div class="kinderRowInner">
        ${renderKinderLeadIcon(student)}
        <span class="studentTextWrap">
          <span>${escapeHtml(student.name)}</span>
          ${metaBits.length ? `<span class="studentMetaText">${escapeHtml(metaBits.join('\u00A0\u00A0|\u00A0\u00A0'))}</span>` : ''}
        </span>
      </div>
    </button>`;
  }).join('');
}

function renderElementaryRecords(name) {
  const list = document.getElementById('recordList');
  let students = getStudentsByType('elementary');
  if (name) students = students.filter(student => student.name.includes(name));

  const activeStudents = sortStudentsForRecord(students.filter(student => getStudentStatus(student) === 'active'));
  const pausedStudents = sortStudentsForRecord(students.filter(student => getStudentStatus(student) === 'paused'));
  const withdrawnStudents = sortStudentsForRecord(students.filter(isWithdrawnVisibleInAttendance));

  const activeHtml = renderElementaryStudentRows(activeStudents);
  const pausedHtml = renderElementaryStudentRows(pausedStudents);
  const withdrawnHtml = renderElementaryStudentRows(withdrawnStudents);
  const activeEmptyHtml = activeHtml ? '' : `<div class="recordEmpty">${name ? '검색된 재원생이 없습니다.' : '등록된 재원생이 없습니다.'}</div>`;
  list.innerHTML = activeHtml
    + activeEmptyHtml
    + renderRecordStatusSection('elementary', 'paused', '휴원', pausedHtml, '휴원생이 없습니다.')
    + renderRecordStatusSection('elementary', 'withdrawn', '퇴원', withdrawnHtml, '최근 한 달 내 퇴원생이 없습니다.');
}

function renderKinderRecords(name) {
  const list = document.getElementById('recordList');
  let students = getStudentsByType('kinder');
  if (name) students = students.filter(student => student.name.includes(name));

  const activeStudents = sortStudentsForRecord(students.filter(student => getStudentStatus(student) === 'active'));
  const pausedStudents = sortStudentsForRecord(students.filter(student => getStudentStatus(student) === 'paused'));
  const withdrawnStudents = sortStudentsForRecord(students.filter(isWithdrawnVisibleInAttendance));

  const activeHtml = renderKinderStudentRows(activeStudents);
  const pausedHtml = renderKinderStudentRows(pausedStudents);
  const withdrawnHtml = renderKinderStudentRows(withdrawnStudents);
  const transferCandidates = name ? [] : getKinderElementaryTransferCandidates();
  const transferBannerHtml = transferCandidates.length
    ? `<button type="button" class="kinderTransferBanner" onclick="openKinderTransferModal()">
        <span class="kinderTransferBannerText"><span class="kinderTransferBannerTitle">초등부 이관 대상</span><span class="kinderTransferBannerSub">3월부터 8세 유치부 학생을 확인해 주세요.</span></span>
        <span class="kinderTransferBannerCount">${transferCandidates.length}명</span>
      </button>`
    : '';
  const activeEmptyHtml = activeHtml ? '' : `<div class="recordEmpty">${name ? '검색된 재원생이 없습니다.' : '등록된 재원생이 없습니다.'}</div>`;
  list.innerHTML = transferBannerHtml + activeHtml
    + activeEmptyHtml
    + renderRecordStatusSection('kinder', 'paused', '휴원', pausedHtml, '휴원생이 없습니다.')
    + renderRecordStatusSection('kinder', 'withdrawn', '퇴원', withdrawnHtml, '최근 한 달 내 퇴원생이 없습니다.');
}


function clearRecordBoardSelection() {
  document.querySelectorAll('.savedFeedbackStudentBlock.studentRowSelected').forEach(el => el.classList.remove('studentRowSelected'));
}

function cancelRecordBoardLongPress() {
  if (recordBoardLongPressTimer) {
    clearTimeout(recordBoardLongPressTimer);
    recordBoardLongPressTimer = null;
  }
}

function startRecordBoardLongPress(e, recordKey) {
  if (currentRecordView === 'elementary' || currentRecordView === 'kinder') return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  cancelRecordBoardLongPress();
  const block = e.currentTarget.closest('.recordStudentBlock');
  const point = getPointerPoint(e);
  recordBoardLongPressStart = point;
  recordBoardLongPressTimer = setTimeout(() => {
    recordBoardLongPressTimer = null;
    suppressNextRecordBoardClick = true;
    clearRecordBoardSelection();
    if (block) block.classList.add('studentRowSelected');
    triggerLightHaptic();
    setTimeout(() => {
      openRecordBoardActionMenu(recordKey, block);
    }, 140);
  }, 650);
}

function moveRecordBoardLongPress(e) {
  if (!recordBoardLongPressTimer) return;
  const point = getPointerPoint(e);
  const dx = Math.abs(point.x - recordBoardLongPressStart.x);
  const dy = Math.abs(point.y - recordBoardLongPressStart.y);
  if (dx > 10 || dy > 10) cancelRecordBoardLongPress();
}

function handleRecordBoardHeadClick(e, headEl) {
  if (suppressNextRecordBoardClick) {
    e.preventDefault();
    e.stopPropagation();
    suppressNextRecordBoardClick = false;
    return;
  }
  toggleStudentBlock(headEl);
}

function openRecordBoardActionMenu(recordKey, blockEl) {
  const key = String(recordKey || '').trim();
  if (!key) return;
  selectedRecordBoardStudentName = key;
  const group = window.__olliRecordBoardGroups?.[key] || {};
  const displayName = group.studentName || group.displayName || key.replace(/^name:/, '').replace(/^id:/, '');
  clearRecordBoardSelection();
  if (blockEl) {
    blockEl.classList.add('studentRowSelected');
    setTimeout(() => {
      clearRecordBoardSelection();
    }, 260);
  }
  const title = document.getElementById('recordBoardActionTitle');
  if (title) title.textContent = `${displayName} 선택`;
  const overlay = document.getElementById('recordBoardActionOverlay');
  if (overlay) overlay.classList.add('show');
}

function closeRecordBoardActionMenu() {
  selectedRecordBoardStudentName = '';
  clearRecordBoardSelection();
  const overlay = document.getElementById('recordBoardActionOverlay');
  if (overlay) overlay.classList.remove('show');
}

function getRecordBoardGroupByKey(recordKey) {
  const key = String(recordKey || '').trim();
  if (!key) return null;
  const group = window.__olliRecordBoardGroups?.[key] || null;
  if (group) return { ...group, key };
  if (key.startsWith('id:')) return { key, studentId: key.slice(3), displayName: key.slice(3), studentName: '' };
  if (key.startsWith('name:')) return { key, studentId: '', displayName: key.slice(5), studentName: key.slice(5) };
  return { key: `name:${key}`, studentId: '', displayName: key, studentName: key };
}

function getOlliSoftDeleteActorId() {
  try {
    if (typeof getCurrentAcademyContext === 'function') {
      const context = getCurrentAcademyContext() || {};
      return String(context.memberId || context.userId || '').trim();
    }
  } catch {}
  return String(
    localStorage.getItem('olli_current_member_id') ||
    localStorage.getItem('olli_current_user_id') ||
    localStorage.getItem('olli_current_member_name') ||
    ''
  ).trim();
}

async function deleteRecordBoardRowsByStudentKey(recordKey) {
  const academyId = requireOlliAcademyId('기록보드 학생 삭제');
  const group = getRecordBoardGroupByKey(recordKey);
  if (!group) return;
  const studentId = String(group.studentId || '').trim();
  if (!studentId) throw new Error('학생코드가 없는 기록은 이름만으로 삭제하지 않습니다. 학생 목록에서 해당 학생을 선택해 주세요.');

  const deleteFeatures = [
    { feature: 'general_feedbacks_by_student_delete', table: 'feedbacks' },
    { feature: 'growth_feedbacks_by_student_delete', table: 'fail_feedbacks' },
    { feature: 'summary_feedbacks_by_student_delete', table: 'summary_feedbacks' }
  ];
  await Promise.all(deleteFeatures.map(item => {
    if (typeof deleteOlliData === 'function') {
      return deleteOlliData(item.feature, {
        academyId,
        studentId,
        forceCommon: true,
        deleteMode: 'soft',
        reason: 'student_deleted'
      }).catch(err => {
        console.warn(`${item.table} 기록 soft delete 대기:`, err.message || err);
      });
    }

    const err = new Error('deleteOlliData 공통 삭제 함수를 사용할 수 없어 피드백 삭제를 중단합니다. 직접 Supabase PATCH/DELETE fallback은 사용하지 않습니다.');
    if (typeof recordOlliStorageIssue === 'function') {
      recordOlliStorageIssue({
        feature: item.feature,
        resource: item.table,
        operation: 'soft_delete_common_missing',
        student_id: studentId,
        message: err.message,
        severity: 'error'
      });
    }
    console.warn(`${item.table} 기록 soft delete 공통 함수 없음:`, err.message);
    return Promise.reject(err);
  }));
}

async function deleteRecordBoardStudentByKey(recordKey) {
  const group = getRecordBoardGroupByKey(recordKey);
  if (!group) return;
  const studentId = String(group.studentId || '').trim();
  const name = String(group.studentName || group.displayName || '').trim();
  if (!studentId && !name) return;

  const matchedStudents = studentId
    ? getAllStudents().filter(student => String(student.id || '').trim() === studentId)
    : getAllStudents().filter(student => String(student.name || '').trim() === name);

  if (!studentId && matchedStudents.length > 1) {
    alert('같은 이름의 학생이 여러 명 있습니다. 학생코드가 있는 기록에서 다시 삭제해 주세요.');
    return;
  }

  const matchedIds = matchedStudents.map(student => String(student.id || '').trim()).filter(Boolean);

  if (matchedIds.length) {
    const matchedStudentMap = new Map(matchedStudents.map(student => [String(student.id || ''), student]));
    const successIds = [];
    const failed = [];
    for (const id of matchedIds) {
      try {
        await deactivateStudentInSupabase(id);
        successIds.push(String(id));
      } catch (err) {
        failed.push({ id: String(id), message: String(err && (err.message || err) || '알 수 없는 오류') });
      }
    }
    if (failed.length) {
      alert(`학생 삭제 서버 저장에 실패했습니다.\n기록보드와 출석부에서 숨기지 않고 그대로 유지합니다.\n저장 진단의 student_soft_delete 오류를 확인해 주세요.\n${failed[0].message}`);
      return;
    }
    if (successIds.length) {
      const idSet = new Set(successIds);
      successIds.forEach(id => backupAndRemoveStudentLocalData(id, matchedStudentMap.get(String(id)) || null));
      setAllStudents(getAllStudents().filter(item => !idSet.has(String(item.id))));
      successIds.forEach(id => unmarkDeletedStudentId(id));
    }
  }

  await deleteRecordBoardRowsByStudentKey(group.key || recordKey);

  if (currentMemoStudent && ((studentId && String(currentMemoStudent.id || '') === studentId) || (!studentId && String(currentMemoStudent.name || '').trim() === name))) {
    currentMemoStudent = null;
  }

  closeRecordBoardActionMenu();
  updateRecordHeaderUI();
  const searchValue = document.getElementById('searchName')?.value.trim() || '';
  await loadRecords(searchValue);
}

async function confirmDeleteRecordBoardSelected() {
  const key = String(selectedRecordBoardStudentName || '').trim();
  if (!key) return;
  const group = getRecordBoardGroupByKey(key);
  const displayName = group?.studentName || group?.displayName || key.replace(/^name:/, '').replace(/^id:/, '');
  const ok = confirm('삭제 시 통계에서 제외됩니다.\n실제 수업한 학생은 퇴원으로 처리해 주세요.');
  if (!ok) return;
  await deleteRecordBoardStudentByKey(key);
}


const OLLI_CONSULTATION_RULES_KEY = 'olli_consultation_rules_v1';
const OLLI_CONSULTATION_RULE_OPTIONS = [
  { key: 'after_1', label: '1개월 후', type: 'once', month: 1 },
  { key: 'after_3', label: '3개월 후', type: 'once', month: 3 },
  { key: 'every_6', label: '6개월마다', type: 'repeat', interval: 6 },
  { key: 'every_12', label: '12개월마다', type: 'repeat', interval: 12 }
];
const OLLI_DEFAULT_CONSULTATION_RULES = ['after_1','every_12'];
const OLLI_DEFAULT_CONSULTATION_RULES_BY_TYPE = {
  elementary: ['after_1','every_12'],
  kinder: ['after_1','every_6','every_12']
};

function getOlliConsultationRuleOptions(){
  return OLLI_CONSULTATION_RULE_OPTIONS.slice();
}

function normalizeOlliConsultationRules(value, fallbackRules){
  const valid = new Set(OLLI_CONSULTATION_RULE_OPTIONS.map(option => option.key));
  let raw = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch(e) { raw = raw.split(','); }
  }
  if (!Array.isArray(raw)) raw = [];
  const converted = raw.map(item => {
    if (typeof item === 'number') {
      if (item === 1) return 'after_1';
      if (item === 3) return 'after_3';
      if (item === 6) return 'every_6';
      if (item === 12) return 'every_12';
    }
    const str = String(item || '').trim();
    if (valid.has(str)) return str;
    if (str === '1') return 'after_1';
    if (str === '3') return 'after_3';
    if (str === '6') return 'every_6';
    if (str === '12') return 'every_12';
    return '';
  }).filter(Boolean);
  const unique = Array.from(new Set(converted)).filter(key => valid.has(key));
  const fallback = Array.isArray(fallbackRules) && fallbackRules.length ? fallbackRules : OLLI_DEFAULT_CONSULTATION_RULES;
  return unique.length ? unique : fallback.slice();
}

function getOlliConsultationDivisionKey(type){
  const raw = String(type || '').trim();
  if (raw === 'kinder' || raw === 'kindergarten' || raw === '유치부') return 'kinder';
  return 'elementary';
}

function getOlliDefaultConsultationRules(type){
  const key = getOlliConsultationDivisionKey(type);
  const fallback = OLLI_DEFAULT_CONSULTATION_RULES_BY_TYPE[key] || OLLI_DEFAULT_CONSULTATION_RULES_BY_TYPE.elementary || OLLI_DEFAULT_CONSULTATION_RULES;
  return fallback.slice();
}

function getOlliDefaultConsultationRulesMap(){
  return {
    elementary: getOlliDefaultConsultationRules('elementary'),
    kinder: getOlliDefaultConsultationRules('kinder')
  };
}

function normalizeOlliConsultationRulesByType(value){
  let raw = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch(e) { raw = raw.split(','); }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      elementary: normalizeOlliConsultationRules(raw.elementary || raw.elementaryRules || raw['초등부'], getOlliDefaultConsultationRules('elementary')),
      kinder: normalizeOlliConsultationRules(raw.kinder || raw.kindergarten || raw.kinderRules || raw['유치부'], getOlliDefaultConsultationRules('kinder'))
    };
  }
  if (raw == null || raw === '') return getOlliDefaultConsultationRulesMap();
  const normalized = normalizeOlliConsultationRules(raw, OLLI_DEFAULT_CONSULTATION_RULES);
  return { elementary: normalized.slice(), kinder: normalized.slice() };
}

const OLLI_SHARED_SETTINGS_TABLE = 'academy_settings';
const OLLI_SHARED_SETTINGS_KEY_CONSULTATION = 'consultation_rules';
const OLLI_SHARED_SETTINGS_KEY_GROUP_MONTHS = 'elementary_group_feedback_months';
const OLLI_CONSULTATION_PROGRESS_FEATURE = 'consultation_progress';
let olliSharedSettingsServerLoaded = false;
let olliSharedSettingsSaveTimer = null;

function getOlliSharedSettingLocalKey(settingKey) {
  const academyId = (typeof getOlliCurrentAcademyId === 'function') ? getOlliCurrentAcademyId() : '';
  return academyId ? `olli_shared_setting_${settingKey}_${academyId}` : `olli_shared_setting_${settingKey}`;
}

function readOlliSharedSettingLocal(settingKey, fallbackValue) {
  try {
    const raw = localStorage.getItem(getOlliSharedSettingLocalKey(settingKey));
    if (!raw) return fallbackValue;
    return JSON.parse(raw);
  } catch(e) {
    return fallbackValue;
  }
}

function writeOlliSharedSettingLocal(settingKey, value) {
  try {
    localStorage.setItem(getOlliSharedSettingLocalKey(settingKey), JSON.stringify(value));
  } catch(e) {
    console.warn('shared setting local save skipped:', settingKey, e);
  }
}

async function loadOlliSharedSettingsFromServer() {
  // 상담기준은 7단계부터, 그룹별 피드백 발송월은 8단계부터 공통 저장 구조 한 곳에서 처리합니다.
  // 9단계부터 academy_settings 직접 Supabase 조회 fallback은 사용하지 않습니다.
  const academyId = (typeof settingsGetAcademyId === 'function') ? settingsGetAcademyId() : ((typeof getOlliCurrentAcademyId === 'function') ? getOlliCurrentAcademyId() : '');
  if (!academyId) return false;

  if (typeof loadOlliData !== 'function') {
    recordOlliStorageIssue({
      feature: '그룹별 피드백 발송월',
      resource: OLLI_SHARED_SETTINGS_TABLE,
      operation: 'load',
      message: '공통 저장 불러오기 함수(loadOlliData)가 준비되지 않아 직접 Supabase fallback을 실행하지 않았습니다.'
    });
    return false;
  }

  try {
    const beforeMap = JSON.stringify(readElementaryGroupFeedbackMonthsMap());
    const request = loadOlliData('elementary_group_feedback_months', { academyId, backgroundRefresh: true });
    const localMap = normalizeElementaryGroupFeedbackMonthsMap(request.localData);
    if (Object.keys(localMap).length) writeElementaryGroupFeedbackMonthsMap(localMap, { skipServerSync: true });
    const refreshed = await request.refreshPromise;
    if (refreshed && refreshed.data) {
      const serverMap = normalizeElementaryGroupFeedbackMonthsMap(refreshed.data);
      writeElementaryGroupFeedbackMonthsMap(serverMap, { skipServerSync: true });
    }
    olliSharedSettingsServerLoaded = true;
    return beforeMap !== JSON.stringify(readElementaryGroupFeedbackMonthsMap());
  } catch(err) {
    recordOlliStorageIssue({ feature: '그룹별 피드백 발송월', resource: OLLI_SHARED_SETTINGS_TABLE, operation: 'load', message: err.message || err });
    console.warn('그룹별 피드백 발송월 공통 저장 불러오기 실패:', err.message || err);
    return false;
  }
}

async function saveOlliSharedSettingToServer(settingKey, value) {
  const academyId = (typeof settingsGetAcademyId === 'function') ? settingsGetAcademyId() : ((typeof getOlliCurrentAcademyId === 'function') ? getOlliCurrentAcademyId() : '');
  writeOlliSharedSettingLocal(settingKey, value);
  if (!academyId) return false;

  if (settingKey !== OLLI_SHARED_SETTINGS_KEY_GROUP_MONTHS) return false;

  if (typeof saveOlliData !== 'function') {
    recordOlliStorageIssue({
      feature: '그룹별 피드백 발송월',
      resource: OLLI_SHARED_SETTINGS_TABLE,
      operation: 'save',
      message: '공통 저장 함수(saveOlliData)가 준비되지 않아 직접 Supabase fallback을 실행하지 않았습니다.'
    });
    return false;
  }

  try {
    const normalized = normalizeElementaryGroupFeedbackMonthsMap(value);
    const result = await saveOlliData('elementary_group_feedback_months', {
      academyId,
      data: normalized,
      forceCommon: true
    });
    if (!result || !result.serverSaved || !result.verified) {
      throw new Error((result && (result.errorCode || (result.error && result.error.message))) || '공통 저장 검증 실패');
    }
    return true;
  } catch(err) {
    recordOlliStorageIssue({ feature: '그룹별 피드백 발송월', resource: OLLI_SHARED_SETTINGS_TABLE, operation: 'save', message: `${settingKey}: ${err.message || err}` });
    console.warn('그룹별 피드백 발송월 공통 저장 실패:', err.message || err);
    return false;
  }
}

function scheduleOlliSharedSettingSave(settingKey, value) {
  clearTimeout(olliSharedSettingsSaveTimer);
  olliSharedSettingsSaveTimer = setTimeout(() => {
    saveOlliSharedSettingToServer(settingKey, value);
  }, 450);
}

let olliConsultationRefreshPromise = null;
let olliConsultationLastRefreshAt = 0;
let olliConsultationAutoSyncTimer = null;

function getOlliConsultationAcademyId(){
  return String(
    ((typeof settingsGetAcademyId === 'function') ? settingsGetAcademyId() : '') ||
    ((typeof getOlliCurrentAcademyId === 'function') ? getOlliCurrentAcademyId() : '') ||
    ''
  ).trim();
}

function getOlliEffectiveStorageRole(){
  // 다학원 계정은 선택된 학원의 역할을 우선하며, 단일 학원 기존 로그인만 owner 플래그를 우선합니다.
  const explicitRole = String(localStorage.getItem('olli_current_member_role') || '').trim();
  const hasAccountSession = !!localStorage.getItem('olli_account_session_token_v1');
  if (hasAccountSession && ['super_admin', 'owner', 'manager', 'teacher'].includes(explicitRole)) {
    return explicitRole;
  }

  if (localStorage.getItem('olli_owner_logged_in') === 'true') {
    if (explicitRole !== 'owner') localStorage.setItem('olli_current_member_role', 'owner');
    return 'owner';
  }

  if (explicitRole === 'super_admin' || explicitRole === 'owner' || explicitRole === 'manager' || explicitRole === 'teacher') {
    return explicitRole;
  }

  if (typeof getOlliCurrentRole === 'function') {
    const appRole = String(getOlliCurrentRole() || '').trim();
    if (appRole === 'super_admin' || appRole === 'owner' || appRole === 'manager' || appRole === 'teacher') {
      return appRole;
    }
  }

  return localStorage.getItem('olli_teacher_logged_in') === 'true' ? 'teacher' : 'teacher';
}

function ensureOlliConsultationContext(){
  const academyId = getOlliConsultationAcademyId();
  if (!academyId) return '';
  const core = window.OlliStorageCore;
  if (core && core.AcademyContext) {
    const current = core.AcademyContext.getCurrent();
    const effectiveRole = getOlliEffectiveStorageRole();
    const needsUpdate = String(current.academyId || '') !== academyId || String(current.role || '') !== effectiveRole;
    if (needsUpdate) {
      core.AcademyContext.setCurrent({
        ...current,
        academyId,
        academyName: localStorage.getItem('olli_current_academy_name') || current.academyName || '',
        academyCode: localStorage.getItem('olli_current_academy_code') || current.academyCode || '',
        memberId: localStorage.getItem('olli_current_member_id') || current.memberId || '',
        memberName: localStorage.getItem('olli_current_member_name') || current.memberName || '',
        role: effectiveRole
      }, { persistLegacyKeys: false });
    }
  }
  return academyId;
}

function migrateOlliConsultationRulesOnce(){
  const academyId = ensureOlliConsultationContext();
  if (!academyId || typeof hasOlliLocal !== 'function' || typeof writeOlliLocal !== 'function') return;
  if (hasOlliLocal('consultation_rules', { academyId })) return;

  const legacyKeys = [
    `olli_shared_setting_${OLLI_SHARED_SETTINGS_KEY_CONSULTATION}_${academyId}`,
    OLLI_CONSULTATION_RULES_KEY,
    'olli_consultation_months_v1'
  ];
  let legacyValue = null;
  for (const key of legacyKeys) {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === '') continue;
    try { legacyValue = JSON.parse(raw); }
    catch(e) { legacyValue = raw; }
    break;
  }
  if (legacyValue == null) return;
  writeOlliLocal(
    'consultation_rules',
    { academyId },
    normalizeOlliConsultationRulesByType(legacyValue),
    { syncStatus: 'synced', lastSyncedAt: null, retryCount: 0 }
  );
}

function getOlliConsultationRules(type){
  const academyId = ensureOlliConsultationContext();
  if (!academyId || typeof readOlliLocal !== 'function') {
    return getOlliDefaultConsultationRules(type);
  }
  migrateOlliConsultationRulesOnce();
  const raw = readOlliLocal('consultation_rules', { academyId }, { fallback: getOlliDefaultConsultationRulesMap() });
  const map = normalizeOlliConsultationRulesByType(raw);
  return map[getOlliConsultationDivisionKey(type)] || getOlliDefaultConsultationRules(type);
}

function getOlliConsultationRulesMap(){
  const academyId = ensureOlliConsultationContext();
  if (!academyId || typeof readOlliLocal !== 'function') {
    return getOlliDefaultConsultationRulesMap();
  }
  migrateOlliConsultationRulesOnce();
  return normalizeOlliConsultationRulesByType(
    readOlliLocal('consultation_rules', { academyId }, { fallback: getOlliDefaultConsultationRulesMap() })
  );
}

function refreshOlliConsultationViews(){
  if (typeof updateOlliConsultationSettingUI === 'function') updateOlliConsultationSettingUI();
  if (typeof currentRecordView !== 'undefined' && currentRecordView === 'academy' && typeof renderRecordAcademyManagementDashboard === 'function') {
    renderRecordAcademyManagementDashboard();
  }
}

async function saveOlliConsultationRulesShared(rules){
  const academyId = ensureOlliConsultationContext();
  const normalized = normalizeOlliConsultationRulesByType(rules);
  if (!academyId || typeof saveOlliData !== 'function') return normalized;

  // saveOlliData는 서버 요청 전에 공통 학원별 로컬 캐시에 먼저 저장합니다.
  const savePromise = saveOlliData('consultation_rules', {
    academyId,
    data: normalized,
    forceCommon: true
  });
  refreshOlliConsultationViews();

  const result = await savePromise;
  if (!result || !result.serverSaved || !result.verified) {
    console.warn('상담기준은 로컬에 저장되었으며 서버 동기화를 다시 시도합니다.', result && (result.errorCode || result.error));
  }
  return normalized;
}

function saveOlliConsultationRules(rules){
  // 호환용 함수도 같은 공통 저장 경로만 사용합니다.
  return saveOlliConsultationRulesShared(rules);
}

async function loadOlliConsultationRulesFromServer(options = {}){
  const academyId = ensureOlliConsultationContext();
  if (!academyId || typeof loadOlliData !== 'function') return false;
  migrateOlliConsultationRulesOnce();

  const now = Date.now();
  if (!options.force && now - olliConsultationLastRefreshAt < 1200) return false;
  if (olliConsultationRefreshPromise) return olliConsultationRefreshPromise;

  olliConsultationLastRefreshAt = now;
  olliConsultationRefreshPromise = (async () => {
    const beforeRules = JSON.stringify(getOlliConsultationRulesMap());
    const request = loadOlliData('consultation_rules', { academyId, backgroundRefresh: true });
    const refreshed = await request.refreshPromise;

    if (refreshed && refreshed.protectedPending && request.localData) {
      // 로컬 변경이 서버보다 새로울 때만 한 번 재전송합니다.
      await saveOlliData('consultation_rules', {
        academyId,
        data: normalizeOlliConsultationRulesByType(request.localData),
        forceCommon: true
      });
    }

    // 같은 상담 기준을 다시 받은 것뿐이라면 목록 전체를 다시 그리지 않습니다.
    // 실제 기준이 바뀐 경우에만 상담예정 명단을 다시 생성합니다.
    const afterRules = JSON.stringify(getOlliConsultationRulesMap());
    if (beforeRules !== afterRules) refreshOlliConsultationViews();
    return beforeRules !== afterRules;
  })().catch(err => {
    console.warn('상담기준 불러오기 실패:', err && (err.message || err));
    return false;
  }).finally(() => {
    olliConsultationRefreshPromise = null;
  });

  return olliConsultationRefreshPromise;
}


let olliConsultationProgressRefreshPromise = null;
let olliConsultationProgressLastRefreshAt = 0;

function normalizeOlliConsultationProgress(value){
  let raw = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch(e) { raw = {}; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  const completedRaw = raw.completed && typeof raw.completed === 'object' && !Array.isArray(raw.completed)
    ? raw.completed
    : {};
  const completed = {};
  Object.keys(completedRaw).forEach(key => {
    const item = completedRaw[key];
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      completed[key] = {
        completed_at: String(item.completed_at || item.completedAt || ''),
        completed_month: String(item.completed_month || item.completedMonth || '')
      };
    } else if (item) {
      completed[key] = { completed_at: '', completed_month: '' };
    }
  });
  const todosRaw = Array.isArray(raw.todos) ? raw.todos : [];
  const todos = todosRaw.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const text = String(item.text || '').trim().slice(0, 80);
    if (!text) return null;
    return {
      id: String(item.id || `todo_legacy_${index}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80),
      text,
      completed: !!item.completed,
      created_at: String(item.created_at || item.createdAt || ''),
      completed_at: String(item.completed_at || item.completedAt || '')
    };
  }).filter(Boolean).slice(0, 100);
  return {
    version: 1,
    tracking_started_month: String(raw.tracking_started_month || raw.trackingStartedMonth || ''),
    completed,
    todos
  };
}

function getOlliConsultationProgressMirrorKey(academyId){
  const safeAcademyId = String(academyId || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '_');
  return `olli_consultation_progress_mirror_v1_${safeAcademyId || 'unknown'}`;
}

function readOlliConsultationProgressMirror(academyId){
  if (!academyId) return normalizeOlliConsultationProgress({});
  try {
    const raw = localStorage.getItem(getOlliConsultationProgressMirrorKey(academyId));
    return normalizeOlliConsultationProgress(raw ? JSON.parse(raw) : {});
  } catch(e) {
    return normalizeOlliConsultationProgress({});
  }
}

function writeOlliConsultationProgressMirror(academyId, progress){
  const normalized = normalizeOlliConsultationProgress(progress);
  if (!academyId) return normalized;
  try {
    localStorage.setItem(getOlliConsultationProgressMirrorKey(academyId), JSON.stringify(normalized));
  } catch(e) {}
  return normalized;
}

function hasOlliConsultationProgressData(progress){
  if (!progress || typeof progress !== 'object') return false;
  if (String(progress.tracking_started_month || '').trim()) return true;
  return !!(progress.completed && typeof progress.completed === 'object' && Object.keys(progress.completed).length);
}

function getOlliConsultationProgress(){
  const academyId = ensureOlliConsultationContext();
  if (!academyId) return normalizeOlliConsultationProgress({});

  // 학원관리 화면은 Supabase 응답을 기다리지 않고 로컬 미러를 먼저 사용할 수 있습니다.
  const mirror = readOlliConsultationProgressMirror(academyId);
  if (typeof readOlliLocal !== 'function') return mirror;

  try {
    const storageProgress = normalizeOlliConsultationProgress(
      readOlliLocal(OLLI_CONSULTATION_PROGRESS_FEATURE, { academyId }, { fallback: {} })
    );
    if (hasOlliConsultationProgressData(storageProgress)) {
      writeOlliConsultationProgressMirror(academyId, storageProgress);
      return storageProgress;
    }
  } catch(e) {}
  return mirror;
}

function writeOlliConsultationProgressLocal(progress, syncStatus = 'pending'){
  const academyId = ensureOlliConsultationContext();
  const normalized = normalizeOlliConsultationProgress(progress);
  if (!academyId) return normalized;

  // 화면 재진입 시 서버 조회 전에도 상담 완료 상태를 즉시 복원하기 위한 동기 로컬 미러입니다.
  writeOlliConsultationProgressMirror(academyId, normalized);

  if (typeof writeOlliLocal === 'function') {
    writeOlliLocal(
      OLLI_CONSULTATION_PROGRESS_FEATURE,
      { academyId },
      normalized,
      { syncStatus, lastSyncedAt: syncStatus === 'synced' ? new Date().toISOString() : null, retryCount: 0 }
    );
  }
  return normalized;
}

function ensureOlliConsultationProgressTrackingStart(progress){
  const normalized = normalizeOlliConsultationProgress(progress);
  if (!normalized.tracking_started_month) {
    normalized.tracking_started_month = getAcademyConsultationMonthKey();
  }
  return normalized;
}

async function saveOlliConsultationProgressShared(progress){
  const academyId = ensureOlliConsultationContext();
  const normalized = ensureOlliConsultationProgressTrackingStart(progress);
  writeOlliConsultationProgressLocal(normalized, 'pending');
  if (typeof currentRecordView !== 'undefined' && currentRecordView === 'academy') {
    if (document.body?.classList?.contains('olliPcApp') && typeof window.pcRefreshAcademyConsultationCompletionState === 'function') {
      window.pcRefreshAcademyConsultationCompletionState();
    } else if (typeof renderRecordAcademyManagementDashboard === 'function') {
      renderRecordAcademyManagementDashboard();
    }
  }
  if (!academyId || typeof saveOlliData !== 'function') return normalized;

  try {
    const result = await saveOlliData(OLLI_CONSULTATION_PROGRESS_FEATURE, {
      academyId,
      data: normalized,
      forceCommon: true
    });
    if (!result || !result.serverSaved || !result.verified) {
      console.warn('상담 진행상태는 로컬에 저장되었으며 서버 동기화를 다시 시도합니다.', result && (result.errorCode || result.error));
    }
  } catch(err) {
    console.warn('상담 진행상태 서버 저장 실패:', err && (err.message || err));
  }
  return normalized;
}

async function loadOlliConsultationProgressFromServer(options = {}){
  const academyId = ensureOlliConsultationContext();
  if (!academyId || typeof loadOlliData !== 'function') return false;

  const now = Date.now();
  if (!options.force && now - olliConsultationProgressLastRefreshAt < 1200) return false;
  if (olliConsultationProgressRefreshPromise) return olliConsultationProgressRefreshPromise;

  olliConsultationProgressLastRefreshAt = now;
  olliConsultationProgressRefreshPromise = (async () => {
    const beforeProgress = JSON.stringify(getOlliConsultationProgress());
    const request = loadOlliData(OLLI_CONSULTATION_PROGRESS_FEATURE, { academyId, backgroundRefresh: true });
    const refreshed = await request.refreshPromise;
    let progress = getOlliConsultationProgress();
    writeOlliConsultationProgressMirror(academyId, progress);

    if (!progress.tracking_started_month) {
      progress = ensureOlliConsultationProgressTrackingStart(progress);
      await saveOlliConsultationProgressShared(progress);
    } else if (refreshed && refreshed.protectedPending && request.localData) {
      await saveOlliData(OLLI_CONSULTATION_PROGRESS_FEATURE, {
        academyId,
        data: normalizeOlliConsultationProgress(request.localData),
        forceCommon: true
      });
    }

    const changed = beforeProgress !== JSON.stringify(getOlliConsultationProgress());
    if (changed && typeof currentRecordView !== 'undefined' && currentRecordView === 'academy') {
      if (document.body?.classList?.contains('olliPcApp') && typeof window.pcRefreshAcademyConsultationCompletionState === 'function') {
        window.pcRefreshAcademyConsultationCompletionState();
      } else if (typeof renderRecordAcademyManagementDashboard === 'function') {
        renderRecordAcademyManagementDashboard();
      }
    }
    return changed;
  })().catch(err => {
    console.warn('상담 진행상태 불러오기 실패:', err && (err.message || err));
    // 서버 컬럼이 아직 준비되지 않은 경우에도 현재 기기의 이월 기능은 유지합니다.
    let progress = getOlliConsultationProgress();
    if (!progress.tracking_started_month) {
      progress = ensureOlliConsultationProgressTrackingStart(progress);
      writeOlliConsultationProgressLocal(progress, 'pending');
    }
    return false;
  }).finally(() => {
    olliConsultationProgressRefreshPromise = null;
  });

  return olliConsultationProgressRefreshPromise;
}

function bindOlliConsultationSyncOnce(){
  if (window.__olliConsultationSyncBound) return;
  window.__olliConsultationSyncBound = true;

  try {
    const core = window.OlliStorageCore;
    if (core && core.FeatureFlags) {
      core.FeatureFlags.set('consultation_rules', 'common');
      core.FeatureFlags.set(OLLI_CONSULTATION_PROGRESS_FEATURE, 'common');
    }
  } catch(e) {
    console.warn('상담 공통 저장 모드 설정 실패:', e);
  }

  const refresh = () => Promise.all([
    loadOlliConsultationRulesFromServer({ force: true }),
    loadOlliConsultationProgressFromServer({ force: true })
  ]);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);

  clearInterval(olliConsultationAutoSyncTimer);
  olliConsultationAutoSyncTimer = setInterval(() => {
    const settingsVisible = document.getElementById('settingsPageScreen')?.style.display === 'flex';
    const academyVisible = typeof currentRecordView !== 'undefined' && currentRecordView === 'academy';
    if (settingsVisible || academyVisible) {
      loadOlliConsultationRulesFromServer();
      loadOlliConsultationProgressFromServer();
    }
  }, 30000);

  loadOlliConsultationRulesFromServer({ force: true });
  loadOlliConsultationProgressFromServer({ force: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindOlliConsultationSyncOnce, { once: true });
} else {
  setTimeout(bindOlliConsultationSyncOnce, 0);
}

function bindOlliGroupFeedbackMonthsSyncOnce(){
  if (window.__olliGroupFeedbackMonthsSyncBound) return;
  window.__olliGroupFeedbackMonthsSyncBound = true;

  try {
    const core = window.OlliStorageCore;
    if (core && core.FeatureFlags) core.FeatureFlags.set('elementary_group_feedback_months', 'common');
  } catch(e) {
    console.warn('그룹별 피드백 발송월 공통 저장 모드 설정 실패:', e);
  }

  const refresh = () => {
    if (typeof loadOlliSharedSettingsFromServer === 'function') loadOlliSharedSettingsFromServer();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
  setTimeout(refresh, 0);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindOlliGroupFeedbackMonthsSyncOnce, { once: true });
} else {
  setTimeout(bindOlliGroupFeedbackMonthsSyncOnce, 0);
}

function getOlliConsultationRuleLabel(key){
  const option = OLLI_CONSULTATION_RULE_OPTIONS.find(item => item.key === key);
  return option ? option.label : '';
}

function getOlliConsultationRuleShortLabel(label){
  return String(label || '').replace(/(후|마다)$/,'');
}

function getOlliConsultationRulesLabel(type){
  if (type) return getOlliConsultationRules(type).map(getOlliConsultationRuleLabel).filter(Boolean).join(', ');
  const elementary = getOlliConsultationRulesLabel('elementary') || '미설정';
  const kinder = getOlliConsultationRulesLabel('kinder') || '미설정';
  return `초등부 ${elementary} / 유치부 ${kinder}`;
}

function monthsBetweenByCalendar(start, end){
  if (!(start instanceof Date) || isNaN(start.getTime()) || !(end instanceof Date) || isNaN(end.getTime())) return NaN;
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

function getConsultationMonthIndex(monthKey){
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return NaN;
  return Number(match[1]) * 12 + (Number(match[2]) - 1);
}

function getConsultationTaskKey(student, ruleKey, dueMonth){
  const studentPart = student?.id
    ? `id:${student.id}`
    : `name:${String(student?.name || '').trim()}`;
  return `${studentPart}|${String(ruleKey || '')}|${String(dueMonth || '')}`;
}

function getConsultationCompletedItem(taskKey, progress = getOlliConsultationProgress()){
  return progress?.completed?.[taskKey] || null;
}

function getConsultationDueTasksForStudent(student, referenceDate = new Date()){
  if (getStudentStatus(student) !== 'active') return [];
  const enrolled = getStudentEnrollmentDateForStats(student);
  if (!enrolled) return [];

  const now = referenceDate instanceof Date && !isNaN(referenceDate.getTime()) ? referenceDate : new Date();
  const currentMonth = getAcademyConsultationMonthKey(now);
  const currentIndex = getConsultationMonthIndex(currentMonth);
  const progress = getOlliConsultationProgress();
  const trackingStart = progress.tracking_started_month || currentMonth;
  const trackingStartIndex = getConsultationMonthIndex(trackingStart);
  const elapsedMonths = monthsBetweenByCalendar(enrolled, now);
  const activeKeys = new Set(getOlliConsultationRules(student?.type));
  const tasks = [];

  const pushTask = (option, dueDate, occurrenceMonths) => {
    const dueMonth = getAcademyConsultationMonthKey(dueDate);
    const dueIndex = getConsultationMonthIndex(dueMonth);
    if (!Number.isFinite(dueIndex) || dueIndex > currentIndex) return;
    // 기능 적용 이전 달의 과거 상담을 한꺼번에 미완료로 만들지 않습니다.
    if (Number.isFinite(trackingStartIndex) && dueIndex < trackingStartIndex) return;
    const taskKey = getConsultationTaskKey(student, option.key, dueMonth);
    const completedItem = getConsultationCompletedItem(taskKey, progress);
    const completedMonth = String(completedItem?.completed_month || '');
    const isCurrentDue = dueMonth === currentMonth;
    const completedThisMonth = completedMonth === currentMonth;
    // 현재 달 상담은 완료 후에도 검정 버튼 상태를 확인할 수 있게 이번 달 동안 유지합니다.
    if (!isCurrentDue && completedItem && !completedThisMonth) return;
    tasks.push({
      key: taskKey,
      ruleKey: option.key,
      label: option.label,
      dueMonth,
      occurrenceMonths: Number(occurrenceMonths) || 0,
      completed: !!completedItem,
      completedMonth
    });
  };

  OLLI_CONSULTATION_RULE_OPTIONS.forEach(option => {
    if (!activeKeys.has(option.key)) return;
    if (option.type === 'once') {
      pushTask(option, addMonthsSafe(enrolled, option.month), option.month);
      return;
    }
    if (option.type === 'repeat' && elapsedMonths >= option.interval) {
      for (let occurrence = option.interval; occurrence <= elapsedMonths; occurrence += option.interval) {
        pushTask(option, addMonthsSafe(enrolled, occurrence), occurrence);
      }
    }
  });

  return tasks.sort((a, b) => {
    const monthDiff = getConsultationMonthIndex(a.dueMonth) - getConsultationMonthIndex(b.dueMonth);
    if (monthDiff) return monthDiff;
    return a.occurrenceMonths - b.occurrenceMonths;
  });
}

function getDueConsultationRuleLabelsForStudent(student){
  return Array.from(new Set(getConsultationDueTasksForStudent(student).map(task => task.label).filter(Boolean)));
}

function isAcademyConsultationCompletedForCurrentList(student){
  const tasks = getConsultationDueTasksForStudent(student);
  return tasks.length > 0 && tasks.every(task => task.completed);
}

async function toggleAcademyConsultationCompleted(studentRef, event){
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const role = typeof getOlliEffectiveStorageRole === 'function' ? getOlliEffectiveStorageRole() : '';
  if (!['owner','manager','super_admin'].includes(role)) {
    if (typeof showPushToast === 'function') showPushToast('상담 완료 선택은 원장 또는 관리자만 변경할 수 있어요.');
    return;
  }
  const ref = String(studentRef || '');
  const students = getAcademyManagementStudentsForStats();
  const student = ref.startsWith('id:')
    ? students.find(item => String(item.id || '') === ref.slice(3))
    : (ref.startsWith('name:')
      ? students.find(item => String(item.name || '').trim() === ref.slice(5).trim())
      : null);
  if (!student) return;
  const tasks = getConsultationDueTasksForStudent(student);
  if (!tasks.length) return;

  const progress = ensureOlliConsultationProgressTrackingStart(getOlliConsultationProgress());
  const nextCompleted = { ...(progress.completed || {}) };
  const shouldComplete = !tasks.every(task => !!nextCompleted[task.key]);

  // 서버 응답을 기다리지 않고 사용자가 누른 즉시 현재 버튼 상태를 먼저 반영합니다.
  const pressedBtn = event?.currentTarget || null;
  if (pressedBtn) {
    pressedBtn.classList.toggle('active', shouldComplete);
    pressedBtn.setAttribute('aria-pressed', shouldComplete ? 'true' : 'false');
    pressedBtn.disabled = true;
  }

  if (shouldComplete) {
    const completedAt = new Date().toISOString();
    const completedMonth = getAcademyConsultationMonthKey();
    tasks.forEach(task => {
      nextCompleted[task.key] = {
        completed_at: completedAt,
        completed_month: completedMonth
      };
    });
  } else {
    tasks.forEach(task => { delete nextCompleted[task.key]; });
  }

  await saveOlliConsultationProgressShared({
    ...progress,
    completed: nextCompleted
  });
  if (pressedBtn && pressedBtn.isConnected) pressedBtn.disabled = false;
  if (typeof showPushToast === 'function') {
    showPushToast(shouldComplete ? `${student.name} 상담을 완료로 표시했어요.` : `${student.name} 상담 완료 표시를 취소했어요.`);
  }
}

window.toggleAcademyConsultationCompleted = toggleAcademyConsultationCompleted;

function updateOlliConsultationSettingUI(){
  const value = document.getElementById('settingsConsultationMonthsValue');
  if (value) value.textContent = getOlliConsultationRulesLabel() || '미설정';
  ['elementary','kinder'].forEach(type => {
    const selected = new Set(getOlliConsultationRules(type));
    document.querySelectorAll(`[data-consultation-type="${type}"][data-consultation-rule]`).forEach(btn => {
      btn.classList.toggle('active', selected.has(btn.getAttribute('data-consultation-rule')));
    });
  });
}

function getSettingsConsultationActiveLabels(type){
  return Array.from(document.querySelectorAll(`[data-consultation-type="${type}"][data-consultation-rule].active`))
    .map(item => getOlliConsultationRuleLabel(item.getAttribute('data-consultation-rule')))
    .filter(Boolean);
}

function toggleSettingsConsultationRuleOption(key, type){
  if (typeof canEditOlliConsultationSettings === 'function' && !canEditOlliConsultationSettings()) return;
  const targetKey = String(key || '');
  const targetType = getOlliConsultationDivisionKey(type);
  const btn = Array.from(document.querySelectorAll(`[data-consultation-type="${targetType}"][data-consultation-rule]`))
    .find(item => item.getAttribute('data-consultation-rule') === targetKey);
  if (!btn) return;
  btn.classList.toggle('active');
  const value = document.getElementById('settingsConsultationMonthsValue');
  if (value) {
    const elementary = getSettingsConsultationActiveLabels('elementary').join(', ') || '미설정';
    const kinder = getSettingsConsultationActiveLabels('kinder').join(', ') || '미설정';
    value.textContent = `초등부 ${elementary} / 유치부 ${kinder}`;
  }
}

function toggleSettingsConsultationMonthOption(month, type){
  const mapped = month === 1 ? 'after_1' : month === 3 ? 'after_3' : month === 6 ? 'every_6' : month === 12 ? 'every_12' : '';
  if (mapped) toggleSettingsConsultationRuleOption(mapped, type || 'elementary');
}


function isCurrentMonthYear(date){
  if (!(date instanceof Date) || isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function isCurrentYearDate(date){
  if (!(date instanceof Date) || isNaN(date.getTime())) return false;
  return date.getFullYear() === new Date().getFullYear();
}

function addMonthsSafe(date, months){
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

function getStudentEnrollmentDateForStats(student){
  const raw = getEnrolledAtFromStudent(student);
  if (!raw) return null;
  const date = new Date(String(raw).replace(/\./g, '-'));
  return isNaN(date.getTime()) ? null : date;
}

function getStudentWithdrawalDateForStats(student){
  const raw = student?.withdrawn_at || student?.withdrawal_at || student?.quit_at || student?.status_changed_at || student?.inactive_at || student?.deleted_at || student?.updated_at || '';
  if (!raw) return null;
  const date = new Date(String(raw).replace(/\./g, '-'));
  return isNaN(date.getTime()) ? null : date;
}

function getAcademyManagementStudentsForStats(){
  try {
    const academyId = getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : '';
    const pendingStatusMap = (typeof getPendingStudentStatusMap === 'function') ? getPendingStudentStatusMap() : {};
    return getAllStudents()
      .filter(item => {
        const rawType = String(item?.type || item?.division || '').trim();
        return rawType === 'elementary' || rawType === 'kinder';
      })
      .map(item => {
        const student = normalizeStudentObject({ ...item, academy_id: item?.academy_id || academyId }, item?.type || item?.division);
        const pendingState = pendingStatusMap[String(student.id || '')] || null;
        if (pendingState) {
          return normalizeStudentObject({
            ...student,
            status: pendingState.status || student.status || 'active',
            withdrawn_at: pendingState.withdrawn_at || '',
            paused_at: pendingState.paused_at || '',
            status_changed_at: pendingState.status_changed_at || student.status_changed_at || ''
          }, student.type || 'elementary');
        }
        return student;
      })
      .filter(student => !academyId || !student.academy_id || student.academy_id === academyId)
      .filter(student => !isOlliSoftDeletedRow(student));
  } catch {
    return [];
  }
}
function isAcademyManagementActiveStudent(student){
  return (student?.type === 'elementary' || student?.type === 'kinder') && getStudentStatus(student) === 'active';
}

function getThisMonthConsultationDueStudents(students){
  return (Array.isArray(students) ? students : [])
    .filter(isAcademyManagementActiveStudent)
    .filter(student => getDueConsultationRuleLabelsForStudent(student).length > 0);
}

function renderRecordAcademyManagementDashboard(){
  if (window.OlliPcStudentManagement && typeof window.OlliPcStudentManagement.renderDashboard === 'function') {
    window.OlliPcStudentManagement.renderDashboard();
  }
}

async function openRecordAttendanceDashboard(){
  studentSelectionMode = false;
  selectedStudentIds.clear();
  const targetView = (currentObservationView === 'kinder') ? 'kinder' : 'elementary';
  currentObservationView = targetView;
  currentRecordView = targetView;
  setObservationButtonSide(targetView, false);
  updateRecordHeaderUI();
  if (typeof window.refreshRecordSortPopup === 'function') setTimeout(window.refreshRecordSortPopup, 0);
  await loadRecords('');
  
}

function renderCurrentStudentRecords(name) {
  const shell = document.getElementById('olliPcShell');
  const usePcPersonalityRecords = shell?.dataset.pcSection === 'attendance'
    && (!window.matchMedia || window.matchMedia('(min-width: 900px)').matches)
    && window.OlliPcPersonalityRecords
    && typeof window.OlliPcPersonalityRecords.renderList === 'function';
  if (usePcPersonalityRecords) {
    window.OlliPcPersonalityRecords.renderList(name);
    return;
  }
  if (currentRecordView === 'kinder') renderKinderRecords(name);
  else renderElementaryRecords(name);
}

async function toggleRecordAcademyManagementMode(){
  if (typeof canAccessOlliStartPageAcademyManagement === 'function' && !canAccessOlliStartPageAcademyManagement()) {
    if (currentRecordView === 'academy') {
      currentRecordView = currentObservationView === 'kinder' ? 'kinder' : 'elementary';
      updateRecordHeaderUI();
      await loadRecords('');
      
    }
    return;
  }
  studentSelectionMode = false;
  selectedStudentIds.clear();
  if (currentRecordView === 'elementary' || currentRecordView === 'kinder') currentObservationView = currentRecordView;
  currentRecordView = 'academy';
  updateRecordHeaderUI();
  await loadRecords('');
  
}

async function loadRecords(name) {
  const list = document.getElementById('recordList');
  // 학생 목록 화면에서는 Supabase 로딩 문구를 띄우지 않습니다.
  // 먼저 각 기기의 로컬 캐시 학생 목록을 보여주고, Supabase 동기화가 끝나면 같은 자리에서 조용히 갱신합니다.
  if (!getOlliCurrentAcademyId()) {
    list.innerHTML = '<div class="recordEmpty">현재 학원 ID가 없어 기록을 불러올 수 없습니다.<br>다시 로그인해 주세요.</div>';
    return;
  }

  if (currentRecordView === 'attendance') {
    currentRecordView = currentObservationView === 'kinder' ? 'kinder' : 'elementary';
    updateRecordHeaderUI();
  }

  if (currentRecordView === 'academy') {
    renderRecordAcademyManagementDashboard();
    const academyLoadToken = ++academyManagementLoadToken;
    const settingsPromise = Promise.all([
      (typeof loadOlliSharedSettingsFromServer === 'function') ? loadOlliSharedSettingsFromServer() : Promise.resolve(false),
      (typeof loadOlliConsultationRulesFromServer === 'function') ? loadOlliConsultationRulesFromServer({ force: true }) : Promise.resolve(false),
      (typeof loadOlliConsultationProgressFromServer === 'function') ? loadOlliConsultationProgressFromServer({ force: true }) : Promise.resolve(false)
    ]).then(results => results.some(result => result === true || result?.changed === true)).catch(() => false);
    const studentsPromise = loadStudentsFromSupabase().then(result => !!result?.changed).catch(err => {
      console.warn('학원관리 학생 동기화 실패:', err);
      return false;
    });
    Promise.all([settingsPromise, studentsPromise]).then(([settingsChanged, studentsChanged]) => {
      if (currentRecordView !== 'academy') return;
      if (academyLoadToken !== academyManagementLoadToken) return;
      if (!settingsChanged && !studentsChanged) return;
      renderRecordAcademyManagementDashboard();
      scheduleAcademyConsultationSummaryAutoCheck(900);
    }).catch(() => {});
    return;
  }


  if (currentRecordView === 'elementary') {
    const requestedView = currentRecordView;
    renderCurrentStudentRecords(name);
    loadStudentsFromSupabase().then(result => {
      if (currentRecordView !== requestedView || result?.changed !== true) return;
      renderCurrentStudentRecords(name);
    }).catch(err => console.warn('초등부 학생 백그라운드 동기화 실패:', err));
    return;
  }

  if (currentRecordView === 'kinder') {
    const requestedView = currentRecordView;
    renderCurrentStudentRecords(name);
    loadStudentsFromSupabase().then(result => {
      if (currentRecordView !== requestedView || result?.changed !== true) return;
      renderCurrentStudentRecords(name);
    }).catch(err => console.warn('유치부 학생 백그라운드 동기화 실패:', err));
    return;
  }

  const academyId = requireOlliAcademyId('기록 조회');
  let feedbackPath = `feedbacks?academy_id=eq.${encodeURIComponent(academyId)}&order=id.desc&limit=500`;
  let failFeedbackPath = `fail_feedbacks?academy_id=eq.${encodeURIComponent(academyId)}&order=id.desc&limit=500`;
  let summaryPath = `summary_feedbacks?academy_id=eq.${encodeURIComponent(academyId)}&order=id.desc&limit=500`;
  if (name) {
    const encodedName = encodeURIComponent(name);
    feedbackPath += `&student_name=ilike.*${encodedName}*`;
    failFeedbackPath += `&student_name=ilike.*${encodedName}*`;
    summaryPath += `&student_name=ilike.*${encodedName}*`;
  }

  try {
    let rawData = [];
    let sourceTableName = 'feedbacks';

    if (currentRecordMode === 'summary') {
      rawData = await supabase('GET', summaryPath);
      sourceTableName = 'summary_feedbacks';
    } else if (currentRecordMode === 'fail') {
      rawData = await supabase('GET', failFeedbackPath);
      sourceTableName = 'fail_feedbacks';
    } else {
      rawData = await supabase('GET', feedbackPath);
      sourceTableName = 'feedbacks';
    }

    if (!Array.isArray(rawData)) { list.innerHTML = '<div class="recordEmpty">오류가 발생했습니다.</div>'; return; }

    const normalized = filterOlliActiveRows(rawData).map(item => ({
      ...item,
      source_table: sourceTableName,
      feedback_type: sourceTableName === 'fail_feedbacks' ? 'fail' : (item.feedback_type || (sourceTableName === 'summary_feedbacks' ? 'summary' : 'class'))
    }));
    const filtered = currentRecordMode === 'summary' || currentRecordMode === 'fail'
      ? normalized
      : normalized.filter(r => String(r.feedback_type || 'class').toLowerCase() === currentRecordMode);

    if (!filtered.length) { list.innerHTML = '<div class="recordEmpty">저장된 피드백이 없습니다.</div>'; return; }

    const grouped = {};
    filtered.forEach(r => {
      const studentId = String(r.student_id || '').trim();
      const studentName = String(r.student_name || '').trim() || '이름 없음';
      const recordKey = studentId ? `id:${studentId}` : `name:${studentName}`;
      const year = r.year || new Date().getFullYear();
      if (!grouped[recordKey]) grouped[recordKey] = { key: recordKey, studentId, studentName, displayName: studentName, years: {}, all: [] };
      if (!grouped[recordKey].years[year]) grouped[recordKey].years[year] = [];
      grouped[recordKey].years[year].push(r);
      grouped[recordKey].all.push(r);
    });

    const allStudents = getAllStudents();
    Object.keys(grouped).forEach(recordKey => {
      const group = grouped[recordKey];
      const matchedStudent = group.studentId
        ? allStudents.find(student => String(student.id || '').trim() === group.studentId)
        : allStudents.find(student => String(student.name || '').trim() === String(group.studentName || '').trim());
      if (matchedStudent) {
        group.studentName = matchedStudent.name || group.studentName;
        group.displayName = matchedStudent.name || group.displayName;
        group.studentType = matchedStudent.type || '';
        group.student = matchedStudent;
      }
    });
    window.__olliRecordBoardGroups = grouped;

    list.innerHTML = Object.keys(grouped).sort((a, b) => String(grouped[a].displayName || '').localeCompare(String(grouped[b].displayName || ''), 'ko')).map(recordKey => {
      const group = grouped[recordKey];
      const sname = group.displayName || group.studentName || '이름 없음';
      const encodedKey = escapeTemplateLiteral(recordKey);
      const encodedName = escapeTemplateLiteral(sname);
      const encodedRecords = encodeURIComponent(JSON.stringify(group.all));
      const matchedStudent = group.student || null;
      const isKinder = matchedStudent?.type === 'kinder';
      const metaBits = matchedStudent
        ? (isKinder
          ? [getKinderMetaText(matchedStudent)].filter(Boolean)
          : [getElementaryMetaText(matchedStudent), getStudentStatusLabel(matchedStudent)].filter(Boolean))
        : [];

      const leadIcon = renderRecordBoardLeadIcon();

      const summaryButtons = currentRecordMode === 'summary'
        ? ''
        : `<button class="recordSummaryBtn" onclick="event.stopPropagation(); requestSummaryFeedbackFromRecords('${encodedName}', '${encodedRecords}', 6)">6</button><button class="recordSummaryBtn" onclick="event.stopPropagation(); requestSummaryFeedbackFromRecords('${encodedName}', '${encodedRecords}', 12)">12</button>`;

      return `
      <div class="recordStudentBlock savedFeedbackStudentBlock">
        <div class="recordStudentHead savedFeedbackStudentHead" onclick="handleRecordBoardHeadClick(event,this)" onpointerdown="startRecordBoardLongPress(event,'${encodedKey}')" onpointermove="moveRecordBoardLongPress(event)" onpointerup="cancelRecordBoardLongPress()" onpointercancel="cancelRecordBoardLongPress()" oncontextmenu="event.preventDefault()">
          <div class="recordStudentLeft savedFeedbackStudentLeft">
            ${leadIcon}
            <span class="studentTextWrap">
              <span class="recordStudentName">${escapeHtml(sname)}</span>
              ${metaBits.length ? `<span class="studentMetaText">${escapeHtml(metaBits.join('  |  '))}</span>` : ''}
            </span>
          </div>
          <div class="recordStudentActions" onclick="event.stopPropagation()">
            <button class="recordHeadIconBtn" onclick="copyStudentFeedback(this, '${encodedName}', '${encodedRecords}')" title="복사">${copyIconSvg()}</button>
            ${summaryButtons}
          </div>
        </div>
        <div class="recordStudentContent">
          ${Object.keys(group.years).sort((a, b) => Number(b) - Number(a)).map(year => `
            <div class="recordYearBlock">
              <div class="recordYearLabel">${year}년</div>
              ${group.years[year].map(r => `
                <div class="recordItem">
                  <div class="recordDate">${escapeHtml(String(r.date || ''))}</div>
                  <div class="recordText">${escapeHtml(String(r.content || ''))}</div>
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="recordEmpty">${escapeHtml(err.message || '오류가 발생했습니다.')}</div>`;
  }
}


let elementaryInfoDraft = { group: '', personality: '' };
let kinderInfoDraft = { personality: '' };

function openCurrentStudentInfoModal() {
  if (!currentMemoStudent) return;
  if (currentMemoType === 'kinder') openKinderInfoModal();
  else openElementaryInfoModal();
}

function renderElementaryGroupMonthButtons(containerId, group, setterName) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const groupKey = String(group || '').trim();
  if (!groupKey) {
    el.innerHTML = '<div class="infoMonthEmpty">그룹을 먼저 선택해 주세요.</div>';
    return;
  }
  const selected = new Set(getElementaryGroupFeedbackMonths(groupKey));
  el.innerHTML = ELEMENTARY_GROUP_MONTH_VALUES.map(month => `<button type="button" class="infoDayBtn ${selected.has(month) ? 'active' : ''}" onclick="${setterName}(${month})">${month}월</button>`).join('');
}

function syncElementaryInfoButtons() {
  document.querySelectorAll('#elementaryGroupToggleRow .infoToggleBtn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.group === elementaryInfoDraft.group);
  });
  document.querySelectorAll('#elementaryPersonalityToggleRow .infoToggleBtn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.personality === elementaryInfoDraft.personality);
  });
}

function selectElementaryGroup(group) {
  elementaryInfoDraft.group = elementaryInfoDraft.group === group ? '' : group;
  syncElementaryInfoButtons();
}

function toggleElementaryInfoGroupMonth(month) {
  if (!elementaryInfoDraft.group) {
    alert('먼저 그룹을 선택해 주세요.');
    return;
  }
  toggleElementaryGroupFeedbackMonth(elementaryInfoDraft.group, month);
  syncElementaryInfoButtons();
}

function selectElementaryPersonality(personality) {
  elementaryInfoDraft.personality = elementaryInfoDraft.personality === personality ? '' : personality;
  if (window.__olliPersonalityDropdownOpen) window.__olliPersonalityDropdownOpen.elementaryPersonalityToggleRow = false;
  syncElementaryInfoButtons();
  if (typeof window.refreshStudentModalPersonalityDropdowns === 'function') window.refreshStudentModalPersonalityDropdowns();
}

function openElementaryInfoModal() {
  const targetStudent = getStudentInfoModalTarget('elementary');
  if (!targetStudent) return;
  if (typeof window.olliPatchStudentModalMarkup === 'function') window.olliPatchStudentModalMarkup();
  elementaryInfoDraft = {
    group: targetStudent.group || '',
    personality: targetStudent.personality || ''
  };
  document.getElementById('elementaryInfoNameInput').value = targetStudent.name || '';
  setStudentInfoDateInput('elementaryInfoEnrolledAtInput', targetStudent);
  document.getElementById('elementarySchoolInput').value = targetStudent.school || '';
  document.getElementById('elementaryGradeInput').value = formatElementaryGradeInputValue(targetStudent.grade);
  const elementaryAgeInput = document.getElementById('elementaryAgeInput');
  if (elementaryAgeInput) elementaryAgeInput.value = formatElementaryAgeInputValue(getElementaryAgeFromGrade(targetStudent.grade) || targetStudent.age || '');
  syncElementaryInfoButtons();
  if (typeof updateElementaryInfoRiskPanel === 'function') updateElementaryInfoRiskPanel(targetStudent);
  document.getElementById('elementaryInfoModal').style.display = 'flex';
  if (typeof window.olliPrepareInfoExtra === 'function') window.olliPrepareInfoExtra('elementary', targetStudent);
}

function closeElementaryInfoModal() {
  hideModalOnly('elementaryInfoModal');
  studentInfoModalTarget = null;
}

async function saveElementaryInfo() {
  const targetStudent = getStudentInfoModalTarget('elementary');
  if (!targetStudent) return;
  const nextName = document.getElementById('elementaryInfoNameInput').value.trim();
  if (!nextName) {
    alert('학생 이름을 입력해 주세요.');
    return;
  }

  const originalName = String(targetStudent.name || '').trim();
  const duplicated = nextName !== originalName && getStudentsByType('elementary').some(student => String(student.id) !== String(targetStudent.id) && String(student.name || '').trim() === nextName);
  if (duplicated) {
    alert('이미 등록된 학생 이름입니다.');
    return;
  }

  const dateInfo = readStudentInfoDateInput('elementaryInfoEnrolledAtInput', targetStudent);
  if (!dateInfo) return;

  const extraInfo = typeof window.olliGetInfoExtra === 'function' ? window.olliGetInfoExtra('elementary') : {};
  const student = {
    ...targetStudent,
    ...dateInfo,
    name: nextName,
    group: elementaryInfoDraft.group,
    group_months: elementaryGroupMonthsToText(getElementaryGroupFeedbackMonths(elementaryInfoDraft.group, targetStudent)),
    feedback_months: elementaryGroupMonthsToText(getElementaryGroupFeedbackMonths(elementaryInfoDraft.group, targetStudent)),
    personality: elementaryInfoDraft.personality,
    lesson_day: Object.prototype.hasOwnProperty.call(extraInfo, 'lesson_day') ? extraInfo.lesson_day : (targetStudent.lesson_day || ''),
    lesson_time: Object.prototype.hasOwnProperty.call(extraInfo, 'lesson_time') ? normalizeLessonTimeDisplay(extraInfo.lesson_time || extraInfo.class_time || '') : normalizeLessonTimeDisplay(targetStudent.lesson_time || targetStudent.class_time || ''),
    class_time: Object.prototype.hasOwnProperty.call(extraInfo, 'lesson_time') ? normalizeLessonTimeDisplay(extraInfo.lesson_time || extraInfo.class_time || '') : normalizeLessonTimeDisplay(targetStudent.class_time || targetStudent.lesson_time || ''),
    teacher: Object.prototype.hasOwnProperty.call(extraInfo, 'teacher') ? extraInfo.teacher : (targetStudent.teacher || ''),
    homeroom_teacher: Object.prototype.hasOwnProperty.call(extraInfo, 'homeroom_teacher') ? extraInfo.homeroom_teacher : (targetStudent.homeroom_teacher || ''),
    school: document.getElementById('elementarySchoolInput').value.trim(),
    age: getElementaryAgeFromGrade(normalizeElementaryGradeValue(document.getElementById('elementaryGradeInput').value)),
    birth_year: '',
    grade: normalizeElementaryGradeValue(document.getElementById('elementaryGradeInput').value),
    school_entry_year: inferOlliSchoolEntryYearFromGrade(normalizeElementaryGradeValue(document.getElementById('elementaryGradeInput').value)),
    className: ''
  };
  try {
    const savedStudent = await ensureStudentSavedToSupabase(student);
    if (currentMemoStudent && String(currentMemoStudent.id) === String(savedStudent.id)) {
      currentMemoStudent = savedStudent;
      setMemoModePillLabel(savedStudent.name || '학생 이름');
      const memoSubLabel = document.getElementById('memoSubLabel');
      if (memoSubLabel) memoSubLabel.textContent = '학생분석 메모';
    }
    closeElementaryInfoModal();
    await loadRecords('');
  } catch (err) {
    alert(`학생 정보 저장에 실패했어요.\n\n${err.message || err}`);
  }
}

function openKinderInfoModal() {
  const targetStudent = getStudentInfoModalTarget('kinder');
  if (!targetStudent) return;
  if (typeof window.olliPatchStudentModalMarkup === 'function') window.olliPatchStudentModalMarkup();
  kinderInfoDraft = { personality: targetStudent.personality || '' };
  document.getElementById('kinderInfoModal').style.display = 'flex';
  document.getElementById('kinderInfoNameInput').value = targetStudent.name || '';
  setStudentInfoDateInput('kinderInfoEnrolledAtInput', targetStudent);
  document.getElementById('kinderKindergartenInput').value = targetStudent.kindergarten || '';
  document.getElementById('kinderAgeInput').value = targetStudent.age || '';
  const kinderLessonDayInput = document.getElementById('kinderLessonDayInput');
  if (kinderLessonDayInput) kinderLessonDayInput.value = targetStudent.lesson_day || '';
  updateKinderInfoRiskPanel(targetStudent);
  if (typeof window.olliPrepareInfoExtra === 'function') window.olliPrepareInfoExtra('kinder', targetStudent);
}
function closeKinderInfoModal() {
  hideModalOnly('kinderInfoModal');
  studentInfoModalTarget = null;
}
async function saveKinderInfo() {
  const targetStudent = getStudentInfoModalTarget('kinder');
  if (!targetStudent) return;
  const nextName = document.getElementById('kinderInfoNameInput').value.trim();
  if (!nextName) {
    alert('학생 이름을 입력해 주세요.');
    return;
  }

  const originalName = String(targetStudent.name || '').trim();
  const duplicated = nextName !== originalName && getStudentsByType('kinder').some(student => String(student.id) !== String(targetStudent.id) && String(student.name || '').trim() === nextName);
  if (duplicated) {
    alert('이미 등록된 학생 이름입니다.');
    return;
  }

  const dateInfo = readStudentInfoDateInput('kinderInfoEnrolledAtInput', targetStudent);
  if (!dateInfo) return;

  const kindergarten = document.getElementById('kinderKindergartenInput').value.trim();
  const age = document.getElementById('kinderAgeInput').value.trim();
  const lessonDayInput = document.getElementById('kinderLessonDayInput');
  const extraInfo = typeof window.olliGetInfoExtra === 'function' ? window.olliGetInfoExtra('kinder') : {};
  const lesson_day = Object.prototype.hasOwnProperty.call(extraInfo, 'lesson_day') ? extraInfo.lesson_day : (lessonDayInput ? lessonDayInput.value.trim() : (targetStudent.lesson_day || ''));
  const lesson_time = Object.prototype.hasOwnProperty.call(extraInfo, 'lesson_time') ? normalizeLessonTimeDisplay(extraInfo.lesson_time || extraInfo.class_time || '') : normalizeLessonTimeDisplay(targetStudent.lesson_time || targetStudent.class_time || '');
  const student = {
    ...targetStudent,
    ...dateInfo,
    name: nextName,
    kindergarten,
    age,
    birth_year: inferOlliBirthYearFromAge(age),
    lesson_day,
    lesson_time,
    class_time: lesson_time,
    personality: typeof extraInfo.personality === 'string' ? extraInfo.personality : (kinderInfoDraft.personality || ''),
    teacher: Object.prototype.hasOwnProperty.call(extraInfo, 'teacher') ? extraInfo.teacher : (targetStudent.teacher || ''),
    homeroom_teacher: Object.prototype.hasOwnProperty.call(extraInfo, 'homeroom_teacher') ? extraInfo.homeroom_teacher : (targetStudent.homeroom_teacher || '')
  };
  try {
    const savedStudent = await ensureStudentSavedToSupabase(student);
    if (currentMemoStudent && String(currentMemoStudent.id) === String(savedStudent.id)) {
      currentMemoStudent = savedStudent;
      const kinderNameEl = document.getElementById('kinderObservationNoteTitle');
      if (kinderNameEl) kinderNameEl.textContent = `${savedStudent.name || '유치부'}의 노트`;
      setMemoModePillLabel(savedStudent.name || '관찰 메모');
      const memoSubLabel = document.getElementById('memoSubLabel');
      if (memoSubLabel) memoSubLabel.textContent = '관찰노트 메모';
    }
    closeKinderInfoModal();
    await loadRecords('');
  } catch (err) {
    alert(`학생 정보 저장에 실패했어요.\n\n${err.message || err}`);
  }
}


const OLLI_BOOT_MIN_DURATION = 1500;
const OLLI_BOOT_FADE_OUT_DURATION = 720;
let olliBootStartedAt = Date.now();

function showOlliBootScreen() {
  olliBootStartedAt = Date.now();
  const boot = document.getElementById('olliBootScreen');
  if (!boot) return;
  boot.style.display = 'flex';
  boot.classList.remove('hide');
}

function waitOlli(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms || 0)));
}

async function hideOlliBootScreen() {
  const boot = document.getElementById('olliBootScreen');
  if (!boot) return;

  const elapsed = Date.now() - olliBootStartedAt;
  const remain = OLLI_BOOT_MIN_DURATION - elapsed;
  if (remain > 0) await waitOlli(remain);

  boot.classList.add('hide');
  await waitOlli(OLLI_BOOT_FADE_OUT_DURATION);
  if (boot.classList.contains('hide')) {
    boot.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  showOlliBootScreen();
  setupMemoPauseAutoSaveBindings();
  try {
    hideOlliAppScreensForRoute();

    if (typeof restoreOlliAccountSession === 'function') {
      await restoreOlliAccountSession({ silent: true });
    }

    if (typeof validateOlliCurrentAcademyStillExists === 'function') {
      const academyCheck = await validateOlliCurrentAcademyStillExists({ silent: true });
      if (academyCheck && academyCheck.blocked) {
        await hideOlliBootScreen();
        return;
      }
    }

    if (typeof validateOlliCurrentMemberAccess === 'function') {
      const access = await validateOlliCurrentMemberAccess({ silent: true });
      if (access && access.blocked) {
        if (typeof showOlliTeacherRequest === 'function') showOlliTeacherRequest();
        await hideOlliBootScreen();
        return;
      }
    }

    migrateStudentStorageIfNeeded();
    initGroupChoiceIcons();
    purgeOldLocalMemos();
    await loadStudentsFromSupabase();
    startOlliStudentBackgroundSync();
    updateRecordHeaderUI();
    updateModeUI();
    renderSceneInput();
    bindStudentAddButton();
    bindModalCloseEvents();
    const yearInput = document.getElementById('studentYearBadge');
    if (yearInput) {
      const currentYear = String(getCurrentYear());
      yearInput.value = currentYear;
      yearInput.defaultValue = currentYear;
    }
    setupPillPressFeedback();
    

    setupMemoPauseAutoSaveBindings();

    window.addEventListener('beforeunload', flushMemoAutoSave);

    if (isOlliLoggedInForStartPage()) {
      if (typeof clearOlliTeacherInviteParamsFromUrl === 'function') clearOlliTeacherInviteParamsFromUrl();
      await enterOlliAfterLoginOrSetup();
    } else if (!(typeof applyOlliTeacherInviteFromUrl === 'function' && applyOlliTeacherInviteFromUrl())) {
      showOlliLoginEntry();
    }
    await hideOlliBootScreen();
  } catch (err) {
    console.error('startup init error:', err);
    if (isOlliLoggedInForStartPage()) {
      await enterOlliByStartPage(getOlliDefaultStartPage() || 'attendance');
    } else if (!(typeof applyOlliTeacherInviteFromUrl === 'function' && applyOlliTeacherInviteFromUrl())) {
      showOlliLoginEntry();
    }
    await hideOlliBootScreen();
  }

  window.showRecordRoom = showRecordRoom;
  window.openRecordAttendanceDashboard = openRecordAttendanceDashboard;
  window.hideRecordRoom = hideRecordRoom;
  window.toggleRecordViewMode = toggleRecordViewMode;
  window.toggleRecordMode = toggleRecordMode;
  window.openStudentModal = openStudentModal;
  window.closeModalById = closeModalById;
  window.closeStudentModal = closeStudentModal;
  window.confirmStudent = confirmStudent;
  window.openStudentMemoPageById = openStudentMemoPageById;
  window.forceStudentMemoControlsVisible = forceStudentMemoControlsVisible;
  window.closeMemoPage = closeMemoPage;
  window.saveCurrentMemo = saveCurrentMemo;
  window.requestElementaryFeedback = requestElementaryFeedback;
window.toggleMemoModeMenu = toggleMemoModeMenu;
window.openMemoObservationMode = openMemoObservationMode;
  window.openMemoFailGrowthMode = openMemoFailGrowthMode;
  window.showOlliStartPageSetup = showOlliStartPageSetup;
  window.selectOlliStartPageAndEnter = selectOlliStartPageAndEnter;
  window.enterOlliByStartPage = enterOlliByStartPage;
  window.saveOlliDefaultStartPage = saveOlliDefaultStartPage;
  window.selectSettingsStartPageOption = selectSettingsStartPageOption;
  window.toggleSceneInputMode = toggleSceneInputMode;
  window.handleSceneCardBodyClick = handleSceneCardBodyClick;
  window.handleSceneNumberClick = handleSceneNumberClick;
  window.toggleSceneTag = toggleSceneTag;
  window.requestSceneCardFeedback = requestSceneCardFeedback;
  window.handleMemoHeaderAction = handleMemoHeaderAction;
  window.openElementaryAnalysisModal = openElementaryAnalysisModal;
  window.closeElementaryAnalysisModal = closeElementaryAnalysisModal;
  window.openElementaryAnalysisDetailModal = openElementaryAnalysisDetailModal;
  window.closeElementaryAnalysisDetailModal = closeElementaryAnalysisDetailModal;
  window.openElementaryAnalysisDetailFromCurrent = openElementaryAnalysisDetailFromCurrent;
  
window.applyElementaryAnalysisToMemo = applyElementaryAnalysisToMemo;
  window.toggleElementaryAnalysisValue = toggleElementaryAnalysisValue;
  window.toggleElementaryTendencyValue = toggleElementaryTendencyValue;
  window.toggleElementaryTendencyGroup = toggleElementaryTendencyGroup;
  window.openCurrentElementaryMemoRecord = openCurrentElementaryMemoRecord;
  window.openArchivedElementaryMemoRecord = openArchivedElementaryMemoRecord;
  window.applyFailSurveyToInput = applyFailSurveyToInput;
  window.selectFailSurveySingle = selectFailSurveySingle;
  window.toggleFailSurveyMulti = toggleFailSurveyMulti;

  window.closeSaveModal = closeSaveModal;
  window.confirmSave = confirmSave;
  window.openSaveModal = openSaveModal;
  window.cp = cp;
  window.copyStudentFeedback = copyStudentFeedback;
  window.shareStudentFeedback = shareStudentFeedback;
  window.requestSummaryFeedbackFromRecords = requestSummaryFeedbackFromRecords;
  window.toggleStudentBlock = toggleStudentBlock;
  window.openCurrentStudentInfoModal = openCurrentStudentInfoModal;
  window.openElementaryInfoModal = openElementaryInfoModal;
  window.closeElementaryInfoModal = closeElementaryInfoModal;
  window.saveElementaryInfo = saveElementaryInfo;
  window.selectElementaryGroup = selectElementaryGroup;
  window.selectElementaryPersonality = selectElementaryPersonality;
  window.openKinderInfoModal = openKinderInfoModal;
  window.closeKinderInfoModal = closeKinderInfoModal;
  window.saveKinderInfo = saveKinderInfo;
  window.startStudentLongPress = startStudentLongPress;
  window.moveStudentLongPress = moveStudentLongPress;
  window.cancelStudentLongPress = cancelStudentLongPress;
  window.handleStudentRowClick = handleStudentRowClick;
  window.openAttendanceStudentFeedbackSheet = openAttendanceStudentFeedbackSheet;
  window.closeAttendanceStudentFeedbackSheet = closeAttendanceStudentFeedbackSheet;
  window.toggleAttendanceFeedbackSheetCard = toggleAttendanceFeedbackSheetCard;
  window.closeStudentActionMenu = closeStudentActionMenu;
  window.confirmDeleteSelectedStudent = confirmDeleteSelectedStudent;
  window.enterStudentSelectionMode = enterStudentSelectionMode;
  window.setSelectedStudentStatus = setSelectedStudentStatus;
  window.deleteSelectedStudents = deleteSelectedStudents;
  window.exitStudentSelectionMode = exitStudentSelectionMode;
  window.openMoreMenuPlaceholder = openMoreMenuPlaceholder;
});

window.addEventListener('pageshow', () => {
  try {  } catch (err) { console.warn('notification sync skipped:', err); }
});
window.addEventListener('storage', (event) => {
  if (event.key === STUDENTS_KEY || event.key === RISK_NOTIFICATIONS_KEY) {
    try {  } catch (err) { console.warn('notification sync skipped:', err); }
  }
});

document.addEventListener('input', function(event) {
  if (event.target && event.target.id === 'sceneMemoInput') {
    updateSceneMemoPlaceholder();
  }
});
document.addEventListener('DOMContentLoaded', function() {
  updateSceneMemoPlaceholder();
});


function resetOneMinuteFeedbackBeforeLeaving() {
  const main = document.getElementById('mainPageScreen');
  if (!main) return;
  const style = window.getComputedStyle(main);
  const isVisible = style.display !== 'none' && main.offsetParent !== null;
  if (isVisible) resetOneMinuteFeedback();
}

function wrapOneMinuteLeaveFunction(fnName) {
  const original = window[fnName];
  if (typeof original !== 'function' || original.__oneMinuteWrapped) return;
  const wrapped = function(...args) {
    resetOneMinuteFeedbackBeforeLeaving();
    return original.apply(this, args);
  };
  wrapped.__oneMinuteWrapped = true;
  window[fnName] = wrapped;
}

document.addEventListener('DOMContentLoaded', function() {
  ['showRecordRoom','showStudentMemoScreen','openStudentMemo',].forEach(wrapOneMinuteLeaveFunction);
});


let currentKinderSceneInfoId = null;

function handleKinderSceneCardTap(event, id) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (!selectedSceneIds.has(id)) {
    selectedSceneIds.add(id);
    try { insertSceneMemoLabel(id); } catch (err) {}
    closeKinderSceneInfo();
    renderSceneInput();
    return;
  }

  openKinderSceneInfo(id);
}

function toggleKinderSceneMarker(event, id) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (selectedSceneIds.has(id)) {
    selectedSceneIds.delete(id);
    try { removeSceneMemoLabel(id); } catch (err) {}
    if (currentKinderSceneInfoId === id) {
      const marker = document.getElementById('kinderSceneInfoMarker');
      if (marker) marker.dataset.selected = 'false';
    }
  } else {
    selectedSceneIds.add(id);
    try { insertSceneMemoLabel(id); } catch (err) {}
    if (currentKinderSceneInfoId === id) {
      const marker = document.getElementById('kinderSceneInfoMarker');
      if (marker) marker.dataset.selected = 'true';
    }
  }

  renderSceneInput();
}

function openKinderSceneInfo(id) {
  const item = getSceneById(id);
  const overlay = document.getElementById('kinderSceneInfoOverlay');
  if (!item || !overlay) return;

  currentKinderSceneInfoId = id;

  const marker = document.getElementById('kinderSceneInfoMarker');
  const noText = document.getElementById('kinderSceneInfoNumText');
  const titleEl = document.getElementById('kinderSceneInfoTitle');
  const mainEl = document.getElementById('kinderSceneInfoMain');
  const subEl = document.getElementById('kinderSceneInfoSub');
  const keyEl = document.getElementById('kinderSceneInfoKeywords');

  if (marker) marker.dataset.selected = selectedSceneIds.has(id) ? 'true' : 'false';
  if (noText) noText.textContent = item.no;
  if (titleEl) titleEl.textContent = item.title;
  if (mainEl) mainEl.textContent = item.main;
  if (subEl) subEl.textContent = item.sub;
  if (keyEl) keyEl.innerHTML = item.keywords.map(k => `<span>${escapeHtml(k)}</span>`).join('');

  overlay.classList.add('show');
}

function toggleKinderSceneInfoSelection(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (!currentKinderSceneInfoId) return;

  if (selectedSceneIds.has(currentKinderSceneInfoId)) {
    selectedSceneIds.delete(currentKinderSceneInfoId);
    try { removeSceneMemoLabel(currentKinderSceneInfoId); } catch (err) {}
  } else {
    selectedSceneIds.add(currentKinderSceneInfoId);
    try { insertSceneMemoLabel(currentKinderSceneInfoId); } catch (err) {}
  }

  const marker = document.getElementById('kinderSceneInfoMarker');
  if (marker) marker.dataset.selected = selectedSceneIds.has(currentKinderSceneInfoId) ? 'true' : 'false';
  renderSceneInput();
}

function closeKinderSceneInfo() {
  const overlay = document.getElementById('kinderSceneInfoOverlay');
  if (overlay) overlay.classList.remove('show');
}

function handleKinderSceneInfoOverlayClick(event) {
  if (event && event.target && event.target.id === 'kinderSceneInfoOverlay') closeKinderSceneInfo();
}

function unselectKinderSceneFromInfo() {
  if (!currentKinderSceneInfoId) return;
  selectedSceneIds.delete(currentKinderSceneInfoId);
  try { removeSceneMemoLabel(currentKinderSceneInfoId); } catch (err) {}
  const marker = document.getElementById('kinderSceneInfoMarker');
  if (marker) marker.dataset.selected = 'false';
  renderSceneInput();
}

function resetOneMinuteFeedback() {
  try {
    selectedSceneIds.clear();
    if (typeof flippedSceneIds !== 'undefined') flippedSceneIds.clear();
    currentKinderSceneInfoId = null;
    const memo = document.getElementById('sceneMemoInput');
    if (memo) {
      memo.value = '';
      delete memo.dataset.userFocusedOnce;
      memo.style.height = '';
      memo.scrollTop = 0;
      memo.scrollLeft = 0;
    }
    const result = document.getElementById('sceneResultArea');
    if (result) result.innerHTML = '';
    closeKinderSceneInfo();
    const modal = document.getElementById('sceneCardModalOverlay');
    if (modal) modal.classList.remove('show');
    document.body.classList.remove('modalOpen');
    try { updateSceneMemoPlaceholder(); } catch (err) {}
    renderSceneInput();
  } catch (err) {
    console.warn('resetOneMinuteFeedback skipped:', err);
  }
}

function resetOneMinuteFeedbackBeforeLeaving() {
  const main = document.getElementById('mainPageScreen');
  if (!main) return;
  const style = window.getComputedStyle(main);
  const isVisible = style.display !== 'none';
  if (isVisible) resetOneMinuteFeedback();
}

function wrapOneMinuteLeaveFunction(fnName) {
  const original = window[fnName];
  if (typeof original !== 'function' || original.__oneMinuteWrapped) return;
  const wrapped = function(...args) {
    resetOneMinuteFeedbackBeforeLeaving();
    return original.apply(this, args);
  };
  wrapped.__oneMinuteWrapped = true;
  window[fnName] = wrapped;
}

document.addEventListener('DOMContentLoaded', function() {
  ['showRecordRoom','showStudentMemoScreen','openStudentMemo',].forEach(wrapOneMinuteLeaveFunction);
});


function setSceneMemoCursorAfterFirstLine(textarea) {
  if (!textarea) return;
  const value = textarea.value || '';
  if (!value.trim()) return;

  const firstLineEnd = value.indexOf('\n') >= 0 ? value.indexOf('\n') : value.length;

  try {
    textarea.setSelectionRange(firstLineEnd, firstLineEnd);
  } catch (err) {}

  requestAnimationFrame(() => {
    try {
      textarea.setSelectionRange(firstLineEnd, firstLineEnd);
    } catch (err) {}
  });
}

document.addEventListener('focusin', function(event) {
  if (!event.target || event.target.id !== 'sceneMemoInput') return;
  const textarea = event.target;

  // 카드 선택으로 자동 포커스가 생기지 않도록 카드 선택에서는 focus()를 호출하지 않습니다.
  // 사용자가 메모장을 처음 터치해 포커스가 들어온 순간에만 첫 줄 텍스트 바로 뒤로 이동합니다.
  if (!textarea.dataset.userFocusedOnce && (textarea.value || '').trim()) {
    textarea.dataset.userFocusedOnce = '1';
    setSceneMemoCursorAfterFirstLine(textarea);
  }
});

document.addEventListener('blur', function(event) {
  if (event.target && event.target.id === 'sceneMemoInput') {
    delete event.target.dataset.userFocusedOnce;
  }
}, true);

function insertTemplate(text) {
  const input = document.getElementById('sceneMemoInput');
  if (!input) return;
  const current = (input.value || '').trim();
  input.value = current ? `${current}
${text}` : text;
  autoResizeSceneMemoInput(input);
  updateSceneMemoPlaceholder();
  try { input.focus(); } catch (err) {}
}
function autoResizeSceneMemoInput(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, 162) + 'px';
}
document.addEventListener('input', function(event) {
  if (event.target && event.target.id === 'sceneMemoInput') {
    autoResizeSceneMemoInput(event.target);
  }
});
document.addEventListener('DOMContentLoaded', function() {
  const textarea = document.getElementById('sceneMemoInput');
  if (textarea) autoResizeSceneMemoInput(textarea);
  renderKinderFeedbackSceneGrid();
  updateSceneCardModalMeta();
});


/* v40-64: 모든 피드백 생성/전송 버튼 입력값 없을 때 차단 */
(function(){
  if (window.__feedbackInputGuardV64) return;
  window.__feedbackInputGuardV64 = true;

  const EMPTY_FEEDBACK_MESSAGE = '수업 내용이 부족합니다.';

  function notifyFeedbackInputRequired() {
    alert(EMPTY_FEEDBACK_MESSAGE);
  }

  function textValue(id) {
    const el = document.getElementById(id);
    return el && 'value' in el ? String(el.value || '').trim() : '';
  }

  function hasSceneCardFeedbackInput(customText) {
    if (typeof customText === 'string' && customText.trim()) return true;
    const memo = textValue('sceneMemoInput');
    const hasSelectedCards = !!(window.selectedSceneIds && window.selectedSceneIds.size > 0);
    return !!memo || hasSelectedCards;
  }

  function hasCurrentElementaryAnalysisContentSafe() {
    try {
      if (!currentMemoStudent) return false;
      if (typeof getElementaryAnalysisByStudent !== 'function') return false;
      const analysisData = getElementaryAnalysisByStudent(currentMemoStudent);
      if (typeof elementaryAnalysisHasContent === 'function') {
        return !!elementaryAnalysisHasContent(analysisData);
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  function hasElementaryMemoFeedbackInput(text, analysisPromptText) {
    const memoText = typeof text === 'string' ? text.trim() : textValue('memoEditor');
    const analysisText = typeof analysisPromptText === 'string' ? analysisPromptText.trim() : '';
    const hasExplicitAnalysisPrompt = !!analysisText && !/^\[초등부 분석 선택 데이터\]\s*$/.test(analysisText);
    return !!memoText || hasCurrentElementaryAnalysisContentSafe() || hasExplicitAnalysisPrompt;
  }


  function wrapFunction(name, validator) {
    const original = window[name];
    if (typeof original !== 'function') return false;
    if (original.__feedbackInputGuardWrapped) return true;

    const wrapped = function(...args) {
      if (!validator(...args)) {
        notifyFeedbackInputRequired();
        return;
      }
      return original.apply(this, args);
    };

    wrapped.__feedbackInputGuardWrapped = true;
    wrapped.__originalFeedbackFunction = original;
    window[name] = wrapped;
    return true;
  }

  function installFeedbackInputGuards() {
    wrapFunction('requestSceneCardFeedback', function(customText) {
      return hasSceneCardFeedbackInput(customText);
    });

    wrapFunction('requestElementaryFeedback', function() {
      return hasElementaryMemoFeedbackInput();
    });

    wrapFunction('requestSceneCardFeedbackFromElementary', function(studentName, text, analysisPromptText) {
      return hasElementaryMemoFeedbackInput(text, analysisPromptText);
    });
}

  installFeedbackInputGuards();

  document.addEventListener('DOMContentLoaded', installFeedbackInputGuards);

  /* onclick보다 먼저 막아야 하는 버튼은 capture 단계에서도 한 번 더 방어 */
  document.addEventListener('click', function(event) {
    const btn = event.target && event.target.closest
      ? event.target.closest('button')
      : null;
    if (!btn) return;

    const id = btn.id || '';
    const cls = btn.className || '';
    const text = String(btn.textContent || '').trim();

    const isFeedbackButton =
      id === 'cardGenerateBtn' ||
      id === 'memoFeedbackBtn' ||
      id === 'failGrowthGenerateBtn' ||
      id === 'elementaryFailGrowthGenerateBtn' ||
      String(cls).includes('kinderGenerateBtn') ||
      String(cls).includes('memoFeedbackBottomBtn') ||
      String(cls).includes('growthGenerateBtn') ||
      (text.includes('피드백') && (text.includes('생성') || text.includes('만들기') || text.includes('받기')));

    if (!isFeedbackButton) return;

    let ok = true;

    if (id === 'cardGenerateBtn' || String(cls).includes('kinderGenerateBtn')) {
      ok = hasSceneCardFeedbackInput();
    } else if (id === 'memoFeedbackBtn' || String(cls).includes('memoFeedbackBottomBtn')) {
      ok = hasElementaryMemoFeedbackInput();
    } else if (id === 'failGrowthGenerateBtn') {
      ok = hasFailGrowthInput();
    } else if (id === 'elementaryFailGrowthGenerateBtn') {
      ok = hasElementaryFailGrowthInput();
    }

    if (!ok) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      notifyFeedbackInputRequired();
    }
  }, true);

  window.installFeedbackInputGuards = installFeedbackInputGuards;
})();


/* ── 내부 피드백 작업 보관함: 화면용 '오늘 피드백' 기능은 사용하지 않음 ── */
const FEEDBACK_JOB_QUEUE_KEY = 'olli_feedback_jobs_v2';
const TODAY_FEEDBACK_QUEUE_KEY = FEEDBACK_JOB_QUEUE_KEY;
function getFeedbackJobQueueStorageKey() {
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || 'unscoped';
  return `${FEEDBACK_JOB_QUEUE_KEY}_${academyId}`;
}
try { localStorage.removeItem('olli_today_feedback_queue_v1'); } catch(e) {}

function getTodayFeedbackDateKey(dateValue) {
  const d = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0,10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function getTodayFeedbackItemsRaw() {
  try {
    const raw = localStorage.getItem(getFeedbackJobQueueStorageKey());
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function setTodayFeedbackItemsRaw(list) {
  localStorage.setItem(getFeedbackJobQueueStorageKey(), JSON.stringify(Array.isArray(list) ? list.slice(0, 300) : []));
  
  try { updateKinderChatFeedbackBadge(); } catch(e) {}
  try { renderKinderChatFeedbackInbox(); } catch(e) {}
}
function getTodayFeedbackItems() {
  const today = getTodayFeedbackDateKey();
  return getTodayFeedbackItemsRaw().filter(item => item && item.dateKey === today);
}
function getTodayFeedbackCounts() {
  const items = getTodayFeedbackItems();
  return {
    generating: items.filter(item => item.status === 'generating').length,
    done: items.filter(item => item.status === 'done' && !item.reviewed).length,
    error: items.filter(item => item.status === 'error' || item.status === 'review').length,
    total: items.length
  };
}
function normalizeTodayFeedbackStudentName(name, fallback) {
  let value = String(name || fallback || '').trim();
  const bad = new Set(['학생 이름','아이 이름','성장 피드백','초등부','유치부','OLLI','오늘 피드백']);
  return bad.has(value) ? '' : value;
}

function getSuspiciousFeedbackSegments(text) {
  const source = String(text || '');
  if (!source) return [];
  const pattern = /[\u0900-\u097F]+|[\u3040-\u30FF]+|[\u3400-\u4DBF\u4E00-\u9FFF]+|[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+|[\u0E00-\u0E7F]+|[\u0400-\u04FF]+|[\u0590-\u05FF]+|[\u0370-\u03FF]+/gu;
  const found = source.match(pattern) || [];
  return Array.from(new Set(found.map(v => String(v || '').trim()).filter(Boolean))).slice(0, 20);
}
function hasSuspiciousFeedbackText(text) {
  return getSuspiciousFeedbackSegments(text).length > 0;
}
function renderSuspiciousFeedbackText(text) {
  const source = String(text || '');
  if (!source) return '';
  const pattern = /[\u0900-\u097F]+|[\u3040-\u30FF]+|[\u3400-\u4DBF\u4E00-\u9FFF]+|[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+|[\u0E00-\u0E7F]+|[\u0400-\u04FF]+|[\u0590-\u05FF]+|[\u0370-\u03FF]+/gu;
  let html = '';
  let lastIndex = 0;
  source.replace(pattern, (match, offset) => {
    html += escapeHtml(source.slice(lastIndex, offset));
    html += `<span class="todayFeedbackSuspiciousChar">${escapeHtml(match)}</span>`;
    lastIndex = offset + match.length;
    return match;
  });
  html += escapeHtml(source.slice(lastIndex));
  return html;
}
function buildTodayFeedbackIssueHtml(segments) {
  const list = Array.isArray(segments) ? segments.filter(Boolean) : [];
  if (!list.length) return '';
  return `<div class="todayFeedbackIssueBox">외국어 문자로 보이는 내용이 포함되어 있어요. 수정 후 복사/저장할 수 있습니다.<div class="todayFeedbackIssueChars">${list.map(v => `<span class="todayFeedbackIssueChar">${escapeHtml(v)}</span>`).join('')}</div></div>`;
}
function isTodayFeedbackLoadFailItem(item) {
  const text = [item?.label, item?.sourceText, item?.resultText, item?.errorMessage].map(value => String(value || '').toLowerCase()).join(' ');
  return /로드\s*페일|로드페일|load\s*fail|load\s*failed|failed\s*to\s*load/.test(text);
}
function getTodayFeedbackExportBlockReason(item) {
  if (isTodayFeedbackLoadFailItem(item)) return '로드페일 항목은 기록실에 저장하지 않습니다.';
  const segments = getSuspiciousFeedbackSegments(item?.resultText || '');
  if (!segments.length) return '';
  try { updateTodayFeedbackItem(item.id, { status:'review', suspiciousSegments:segments }); } catch(e) {}
  return `외국어 문자(${segments.join(', ')})가 남아 있어요. 수정 후 다시 시도해 주세요.`;
}
function showFeedbackQueueNotice(title, message) {
  const old = document.getElementById('feedbackQueueNotice');
  if (old) old.remove();
  const overlay = document.createElement('div');
  overlay.id = 'feedbackQueueNotice';
  overlay.className = 'feedbackQueueNotice';
  overlay.innerHTML = `<div class="feedbackQueueNoticeCard"><div class="feedbackQueueNoticeTitle">${escapeHtml(title || '')}</div><div class="feedbackQueueNoticeText">${escapeHtml(message || '')}</div></div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  setTimeout(() => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 220);
  }, 1700);
}
function getCurrentFeedbackStudentNameForToday(preferredDivision) {
  const candidates = [];
  if (currentMemoStudent && currentMemoStudent.name) candidates.push(currentMemoStudent.name);
  ['memoStudentName','kinderObservationNoteTitle'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    candidates.push(el.value || el.textContent || '');
  });
  if (preferredDivision === 'kinder') {
    const kinder = document.querySelector('.kinderStudentRow.studentRowSelected .studentTextWrap span:first-child, .kinderStudentRow .studentTextWrap span:first-child');
    if (kinder) candidates.push(kinder.textContent || '');
  }
  for (const name of candidates) {
    const normalized = normalizeTodayFeedbackStudentName(name);
    if (normalized) return normalized;
  }
  return '';
}
function inferFeedbackDivisionFromLabel(label) {
  const text = String(label || '');
  if (text.includes('유치')) return 'kinder';
  if (text.includes('초등')) return 'elementary';
  if (currentMemoType === 'kinder') return 'kinder';
  if (currentMemoType === 'elementary') return 'elementary';
  return 'elementary';
}
function createTodayFeedbackItem(options = {}) {
  const now = new Date().toISOString();
  const item = {
    id: options.id || `tf_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    status: options.status || 'generating',
    studentName: normalizeTodayFeedbackStudentName(options.studentName) || '학생',
    studentDivision: options.studentDivision === 'kinder' ? 'kinder' : 'elementary',
    feedbackType: options.feedbackType || 'class',
    label: options.label || '피드백',
    sourcePage: String(options.sourcePage || ''),
    sourceText: String(options.sourceText || ''),
    attachments: Array.isArray(options.attachments) ? options.attachments : [],
    resultText: String(options.resultText || ''),
    errorMessage: String(options.errorMessage || ''),
    suspiciousSegments: Array.isArray(options.suspiciousSegments) ? options.suspiciousSegments : getSuspiciousFeedbackSegments(options.resultText || ''),
    createdAt: options.createdAt || now,
    updatedAt: now,
    dateKey: getTodayFeedbackDateKey(now),
    feedbackMonth: String(options.feedbackMonth || getFeedbackMonthLabel(now)),
    feedbackMonthNumber: Number(options.feedbackMonthNumber || getFeedbackMonthNumber(now)),
    reviewed: false,
    saved: false
  };
  const list = getTodayFeedbackItemsRaw();
  list.unshift(item);
  setTodayFeedbackItemsRaw(list);
  return item;
}
function updateTodayFeedbackItem(id, patch = {}) {
  const list = getTodayFeedbackItemsRaw();
  let changed = false;
  const next = list.map(item => {
    if (!item || item.id !== id) return item;
    changed = true;
    return { ...item, ...patch, updatedAt: new Date().toISOString() };
  });
  if (changed) setTodayFeedbackItemsRaw(next);
}
function addCompletedTodayFeedback(options = {}) {
  const text = String(options.resultText || options.text || '').trim();
  if (!text) return null;
  return createTodayFeedbackItem({ ...options, status:'done', resultText:text });
}
function getTodayFeedbackStatusLabel(status) {
  if (status === 'generating') return '생성 중';
  if (status === 'error' || status === 'review') return '확인 필요';
  return '생성 완료';
}
function renderTodayFeedbackPage() {}

function getTodayFeedbackItemById(id) {
  return getTodayFeedbackItemsRaw().find(item => item && item.id === id) || null;
}
function getTodayFeedbackSavedSourceTable(item = {}) {
  const explicitTable = String(item.savedSourceTable || item.sourceTable || item.serverTable || '').trim();
  if (explicitTable) return explicitTable;
  return getFeedbackTableNameByType(item.feedbackType || 'class');
}
function getTodayFeedbackSavedRowId(item = {}) {
  return String(item.savedRowId || item.serverRowId || item.feedbackRowId || item.rowId || item.row?.id || '').trim();
}
function getTodayFeedbackEditFeatureByTable(tableName) {
  if (typeof getMemoFeedbackArchiveEditFeature === 'function') return getMemoFeedbackArchiveEditFeature(tableName);
  const table = String(tableName || '').trim();
  if (table === 'feedbacks') return 'general_feedback_edit';
  if (table === 'fail_feedbacks') return 'growth_feedback_edit';
  if (table === 'summary_feedbacks') return 'summary_feedback_edit';
  return '';
}
async function patchSavedTodayFeedbackItem(item = {}, nextText = '') {
  const tableName = getTodayFeedbackSavedSourceTable(item);
  const feature = getTodayFeedbackEditFeatureByTable(tableName);
  const academyId = String(item.savedAcademyId || item.academy_id || (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || '').trim();
  const studentId = String(item.savedStudentId || item.studentId || item.student_id || '').trim();
  const recordId = getTodayFeedbackSavedRowId(item);
  const content = String(nextText || '').trim();
  if (!feature) throw new Error(`지원하지 않는 피드백 수정 테이블입니다: ${tableName || 'unknown'}`);
  if (!academyId || !studentId || !recordId) throw new Error('저장된 피드백의 서버 식별값을 찾지 못해 수정 저장을 할 수 없습니다.');
  if (typeof saveOlliData !== 'function') throw new Error('공통 저장 함수가 준비되지 않았습니다.');
  const patch = { content, updated_at: new Date().toISOString() };
  const result = await saveOlliData(feature, {
    academyId,
    studentId,
    recordId,
    data: patch,
    forceCommon: true
  });
  if (isOlliPendingCommonSaveResult(result)) {
    return { ...patch, id: recordId, academy_id: academyId, student_id: studentId, __pending_sync: true };
  }
  if (!result || !result.serverSaved || !result.verified) {
    const error = result && result.error ? result.error : new Error('저장된 피드백 수정 서버 저장이 완료되지 않았습니다.');
    throw error;
  }
  return result.serverRow || (Array.isArray(result.serverRows) ? result.serverRows[0] : result.serverRows) || { ...patch, id: recordId, academy_id: academyId, student_id: studentId };
}
async function saveTodayFeedbackItem(id, btn, selectedStudentId = '') {
  const item = getTodayFeedbackItemById(id);
  if (!item || !item.resultText) return false;
  const reason = getTodayFeedbackExportBlockReason(item);
  if (reason) {
    showPushToast(reason);
    return false;
  }
  const studentName = normalizeTodayFeedbackStudentName(item.studentName || '');
  const studentDivision = item.studentDivision || 'elementary';
  let finalStudentId = String(selectedStudentId || '');
  if (!finalStudentId) {
    const candidates = typeof getKinderChatFeedbackSaveStudentCandidates === 'function'
      ? getKinderChatFeedbackSaveStudentCandidates(studentName, studentDivision)
      : [];
    if (!candidates.length) {
      showPushToast(`${studentName || '입력한 이름'}로 등록된 학생 이름이 없습니다.`);
      return false;
    }
    if (candidates.length > 1 && typeof openKinderChatFeedbackSaveStudentPicker === 'function') {
      openKinderChatFeedbackSaveStudentPicker(id, candidates);
      return null;
    }
    finalStudentId = String(candidates[0]?.id || '');
  }
  const savedOk = await autoSaveGeneratedFeedback(item.resultText, {
    feedbackType: item.feedbackType || 'class',
    studentDivision,
    studentName,
    studentId: finalStudentId
  }, btn || null);
  if (savedOk === false) return false;
  try {
    await linkFeedbackPhotosToStudent(item, finalStudentId);
  } catch (err) {
    showPushToast('피드백은 저장됐지만 사진 연결을 다시 확인해야 해요.');
    recordOlliStorageIssue({ feature: '수업사진', resource: 'feedback_photos', operation: 'link', student_id: finalStudentId, message: err.message || err });
  }
  const savedRow = (savedOk && typeof savedOk === 'object') ? savedOk : null;
  const sourceTable = getFeedbackTableNameByType(item.feedbackType || 'class');
  const savedRowId = String(savedRow?.id || savedRow?.client_record_id || item.savedRowId || '').trim();
  updateTodayFeedbackItem(id, {
    saved:true,
    reviewed:true,
    savedRowId,
    savedSourceTable: sourceTable,
    savedStudentId: finalStudentId,
    savedAcademyId: (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : ''),
    savedAt: new Date().toISOString()
  });
  const kcfCard = document.querySelector(`[data-kcf-feedback-id="${CSS.escape(id)}"]`);
  if (kcfCard) {
    kcfCard.classList.add('open');
    const textEl = kcfCard.querySelector('.kcfInboxText');
    if (textEl) textEl.textContent = textEl.dataset.kcfOpenMeta || '';
    const saveBtn = kcfCard.querySelector('.kcfInboxSaveBtn');
    if (saveBtn) saveBtn.disabled = true;
    updateKinderChatFeedbackBadge();
  }
  return true;
}
function getFeedbackMonthNumber(dateValue) {
  const d = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().getMonth() + 1;
  return d.getMonth() + 1;
}
function getFeedbackMonthLabel(dateValue) {
  return `${getFeedbackMonthNumber(dateValue)}월`;
}
function buildTodayFeedbackRequestContent(userText, studentName, feedbackMonth) {
  const name = normalizeTodayFeedbackStudentName(studentName);
  const monthLabel = String(feedbackMonth || getFeedbackMonthLabel()).trim();
  const body = String(userText || '').trim();
  const lines = [];
  if (name && !/아이\s*이름\s*:|학생\s*이름\s*:/.test(body)) lines.push(`아이 이름: ${name}`);
  if (monthLabel && !/(피드백\s*기준\s*월|성장노트\s*월|월\s*정보)\s*[:：]/.test(body)) lines.push(`피드백 기준 월: ${monthLabel}`);
  if (body) lines.push(body);
  return lines.join('\n');
}
function startTodayFeedbackRequest(options = {}) {
  const feedbackMonth = String(options.feedbackMonth || getFeedbackMonthLabel()).trim();
  const feedbackMonthNumber = Number(options.feedbackMonthNumber || getFeedbackMonthNumber());
  const item = createTodayFeedbackItem({
    id: options.id,
    status:'generating',
    studentName: options.studentName,
    studentDivision: options.studentDivision,
    feedbackType: options.feedbackType,
    label: options.label,
    sourcePage: options.sourcePage,
    sourceText: options.userText,
    attachments: Array.isArray(options.attachments) ? options.attachments : [],
    feedbackMonth,
    feedbackMonthNumber
  });
  if (!options.silent) showFeedbackQueueNotice(`${item.studentName} 피드백을 정리하고 있어요.`, '이제 다음 아이 피드백을 작성해도 됩니다.');
  
  try { updateKinderChatFeedbackBadge(); } catch(e) {}

  fetch('/api/chat', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({
      promptType: options.promptType || 'class',
      studentName: item.studentName,
      feedbackMonth,
      feedbackMonthNumber,
      messages:[{ role:'user', content: buildTodayFeedbackRequestContent(options.userText || '', item.studentName, feedbackMonth) }]
    })
  })
  .then(async res => {
    const rawText = await res.text();
    let data; try { data = rawText ? JSON.parse(rawText) : {}; } catch { data = { raw: rawText }; }
    if (!res.ok) throw new Error(getApiErrorMessage(res.status, data));
    const rawReply = String(data.reply || '').trim();
    if (!rawReply) throw new Error('응답 본문이 비어 있습니다.');
    const parsed = parseReplyType(rawReply);
    const suspiciousSegments = getSuspiciousFeedbackSegments(parsed.cleanText);
    updateTodayFeedbackItem(item.id, {
      status: suspiciousSegments.length ? 'review' : 'done',
      resultText: parsed.cleanText,
      suspiciousSegments,
      errorMessage:''
    });
    if (!options.silent) {
      showPushToast(suspiciousSegments.length ? `${item.studentName} 피드백 확인이 필요해요.` : `${item.studentName} 피드백이 완성됐어요.`);
      try { showBrowserNotification(`${item.studentName} 피드백이 완성됐어요.`); } catch(e) {}
    }
  })
  .catch(err => {
    updateTodayFeedbackItem(item.id, { status:'error', errorMessage: err.message || '알 수 없는 오류입니다.' });
    if (!options.silent) showPushToast(`${item.studentName} 피드백 확인이 필요해요.`);
  });

  return item;
}
function resetSceneFeedbackInputAfterQueue() {
  try { clearSceneSelections(); } catch(e) {}
  const memo = document.getElementById('sceneMemoInput');
  if (memo) {
    memo.value = '';
    try { autoResizeSceneMemoInput(memo); } catch(e) {}
    try { updateSceneMemoPlaceholder(); } catch(e) {}
  }
  const area = document.getElementById('kinderSceneResultArea');
  if (area) area.innerHTML = '';
}
function requestSceneCardFeedback(customText) {
  const memo = typeof customText === 'string' ? customText.trim() : (document.getElementById('sceneMemoInput')?.value || '').trim();
  if (!memo && selectedSceneIds.size === 0) { alert('장면카드를 선택하거나 메모를 먼저 입력해 주세요.'); return; }
  const userText = buildSceneCardUserText(memo);
  const isElementary = !!customText;
  const studentName = getCurrentFeedbackStudentNameForToday(isElementary ? 'elementary' : 'kinder');
  startTodayFeedbackRequest({ promptType:(isElementary ? 'elementary' : 'class'), userText, studentName, studentDivision:(isElementary ? 'elementary' : 'kinder'), feedbackType:'class', label:(isElementary ? '초등부 피드백' : '유치부 피드백') });
  resetSceneFeedbackInputAfterQueue();
}
window.saveTodayFeedbackItem = saveTodayFeedbackItem;
