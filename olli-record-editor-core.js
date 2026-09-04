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
function renderMemoModeMenu() {
  const menu = document.getElementById('memoModeDropup');
  if (!menu) return;
  const checkSvg = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"></path></svg>';
  const option = (active, title, guide, action) => `
    <button type="button" class="memoRecordOption ${active ? 'active' : ''}" onclick="${action}">
      <span class="memoModeCheck" aria-hidden="true">${active ? checkSvg : ''}</span>
      <span class="memoModeOptionText">
        <span class="memoModeOptionTitle">${title}</span>
        <span class="memoModeOptionGuide">${guide}</span>
      </span>
    </button>`;
  menu.innerHTML = `
    ${option(false, '1분 피드백(유치부)', '일상 관찰을 빠르게 정리', "closeMemoModeMenu(); openKinderChatFeedbackPage();")}
    ${option(false, '성장 피드백(유치부)', '막힘·전환 장면을 깊게 정리', "closeMemoModeMenu(); openKinderChatFeedbackGrowthSheet();")}
    ${option(true, '관찰 노트(초등부)', '초등부 관찰노트로 이동', "closeMemoModeMenu(); openMemoObservationMode(event);")}
  `;
}
function closeMemoModeMenu() { const menu = document.getElementById('memoModeDropup'); if (menu) menu.classList.remove('show'); }
function setMemoModePillLabel(label = '학생 이름', modeLabel = '관찰 모드') {
  const el = document.getElementById('memoStudentName');
  const sub = document.getElementById('memoModeSub');
  if (el) el.textContent = '관찰 노트';
  if (sub) sub.textContent = modeLabel || '관찰 모드';
}
function formatMemoUpdatedDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${d} ${hh}:${mm}`;
}
function updateMemoStudentMetaDisplay(student, updatedAt = '') {
  const nameEl = document.getElementById('memoPageStudentName');
  const dateEl = document.getElementById('memoStudentUpdatedDate');
  if (nameEl) nameEl.textContent = student?.name || '학생 이름';
  if (dateEl) {
    const localEntry = getMemoEntryByStudent(student);
    const hasMemoContent = String(localEntry.content || '').trim().length > 0;
    const dateSource = updatedAt || (hasMemoContent ? localEntry.updatedAt : '');
    const dateText = formatMemoUpdatedDate(dateSource || '');
    if (dateText) {
      dateEl.hidden = false;
      dateEl.style.display = 'flex';
      dateEl.innerHTML = `<span>마지막 수정</span><span>${escapeHtml(dateText)}</span>`;
    } else {
      dateEl.hidden = true;
      dateEl.style.display = 'none';
      dateEl.innerHTML = '';
    }
  }
}
function toggleMemoModeMenu(event) {
  if (event) event.stopPropagation();
  if (currentMemoType === 'kinder') return;
  renderMemoModeMenu();
  const menu = document.getElementById('memoModeDropup');
  if (menu) menu.classList.toggle('show');
}
function closeGlobalFeedbackModeMenus() {
  ['mainCardModeDropup'].forEach(id => {
    const menu = document.getElementById(id);
    if (menu) menu.classList.remove('show');
  });
}
function renderGlobalFeedbackModeMenu(active = 'main') {
  const make = (target) => {
    const menu = document.getElementById('mainCardModeDropup');
    if (!menu) return;

    menu.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'memoRecordsTitle';
    title.textContent = '노트 선택';
    menu.appendChild(title);

    const observationBtn = document.createElement('button');
    observationBtn.type = 'button';
    observationBtn.className = 'memoRecordOption ' + (active === 'main' ? 'active' : '');
    observationBtn.textContent = '1분 피드백';
    observationBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof closeGlobalFeedbackModeMenus === 'function') closeGlobalFeedbackModeMenus();
      if (typeof openGlobalObservationMode === 'function') openGlobalObservationMode(e);
    });
    menu.appendChild(observationBtn);

    const growthBtn = document.createElement('button');
    growthBtn.type = 'button';
    growthBtn.className = 'memoRecordOption ' + (active === 'fail' ? 'active' : '');
    growthBtn.textContent = '성장 피드백';
    growthBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof closeGlobalFeedbackModeMenus === 'function') closeGlobalFeedbackModeMenus();
      if (active !== 'fail' && typeof openGlobalFailGrowthMode === 'function') {
        openGlobalFailGrowthMode(e);
      }
    });
    menu.appendChild(growthBtn);
  };
  make('main');
}
function toggleGlobalFeedbackModeMenu(event, active = 'main') {
  if (event) event.stopPropagation();
  renderGlobalFeedbackModeMenu(active);
  const id = 'mainCardModeDropup';
  const menu = document.getElementById(id);
  if (!menu) return;
  const willOpen = !menu.classList.contains('show');
  closeGlobalFeedbackModeMenus();
  if (willOpen) menu.classList.add('show');
}
function openGlobalObservationMode(event) {
  if (event) event.stopPropagation();
  closeGlobalFeedbackModeMenus();
}
function openGlobalFailGrowthMode(event) {
  if (event) event.stopPropagation();
  closeGlobalFeedbackModeMenus();
  if (typeof openKinderChatFeedbackGrowthSheet === 'function') {
    openKinderChatFeedbackGrowthSheet();
    return;
  }
  alert('성장피드백은 새 버전으로 준비 중입니다.');
}
function openMemoObservationMode(event) { if (event) event.stopPropagation(); closeMemoModeMenu(); const memo = document.getElementById('studentMemoScreen'); if (memo) memo.style.display = 'flex'; if (typeof forceStudentMemoControlsVisible === 'function') { forceStudentMemoControlsVisible(); requestAnimationFrame(forceStudentMemoControlsVisible); } }
function openMemoFailGrowthMode(event) {
  if (event) event.stopPropagation();
  closeMemoModeMenu();
  if (typeof openElementaryGrowthFeedbackSheet === 'function') {
    openElementaryGrowthFeedbackSheet();
    return;
  }
  alert('초등부 성장피드백을 열 수 없습니다.');
}
document.addEventListener('click', (event) => { const wrap = document.getElementById('memoModeWrap'); if (wrap && !wrap.contains(event.target)) closeMemoModeMenu(); });
document.addEventListener('click', (event) => {
  const mainWrap = document.getElementById('mainCardModeWrap');
  if (!mainWrap || !mainWrap.contains(event.target)) closeGlobalFeedbackModeMenus();
});

const SCENE_CARD_OPTIONS = [
  { id:'start', no:1, title:'시작 반응', question:'주제를 들었을 때 아이의 첫 표정과 말은?', main:'주제를 들었을 때 아이의 첫 반응은 어땠나요?', sub:'그 반응이 수업 흐름에 어떤 영향을 주었나요?', keywords:['첫 반응','표정','망설임','기대','긴장'], color:'#e8a66b', bg:'#fff5eb' },
  { id:'words', no:2, title:'아이의 말', question:'오늘 남기고 싶은 아이의 한마디는?', main:'오늘 아이가 한 말 중 기억나는 문장은 무엇인가요?', sub:'그 말 안에 아이의 감정이나 생각이 어떻게 담겨 있었나요?', keywords:['발화','생각','감정','질문','표현'], color:'#6caed6', bg:'#edf7ff' },
  { id:'choice', no:3, title:'선택', question:'아이가 스스로 고른 색·재료·방법은?', main:'오늘 아이가 스스로 선택한 것은 무엇인가요?', sub:'그 선택이 아이의 주도성이나 자신감과 어떻게 연결되었나요?', keywords:['선택','주도성','결정','취향','자기표현'], color:'#78b965', bg:'#f3fbef' },
  { id:'difficulty', no:4, title:'어려움', question:'잠시 망설이거나 힘들어한 순간은?', main:'오늘 아이가 어려움을 느낀 순간은 어디였나요?', sub:'그 어려움은 기술, 감정, 이해, 관계 중 어디에 가까웠나요?', keywords:['막힘','망설임','불안','난이도','도움'], color:'#d9bf3f', bg:'#fffbe8' },
  { id:'retry', no:5, title:'다시 시도', question:'어려움 뒤에 아이는 어떻게 해보았나요?', main:'어려움 뒤에 아이는 어떻게 다시 시작했나요?', sub:'선생님의 어떤 말이나 도움 뒤에 변화가 생겼나요?', keywords:['재도전','회복','용기','수정','지속'], color:'#a77ad1', bg:'#f7f0ff' },
  { id:'material', no:6, title:'재료 반응', question:'재료를 만났을 때 아이의 감각 반응은?', main:'재료를 만났을 때 아이는 어떻게 반응했나요?', sub:'그 반응이 몰입, 탐색, 표현으로 이어졌나요?', keywords:['재료','감각','탐색','흥미','표현'], color:'#4db58f', bg:'#effbf6' },
  { id:'focus', no:7, title:'몰입', question:'가장 오래 빠져든 순간은 언제였나요?', main:'오늘 아이가 가장 몰입한 순간은 언제였나요?', sub:'무엇이 아이의 집중을 오래 유지하게 했나요?', keywords:['몰입','집중','지속','흥미','깊이'], color:'#db74a0', bg:'#fff1f6' },
  { id:'relation', no:8, title:'관계', question:'친구·선생님과 함께한 따뜻한 장면은?', main:'오늘 관계 안에서 기억나는 장면은 무엇인가요?', sub:'친구나 선생님과의 상호작용이 아이에게 어떤 힘이 되었나요?', keywords:['관계','공감','협력','대화','신뢰'], color:'#6e86cf', bg:'#f1f4ff' },
  { id:'growth', no:9, title:'성장', question:'이전보다 달라진 작은 변화는?', main:'이전보다 달라진 작은 변화는 무엇인가요?', sub:'그 변화가 앞으로 어떤 성장으로 이어질 수 있을까요?', keywords:['성장','변화','자신감','가능성','다음 단계'], color:'#9b9b42', bg:'#fbfbef' }
];
let sceneCardsVisible = false;
const selectedSceneIds = new Set();
const flippedSceneIds = new Set();
const SCENE_MEMO_LABELS = {
  start: '시작 반응 :',
  words: '오늘 아이가 한 말 :',
  choice: '아이의 선택 :',
  difficulty: '어려움 :',
  retry: '다시 시도 :',
  material: '재료 반응 :',
  focus: '몰입한 순간 :',
  relation: '관계 형성 순간 :',
  growth: '성장 장면 :'
};
let previousScreenBeforeRecordRoom = 'mainPage';
function getSceneById(id) { return SCENE_CARD_OPTIONS.find(item => item.id === id); }
function renderSceneInput() {
  const area = document.getElementById('sceneInputArea');
  const tagArea = document.getElementById('sceneTagArea');
  const toggleBtn = document.getElementById('sceneModeToggleBtn');
  if (area) area.innerHTML = '';
  if (tagArea) tagArea.innerHTML = '';
  if (toggleBtn) {
    const opened = isSceneCardModalOpen();
    toggleBtn.classList.toggle('active', opened);
    toggleBtn.title = opened ? '장면카드 닫기' : '장면카드 열기';
    toggleBtn.setAttribute('aria-label', toggleBtn.title);
  }
  renderSceneCardModal();
  updateSelectedSceneUI();
}

function buildSceneCardGridHtml() {
  const sceneIcon = `<div class="sceneIconBox"><svg class="sceneIconSvg" viewBox="0 0 92 72" aria-hidden="true"><rect class="cardBack" x="17" y="16" width="45" height="34" rx="9"></rect><rect class="cardFront" x="31" y="22" width="45" height="34" rx="9"></rect><path class="cardDiamond" d="M53.5 28.5l9 9-9 9-9-9 9-9z"></path></svg></div>`;
  return `<div class="sceneGrid">${SCENE_CARD_OPTIONS.map(item => {
    const selected = selectedSceneIds.has(item.id);
    const flipped = flippedSceneIds.has(item.id);
    const cls = ['sceneCard'];
    if (selected) cls.push('selected');
    if (flipped) cls.push('flipped');
    const slotCls = ['sceneCardSlot'];
    if (flipped) slotCls.push('hasFlipped');
    const numberContent = selected ? '<svg class="sceneCheckIcon" viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"></path></svg>' : item.no;
    const front = `<div class="sceneNumber">${item.no}</div>${sceneIcon}<div class="sceneTitle">${item.no}. ${item.title}</div>`;
    const back = `<span class="sceneBackCloseBtn" role="button" aria-label="닫기" onclick="handleSceneBackClose(event,'${item.id}')">×</span><div class="sceneNumber">${item.no}</div><div class="sceneBackMain">${item.main}</div><div class="sceneBackSub">${item.sub}</div><div class="sceneBackKeywords">${item.keywords.map(k => `<span>${k}</span>`).join('')}</div>`;
    return `<div class="${slotCls.join(' ')}"><button type="button" class="${cls.join(' ')}" onclick="handleSceneCardBodyClick('${item.id}')">${flipped ? back : front}</button><button type="button" class="sceneCardSelectBtn" onclick="handleSceneNumberClick(event,'${item.id}')">${numberContent}</button></div>`;
  }).join('')}</div>`;
}

function updateSceneCardModalMeta() {
  const count = document.getElementById('sceneCardModalCount');
  if (count) count.textContent = `${selectedSceneIds.size} / ${SCENE_CARD_OPTIONS.length} 선택`;
  const pageCount = document.getElementById('kinderSelectedCount');
  if (pageCount) pageCount.textContent = `${selectedSceneIds.size} / ${SCENE_CARD_OPTIONS.length} 선택`;
  const resetBtn = document.getElementById('sceneCardModalResetBtn');
  if (resetBtn) resetBtn.disabled = selectedSceneIds.size === 0;
}
function renderSceneCardModal() {
  const body = document.getElementById('sceneCardModalBody');
  if (!body) return;
  body.innerHTML = buildSceneCardGridHtml();
  updateSceneCardModalMeta();
}
function clearSceneSelections() {
  selectedSceneIds.clear();
  flippedSceneIds.clear();
  renderSceneInput();
}

function isSceneCardModalOpen() {
  const overlay = document.getElementById('sceneCardModalOverlay');
  return !!overlay && overlay.classList.contains('show');
}

function syncSceneToggleButton() {
  const toggleBtn = document.getElementById('sceneModeToggleBtn');
  if (!toggleBtn) return;
  const opened = isSceneCardModalOpen();
  toggleBtn.classList.toggle('active', opened);
  toggleBtn.title = opened ? '장면카드 닫기' : '장면카드 열기';
  toggleBtn.setAttribute('aria-label', toggleBtn.title);
}

function openSceneCardModal() {
  const overlay = document.getElementById('sceneCardModalOverlay');
  if (!overlay) return;
  renderSceneCardModal();
  overlay.classList.add('show');
  document.body.classList.add('modalOpen');
  syncSceneToggleButton();
}

function closeSceneCardModal() {
  const overlay = document.getElementById('sceneCardModalOverlay');
  if (!overlay) return;
  overlay.classList.remove('show');
  document.body.classList.remove('modalOpen');
  syncSceneToggleButton();
}

function handleSceneCardModalOverlayClick(event) {
  if (event.target && event.target.id === 'sceneCardModalOverlay') closeSceneCardModal();
}

function insertSceneMemoLabel(id) {
  const textarea = document.getElementById('sceneMemoInput');
  const label = SCENE_MEMO_LABELS[id];
  if (!textarea || !label) return;

  const current = textarea.value || '';
  const lines = current.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.includes(label)) return;

  textarea.value = current.trim() ? `${current.trim()}\n${label}` : label;

  updateSceneMemoPlaceholder();
  autoResizeSceneMemoInput(textarea);
}
function updateSceneMemoPlaceholder() {
  const textarea = document.getElementById('sceneMemoInput');
  const placeholder = document.getElementById('sceneMemoPlaceholder');
  if (!textarea || !placeholder) return;
  placeholder.classList.toggle('hide', !!textarea.value.trim());
}

function resetSceneMemoViewIfEmpty(textarea) {
  if (!textarea) return;
  textarea.value = (textarea.value || '').replace(/ /g, ' ').trim();
  updateSceneMemoPlaceholder();
  if (textarea.value) return;
  try {
    textarea.selectionStart = 0;
    textarea.selectionEnd = 0;
  } catch {}
  textarea.scrollTop = 0;
  textarea.scrollLeft = 0;
  textarea.blur();
  requestAnimationFrame(() => {
    textarea.scrollTop = 0;
    textarea.scrollLeft = 0;
    updateSceneMemoPlaceholder();
  });
}
function removeSceneMemoLabel(id) {
  const textarea = document.getElementById('sceneMemoInput');
  const label = SCENE_MEMO_LABELS[id];
  if (!textarea || !label) return;

  const current = textarea.value || '';
  const lines = current.split('\n');
  let removed = false;
  const nextLines = lines.filter(line => {
    if (!removed && line.trim() === label) {
      removed = true;
      return false;
    }
    return true;
  });

  if (!removed) return;

  textarea.value = nextLines
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');

  autoResizeSceneMemoInput(textarea);
  resetSceneMemoViewIfEmpty(textarea);
}
function handleSceneNumberClick(event, id) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (selectedSceneIds.has(id)) {
    selectedSceneIds.delete(id);
    flippedSceneIds.delete(id);
    removeSceneMemoLabel(id);
  } else {
    selectedSceneIds.add(id);
    flippedSceneIds.delete(id);
    insertSceneMemoLabel(id);
  }
  renderSceneInput();
}

function handleSceneBackClose(event, id) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  flippedSceneIds.delete(id);
  renderSceneInput();
}

function handleSceneCardBodyClick(id) {
  if (!selectedSceneIds.has(id)) {
    selectedSceneIds.add(id);
    flippedSceneIds.clear();
    insertSceneMemoLabel(id);
    renderSceneInput();
    return;
  }
  if (flippedSceneIds.has(id)) {
    flippedSceneIds.delete(id);
  } else {
    flippedSceneIds.clear();
    flippedSceneIds.add(id);
  }
  renderSceneInput();
}
function toggleSceneTag(id) { handleSceneNumberClick(null, id); }
function toggleSceneInputMode() {
  if (isSceneCardModalOpen()) closeSceneCardModal();
  else openSceneCardModal();
}
function openSceneCardsFromAnyPage() { openSceneCardModal(); }
function getSelectedScenePayload() { return Array.from(selectedSceneIds).map(id => getSceneById(id)).filter(Boolean); }
function renderKinderFeedbackSceneGrid() {
  const area = document.getElementById('kinderSceneGrid');
  if (!area) return;
  area.innerHTML = SCENE_CARD_OPTIONS.map(item => {
    const active = selectedSceneIds.has(item.id) ? ' active' : '';
    return `<div role="button" tabindex="0" class="kinderSceneChip${active}" data-id="${item.id}" onclick="handleKinderSceneCardTap(event, '${item.id}')">
      <button type="button" class="kinderSceneMarkerWrap" onclick="toggleKinderSceneMarker(event, '${item.id}')" aria-label="선택 토글">
        <span class="kinderChipNum">
          <span class="kinderSceneNumText">${item.no}</span>
          <svg class="kinderSceneCheckIcon" viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7.3" stroke="currentColor" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </button>
      <span class="kinderChipTitle">${escapeHtml(item.title)}</span>
    </div>`;
  }).join('');
}
function updateSelectedSceneUI() {
  renderKinderFeedbackSceneGrid();
  updateSceneCardModalMeta();
}


function setFeedbackPageBackgroundActive(active) {
  document.body.classList.toggle('feedbackPageActive', !!active);
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute('content', '#FEFEFE');
}

function resetVisibleFailGrowthPagesOnLeave() {}

function vivizacSlideInPage(pageOrId) {
  const page = typeof pageOrId === 'string' ? document.getElementById(pageOrId) : pageOrId;
  if (!page) return;
  const fromBottom = false;
  page.classList.remove('vivizac-slide-in', 'vivizac-slide-out', 'vivizac-slide-from-bottom');
  if (fromBottom) page.classList.add('vivizac-slide-from-bottom');
  page.classList.add('vivizac-slide-page');
  void page.offsetWidth;
  page.classList.add('vivizac-slide-in');
  setTimeout(() => {
    page.classList.remove('vivizac-slide-page', 'vivizac-slide-in', 'vivizac-slide-from-bottom');
  }, 330);
}

function vivizacSlideOutPageToRecord(pageOrId, after) {
  const page = typeof pageOrId === 'string' ? document.getElementById(pageOrId) : pageOrId;
  const record = document.getElementById('recordRoomScreen');

  if (!page) {
    if (typeof after === 'function') after();
    return;
  }

  if (record) record.style.display = 'flex';

  page.classList.remove('vivizac-slide-in', 'vivizac-slide-out');
  page.classList.add('vivizac-slide-page');
  void page.offsetWidth;
  page.classList.add('vivizac-slide-out');

  setTimeout(() => {
    page.classList.remove('vivizac-slide-page', 'vivizac-slide-out');
    page.style.display = 'none';
    if (typeof after === 'function') after();
  }, 280);
}

function vivizacGetVisibleNotePage() {
  const ids = ['studentMemoScreen',  'settingsPageScreen', 'settingsDetailScreen'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && el.style.display !== 'none') return el;
  }
  return null;
}

function hideModalOnly(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.style.display = 'none';
}

function closeModalById(modalId) {
  switch (modalId) {
    case 'elementaryAnalysisModal': closeElementaryAnalysisModal(); break;
    case 'saveModal': closeSaveModal(); break;
    case 'studentModal': closeStudentModal(); break;
    case 'elementaryInfoModal': closeElementaryInfoModal(); break;
    case 'kinderInfoModal': closeKinderInfoModal(); break;
    case 'kinderTransferModal': closeKinderTransferModal(); break;
    default: hideModalOnly(modalId);
  }
}

function bindModalCloseEvents() {
  document.querySelectorAll('[data-modal-close]').forEach(btn => {
    if (btn.dataset.modalBound === '1') return;
    btn.dataset.modalBound = '1';
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      closeModalById(btn.dataset.modalClose);
    });
  });

  document.querySelectorAll('.modalOverlay').forEach(modal => {
    if (modal.dataset.overlayBound === '1') return;
    modal.dataset.overlayBound = '1';
    modal.addEventListener('click', event => {
      if (event.target === modal) closeModalById(modal.id);
    });
  });
}


/* 2026-05-01: 모달 취소 버튼 안정화
   팝업 내부 HTML이 다시 그려져도 data-modal-close 버튼은 항상 닫히게 document 위임으로 처리 */
if (!window.__olliDelegatedModalCloseBound) {
  window.__olliDelegatedModalCloseBound = true;
  document.addEventListener('click', function(event) {
    const closeBtn = event.target && event.target.closest ? event.target.closest('[data-modal-close]') : null;
    if (!closeBtn) return;

    const modalId = closeBtn.getAttribute('data-modal-close');
    if (!modalId) return;

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

    if (typeof closeModalById === 'function') {
      closeModalById(modalId);
    } else {
      const modal = document.getElementById(modalId);
      if (modal) modal.style.display = 'none';
    }
  }, true);
}


function getRecordSearchScreen() {
  return document.getElementById('recordRoomScreen');
}
function getRecordSearchPill() {
  return document.getElementById('recordSearchPill');
}
function getRecordSearchInput() {
  return document.getElementById('searchName');
}
function isRecordSearchOpen() {
  const screen = getRecordSearchScreen();
  return !!(screen && screen.classList.contains('record-search-open'));
}
function getRecordKeyboardOffset() {
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  return Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop) - 6);
}
function setRecordKeyboardOffset() {
  const input = getRecordSearchInput();
  const offset = (isRecordSearchOpen() || document.activeElement === input) ? getRecordKeyboardOffset() : 0;
  document.documentElement.style.setProperty('--record-keyboard-offset', `${offset}px`);
}
function syncRecordSearchQueryState() {
  const screen = getRecordSearchScreen();
  const input = getRecordSearchInput();
  const hasQuery = !!(input && String(input.value || '').trim());
  if (screen) screen.classList.toggle('record-search-has-query', hasQuery);
}
function focusRecordSearchInput() {
  const input = getRecordSearchInput();
  if (!input) return;
  input.style.pointerEvents = 'auto';
  try { input.focus({ preventScroll: true }); } catch(err) { input.focus(); }
  try { input.setSelectionRange(input.value.length, input.value.length); } catch(err) {}
  setRecordKeyboardOffset();
}
function handleSearchPillClick(event) {
  if (event) event.stopPropagation();
  const screen = getRecordSearchScreen();
  const pill = getRecordSearchPill();

  if (screen) screen.classList.add('record-search-open');
  if (pill) pill.classList.add('active');
  syncRecordSearchQueryState();

  focusRecordSearchInput();
  setTimeout(focusRecordSearchInput, 20);
  setTimeout(setRecordKeyboardOffset, 120);
  setTimeout(setRecordKeyboardOffset, 280);
}
function closeSearch(event) {
  if (event) event.stopPropagation();
  const screen = getRecordSearchScreen();
  const pill = getRecordSearchPill();
  const input = getRecordSearchInput();

  if (screen) {
    screen.classList.remove('record-search-open');
    screen.classList.remove('record-search-has-query');
  }
  if (pill) pill.classList.remove('active');
  if (input) {
    input.value = '';
    try { input.blur(); } catch(err) {}
  }

  document.documentElement.style.setProperty('--record-keyboard-offset', '0px');
  loadRecords('');
}
async function searchRecords() {
  syncRecordSearchQueryState();
  const input = getRecordSearchInput();
  const name = input ? input.value.trim() : '';

  if (!isRecordSearchOpen()) {
    await loadRecords('');
    return;
  }
  if (!name) {
    await loadRecords('');
    return;
  }
  await loadRecords(name);
}
function restoreRecordSearchIfKeyboardClosed() {
  const input = getRecordSearchInput();
  if (!isRecordSearchOpen() || !input) return;

  const keyboardClosed = getRecordKeyboardOffset() < 24;
  const inputFocused = document.activeElement === input;
  const suppressUntil = window.__olliRecordSearchSuppressRestoreUntil || 0;
  const suppressRestore = Date.now() < suppressUntil;

  if (keyboardClosed && !inputFocused) {
    document.documentElement.style.setProperty('--record-keyboard-offset', '0px');
    if (suppressRestore) return;
    closeSearch();
  }
}
function restoreRecordSearchAfterAppReturn() {
  if (document.hidden) return;

  const screen = getRecordSearchScreen();
  const input = getRecordSearchInput();
  const pill = getRecordSearchPill();

  const recordVisibleNow = !!(screen && getComputedStyle(screen).display !== 'none');
  const userSearchingNow = !!(recordVisibleNow && screen.classList.contains('record-search-open') && input && document.activeElement === input);
  if (userSearchingNow) return;

  if (input && document.activeElement === input) {
    try { input.blur(); } catch(err) {}
  }

  if (screen) {
    screen.classList.remove('record-search-open');
    screen.classList.remove('record-search-has-query');
  }
  if (pill) pill.classList.remove('active');
  document.documentElement.style.setProperty('--record-keyboard-offset', '0px');

  const list = document.getElementById('recordList');
  const query = input ? String(input.value || '').trim() : '';
  if (recordVisibleNow && list && list.children.length === 0 && !query) {
    loadRecords('');
  }
}
function openRecordSearchFromInputFallback(event) {
  if (isRecordSearchOpen()) return;
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  handleSearchPillClick(event);
}
function bindRecordSearchInput() {
  const input = getRecordSearchInput();
  if (!input || input.dataset.recordSearchMainBound === '1') return;
  input.dataset.recordSearchMainBound = '1';
  input.setAttribute('inputmode', 'search');
  input.setAttribute('enterkeyhint', 'done');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');

  input.addEventListener('input', function() {
    syncRecordSearchQueryState();
    searchRecords();
  });
  input.addEventListener('focus', function(event) {
    if (!isRecordSearchOpen()) {
      setTimeout(function() { openRecordSearchFromInputFallback(event); }, 0);
    }
    setTimeout(setRecordKeyboardOffset, 40);
    setTimeout(setRecordKeyboardOffset, 160);
    setTimeout(setRecordKeyboardOffset, 300);
  }, true);
  input.addEventListener('click', openRecordSearchFromInputFallback, true);
  input.addEventListener('blur', function() {
    setTimeout(restoreRecordSearchIfKeyboardClosed, 180);
    setTimeout(restoreRecordSearchIfKeyboardClosed, 360);
  });
  input.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch(event);
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    window.__olliRecordSearchSuppressRestoreUntil = Date.now() + 900;
    searchRecords();
    try { input.blur(); } catch(err) {}
    setTimeout(setRecordKeyboardOffset, 120);
    setTimeout(setRecordKeyboardOffset, 320);
  });
}
function initRecordSearchHandlers() {
  bindRecordSearchInput();
  if (window.visualViewport && !window.__olliRecordSearchViewportBound) {
    window.__olliRecordSearchViewportBound = true;
    window.visualViewport.addEventListener('resize', function() {
      setRecordKeyboardOffset();
      setTimeout(restoreRecordSearchIfKeyboardClosed, 180);
    });
    window.visualViewport.addEventListener('scroll', function() {
      setRecordKeyboardOffset();
      setTimeout(restoreRecordSearchIfKeyboardClosed, 180);
    });
  }
  if (!window.__olliRecordSearchWindowResizeBound) {
    window.__olliRecordSearchWindowResizeBound = true;
    window.addEventListener('resize', setRecordKeyboardOffset);
  }
  if (!window.__olliRecordSearchVisibilityBound) {
    window.__olliRecordSearchVisibilityBound = true;
    document.addEventListener('visibilitychange', restoreRecordSearchAfterAppReturn);
    window.addEventListener('pageshow', restoreRecordSearchAfterAppReturn);
  }
}
window.setRecordKeyboardOffset = setRecordKeyboardOffset;
window.toggleRecordSearch = handleSearchPillClick;
document.addEventListener('DOMContentLoaded', initRecordSearchHandlers);
initRecordSearchHandlers();

function clearRecordInteractionState() {
  const screen = document.getElementById('recordRoomScreen');
  const pill = document.getElementById('recordSearchPill');
  const input = document.getElementById('searchName');
  const overlay = document.getElementById('studentActionOverlay');
  const controls = document.getElementById('recordSelectionControls');

  if (screen) screen.classList.remove('record-search-open');
  if (pill) pill.classList.remove('active');
  if (input) input.value = '';
  if (overlay) overlay.classList.remove('show');
  if (controls) controls.classList.remove('show');
  studentSelectionMode = false;
  selectedStudentIds.clear();
  selectedStudentActionId = '';
  suppressNextStudentClick = false;
  closeRecordAddMenu();
  updateRecordHeaderUI();
}

function closeRecordAddMenu() {
  const menu = document.getElementById('recordAddMenu');
  const btn = document.getElementById('studentAddBtn');
  if (menu) {
    menu.classList.remove('show');
    menu.setAttribute('aria-hidden', 'true');
  }
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function toggleRecordAddMenu(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const menu = document.getElementById('recordAddMenu');
  const btn = document.getElementById('studentAddBtn');
  if (!menu) return;
  const wasOpen = menu.classList.contains('show');
  clearRecordInteractionState();
  if (wasOpen) {
    if (btn) btn.setAttribute('aria-expanded', 'false');
    return;
  }
  menu.classList.add('show');
  menu.setAttribute('aria-hidden', 'false');
  if (btn) btn.setAttribute('aria-expanded', 'true');
}

function openStudentAddFromRecordMenu(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  closeRecordAddMenu();
  clearRecordInteractionState();
  openStudentModal();
}

function openKinderChatFeedbackFromRecordMenu(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  closeRecordAddMenu();
  clearRecordInteractionState();
  if (typeof openKinderChatFeedbackPage === 'function') openKinderChatFeedbackPage();
}

function handleStudentAddButton(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  closeRecordAddMenu();
  clearRecordInteractionState();
  openStudentModal();
}

function bindStudentAddButton() {
  const btn = document.getElementById('studentAddBtn');
  if (!btn || btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';
}
if (!window.__olliStudentAddDelegatedBound) {
  window.__olliStudentAddDelegatedBound = true;
  document.addEventListener('click', function(event) {
    const btn = event.target && event.target.closest ? event.target.closest('#studentAddBtn') : null;
    if (!btn) return;
    handleStudentAddButton(event);
  }, true);
}
if (!window.__olliRecordAddMenuCloseBound) {
  window.__olliRecordAddMenuCloseBound = true;
  document.addEventListener('click', function(event) {
    const insideMenu = event.target && event.target.closest ? event.target.closest('#recordAddMenu') : null;
    const addBtn = event.target && event.target.closest ? event.target.closest('#studentAddBtn') : null;
    if (!insideMenu && !addBtn) closeRecordAddMenu();
  });
}
function buildSceneCardUserText(extraText) { const selected = getSelectedScenePayload(); const memo = typeof extraText === 'string' ? extraText.trim() : (document.getElementById('sceneMemoInput')?.value || '').trim(); const sceneLines = selected.length ? selected.map(item => `- ${item.no}. ${item.title}\n  메인질문: ${item.main}\n  확장질문: ${item.sub}\n  핵심키워드: ${item.keywords.join(', ')}`).join('\n') : '- 선택된 장면 없음'; return `아래 장면카드 선택 내용과 선생님 메모를 바탕으로 학부모에게 보낼 따뜻하고 전문적인 피드백을 작성해줘.\n\n[선택된 장면카드]\n${sceneLines}\n\n[선생님 메모]\n${memo}`; }


let feedbackLoadingTimer = null;
let feedbackLoadingTypingTimer = null;
let feedbackLoadingStep = 0;
function getFeedbackLoadingSteps(type) {
  return [
    ['선생님의 관찰 기록을 바탕으로', '아이의 수업 상황을 시뮬레이션 중입니다.'],
    ['선생님의 관찰 기록을 바탕으로', '아이의 실패 / 막힘 / 감정변화를 성장의 흐름으로 정리하고 있습니다.'],
    ['선생님의 관찰 기록이', '부모님께 잘 전달 될수 있도록 키워드 요소를 분석 중입니다.']
  ];
}
function typeFeedbackLoadingText(el, text, done) {
  if (!el) { if (done) done(); return; }
  if (feedbackLoadingTypingTimer) {
    clearInterval(feedbackLoadingTypingTimer);
    feedbackLoadingTypingTimer = null;
  }
  let i = 0;
  el.innerHTML = '<span class="feedbackLoadingCursor"></span>';
  feedbackLoadingTypingTimer = setInterval(() => {
    i += 1;
    el.innerHTML = escapeHtml(text.slice(0, i)) + '<span class="feedbackLoadingCursor"></span>';
    if (i >= text.length) {
      clearInterval(feedbackLoadingTypingTimer);
      feedbackLoadingTypingTimer = null;
      if (done) done();
    }
  }, 42);
}
function renderFeedbackLoadingStep(steps) {
  const title = document.getElementById('feedbackLoadingTitle');
  const body = document.getElementById('feedbackLoadingText');
  const step = steps[feedbackLoadingStep];
  if (!step) return;
  typeFeedbackLoadingText(title, step[0], () => {
    typeFeedbackLoadingText(body, step[1]);
  });
}
function showFeedbackLoading(type='class') {
  hideFeedbackLoading();
  const steps = getFeedbackLoadingSteps(type);
  feedbackLoadingStep = 0;
  const overlay = document.createElement('div');
  overlay.id = 'feedbackLoadingOverlay';
  overlay.className = 'feedbackLoadingOverlay';
  overlay.innerHTML = `<div class="feedbackLoadingCard">
    <div class="feedbackLoadingKicker">피드백 문장 정리 중</div>
    <div class="feedbackLoadingTitle" id="feedbackLoadingTitle"></div>
    <div class="feedbackLoadingText" id="feedbackLoadingText"></div>
    <div class="feedbackLoadingDots"><span></span><span></span><span></span></div>
  </div>`;
  document.body.appendChild(overlay);
  renderFeedbackLoadingStep(steps);
  feedbackLoadingTimer = setInterval(() => {
    const nextStep = feedbackLoadingStep + 1;
    if (nextStep >= steps.length) {
      clearInterval(feedbackLoadingTimer);
      feedbackLoadingTimer = null;
      return;
    }
    feedbackLoadingStep = nextStep;
    renderFeedbackLoadingStep(steps);
  }, 9750);
}
function hideFeedbackLoading() {
  if (feedbackLoadingTimer) {
    clearInterval(feedbackLoadingTimer);
    feedbackLoadingTimer = null;
  }
  if (feedbackLoadingTypingTimer) {
    clearInterval(feedbackLoadingTypingTimer);
    feedbackLoadingTypingTimer = null;
  }
  document.querySelectorAll('#feedbackLoadingOverlay, .feedbackLoadingOverlay').forEach(overlay => overlay.remove());
}

function extractFutureDirectionFromFeedback(text, fallback = '') {
  const direct = String(fallback || '').trim();
  if (direct) return direct;

  const source = String(text || '').replace(/\r/g, '').trim();
  if (!source) return '';

  const pattern = /(?:^|\n)\s*(?:\d+[.)]\s*)?(?:앞으로의\s*지도\s*방향|앞으로의\s*지도방향|향후\s*지도\s*방향|다음\s*지도\s*방향|다음\s*수업\s*방향|앞으로의\s*수업\s*방향|다음\s*단계\s*수업\s*방향|다음\s*수업에서\s*이어갈\s*방향)\s*[:：]?\s*([\s\S]*?)(?=\n\s*(?:\d+[.)]\s*)?(?:[가-힣A-Za-z ]{2,30})\s*[:：]|\n\s*\d+[.)]\s|$)/i;

  const match = source.match(pattern);
  if (match && match[1]) {
    const extracted = match[1]
      .split('\n')
      .map(line => line.replace(/^\s*[-•·]\s*/, '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (extracted) return extracted;
  }

  // 제목형 문단이 없을 때는 마지막 의미 있는 문단을 앞으로의 지도 방향으로 사용합니다.
  const paragraphs = source
    .split(/\n{2,}/)
    .map(p => p.replace(/\[TYPE:[A-Z]+\]/gi, '').trim())
    .filter(Boolean);

  const lastParagraph = [...paragraphs].reverse().find(p => {
    const compact = p.replace(/\s+/g, '');
    if (!compact) return false;
    if (/^(안녕하세요|오늘|이번수업)/.test(compact) && compact.length < 35) return false;
    return compact.length >= 18;
  });

  if (lastParagraph) {
    return lastParagraph
      .split('\n')
      .map(line => line.replace(/^\s*[-•·]\s*/, '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return '';
}
function getFutureDirectionFromApiData(data, feedbackText) {
  const candidates = [
    data?.futureDirection,
    data?.future_direction,
    data?.forwardDirection,
    data?.guideDirection,
    data?.guidanceDirection,
    data?.nextDirection,
    data?.next_direction,
    data?.nextStepDirection,
    data?.next_step_direction,
    data?.metadata?.futureDirection,
    data?.meta?.futureDirection,
    data?.result?.futureDirection
  ];
  const direct = candidates.map(v => String(v || '').trim()).find(Boolean) || '';
  return extractFutureDirectionFromFeedback(feedbackText, direct);
}
function getMemoFutureDirectionLine(feedbackText, explicitDirection = '') {
  const extracted = extractFutureDirectionFromFeedback(feedbackText, explicitDirection);
  if (extracted) return `앞으로의 지도방향 : ${extracted}`;

  const compact = String(feedbackText || '')
    .replace(/\[TYPE:[A-Z]+\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return compact
    ? `앞으로의 지도방향 : ${compact.slice(0, 160)}${compact.length > 160 ? '…' : ''}`
    : '';
}
function resetElementaryMemoAfterFeedbackSave() {
  if (!currentMemoStudent || currentMemoType !== 'elementary') return;
  clearStudentNoteDraftFromSupabase(currentMemoStudent, 'elementary_observation').catch(err => console.warn('노트 초안 삭제 실패:', err.message || err));
  clearMemoByStudent(currentMemoStudent);
  currentMemoStudent = { ...currentMemoStudent, memoUpdatedAt: '' };
  updateMemoStudentMetaDisplay(currentMemoStudent, '');
  clearElementaryAnalysisByStudent(currentMemoStudent);
  elementaryAnalysisDraft = getEmptyElementaryAnalysisState();
  selectedElementaryAnalysisHistoryId = '';
  const memo = document.getElementById('memoEditor');
  if (memo) {
    memo.readOnly = false;
    memo.value = '';
  }
  renderElementaryAnalysisSummaryCard(getEmptyElementaryAnalysisState(), { title: '분석 결과', createdAt: '' });
  renderElementaryAnalysisHistoryCards(currentMemoStudent);
  setMemoSaveStatus('자동 저장');
  if (typeof refreshMemoStudentSelectPopupIfOpen === 'function') refreshMemoStudentSelectPopupIfOpen();
}

function getCurrentMemoStudentName() {
  return currentMemoStudent?.name || document.getElementById('memoStudentName')?.textContent?.trim() || '';
}
async function autoSaveMemoFeedback(text, futureDirection = '') {
  const name = getCurrentMemoStudentName();
  const content = String(text || '').trim();
  if (!name) { alert('학생 이름을 찾지 못했어요.'); return; }
  if (!content) { alert('저장할 피드백 내용이 비어 있어요.'); return; }

  let targetStudent = currentMemoStudent && currentMemoStudent.id && currentMemoStudent.type === 'elementary' ? currentMemoStudent : null;
  if (!targetStudent) {
    const matches = getAllStudents().filter(student =>
      (student.type || 'elementary') === 'elementary' &&
      String(student.name || '').trim() === String(name || '').trim()
    );
    if (matches.length === 1) targetStudent = matches[0];
    else if (matches.length > 1) {
      alert('같은 이름의 학생이 여러 명 있습니다. 학생 목록에서 해당 학생을 다시 선택해 주세요.');
      return;
    }
  }
  if (!targetStudent) {
    alert('피드백을 저장할 학생 정보를 찾지 못했어요.');
    return;
  }

  const year = new Date().getFullYear();
  const date = new Date().toLocaleDateString('ko-KR');
  try {
    const payload = addOlliAcademyToPayload({
      student_id: targetStudent.id,
      student_name: targetStudent.name || name,
      content,
      feedback_type: 'class',
      future_direction: futureDirection || null,
      year,
      date
    }, '초등부 관찰 피드백 저장');
    await saveFeedbackRowVerified('feedbacks', payload, '초등부 관찰 피드백 저장');
    if (typeof refreshRecordsAfterFeedbackSave === 'function') await refreshRecordsAfterFeedbackSave();
    else if (typeof loadRecords === 'function') await loadRecords('');
    if (currentMemoStudent && String(currentMemoStudent.id || '') === String(targetStudent.id || '')) resetElementaryMemoAfterFeedbackSave();
    closeMemoFeedbackPopup();
    showPushToast('피드백을 기록실에 저장했어요.');
  } catch (err) {
    console.error('초등부 관찰 피드백 저장 오류:', err);
    closeMemoFeedbackPopup();
    alert(`피드백 저장 중 오류가 발생했어요.

${err.message || '알 수 없는 오류입니다.'}`);
  }
}

function closeMemoFeedbackPopup() {
  const overlay = document.getElementById('memoFeedbackPopupOverlay');
  if (overlay) overlay.remove();
}
function enterMemoFeedbackEdit(btn) {
  const card = btn.closest('.memoFeedbackPopupCard');
  if (!card) return;
  const textEl = card.querySelector('.memoFeedbackPopupText');
  const current = textEl ? textEl.textContent : '';
  card.classList.add('open');
  card.classList.add('editing');
  if (textEl) {
    textEl.outerHTML = `<textarea class="memoFeedbackEditBox">${escapeHtml(current)}</textarea>`;
    const box = card.querySelector('.memoFeedbackEditBox');
    if (box) {
      box.focus();
      box.selectionStart = box.selectionEnd = box.value.length;
    }
  }
}
function finishMemoFeedbackEdit(btn) {
  const card = btn.closest('.memoFeedbackPopupCard');
  if (!card) return;
  const box = card.querySelector('.memoFeedbackEditBox');
  const edited = box ? box.value.trim() : '';
  if (!edited) { alert('피드백 내용이 비어 있어요.'); return; }
  card._feedbackText = edited;
  card._futureDirection = extractFutureDirectionFromFeedback(edited, card._futureDirection || '');
  if (box) {
    box.outerHTML = `<div class="memoFeedbackPopupText">${escapeHtml(edited)}</div>`;
  }
  card.classList.remove('editing');
}
async function saveElementaryFeedbackDirectly(text, options = {}) {
  const content = String(text || '').trim();
  if (!content) throw new Error('저장할 피드백 내용이 비어 있습니다.');
  const studentName = normalizeTodayFeedbackStudentName(options.studentName || currentMemoStudent?.name || '');
  if (!studentName) throw new Error('아이 이름을 찾지 못했습니다.');
  const selectedStudentId = options.studentId || currentMemoStudent?.id || '';
  const savedStudent = await getOrCreateStudentForSupabaseSave(studentName, 'elementary', selectedStudentId);
  const rawType = options.feedbackType || 'class';
  const tableName = getFeedbackTableNameByType(rawType);
  const feedbackType = tableName === 'fail_feedbacks' ? 'fail' : String(rawType || 'class').toLowerCase();
  const now = new Date();
  const payload = addOlliAcademyToPayload({
    student_id: savedStudent.id,
    student_name: savedStudent.name || studentName,
    content,
    feedback_type: feedbackType,
    year: now.getFullYear(),
    date: now.toLocaleDateString('ko-KR')
  }, tableName === 'fail_feedbacks' ? '초등부 성장 피드백 저장' : '초등부 피드백 저장');
  const savedRow = await saveFeedbackRowVerified(tableName, payload, tableName === 'fail_feedbacks' ? '초등부 성장 피드백 저장' : '초등부 피드백 저장');
  await refreshRecordsAfterFeedbackSave();
  if (tableName === 'feedbacks' && currentMemoStudent && String(currentMemoStudent.id || '') === String(savedStudent.id || '')) resetElementaryMemoAfterFeedbackSave();
  if (tableName === 'fail_feedbacks' && typeof resetGrowthFeedbackAfterSuccessfulSave === 'function') resetGrowthFeedbackAfterSuccessfulSave('elementary');
  return { student: savedStudent, row: savedRow, tableName };
}

async function requestSceneCardFeedbackFromElementary(studentName, text, analysisPromptText, options = {}) {
  if (loading) return;

  const feedbackMonth = String(options.feedbackMonth || getFeedbackMonthLabel()).trim();
  const feedbackMonthNumber = Number(options.feedbackMonthNumber || getFeedbackMonthNumber());
  const combined = `${studentName} 초등부 피드백 기록
피드백 기준 월: ${feedbackMonth}

${text}${analysisPromptText ? `

[초등부 분석 데이터]
${analysisPromptText}` : ''}`;
  const userText = buildSceneCardUserText(combined);

  const btn = document.getElementById('memoFeedbackBtn');
  loading = true;
  showFeedbackLoading('elementary');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '작성 중...';
  }

  try {
    const res = await fetch('/api/chat', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        promptType: options.promptType || 'elementary',
        studentName: normalizeTodayFeedbackStudentName(studentName),
        feedbackMonth,
        feedbackMonthNumber,
        messages:[{ role:'user', content: buildTodayFeedbackRequestContent(userText, studentName, feedbackMonth) }]
      })
    });
    const rawText = await res.text();
    let data;
    try { data = rawText ? JSON.parse(rawText) : {}; } catch { data = { raw: rawText }; }
    if (!res.ok) throw new Error(getApiErrorMessage(res.status, data));
    const rawReply = String(data.reply || '').trim();
    if (!rawReply) throw new Error('응답 본문이 비어 있습니다.');
    const parsed = parseReplyType(rawReply);
    const cleanText = parsed.cleanText || rawReply;
    hideFeedbackLoading();
    const futureDirection = getFutureDirectionFromApiData(data, cleanText);
    await saveElementaryFeedbackDirectly(cleanText, {
      studentName: normalizeTodayFeedbackStudentName(studentName),
      studentId: currentMemoStudent?.id || '',
      feedbackType: options.feedbackType || 'class',
      feedbackMonth,
      feedbackMonthNumber,
      futureDirection
    });
    showPushToast(`${studentName} 피드백을 기록실에 저장했어요.`);
  } catch (err) {
    hideFeedbackLoading();
    console.error('초등부 피드백 생성/저장 오류:', err);
    alert(`초등부 피드백 생성 또는 저장 중 오류가 발생했어요.\n\n${err.message || '알 수 없는 오류입니다.'}`);
  } finally {
    loading = false;

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="memoFeedbackBottomText">피드백 생성</span><span class="memoFeedbackArrowCircle" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path></svg></span>';
    }
  }
}

function getStudentModeEntries(records, mode) {
  if (mode === 'summary') return records.filter(r => String(r.source_table || '').toLowerCase() === 'summary_feedbacks');
  return records.filter(r => String(r.feedback_type || 'class').toLowerCase() === mode);
}
function buildStudentShareText(studentName, records, mode) {
  const label = getRecordModeLabel(mode);
  const entries = getStudentModeEntries(records, mode).sort((a, b) => (parseDateSafe(b.date)?.getTime() || 0) - (parseDateSafe(a.date)?.getTime() || 0)).map(item => `${item.date || ''}\n${item.content || ''}`);
  return `${studentName} ${label}\n\n${entries.join('\n')}`.trim();
}
function copyStudentFeedback(btn, studentName, encodedRecords) {
  const records = JSON.parse(decodeURIComponent(encodedRecords));
  const text = buildStudentShareText(studentName, records, currentRecordMode);
  cp(btn, text);
}
async function shareStudentFeedback(studentName, encodedRecords) {
  const records = JSON.parse(decodeURIComponent(encodedRecords));
  const text = buildStudentShareText(studentName, records, currentRecordMode);
  await shareText(text);
}

function setObservationButtonSide(view, animate = true) {
  const modeButton = document.getElementById('recordModeToggleBtn');
  if (!modeButton) return;
  const inner = modeButton.querySelector('.flipInner');
  const shouldFlip = view === 'kinder';

  if (!animate && inner) {
    inner.classList.add('noTransition');
    modeButton.classList.toggle('flipped', shouldFlip);
    void inner.offsetWidth;
    inner.classList.remove('noTransition');
    return;
  }

  modeButton.classList.toggle('flipped', shouldFlip);
}

function updateRecordHeaderUI() {
  // 출석부 요약 탭은 삭제되었습니다. 과거 값이 남아 있으면 현재 부서 화면으로 되돌립니다.
  if (currentRecordView === 'attendance') {
    currentRecordView = currentObservationView === 'kinder' ? 'kinder' : 'elementary';
  }
  try { window.currentRecordView = currentRecordView; } catch(err) {}
  const elementaryToggle = document.getElementById('recordElementaryToggle');
  const kinderToggle = document.getElementById('recordKinderToggle');
  if (elementaryToggle) elementaryToggle.classList.toggle('active', currentRecordView === 'elementary');
  if (kinderToggle) kinderToggle.classList.toggle('active', currentRecordView === 'kinder');

  const isObservationView = currentRecordView === 'elementary' || currentRecordView === 'kinder';
  const isAcademyManagementView = currentRecordView === 'academy';
  const screen = document.getElementById('recordRoomScreen');
  if (screen) screen.classList.toggle('record-academy-management-mode', isAcademyManagementView);
  if (typeof refreshOlliRoleBasedVisibilityUI === 'function') refreshOlliRoleBasedVisibilityUI();
  const academyManageBtn = document.getElementById('recordAcademyManageBtn');
  if (academyManageBtn) academyManageBtn.classList.toggle('active', isAcademyManagementView);
  const attendanceDashboardBtn = document.getElementById('recordAttendanceDashboardBtn');
  if (attendanceDashboardBtn) attendanceDashboardBtn.classList.toggle('active', isObservationView);
  const modeLabelRow = document.querySelector('#recordRoomScreen .recordModeLabelRow');
  if (modeLabelRow) modeLabelRow.style.display = isAcademyManagementView ? 'none' : '';
  const academyDashboard = document.getElementById('recordAcademyDashboard');
  if (academyDashboard) academyDashboard.classList.toggle('show', isAcademyManagementView);
  const recordList = document.getElementById('recordList');
  if (recordList) recordList.style.display = isAcademyManagementView ? 'none' : '';

  const addBtn = document.getElementById('studentAddBtn');
  if (addBtn) {
    if (isObservationView && !studentSelectionMode) addBtn.classList.add('show');
    else {
      addBtn.classList.remove('show');
      closeRecordAddMenu();
    }
  }

  const selectionControls = document.getElementById('recordSelectionControls');
  if (selectionControls) {
    if (isObservationView && studentSelectionMode) selectionControls.classList.add('show');
    else selectionControls.classList.remove('show');
  }
}


function restoreRecordSearchFocus() {
  const screen = document.getElementById('recordRoomScreen');
  const input = document.getElementById('searchName');
  if (!screen || !screen.classList.contains('record-search-open') || !input) return;
  try { input.focus({ preventScroll:true }); } catch(err) { input.focus(); }
  try { input.setSelectionRange(input.value.length, input.value.length); } catch(err) {}
  if (typeof window.setRecordKeyboardOffset === 'function') window.setRecordKeyboardOffset();
}

function handleRecordViewTogglePress(event, targetView) {
  const screen = document.getElementById('recordRoomScreen');
  if (screen && screen.classList.contains('record-search-open')) {
    if (event) event.preventDefault();
    window.__recordViewToggleHandledUntil = Date.now() + 500;
    toggleRecordViewMode(targetView);
    restoreRecordSearchFocus();
    setTimeout(restoreRecordSearchFocus, 60);
    return;
  }
  toggleRecordViewMode(targetView);
}

function handleRecordViewToggleClick(event, targetView) {
  if (Date.now() < (window.__recordViewToggleHandledUntil || 0)) {
    if (event) event.preventDefault();
    return;
  }
  toggleRecordViewMode(targetView);
}

async function toggleRecordViewMode(targetView) {
  studentSelectionMode = false;
  selectedStudentIds.clear();

  // 삭제된 출석부 요약 탭으로 들어오려는 호출은 현재 부서 화면으로 되돌립니다.
  if (targetView === 'attendance') {
    targetView = currentObservationView === 'kinder' ? 'kinder' : 'elementary';
  }

  const nextView = targetView === 'kinder'
    ? 'kinder'
    : (targetView === 'elementary' ? 'elementary' : (currentObservationView === 'elementary' ? 'kinder' : 'elementary'));
  if (nextView === 'elementary' || nextView === 'kinder') currentObservationView = nextView;
  currentRecordView = nextView;

  const screen = document.getElementById('recordRoomScreen');
  const input = document.getElementById('searchName');
  const pill = document.getElementById('recordSearchPill');
  const searchValue = input ? input.value.trim() : '';
  const keepSearchOpen = !!(screen && screen.classList.contains('record-search-open'));

  updateRecordHeaderUI();
  if (typeof window.refreshRecordSortPopup === 'function') setTimeout(window.refreshRecordSortPopup, 0);

  if (keepSearchOpen) {
    if (screen) {
      screen.classList.add('record-search-open');
      screen.classList.toggle('record-search-has-query', !!searchValue);
    }
    if (pill) pill.classList.add('active');

    const restoreSearchFocus = () => {
      if (!input) return;
      try { input.focus({ preventScroll:true }); } catch(err) { input.focus(); }
      try { input.setSelectionRange(input.value.length, input.value.length); } catch(err) {}
      if (typeof window.setRecordKeyboardOffset === 'function') window.setRecordKeyboardOffset();
    };

    restoreSearchFocus();
    await loadRecords(searchValue);
    restoreSearchFocus();
    setTimeout(restoreSearchFocus, 20);
    setTimeout(restoreSearchFocus, 120);
    setTimeout(restoreSearchFocus, 260);
  } else {
    await loadRecords('');
  }

  
}


async function toggleRecordMode() {
  studentSelectionMode = false;
  selectedStudentIds.clear();
  if (currentRecordView === 'elementary' || currentRecordView === 'kinder') {
    currentObservationView = currentRecordView;
    currentRecordView = 'saved';
    recordStorageRotation += 90;
    const switchIcon = document.querySelector('#recordStorageToggleBtn svg');
    if (switchIcon) switchIcon.style.transform = `rotate(${recordStorageRotation}deg)`;
    updateRecordHeaderUI();
    await loadRecords('');
    
    return;
  }

  const currentIndex = RECORD_MODE_ORDER.indexOf(currentRecordMode);
  currentRecordMode = RECORD_MODE_ORDER[(currentIndex + 1) % RECORD_MODE_ORDER.length];
  recordStorageRotation += 90;
  const modeIcon = document.querySelector('#recordStorageToggleBtn svg');
  if (modeIcon) modeIcon.style.transform = `rotate(${recordStorageRotation}deg)`;
  updateRecordHeaderUI();

  const screen = document.getElementById('recordRoomScreen');
  const input = document.getElementById('searchName');
  if (screen && screen.classList.contains('record-search-open')) {
    const name = input.value.trim();
    if (!name) {
      document.getElementById('recordList').innerHTML = '<div class="recordEmpty">학생 이름을 검색해 주세요.</div>';
      return;
    }
    await loadRecords(name);
    return;
  }
  await loadRecords('');
}

async function showRecordRoom() {
  setFeedbackPageBackgroundActive(false);
  const memo = document.getElementById('studentMemoScreen');
const card = document.getElementById('mainPageScreen');

  const memoVisible = memo && memo.style.display !== 'none';
const cardVisible = card && card.style.display !== 'none';

  previousScreenBeforeRecordRoom = memoVisible ? 'studentMemo' : (cardVisible ? 'mainPage' : 'recordRoom');

  const current = vivizacGetVisibleNotePage();
  const record = document.getElementById('recordRoomScreen');
  if (record) record.style.display = 'flex';

  const finishRecordOpen = async () => {
    if (memo) memo.style.display = 'none';
if (card) card.style.display = 'none';
    if (record) record.style.display = 'flex';

    const pill = document.getElementById('recordSearchPill');
    const input = document.getElementById('searchName');
    if (record) record.classList.remove('record-search-open');
    if (pill) pill.classList.remove('active');
    if (input) input.value = '';
    updateRecordHeaderUI();
    await loadRecords('');
    
  };

  if (current && current.id !== 'recordRoomScreen') {
    vivizacSlideOutPageToRecord(current, () => {
      finishRecordOpen();
    });
    return;
  }

  await finishRecordOpen();
}
function hideRecordRoom() {
  document.getElementById('studentMemoScreen').style.display = 'none';
  document.getElementById('recordRoomScreen').style.display = 'none';
  const card = document.getElementById('mainPageScreen');

  if (previousScreenBeforeRecordRoom === 'studentMemo' && currentMemoStudent) {
    if (card) card.style.display = 'none';
    const memo = document.getElementById('studentMemoScreen');
    if (memo) { memo.style.display = 'flex'; vivizacSlideInPage(memo); }
  } else {
    const record = document.getElementById('recordRoomScreen');
    if (record) record.style.display = 'flex';
  }
  
}
function toggleStudentBlock(el) {
  const block = el.closest('.recordStudentBlock');
  if (!block) return;
  block.classList.toggle('open');
}
function parseDateSafe(dateStr) {
  if (!dateStr) return null;
  const cleaned = String(dateStr).replace(/\./g, '-').replace(/\s/g, '');
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}
function getCutoffDate(months) { const d = new Date(); d.setMonth(d.getMonth() - months); return d; }

function purgeOldLocalMemos() {
  const cutoff = Date.now() - (LOCAL_MEMO_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    Object.keys(localStorage).forEach(key => {
      if (!(key.startsWith(ELEMENTARY_MEMO_PREFIX) || key.startsWith(KINDER_MEMO_PREFIX))) return;
      try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : null;
        const updatedAt = parsed?.updatedAt ? new Date(parsed.updatedAt).getTime() : Date.now();
        const hasContent = String(parsed?.content || raw || '').trim().length > 0;
        if (!hasContent && updatedAt < cutoff) localStorage.removeItem(key);
      } catch {}
    });
  } catch (err) {
    console.warn('local memo purge skipped:', err);
  }
}

function getMemoKey(student) {
  if (!student?.id) return '';
  return (student.type === 'kinder' ? KINDER_MEMO_PREFIX : ELEMENTARY_MEMO_PREFIX) + student.id;
}

function getMemoByStudent(student) {
  const key = getMemoKey(student);
  if (!key) return '';
  const raw = localStorage.getItem(key);
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'content' in parsed) {
      return parsed.content || '';
    }
  } catch {}
  return raw;
}

function getMemoEntryByStudent(student) {
  const key = getMemoKey(student);
  if (!key) return { content: '', updatedAt: '', lastSyncedAt: '', syncStatus: 'unknown' };
  const raw = localStorage.getItem(key);
  if (!raw) return { content: '', updatedAt: '', lastSyncedAt: '', syncStatus: 'empty' };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        content: parsed.content || '',
        updatedAt: parsed.updatedAt || '',
        lastSyncedAt: parsed.lastSyncedAt || '',
        syncStatus: parsed.syncStatus || 'local'
      };
    }
  } catch {}
  return { content: raw || '', updatedAt: '', lastSyncedAt: '', syncStatus: 'local' };
}

function setMemoByStudent(student, content, options = {}) {
  const key = getMemoKey(student);
  if (!key) return;
  const previous = getMemoEntryByStudent(student);
  const updatedAt = options.updatedAt || new Date().toISOString();
  localStorage.setItem(key, JSON.stringify({
    content: content || '',
    updatedAt,
    lastSyncedAt: options.lastSyncedAt || previous.lastSyncedAt || '',
    syncStatus: options.syncStatus || previous.syncStatus || 'local'
  }));
}

function clearMemoByStudent(student) {
  const key = getMemoKey(student);
  if (!key) return;
  localStorage.removeItem(key);
}

function setMemoSyncStateByStudent(student, syncState = {}) {
  const entry = getMemoEntryByStudent(student);
  setMemoByStudent(student, entry.content || '', {
    updatedAt: entry.updatedAt || new Date().toISOString(),
    lastSyncedAt: syncState.lastSyncedAt || entry.lastSyncedAt || '',
    syncStatus: syncState.syncStatus || entry.syncStatus || 'local'
  });
}

function isRemoteMemoNewerThanLocal(remoteUpdatedAt, localUpdatedAt) {
  if (!remoteUpdatedAt) return false;
  if (!localUpdatedAt) return true;
  const remoteTime = new Date(remoteUpdatedAt).getTime();
  const localTime = new Date(localUpdatedAt).getTime();
  if (Number.isNaN(remoteTime) || Number.isNaN(localTime)) return false;
  return remoteTime > localTime;
}

function getSupabaseNoteDraftType(student) {
  return student?.type === 'kinder' ? 'kinder_risk' : 'elementary_observation';
}

function getStudentNoteDraftPath(student, noteType = '') {
  const academyId = getOlliCurrentAcademyId();
  const studentId = student?.id || '';
  const type = noteType || getSupabaseNoteDraftType(student);
  if (!academyId || !studentId || !type) return '';
  return `student_note_drafts?academy_id=eq.${encodeURIComponent(academyId)}&student_id=eq.${encodeURIComponent(studentId)}&note_type=eq.${encodeURIComponent(type)}`;
}

async function saveStudentNoteDraftToSupabase(student, content, noteType = '') {
  if (!isSupabaseConfigured()) return null;
  const academyId = requireOlliAcademyId('노트 저장');
  const type = noteType || getSupabaseNoteDraftType(student);
  const text = String(content || '');
  if (!student?.name && !student?.id) throw new Error('노트 저장에 필요한 학생 정보가 없습니다.');
  if (!type) return null;

  const savedStudent = await ensureStudentSavedToSupabase(student);
  const stableStudent = {
    ...student,
    ...savedStudent,
    id: savedStudent.id,
    name: savedStudent.name || student.name || '',
    academy_id: savedStudent.academy_id || academyId
  };

  if (!text.trim()) {
    await clearStudentNoteDraftFromSupabase(stableStudent, type);
    return null;
  }

  const payload = {
    academy_id: academyId,
    student_id: stableStudent.id,
    student_name: stableStudent.name || '',
    note_type: type,
    content: text,
    updated_at: new Date().toISOString()
  };

  if (typeof saveOlliData !== 'function') {
    const error = new Error('관찰노트 초안 공통 저장 함수가 준비되지 않았습니다.');
    recordOlliStorageIssue({ feature: 'student_note_draft', resource: 'student_note_drafts', operation: 'save', student_id: stableStudent.id, message: error.message });
    throw error;
  }

  const result = await saveOlliData('student_note_draft', {
    academyId,
    studentId: stableStudent.id,
    noteType: type,
    data: payload,
    forceCommon: true
  });
  if (result && result.serverSaved && result.verified) {
    if (Array.isArray(result.serverRows) && result.serverRows.length) return result.serverRows;
    if (result.serverRow) return [result.serverRow];
    return [payload];
  }
  if (isOlliPendingCommonSaveResult(result)) {
    return [makeOlliPendingRow(payload, `${stableStudent.id}_${type}`)];
  }
  const error = new Error('관찰노트 초안 서버 저장을 확인하지 못했습니다.');
  recordOlliStorageIssue({ feature: 'student_note_draft', resource: 'student_note_drafts', operation: 'save', student_id: stableStudent.id, message: result?.error?.message || result?.errorCode || error.message });
  throw error;
}

async function loadStudentNoteDraftFromSupabase(student, noteType = '') {
  if (!isSupabaseConfigured() || !student?.id) return null;
  const path = getStudentNoteDraftPath(student, noteType);
  if (!path) return null;
  const rows = await supabase('GET', `${path}&select=*&limit=1`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function clearStudentNoteDraftFromSupabase(student, noteType = '') {
  if (!isSupabaseConfigured() || !student?.id) return;
  const academyId = requireOlliAcademyId('노트 삭제');
  const type = noteType || getSupabaseNoteDraftType(student);
  if (!type) return;

  const payload = {
    academy_id: academyId,
    student_id: student.id,
    student_name: student.name || '',
    note_type: type,
    content: '',
    updated_at: new Date().toISOString()
  };

  if (typeof saveOlliData !== 'function') {
    const error = new Error('관찰노트 초안 삭제 공통 저장 함수가 준비되지 않았습니다.');
    recordOlliStorageIssue({ feature: 'student_note_draft', resource: 'student_note_drafts', operation: 'clear', student_id: student.id, message: error.message });
    throw error;
  }

  const result = await saveOlliData('student_note_draft', {
    academyId,
    studentId: student.id,
    noteType: type,
    data: payload,
    forceCommon: true
  });

  if (result && result.serverSaved && result.verified) return result;
  if (isOlliPendingCommonSaveResult(result)) return result;
  const error = new Error('관찰노트 초안 삭제 상태를 서버에 확인하지 못했습니다.');
  recordOlliStorageIssue({ feature: 'student_note_draft', resource: 'student_note_drafts', operation: 'clear', student_id: student.id, message: result?.error?.message || result?.errorCode || error.message });
  throw error;
}

function openStudentModal() {
  const targetView = (currentRecordView === 'elementary' || currentRecordView === 'kinder')
    ? currentRecordView
    : ((currentObservationView === 'elementary' || currentObservationView === 'kinder') ? currentObservationView : 'elementary');
  currentRecordView = targetView;
  currentObservationView = targetView;

  if (typeof window.olliPatchStudentModalMarkup === 'function') window.olliPatchStudentModalMarkup();

  document.getElementById('studentModal').style.display = 'flex';
  document.getElementById('studentModalTitle').textContent = targetView === 'elementary' ? '초등 학생 등록' : '유치부 학생 등록';
  const yearInput = document.getElementById('studentYearBadge');
  if (yearInput) {
    const currentYear = String(getCurrentYear());
    yearInput.value = currentYear;
    yearInput.defaultValue = currentYear;
  }

  const nameInput = document.getElementById('studentNameInput');
  const monthInput = document.getElementById('studentMonthInput');
  const dayInput = document.getElementById('studentDayInput');
  const kindergartenInput = document.getElementById('studentKindergartenInput');
  const ageInput = document.getElementById('studentAgeInput');
  const lessonDayInput = document.getElementById('studentLessonDayInput');
  const kinderExtraFields = document.getElementById('kinderExtraFields');

  const todayForStudentModal = new Date();
  nameInput.value = '';
  monthInput.value = String(todayForStudentModal.getMonth() + 1);
  dayInput.value = String(todayForStudentModal.getDate());
  if (kindergartenInput) kindergartenInput.value = '';
  if (ageInput) ageInput.value = '';
  if (lessonDayInput) lessonDayInput.value = '';
  if (kinderExtraFields) kinderExtraFields.style.display = targetView === 'kinder' ? 'block' : 'none';
  if (typeof window.olliPrepareStudentAddExtra === 'function') window.olliPrepareStudentAddExtra(targetView);

  setTimeout(() => nameInput.focus(), 50);
}
function closeStudentModal() {
  hideModalOnly('studentModal');
}
async function confirmStudent() {
  const name = document.getElementById('studentNameInput').value.trim();
  const year = Number(document.getElementById('studentYearBadge')?.value || getCurrentYear());
  const month = Number(document.getElementById('studentMonthInput').value);
  const day = Number(document.getElementById('studentDayInput').value);
  const kindergarten = document.getElementById('studentKindergartenInput')?.value.trim() || '';
  const age = document.getElementById('studentAgeInput')?.value.trim() || '';
  const lessonDayInput = document.getElementById('studentLessonDayInput')?.value.trim() || '';

  if (!name) {
    alert('학생 이름을 입력해 주세요.');
    return;
  }
  if (!year || year < 1900 || year > 2100) {
    alert('등록 연도를 올바르게 입력해 주세요.');
    return;
  }
  if (!month || month < 1 || month > 12) {
    alert('등록 월을 올바르게 입력해 주세요.');
    return;
  }
  if (!day || day < 1 || day > 31) {
    alert('등록 일을 올바르게 입력해 주세요.');
    return;
  }

  const type = currentRecordView === 'kinder' ? 'kinder' : 'elementary';
  const list = getStudentsByType(type);
  const duplicate = list.some(student => student.name === name && String(student.year) === String(year) && String(student.month) === String(month) && String(student.day) === String(day));
  if (duplicate) {
    alert('같은 이름과 등록일의 학생이 이미 등록되어 있습니다.');
    return;
  }

  const extraInfo = typeof window.olliGetStudentAddExtra === 'function' ? window.olliGetStudentAddExtra(type) : {};
  const selectedTeacher = extraInfo.teacher || '';
  const selectedLessonDay = extraInfo.lesson_day || lessonDayInput || '';
  const selectedLessonTime = normalizeLessonTimeDisplay(extraInfo.lesson_time || extraInfo.class_time || '');
  const selectedGroup = type === 'elementary' ? (extraInfo.group || '') : '';
  const selectedGroupMonths = type === 'elementary' ? elementaryGroupMonthsToText(extraInfo.group_months || extraInfo.feedback_months || getElementaryGroupFeedbackMonths(selectedGroup)) : '';

  const newStudent = {
    id: uid(),
    type,
    name,
    year,
    month: String(month),
    day: String(day),
    enrolled_at: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    kindergarten: type === 'kinder' ? kindergarten : '',
    age: type === 'kinder' ? age : (type === 'elementary' ? getElementaryAgeFromGrade(extraInfo.grade || '') : ''),
    birth_year: type === 'kinder' ? inferOlliBirthYearFromAge(age) : '',
    school_entry_year: type === 'elementary' ? inferOlliSchoolEntryYearFromGrade(extraInfo.grade || '') : '',
    previous_division: '',
    division_changed_at: '',
    lesson_day: selectedLessonDay,
    lesson_time: selectedLessonTime,
    class_time: selectedLessonTime,
    teacher: selectedTeacher,
    homeroom_teacher: extraInfo.homeroom_teacher || selectedTeacher,
    group: selectedGroup, group_months: selectedGroupMonths, feedback_months: selectedGroupMonths, personality: extraInfo.personality || '', school: type === 'elementary' ? (extraInfo.school || '') : '', grade: type === 'elementary' ? (extraInfo.grade || '') : '', className: '',
    memoUpdatedAt: '',
    status: 'active'
  };

  try {
    const savedStudent = await ensureStudentSavedToSupabase(newStudent);
    closeStudentModal();
    await loadRecords('');
    showPushToast(`${savedStudent.name} 학생이 저장되었습니다.`);
  } catch (err) {
    alert(`학생 저장에 실패했어요.\n\n${err.message || err}`);
  }
}
