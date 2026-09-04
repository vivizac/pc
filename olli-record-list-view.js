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


