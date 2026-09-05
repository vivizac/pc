const MEMO_STUDENT_PICKER_SORT_KEY = 'olli_memo_student_picker_sort_v1';
const MEMO_STUDENT_PICKER_DAYS = ['월','화','수','목','금','토','일'];
let memoStudentPickerManageMode = false;

function cleanMemoStudentPickerText(value) {
  return String(value || '').trim();
}

function readMemoStudentPickerSortState() {
  const fallback = { day: '', group: false };
  try {
    const parsed = JSON.parse(localStorage.getItem(MEMO_STUDENT_PICKER_SORT_KEY) || '{}');
    const legacyDay = Array.isArray(parsed.days)
      ? MEMO_STUDENT_PICKER_DAYS.find(day => parsed.days.includes(day))
      : '';
    const day = MEMO_STUDENT_PICKER_DAYS.includes(parsed.day) ? parsed.day : (legacyDay || '');
    const group = parsed.group === true || parsed.criterion === 'group' || parsed.sortBy === 'group';
    return { day, group };
  } catch (err) {
    return fallback;
  }
}

function writeMemoStudentPickerSortState(state) {
  const day = MEMO_STUDENT_PICKER_DAYS.includes(state?.day) ? state.day : '';
  const group = state?.group === true;
  const nextState = { day, group };
  localStorage.setItem(MEMO_STUDENT_PICKER_SORT_KEY, JSON.stringify(nextState));
  return nextState;
}

function getMemoStudentPickerDays(student) {
  const raw = cleanMemoStudentPickerText(student?.lesson_day || student?.lessonDay || student?.days || student?.day || '')
    .replace(/요일/g, '')
    .replace(/[·,\/]/g, ' ');
  return MEMO_STUDENT_PICKER_DAYS.filter(day => raw.includes(day));
}

function getMemoStudentPickerGroup(student) {
  return cleanMemoStudentPickerText(student?.group || student?.group_no || student?.groupNo || '').replace(/[^0-9A-Fa-f]/g, '');
}

function getMemoStudentPickerGroupRank(student) {
  const group = getMemoStudentPickerGroup(student);
  const n = Number(group);
  if (Number.isFinite(n) && n > 0) return n;
  const upper = group.toUpperCase();
  if (upper && upper.length === 1) {
    const code = upper.charCodeAt(0);
    if (code >= 65 && code <= 90) return code - 64;
  }
  return 999;
}

function getMemoStudentPickerGradeRank(student) {
  try {
    if (typeof getRecordSortGradeValue === 'function' && typeof safeRecordSortNumber === 'function') {
      return safeRecordSortNumber(getRecordSortGradeValue(student));
    }
  } catch (err) {}
  const raw = cleanMemoStudentPickerText(student?.grade || student?.school_grade || student?.class_grade || student?.gradeClass || '');
  const match = raw.match(/\d+/);
  const n = match ? Number(match[0]) : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 999;
}

function compareMemoStudentPickerText(a, b) {
  const av = cleanMemoStudentPickerText(a);
  const bv = cleanMemoStudentPickerText(b);
  if (!av && bv) return 1;
  if (av && !bv) return -1;
  return av.localeCompare(bv, 'ko');
}

function compareMemoStudentPickerName(a, b) {
  return compareMemoStudentPickerText(a?.name, b?.name);
}

function getMemoStudentPickerStatusRank(student) {
  try {
    if (typeof getStudentStatusRank === 'function') return getStudentStatusRank(student);
  } catch (err) {}
  return student && student.status === 'inactive' ? 1 : 0;
}

function memoStudentPickerMatchesSelectedDay(student, selectedDay) {
  if (!selectedDay) return false;
  return getMemoStudentPickerDays(student).includes(selectedDay);
}

function compareMemoStudentPickerFeedbackMonthOrder(a, b) {
  const rankResult = getElementaryCurrentFeedbackGroupRank(a) - getElementaryCurrentFeedbackGroupRank(b);
  if (rankResult !== 0) return rankResult;
  const distanceResult = getElementaryNextFeedbackMonthDistance(a) - getElementaryNextFeedbackMonthDistance(b);
  if (distanceResult !== 0) return distanceResult;
  const groupResult = getMemoStudentPickerGroupRank(a) - getMemoStudentPickerGroupRank(b);
  if (groupResult !== 0) return groupResult;
  return 0;
}

function compareMemoStudentsForPicker(a, b) {
  const statusResult = getMemoStudentPickerStatusRank(a) - getMemoStudentPickerStatusRank(b);
  if (statusResult !== 0) return statusResult;

  const state = readMemoStudentPickerSortState();

  if (state.group) {
    const feedbackMonthResult = compareMemoStudentPickerFeedbackMonthOrder(a, b);
    if (feedbackMonthResult !== 0) return feedbackMonthResult;
  }

  const gradeResult = getMemoStudentPickerGradeRank(a) - getMemoStudentPickerGradeRank(b);
  if (gradeResult !== 0) return gradeResult;

  return compareMemoStudentPickerName(a, b);
}

function getMemoStudentsForPicker() {
  const state = readMemoStudentPickerSortState();
  const students = getStudentsByType('elementary');
  const filtered = state.day
    ? students.filter(student => memoStudentPickerMatchesSelectedDay(student, state.day))
    : students;
  return sortMemoStudentsForPicker(filtered);
}

function sortMemoStudentsForPicker(students) {
  return [...(students || [])].sort(compareMemoStudentsForPicker);
}

function renderMemoStudentPickerHeader(title) {
  const manageMode = isMemoStudentPickerManageMode();
  return `<div class="memoStudentSelectHeader">
    <div class="memoStudentSelectTitle">${escapeHtml(title)}</div>
    <button type="button" class="memoStudentSettingsIconBtn ${manageMode ? 'active' : ''}" onclick="toggleMemoStudentPickerManageMode(event)" aria-label="원생 설정" title="원생 설정">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 0 1 7.1 4l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 0 1 19.9 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"></path></svg>
    </button>
  </div>`;
}

function renderMemoStudentPickerSortControls() {
  const state = readMemoStudentPickerSortState();
  const manageMode = isMemoStudentPickerManageMode();
  if (manageMode) {
    return `<div class="memoStudentSortPanel memoStudentManagePanel">
      <div class="memoStudentSortManageRow">
        <button type="button" class="memoStudentManageChip memoStudentAddChip" onclick="openMemoStudentAddFromPicker(event)" aria-label="원생 등록">+</button>
      </div>
    </div>`;
  }

  const dayButtons = MEMO_STUDENT_PICKER_DAYS.map(day => {
    const active = state.day === day;
    return `<button type="button" class="memoStudentSortChip memoStudentDaySortChip ${active ? 'active' : ''}" onclick="toggleMemoStudentPickerDay('${day}', event)">${day}</button>`;
  }).join('');
  const groupButton = `<button type="button" class="memoStudentSortChip memoStudentGroupSortChip ${state.group ? 'active' : ''}" onclick="toggleMemoStudentPickerGroup(event)">그룹</button>`;
  return `<div class="memoStudentSortPanel">
    <div class="memoStudentSortDayRow">${dayButtons}${groupButton}</div>
  </div>`;
}


function getMemoStudentFeedbackMonthInfo(student) {
  const months = normalizeElementaryGroupMonths(getElementaryGroupFeedbackMonths(student?.group, student));
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  if (!months.length) return { key: 'none', label: '발송월 미설정', current: false, month: null, distance: 999 };
  const ordered = months
    .map(month => ({ month, distance: (month - currentMonth + 12) % 12 }))
    .sort((a, b) => a.distance - b.distance || a.month - b.month);
  const first = ordered[0] || { month: months[0], distance: 999 };
  return {
    key: `month_${first.month}`,
    label: `${first.month}월 학생 목록`,
    current: months.includes(currentMonth),
    month: first.month,
    distance: first.distance
  };
}

function renderMemoStudentMonthDivider(label) {
  return '<div class="memoStudentMonthDivider" aria-hidden="true"></div>';
}

function isMemoStudentPickerManageMode() {
  return memoStudentPickerManageMode === true;
}

function toggleMemoStudentPickerManageMode(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  memoStudentPickerManageMode = !memoStudentPickerManageMode;
  refreshMemoStudentSelectPopupIfOpen();
}

function openMemoStudentAddFromPicker(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  currentRecordView = 'elementary';
  currentObservationView = 'elementary';
  openStudentModal();
}

function openMemoStudentInfoFromPicker(studentId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const student = findStudentById(studentId);
  if (!student) return;
  studentInfoModalTarget = student;
  if (student.type === 'kinder') openKinderInfoModal();
  else openElementaryInfoModal();
}

function refreshMemoStudentSelectPopupIfOpen() {
  const popup = document.getElementById('memoStudentSelectPopup');
  if (popup && popup.classList.contains('show')) renderMemoStudentSelectPopup();
}

function toggleMemoStudentPickerDay(day, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const state = readMemoStudentPickerSortState();
  const nextDay = state.day === day ? '' : day;
  writeMemoStudentPickerSortState({ ...state, day: nextDay });
  refreshMemoStudentSelectPopupIfOpen();
}

function toggleMemoStudentPickerGroup(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const state = readMemoStudentPickerSortState();
  writeMemoStudentPickerSortState({ ...state, group: !state.group });
  refreshMemoStudentSelectPopupIfOpen();
}

function renderMemoStudentSelectPopup() {
  const popup = document.getElementById('memoStudentSelectPopup');
  if (!popup) return;
  const state = readMemoStudentPickerSortState();
  const manageMode = isMemoStudentPickerManageMode();
  const students = getMemoStudentsForPicker();
  const title = manageMode ? '원생 설정' : '원생 목록';
  if (!students.length) {
    const emptyText = state.day && !manageMode ? `${state.day}요일 등원 학생이 없습니다.` : '등록된 초등부 학생이 없습니다.';
    popup.innerHTML = `${renderMemoStudentPickerHeader(title)}<div class="memoStudentSelectList"><div class="memoStudentSelectEmpty">${escapeHtml(emptyText)}</div></div>${renderMemoStudentPickerSortControls()}`;
    return;
  }
  const rows = [];
  let lastDividerKey = '';
  students.forEach(student => {
    const active = !manageMode && currentMemoStudent && String(currentMemoStudent.id) === String(student.id);
    const meta = getElementaryMetaText(student);
    const studentId = escapeHtml(String(student.id || ''));
    const monthInfo = getMemoStudentFeedbackMonthInfo(student);
    if (!manageMode && state.group && monthInfo.key !== lastDividerKey) {
      rows.push(renderMemoStudentMonthDivider(monthInfo.label));
      lastDividerKey = monthInfo.key;
    }
    const textBlock = `<span class="memoStudentSelectName">${escapeHtml(student.name || '이름 없음')}</span>${meta ? `<span class="memoStudentSelectMeta">${escapeHtml(meta)}</span>` : ''}`;
    if (manageMode) {
      rows.push(`<div class="memoStudentSelectOption manageMode">
        <span class="memoStudentSelectTextBlock">${textBlock}</span>
        <button type="button" class="memoStudentInfoDotsBtn" onclick="openMemoStudentInfoFromPicker('${studentId}', event)" aria-label="학생정보 수정">•••</button>
      </div>`);
      return;
    }
    rows.push(`<div class="memoStudentSelectOption ${active ? 'active' : ''}">
      <button type="button" class="memoStudentSelectNameBtn" data-memo-student-id="${studentId}">${textBlock}</button>
    </div>`);
  });
  popup.innerHTML = `${renderMemoStudentPickerHeader(title)}<div class="memoStudentSelectList">${rows.join('')}</div>${renderMemoStudentPickerSortControls()}`;
}
function toggleMemoStudentSelectPopup(event) {
  if (event) event.stopPropagation();
  if (currentMemoType !== 'elementary') return;
  const popup = document.getElementById('memoStudentSelectPopup');
  if (!popup) return;
  renderMemoStudentSelectPopup();
  popup.classList.toggle('show');
}
function closeMemoStudentSelectPopup() {
  const popup = document.getElementById('memoStudentSelectPopup');
  if (popup) popup.classList.remove('show');
}
function openMemoStudentFromPicker(studentId) {
  closeMemoStudentSelectPopup();
  closeMemoModeMenu();
  if (currentMemoStudent && currentMemoType === 'elementary') {
    saveCurrentMemo({ silent: true }).catch(err => {
      console.warn('학생 전환 중 관찰노트 저장 실패:', err?.message || err);
    });
  }
  openStudentMemoPageById(studentId);
}

let memoStudentPickerPointerStartX = 0;
let memoStudentPickerPointerStartY = 0;
let memoStudentPickerPointerMoved = false;
let memoStudentPickerActiveOption = null;
let memoStudentPickerSuppressClickUntil = 0;

function isMemoStudentPickerTarget(target) {
  const popup = document.getElementById('memoStudentSelectPopup');
  return !!(popup && target && popup.contains(target));
}

function getMemoStudentPickerOption(target) {
  return target && target.closest ? target.closest('.memoStudentSelectNameBtn') : null;
}

function beginMemoStudentPickerGesture(target, clientX, clientY) {
  const option = getMemoStudentPickerOption(target);
  memoStudentPickerActiveOption = option && isMemoStudentPickerTarget(option) ? option : null;
  memoStudentPickerPointerStartX = clientX || 0;
  memoStudentPickerPointerStartY = clientY || 0;
  memoStudentPickerPointerMoved = false;
}

function moveMemoStudentPickerGesture(clientX, clientY) {
  if (!memoStudentPickerActiveOption) return;
  const dx = Math.abs((clientX || 0) - memoStudentPickerPointerStartX);
  const dy = Math.abs((clientY || 0) - memoStudentPickerPointerStartY);
  if (dx > 2 || dy > 2) memoStudentPickerPointerMoved = true;
}

function endMemoStudentPickerGesture() {
  if (memoStudentPickerPointerMoved) {
    memoStudentPickerSuppressClickUntil = Date.now() + 650;
  }
  memoStudentPickerActiveOption = null;
}

function handleMemoStudentPickerPointerDown(event) {
  if (!isMemoStudentPickerTarget(event.target)) return;
  beginMemoStudentPickerGesture(event.target, event.clientX, event.clientY);
}

function handleMemoStudentPickerPointerMove(event) {
  if (!isMemoStudentPickerTarget(event.target) && !memoStudentPickerActiveOption) return;
  moveMemoStudentPickerGesture(event.clientX, event.clientY);
}

function handleMemoStudentPickerPointerUp() {
  endMemoStudentPickerGesture();
}

function handleMemoStudentPickerTouchStart(event) {
  if (!isMemoStudentPickerTarget(event.target)) return;
  const touch = event.touches && event.touches[0];
  if (!touch) return;
  beginMemoStudentPickerGesture(event.target, touch.clientX, touch.clientY);
}

function handleMemoStudentPickerTouchMove(event) {
  if (!memoStudentPickerActiveOption) return;
  const touch = event.touches && event.touches[0];
  if (!touch) return;
  moveMemoStudentPickerGesture(touch.clientX, touch.clientY);
}

function handleMemoStudentPickerTouchEnd() {
  endMemoStudentPickerGesture();
}

function guardMemoStudentPickerOptionClick(event) {
  const option = getMemoStudentPickerOption(event.target);
  if (!option || !isMemoStudentPickerTarget(option)) return;
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

  if (Date.now() < memoStudentPickerSuppressClickUntil) return;

  const studentId = option.dataset ? option.dataset.memoStudentId : '';
  if (!studentId) return;
  openMemoStudentFromPicker(studentId);
}

let memoStudentPickerBounceList = null;
let memoStudentPickerBounceStartY = 0;
let memoStudentPickerBounceActive = false;

function getMemoStudentPickerList(target) {
  return target && target.closest ? target.closest('.memoStudentSelectList') : null;
}

function isMemoStudentPickerListScrollable(list) {
  return !!(list && list.scrollHeight > list.clientHeight + 1);
}

function resetMemoStudentPickerListBounce(list) {
  if (!list) return;
  list.style.transition = 'transform .22s cubic-bezier(.22,.61,.36,1)';
  list.style.transform = 'translateY(0)';
  window.setTimeout(() => {
    if (list.style.transform === 'translateY(0)') {
      list.style.transition = '';
      list.style.transform = '';
    }
  }, 240);
}

function handleMemoStudentPickerListBounceStart(event) {
  if (!isMemoStudentSelectPopupOpen()) return;
  const list = getMemoStudentPickerList(event.target);
  if (!list || isMemoStudentPickerListScrollable(list)) return;
  const touch = event.touches && event.touches[0];
  if (!touch) return;
  memoStudentPickerBounceList = list;
  memoStudentPickerBounceStartY = touch.clientY;
  memoStudentPickerBounceActive = true;
  list.style.transition = '';
}

function handleMemoStudentPickerListBounceMove(event) {
  if (!memoStudentPickerBounceActive || !memoStudentPickerBounceList) return;
  const touch = event.touches && event.touches[0];
  if (!touch) return;
  const dy = touch.clientY - memoStudentPickerBounceStartY;
  if (Math.abs(dy) < 3) return;
  const offset = Math.max(-14, Math.min(14, dy * 0.28));
  memoStudentPickerBounceList.style.transform = `translateY(${offset}px)`;
  event.preventDefault();
}

function handleMemoStudentPickerListBounceEnd() {
  if (!memoStudentPickerBounceActive || !memoStudentPickerBounceList) return;
  const list = memoStudentPickerBounceList;
  memoStudentPickerBounceActive = false;
  memoStudentPickerBounceList = null;
  resetMemoStudentPickerListBounce(list);
}

function isMemoStudentSelectPopupOpen() {
  const popup = document.getElementById('memoStudentSelectPopup');
  return !!(popup && popup.classList.contains('show'));
}
function isMemoStudentSelectOutsideTarget(target) {
  const studentSelectWrap = document.getElementById('memoStudentSelectWrap');
  if (!studentSelectWrap || !target) return false;
  if (target.closest && target.closest('#studentModal, #elementaryInfoModal, #kinderInfoModal')) return false;
  return !studentSelectWrap.contains(target);
}
function closeMemoStudentSelectPopupFromOutsideAction(event) {
  if (!isMemoStudentSelectPopupOpen()) return;
  if (isMemoStudentSelectOutsideTarget(event.target)) closeMemoStudentSelectPopup();
}
document.addEventListener('click', (event) => {
  closeMemoStudentSelectPopupFromOutsideAction(event);
});
document.addEventListener('pointerdown', handleMemoStudentPickerPointerDown, { capture: true, passive: true });
document.addEventListener('pointermove', handleMemoStudentPickerPointerMove, { capture: true, passive: true });
document.addEventListener('pointerup', handleMemoStudentPickerPointerUp, { capture: true, passive: true });
document.addEventListener('pointercancel', handleMemoStudentPickerPointerUp, { capture: true, passive: true });
document.addEventListener('touchstart', handleMemoStudentPickerTouchStart, { capture: true, passive: true });
document.addEventListener('touchmove', handleMemoStudentPickerTouchMove, { capture: true, passive: true });
document.addEventListener('touchend', handleMemoStudentPickerTouchEnd, { capture: true, passive: true });
document.addEventListener('touchstart', handleMemoStudentPickerListBounceStart, { capture: true, passive: true });
document.addEventListener('touchmove', handleMemoStudentPickerListBounceMove, { capture: true, passive: false });
document.addEventListener('touchend', handleMemoStudentPickerListBounceEnd, { capture: true, passive: true });
document.addEventListener('touchcancel', handleMemoStudentPickerListBounceEnd, { capture: true, passive: true });
document.addEventListener('click', guardMemoStudentPickerOptionClick, { capture: true });
document.addEventListener('touchstart', closeMemoStudentSelectPopupFromOutsideAction, { capture: true, passive: true });
document.addEventListener('pointerdown', closeMemoStudentSelectPopupFromOutsideAction, { capture: true });

/* 2026-04-27: 초등부/유치부 노트 선택 팝업 분리
   - 초등부: 관찰 노트 / 성장 노트
   - 유치부: 1분 피드백 / 성장 피드백
*/
