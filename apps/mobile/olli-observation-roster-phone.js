/* Phone-only observation memo roster view. Keeps the existing memo editor intact and replaces the old picker popup with a body list. */

const OBSERVATION_ROSTER_SORT_KEY_PREFIX = 'olli_observation_roster_sort_v1';
const OBSERVATION_ROSTER_DIVISION_KEY_PREFIX = 'olli_observation_roster_division_v1';
const OBSERVATION_ROSTER_SORT_DEFAULT = 'lessonDay';
const OBSERVATION_ROSTER_SORT_OPTIONS = [
  ['group', '그룹'],
  ['teacher', '담임'],
  ['tendency', '성향'],
  ['school', '학교'],
  ['grade', '학년'],
  ['lessonDay', '요일']
];
const OBSERVATION_ROSTER_DIVISIONS = [
  ['elementary', '초등부'],
  ['kinder', '유치부']
];
const OBSERVATION_MEMO_SLIDE_MS = 360;
const OBSERVATION_MEMO_HISTORY_LIMIT = 100;
const OBSERVATION_MEMO_ACTION_IDLE_MS = 900;
const OBSERVATION_MEMO_ACTION_MAX_MS = 5000;
const OBSERVATION_MEMO_ACTION_MAX_GRAPHEMES = 24;
const OBSERVATION_MEMO_KEYBOARD_THRESHOLD = 80;
let observationRosterSearchQuery = '';
let observationRosterSearchFocused = false;
let observationRosterSortPopupOpen = false;
let observationRosterActiveDivision = 'elementary';
let observationRosterOutsideClickBound = false;
let observationRosterKeyboardBaselineBottom = 0;
let observationRosterViewportBound = false;
let observationRosterViewportSettleTimer = null;
let observationRosterLastViewportSignature = '';
let observationRosterMeasureRaf = 0;
let observationRosterScrollGestureActive = false;
let observationRosterScrollGestureSettleTimer = null;
let observationRosterUtilityViewportLock = null;
let observationRosterUtilityViewportLockTimer = null;
let observationRosterKeyboardTransitionActive = false;
let observationRosterUtilityResizeObserver = null;
let observationRosterUtilityObservedElement = null;
let observationMemoSlideTimer = null;
let observationMemoUndoStack = [];
let observationMemoRedoStack = [];
let observationMemoCurrentAction = null;
let observationMemoActionIdleTimer = null;
let observationMemoPendingActionInput = null;
let observationMemoHistoryStudentId = '';
let observationMemoCompositionSnapshot = null;
let observationMemoHangulTransaction = null;
let observationMemoPendingHangulBeforeInput = null;
let observationMemoPendingHangulDelete = null;
let observationMemoPendingHangulDeleteTimer = null;
let observationMemoIsComposing = false;
let observationMemoKeyboardBaselineBottom = 0;
let observationMemoKeyboardRaf = 0;
let observationMemoKeyboardSettleTimer = null;


function getObservationRosterStudentDivision(student) {
  return String(student?.type || 'elementary').trim() === 'kinder' ? 'kinder' : 'elementary';
}

function getObservationRosterAllStudents() {
  let rows = [];
  try {
    if (typeof getAllStudents === 'function') {
      rows = getAllStudents() || [];
    } else if (typeof getStudentsByType === 'function') {
      rows = [
        ...(getStudentsByType('elementary') || []),
        ...(getStudentsByType('kinder') || [])
      ];
    }
  } catch (_) {
    rows = [];
  }

  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter(student => {
    const id = String(student?.id || '').trim();
    const fallbackKey = `${getObservationRosterStudentDivision(student)}:${String(student?.name || '').trim()}`;
    const key = id || fallbackKey;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isObservationRosterDivisionVisible(student) {
  return getObservationRosterStudentDivision(student) === observationRosterActiveDivision;
}

function getObservationRosterDivisionStorageKey() {
  let academyId = 'unscoped';
  try {
    if (typeof getOlliCurrentAcademyId === 'function') academyId = String(getOlliCurrentAcademyId() || '').trim() || 'unscoped';
  } catch (_) {}
  return `${OBSERVATION_ROSTER_DIVISION_KEY_PREFIX}_${academyId}`;
}

function getObservationRosterSavedDivision() {
  try {
    const saved = String(localStorage.getItem(getObservationRosterDivisionStorageKey()) || '').trim();
    return saved === 'kinder' || saved === 'elementary' ? saved : '';
  } catch (_) {
    return '';
  }
}

function setObservationRosterDivision(division, options = {}) {
  const value = division === 'kinder' ? 'kinder' : 'elementary';
  observationRosterActiveDivision = value;

  if (options.persist !== false) {
    try { localStorage.setItem(getObservationRosterDivisionStorageKey(), value); } catch (_) {}
  }

  if (options.syncRecordView !== false) {
    try {
      if (typeof currentObservationView !== 'undefined') currentObservationView = value;
      if (typeof currentRecordView !== 'undefined') currentRecordView = value;
    } catch (_) {}
  }

  return value;
}

function getObservationRosterTodayDay() {
  const days = ['일','월','화','수','목','금','토'];
  return days[new Date().getDay()] || '';
}

function getObservationRosterLessonDays(student) {
  try {
    if (typeof getMemoStudentPickerDays === 'function') {
      const days = getMemoStudentPickerDays(student);
      if (Array.isArray(days) && days.length) return days.map(day => String(day || '').replace(/요일/g, '').trim()).filter(Boolean);
    }
  } catch (_) {}
  return String(student?.lesson_day || student?.lessonDay || '')
    .replace(/요일/g, '')
    .split(/[,\s/·]+/)
    .map(day => day.trim())
    .filter(Boolean);
}

function getObservationRosterLessonDayRank(student) {
  const order = ['월','화','수','목','금','토','일'];
  const ranks = getObservationRosterLessonDays(student)
    .map(day => order.indexOf(day))
    .filter(rank => rank >= 0);
  return ranks.length ? Math.min(...ranks) : 999;
}

function getObservationRosterLessonTime(student) {
  return String(student?.lesson_time || student?.lessonTime || student?.class_time || student?.classTime || '').trim();
}

function getObservationRosterTimeRank(student) {
  const serverEntry = typeof getOlliTodayScheduleEntry === 'function' ? getOlliTodayScheduleEntry(student?.id) : null;
  const serverTime = Number(serverEntry?.regular?.time_slot);
  if (Number.isFinite(serverTime) && serverTime > 0) return serverTime * 60;

  const raw = getObservationRosterLessonTime(student);
  if (!raw) return 24 * 60 + 1;
  const compact = raw.replace(/\s+/g, '');
  const match = compact.match(/^(오전|오후)?(\d{1,2})(?:(?::|시)(\d{1,2}))?/);
  if (!match) return 24 * 60 + 1;
  let hour = Number(match[2] || 0);
  const minute = Number(match[3] || 0);
  const meridiem = match[1] || '';
  if (meridiem === '오후' && hour < 12) hour += 12;
  if (meridiem === '오전' && hour === 12) hour = 0;
  return hour * 60 + Math.min(Math.max(minute, 0), 59);
}

function isObservationRosterActiveStudent(student) {
  if (!student) return false;
  try {
    if (typeof getStudentStatus === 'function') return getStudentStatus(student) === 'active';
  } catch (_) {}
  return String(student.status || 'active') !== 'inactive' && String(student.status || 'active') !== 'withdrawn' && String(student.status || 'active') !== 'paused';
}

function isObservationRosterTodayStudent(student) {
  const schedule = window.__olliTodayAttendanceSchedule;
  if (schedule?.loaded && schedule.regular instanceof Map) {
    return schedule.regular.has(String(student?.id || ''));
  }
  const todayDay = getObservationRosterTodayDay();
  try {
    if (typeof getMemoStudentPickerDays === 'function') return getMemoStudentPickerDays(student).includes(todayDay);
  } catch (_) {}
  const rawDay = String(student?.lesson_day || student?.lessonDay || '').replace(/요일/g, '');
  return !!todayDay && rawDay.includes(todayDay);
}

function getTodayObservationMemoStudents() {
  const students = getObservationRosterAllStudents().filter(student => isObservationRosterDivisionVisible(student));
  return students
    .filter(student => isObservationRosterActiveStudent(student))
    .filter(student => isObservationRosterTodayStudent(student))
    .sort((a, b) => {
      const timeResult = getObservationRosterTimeRank(a) - getObservationRosterTimeRank(b);
      if (timeResult !== 0) return timeResult;
      const timeTextResult = getObservationRosterLessonTime(a).localeCompare(getObservationRosterLessonTime(b), 'ko');
      if (timeTextResult !== 0) return timeTextResult;
      return String(a?.name || '').localeCompare(String(b?.name || ''), 'ko');
    });
}

/* 관찰노트 명단 가이드는 학교 / 학년 / 피드백 발송월만 표시한다. */
function getObservationRosterMeta(student) {
  if (getObservationRosterStudentDivision(student) === 'kinder') {
    const kindergarten = String(student?.kindergarten || student?.school || '').trim();
    const age = String(student?.age || '').trim();
    return [kindergarten, age ? `${age}세` : ''].filter(Boolean).join(' / ');
  }

  const school = typeof formatElementarySchoolGuideDisplay === 'function'
    ? String(formatElementarySchoolGuideDisplay(student) || '').trim()
    : String(student?.school || '').trim();
  const gradeClass = typeof formatElementaryGradeClassDisplay === 'function'
    ? String(formatElementaryGradeClassDisplay(student) || '').trim()
    : String(student?.grade || '').trim();
  const feedbackMonth = typeof getElementaryGroupFeedbackMonthDisplay === 'function'
    ? String(getElementaryGroupFeedbackMonthDisplay(student?.group, student) || '').trim()
    : '';

  return [
    school,
    gradeClass ? `${gradeClass}학년` : '',
    feedbackMonth
  ].filter(Boolean).join(' / ');
}

function getObservationRosterSortStorageKey() {
  let academyId = 'unscoped';
  try {
    if (typeof getOlliCurrentAcademyId === 'function') academyId = String(getOlliCurrentAcademyId() || '').trim() || 'unscoped';
  } catch (_) {}
  return `${OBSERVATION_ROSTER_SORT_KEY_PREFIX}_${academyId}`;
}

function getObservationRosterSortCriterion() {
  try {
    const saved = String(localStorage.getItem(getObservationRosterSortStorageKey()) || '').trim();
    return OBSERVATION_ROSTER_SORT_OPTIONS.some(([key]) => key === saved) ? saved : OBSERVATION_ROSTER_SORT_DEFAULT;
  } catch (_) {
    return OBSERVATION_ROSTER_SORT_DEFAULT;
  }
}

function setObservationRosterSortCriterion(criterion) {
  const value = OBSERVATION_ROSTER_SORT_OPTIONS.some(([key]) => key === criterion) ? criterion : OBSERVATION_ROSTER_SORT_DEFAULT;
  try { localStorage.setItem(getObservationRosterSortStorageKey(), value); } catch (_) {}
}

function getObservationRosterSortLabel(criterion) {
  return OBSERVATION_ROSTER_SORT_OPTIONS.find(([key]) => key === criterion)?.[1] || '요일';
}

function getObservationRosterTeacherValue(student) {
  if (typeof getRecordSortTeacherValue === 'function') return String(getRecordSortTeacherValue(student) || '').trim();
  return String(student?.homeroom_teacher || student?.teacher || student?.teacher_name || student?.teacherName || '').trim();
}

function getObservationRosterTendencyValue(student) {
  if (typeof getRecordSortTendencyValue === 'function') return String(getRecordSortTendencyValue(student) || '').trim();
  return String(student?.tendency || student?.personality || student?.personalityType || student?.personality_type || '').trim();
}

function getObservationRosterSchoolValue(student) {
  if (getObservationRosterStudentDivision(student) === 'kinder') {
    return String(student?.kindergarten || student?.school || student?.schoolName || '').trim();
  }
  if (typeof getRecordSortSchoolValue === 'function') return String(getRecordSortSchoolValue(student) || '').trim();
  return String(student?.school || student?.elementary_school || student?.schoolName || '').trim();
}

function getObservationRosterGradeValue(student) {
  if (getObservationRosterStudentDivision(student) === 'kinder') {
    return String(student?.age || '').trim();
  }
  if (typeof getRecordSortGradeValue === 'function') return String(getRecordSortGradeValue(student) || '').trim();
  return String(student?.grade || student?.school_grade || student?.class_grade || '').trim();
}


function compareObservationRosterString(a, b) {
  const av = String(a || '').trim();
  const bv = String(b || '').trim();
  if (!av && bv) return 1;
  if (av && !bv) return -1;
  return av.localeCompare(bv, 'ko');
}

function getObservationRosterNumber(value) {
  const match = String(value || '').match(/\d+/);
  const number = match ? Number(match[0]) : Number(value);
  return Number.isFinite(number) ? number : 999;
}

function sortObservationRosterStudents(students, criterion) {
  const list = [...(students || [])];
  if (criterion === 'lessonDay') {
    return list.sort((a, b) => {
      const dayResult = getObservationRosterLessonDayRank(a) - getObservationRosterLessonDayRank(b);
      if (dayResult !== 0) return dayResult;
      const timeResult = getObservationRosterTimeRank(a) - getObservationRosterTimeRank(b);
      if (timeResult !== 0) return timeResult;
      return String(a?.name || '').localeCompare(String(b?.name || ''), 'ko');
    });
  }
  return list.sort((a, b) => {
    let result = 0;
    if (criterion === 'group') {
      if (typeof compareElementaryGroupFeedbackOrder === 'function') result = compareElementaryGroupFeedbackOrder(a, b);
      else result = compareObservationRosterString(a?.group || '', b?.group || '');
    } else if (criterion === 'teacher') {
      result = compareObservationRosterString(getObservationRosterTeacherValue(a), getObservationRosterTeacherValue(b));
    } else if (criterion === 'tendency') {
      result = compareObservationRosterString(getObservationRosterTendencyValue(a), getObservationRosterTendencyValue(b));
    } else if (criterion === 'grade') {
      result = getObservationRosterNumber(getObservationRosterGradeValue(a)) - getObservationRosterNumber(getObservationRosterGradeValue(b));
    } else if (criterion === 'school') {
      result = compareObservationRosterString(getObservationRosterSchoolValue(a), getObservationRosterSchoolValue(b));
    }
    if (result !== 0) return result;
    const teacherResult = compareObservationRosterString(getObservationRosterTeacherValue(a), getObservationRosterTeacherValue(b));
    if (teacherResult !== 0) return teacherResult;
    return String(a?.name || '').localeCompare(String(b?.name || ''), 'ko');
  });
}

function getObservationRosterStudentsForCurrentSort() {
  const criterion = getObservationRosterSortCriterion();
  let students = getObservationRosterAllStudents()
    .filter(student => isObservationRosterActiveStudent(student));

  if (observationRosterSearchQuery) {
    students = students.filter(student => String(student?.name || '').includes(observationRosterSearchQuery));
  } else {
    students = students.filter(student => isObservationRosterDivisionVisible(student));
  }

  return sortObservationRosterStudents(students, criterion);
}

function observationRosterSearchIconSvg() {
  return `<svg fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2.2"></circle><path d="M16 16L21 21" stroke="currentColor" stroke-linecap="round" stroke-width="2.2"></path></svg>`;
}

function observationRosterSortIconSvg() {
  return `<svg aria-hidden="true" viewBox="0 0 28 28"><path d="M9.9 4.7h8.1c3.2 0 5 1.8 5 5v8.6c0 3.2-1.8 5-5 5H9.9c-3.2 0-5-1.8-5-5V9.7c0-3.2 1.8-5 5-5Z"></path><circle cx="9.5" cy="10.2" fill="currentColor" r="1.92" stroke="none"></circle><circle cx="9.5" cy="17.7" r="1.58"></circle><path d="M13.9 10.2h5.0"></path><path d="M13.9 17.7h5.0"></path></svg>`;
}

function renderObservationRosterSortPopup() {
  if (!observationRosterSortPopupOpen) return '';
  const selected = getObservationRosterSortCriterion();
  const divisionButtons = OBSERVATION_ROSTER_DIVISIONS
    .map(([key, label]) => `<button type="button" class="memoRosterDivisionChip ${observationRosterActiveDivision === key ? 'active' : ''}" data-memo-roster-division="${key}" aria-pressed="${observationRosterActiveDivision === key ? 'true' : 'false'}">${label}</button>`)
    .join('');
  const sortButtons = OBSERVATION_ROSTER_SORT_OPTIONS
    .map(([key, label]) => `<button type="button" class="memoRosterSortChip ${selected === key ? 'active' : ''}" data-memo-roster-sort="${key}">${label}</button>`)
    .join('');

  return `<div class="memoRosterSortPopup" role="dialog" aria-label="관찰노트 정렬 기준">
    <div class="memoRosterDivisionGrid">${divisionButtons}</div>
    <div class="memoRosterSortDivider" aria-hidden="true"></div>
    <div class="memoRosterSortGrid">${sortButtons}</div>
  </div>`;
}

function getObservationRosterSearchInput() {
  return document.getElementById('memoRosterSearchInput');
}
function getObservationRosterUtilityLayer() {
  return document.getElementById('observationRosterUtilityLayer');
}
function getObservationRosterScrollArea() {
  return getObservationRosterScreen()?.querySelector('.memoBodyRosterScroll') || null;
}
function getObservationRosterUtilityBar() {
  return getObservationRosterScreen()?.querySelector('.memoRosterUtilityBar') || null;
}
function getObservationRosterViewportBottom() {
  const viewport = window.visualViewport;
  if (!viewport) return Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
  return Number(viewport.offsetTop || 0) + Number(viewport.height || 0);
}
function captureObservationRosterKeyboardBaseline(force = false) {
  const currentBottom = getObservationRosterViewportBottom();
  if (!currentBottom) return;
  const layoutBottom = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
  const candidate = Math.max(currentBottom, layoutBottom);
  if (force || !observationRosterKeyboardBaselineBottom) observationRosterKeyboardBaselineBottom = candidate;
}
function getObservationRosterKeyboardOffset() {
  const currentBottom = getObservationRosterViewportBottom();
  if (!observationRosterKeyboardBaselineBottom) captureObservationRosterKeyboardBaseline(true);
  return Math.max(0, Math.round(observationRosterKeyboardBaselineBottom - currentBottom));
}
function readObservationRosterUtilityViewportGeometry() {
  const viewport = window.visualViewport;
  const layoutWidth = Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0);
  const layoutHeight = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
  return {
    left: viewport ? Number(viewport.offsetLeft || 0) : 0,
    top: viewport ? Number(viewport.offsetTop || 0) : 0,
    width: viewport ? Number(viewport.width || layoutWidth) : layoutWidth,
    height: viewport ? Number(viewport.height || layoutHeight) : layoutHeight
  };
}
function applyObservationRosterUtilityViewportGeometry(layer, geometry) {
  if (!layer || !geometry) return;
  layer.style.setProperty('--observation-roster-vv-left', Math.round(Number(geometry.left) || 0) + 'px');
  layer.style.setProperty('--observation-roster-vv-top', Math.round(Number(geometry.top) || 0) + 'px');
  layer.style.setProperty('--observation-roster-vv-width', Math.max(1, Math.round(Number(geometry.width) || 1)) + 'px');
  layer.style.setProperty('--observation-roster-vv-height', Math.max(1, Math.round(Number(geometry.height) || 1)) + 'px');
}
function releaseObservationRosterUtilityViewportLock() {
  if (observationRosterUtilityViewportLockTimer) clearTimeout(observationRosterUtilityViewportLockTimer);
  observationRosterUtilityViewportLockTimer = null;
  observationRosterUtilityViewportLock = null;
  getObservationRosterScreen()?.classList.remove('observation-roster-viewport-locked');
}
function lockObservationRosterUtilityViewport() {
  const screen = getObservationRosterScreen();
  const input = getObservationRosterSearchInput();
  if (!screen || !input || document.activeElement !== input) return false;
  if (getObservationRosterKeyboardOffset() <= 24) return false;
  observationRosterUtilityViewportLock = readObservationRosterUtilityViewportGeometry();
  applyObservationRosterUtilityViewportGeometry(getObservationRosterUtilityLayer(), observationRosterUtilityViewportLock);
  screen.classList.add('observation-roster-viewport-locked');
  observationRosterKeyboardTransitionActive = false;
  return true;
}
function scheduleObservationRosterUtilityViewportLock() {
  if (observationRosterUtilityViewportLockTimer) clearTimeout(observationRosterUtilityViewportLockTimer);
  observationRosterUtilityViewportLockTimer = setTimeout(() => {
    observationRosterUtilityViewportLockTimer = null;
    lockObservationRosterUtilityViewport();
  }, 120);
}
function syncObservationRosterUtilityViewport(options = {}) {
  if (observationRosterScrollGestureActive && options.force !== true) return;
  const layer = getObservationRosterUtilityLayer();
  if (!layer) return;
  if (observationRosterUtilityViewportLock && options.followKeyboard !== true) {
    applyObservationRosterUtilityViewportGeometry(layer, observationRosterUtilityViewportLock);
    return;
  }
  applyObservationRosterUtilityViewportGeometry(layer, readObservationRosterUtilityViewportGeometry());
}
function syncObservationRosterScrollToUtility() {
  observationRosterMeasureRaf = 0;
  const screen = getObservationRosterScreen();
  const viewport = screen?.querySelector('.observationRosterPageInner');
  const utilityBar = getObservationRosterUtilityBar();
  if (!screen || !viewport || !utilityBar || !isObservationRosterScreenVisible()) return;

  const viewportRect = viewport.getBoundingClientRect();
  const utilityRect = utilityBar.getBoundingClientRect();
  if (
    !Number.isFinite(viewportRect.bottom)
    || !Number.isFinite(viewportRect.height)
    || !Number.isFinite(utilityRect.top)
  ) return;

  // Physical boundary: the roster scroller itself stops above the fixed input.
  const bottomGap = Math.max(
    0,
    Math.min(
      Math.ceil(viewportRect.height),
      Math.ceil(viewportRect.bottom - utilityRect.top)
    )
  );
  screen.style.setProperty('--observation-roster-scroll-bottom', bottomGap + 'px');
}
function scheduleObservationRosterScrollToUtility() {
  if (observationRosterMeasureRaf) cancelAnimationFrame(observationRosterMeasureRaf);
  observationRosterMeasureRaf = requestAnimationFrame(syncObservationRosterScrollToUtility);
}
function bindObservationRosterUtilityTracking() {
  const utilityBar = getObservationRosterUtilityBar();
  if (utilityBar === observationRosterUtilityObservedElement) return;
  if (observationRosterUtilityResizeObserver) {
    try { observationRosterUtilityResizeObserver.disconnect(); } catch (_) {}
  }
  observationRosterUtilityObservedElement = utilityBar;
  if (utilityBar && typeof ResizeObserver === 'function') {
    observationRosterUtilityResizeObserver = new ResizeObserver(scheduleObservationRosterScrollToUtility);
    observationRosterUtilityResizeObserver.observe(utilityBar);
  }
  scheduleObservationRosterScrollToUtility();
}
function finishObservationRosterViewportTransition() {
  const screen = getObservationRosterScreen();
  if (!screen) return;
  screen.classList.remove('observation-roster-viewport-moving');
  observationRosterViewportSettleTimer = null;
  syncObservationRosterScrollToUtility();
}
function scheduleObservationRosterViewportSettle() {
  if (observationRosterViewportSettleTimer) clearTimeout(observationRosterViewportSettleTimer);
  observationRosterViewportSettleTimer = setTimeout(finishObservationRosterViewportTransition, 130);
}
function syncObservationRosterViewport(options = {}) {
  const screen = getObservationRosterScreen();
  if (!screen || !isObservationRosterScreenVisible()) return;
  const vv = window.visualViewport;
  const top = vv ? Number(vv.offsetTop || 0) : 0;
  const left = vv ? Number(vv.offsetLeft || 0) : 0;
  const width = vv ? Number(vv.width || window.innerWidth) : window.innerWidth;
  const height = vv ? Number(vv.height || window.innerHeight) : window.innerHeight;
  const input = getObservationRosterSearchInput();
  const inputFocused = !!input && document.activeElement === input;
  if (inputFocused && !observationRosterKeyboardBaselineBottom) captureObservationRosterKeyboardBaseline(true);
  const keyboardTracking = inputFocused || screen.classList.contains('observation-keyboard-open') || observationRosterKeyboardTransitionActive;
  const keyboardOffset = keyboardTracking ? getObservationRosterKeyboardOffset() : 0;
  const keyboardOpen = keyboardTracking && keyboardOffset > 24;
  const signature = [Math.round(top), Math.round(left), Math.round(width), Math.round(height)].join(':');
  const viewportChanged = signature !== observationRosterLastViewportSignature;
  if (observationRosterScrollGestureActive) {
    observationRosterLastViewportSignature = signature;
    return;
  }
  const keyboardInteraction = inputFocused || screen.classList.contains('observation-keyboard-open') || screen.classList.contains('observation-roster-viewport-moving');
  if (keyboardInteraction && viewportChanged) {
    screen.classList.add('observation-roster-viewport-moving');
    scheduleObservationRosterViewportSettle();
  }
  observationRosterLastViewportSignature = signature;
  if (keyboardOpen) {
    if (!inputFocused) syncObservationRosterUtilityViewport({ followKeyboard:true });
    else if (observationRosterKeyboardTransitionActive || !observationRosterUtilityViewportLock) {
      syncObservationRosterUtilityViewport({ followKeyboard:true });
      scheduleObservationRosterUtilityViewportLock();
    } else syncObservationRosterUtilityViewport();
  } else {
    syncObservationRosterUtilityViewport({ followKeyboard:true });
  }
  screen.classList.toggle('observation-keyboard-open', keyboardOpen);
  scheduleObservationRosterScrollToUtility();
  if (!keyboardOpen && !inputFocused) {
    releaseObservationRosterUtilityViewportLock();
    observationRosterKeyboardTransitionActive = false;
    observationRosterKeyboardBaselineBottom = 0;
  }
}
function bindObservationRosterViewport() {
  if (observationRosterViewportBound) return;
  observationRosterViewportBound = true;
  window.addEventListener('resize', () => syncObservationRosterViewport({ source:'window-resize' }), { passive:true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => syncObservationRosterViewport({ source:'visual-resize' }), { passive:true });
    window.visualViewport.addEventListener('scroll', () => {
      if (observationRosterUtilityViewportLock) {
        syncObservationRosterUtilityViewport();
        return;
      }
      syncObservationRosterViewport({ source:'visual-scroll' });
    }, { passive:true });
  }
}
function beginObservationRosterScrollGesture() {
  if (observationRosterScrollGestureSettleTimer) {
    clearTimeout(observationRosterScrollGestureSettleTimer);
    observationRosterScrollGestureSettleTimer = null;
  }
  observationRosterScrollGestureActive = true;
}
function endObservationRosterScrollGesture() {
  if (!observationRosterScrollGestureActive && !observationRosterScrollGestureSettleTimer) return;
  if (observationRosterScrollGestureSettleTimer) clearTimeout(observationRosterScrollGestureSettleTimer);
  observationRosterScrollGestureSettleTimer = setTimeout(() => {
    observationRosterScrollGestureSettleTimer = null;
    observationRosterScrollGestureActive = false;
    syncObservationRosterUtilityViewport({ force:true });
    syncObservationRosterViewport();
    scheduleObservationRosterScrollToUtility();
  }, 120);
}
function bindObservationRosterScrollSurface() {
  const scrollArea = getObservationRosterScrollArea();
  if (!scrollArea || scrollArea.dataset.observationViewportGestureBound === '1') return;
  scrollArea.dataset.observationViewportGestureBound = '1';
  scrollArea.addEventListener('pointerdown', beginObservationRosterScrollGesture, { passive:true });
  scrollArea.addEventListener('touchstart', beginObservationRosterScrollGesture, { passive:true });
}
function bindObservationRosterUtilitySurface() {
  const screen = getObservationRosterScreen();
  const utilityBar = getObservationRosterUtilityBar();
  const input = getObservationRosterSearchInput();
  if (!screen || !utilityBar || !input) return;
  if (utilityBar.dataset.observationUtilityTouchBound !== '1') {
    utilityBar.dataset.observationUtilityTouchBound = '1';
    let touchStartX = null;
    let touchStartY = null;
    utilityBar.addEventListener('touchstart', event => {
      const touch = event.touches?.[0];
      touchStartX = touch ? Number(touch.clientX) : null;
      touchStartY = touch ? Number(touch.clientY) : null;
    }, { passive:true });
    utilityBar.addEventListener('touchmove', event => {
      const inputFocused = document.activeElement === getObservationRosterSearchInput();
      if (!inputFocused && !screen.classList.contains('observation-keyboard-open')) return;
      const touch = event.touches?.[0];
      if (!touch || !Number.isFinite(touchStartX) || !Number.isFinite(touchStartY)) return;
      const deltaX = Math.abs(Number(touch.clientX) - touchStartX);
      const deltaY = Math.abs(Number(touch.clientY) - touchStartY);
      if (deltaY < 6 || deltaY <= deltaX) return;
      event.preventDefault();
      event.stopPropagation();
    }, { passive:false });
    const clearTouch = () => {
      touchStartX = null;
      touchStartY = null;
    };
    utilityBar.addEventListener('touchend', clearTouch, { passive:true });
    utilityBar.addEventListener('touchcancel', clearTouch, { passive:true });
  }
  if (input.dataset.observationViewportInputBound === '1') return;
  input.dataset.observationViewportInputBound = '1';
  input.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') {
      if (document.activeElement !== input) {
        captureObservationRosterKeyboardBaseline(true);
        try { input.focus({ preventScroll:true }); }
        catch (_) { input.focus(); }
      }
      return;
    }
    captureObservationRosterKeyboardBaseline(true);
  }, true);
  input.addEventListener('focus', () => {
    releaseObservationRosterUtilityViewportLock();
    observationRosterKeyboardTransitionActive = true;
    captureObservationRosterKeyboardBaseline(true);
    screen.classList.add('observation-roster-viewport-moving');
    scheduleObservationRosterViewportSettle();
    setTimeout(() => syncObservationRosterViewport({ source:'focus' }), 40);
    setTimeout(() => syncObservationRosterViewport({ source:'focus' }), 160);
    setTimeout(() => syncObservationRosterViewport({ source:'focus' }), 300);
  }, true);
  input.addEventListener('blur', () => {
    releaseObservationRosterUtilityViewportLock();
    observationRosterKeyboardTransitionActive = true;
    screen.classList.add('observation-roster-viewport-moving');
    scheduleObservationRosterViewportSettle();
    setTimeout(() => syncObservationRosterViewport({ source:'blur' }), 40);
    setTimeout(() => syncObservationRosterViewport({ source:'blur' }), 140);
    setTimeout(() => {
      syncObservationRosterViewport({ source:'blur' });
      if (document.activeElement !== input && !screen.classList.contains('observation-keyboard-open')) {
        observationRosterKeyboardBaselineBottom = 0;
        observationRosterKeyboardTransitionActive = false;
      }
    }, 320);
  });
}
function bindObservationRosterViewportSurfaces() {
  bindObservationRosterScrollSurface();
  bindObservationRosterUtilitySurface();
  bindObservationRosterUtilityTracking();
  bindObservationRosterViewport();
  syncObservationRosterViewport();
  scheduleObservationRosterScrollToUtility();
}
function renderObservationRosterFooter() {
  return `<div class="memoRosterUtilityBar" aria-label="관찰노트 학생 목록 도구">
    <button type="button" class="memoRosterSearchPill ${observationRosterSearchQuery ? 'active' : ''}" id="memoRosterSearchBtn" aria-label="검색" title="검색">
      <span class="memoRosterSearchIcon">${observationRosterSearchIconSvg()}</span>
      <input class="memoRosterSearchInput" id="memoRosterSearchInput" inputmode="search" enterkeyhint="done" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="검색" value="${escapeHtml(observationRosterSearchQuery)}">
    </button>
    <div class="memoRosterSortWrap">
      <button type="button" class="memoRosterUtilityBtn memoRosterSearchClose" id="memoRosterSearchClose" aria-label="검색 닫기" title="검색 닫기">✕</button>
      <button type="button" class="memoRosterUtilityBtn memoRosterSortBtn ${observationRosterSortPopupOpen ? 'active' : ''}" id="memoRosterSortBtn" aria-label="정렬" title="정렬">${observationRosterSortIconSvg()}</button>
      ${renderObservationRosterSortPopup()}
    </div>
  </div>`;
}

function closeObservationRosterSearch(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  observationRosterSearchQuery = '';
  observationRosterSearchFocused = false;
  observationRosterSortPopupOpen = false;
  const input = document.getElementById('memoRosterSearchInput');
  if (input) {
    input.value = '';
    try { input.blur(); } catch (_) {}
  }
  const screen = getObservationRosterScreen();
  releaseObservationRosterUtilityViewportLock();
  observationRosterKeyboardBaselineBottom = 0;
  observationRosterKeyboardTransitionActive = false;
  if (screen) {
    screen.classList.remove('observation-keyboard-open','observation-roster-viewport-moving','observation-roster-viewport-locked');
  }
  renderObservationRosterList();
  renderObservationRosterUtility();
  syncObservationRosterViewport();
}

function bindObservationRosterFooterEvents() {
  const input = getObservationRosterSearchInput();
  if (input) {
    input.addEventListener('focus', () => {
      if (observationRosterSearchFocused) return;
      observationRosterSearchFocused = true;
      observationRosterSortPopupOpen = false;
      renderObservationRosterList();
      scheduleObservationRosterScrollToUtility();
    });
    input.addEventListener('input', () => {
      observationRosterSearchFocused = true;
      observationRosterSearchQuery = String(input.value || '').trim();
      renderObservationRosterList();
    });
    input.addEventListener('click', event => event.stopPropagation());
    input.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      closeObservationRosterSearch(event);
    });
  }
  const searchBtn = document.getElementById('memoRosterSearchBtn');
  if (searchBtn) searchBtn.addEventListener('click', event => {
    if (event.target?.closest?.('input')) return;
    event.preventDefault();
    event.stopPropagation();
    const target = getObservationRosterSearchInput();
    if (target) {
      try { target.focus({ preventScroll:true }); }
      catch (_) { target.focus(); }
    }
  });
  const closeBtn = document.getElementById('memoRosterSearchClose');
  if (closeBtn) closeBtn.addEventListener('click', closeObservationRosterSearch);
  const sortBtn = document.getElementById('memoRosterSortBtn');
  if (sortBtn) sortBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    observationRosterSortPopupOpen = !observationRosterSortPopupOpen;
    renderObservationRosterUtility();
  });
  document.querySelectorAll('[data-memo-roster-division]').forEach(btn => {
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setObservationRosterDivision(btn.dataset.memoRosterDivision || 'elementary');
      observationRosterSortPopupOpen = false;
      renderObservationRosterList();
      renderObservationRosterUtility();
    });
  });
  document.querySelectorAll('[data-memo-roster-sort]').forEach(btn => {
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setObservationRosterSortCriterion(btn.dataset.memoRosterSort || OBSERVATION_ROSTER_SORT_DEFAULT);
      observationRosterSortPopupOpen = false;
      if (getObservationRosterSortCriterion() === 'lessonDay') hydrateObservationRosterLocalScheduleSnapshot();
      renderObservationRosterList();
      renderObservationRosterUtility();
      refreshObservationRosterScheduleInBackground();
    });
  });
}
function getObservationRosterScheduleSignature() {
  const criterion = getObservationRosterSortCriterion();
  const rows = getObservationRosterStudentsForCurrentSort().map(student => {
    const id = String(student?.id || '');
    const schedule = typeof getOlliTodayScheduleEntry === 'function' ? getOlliTodayScheduleEntry(id) : null;
    return [
      id,
      isObservationRosterTodayStudent(student) ? 1 : 0,
      Number(schedule?.regular?.time_slot) || 0,
      Number(schedule?.makeup?.time_slot) || 0,
      getObservationRosterTimeRank(student)
    ];
  });
  return JSON.stringify({
    division: observationRosterActiveDivision,
    criterion,
    search: observationRosterSearchQuery,
    rows
  });
}

function hydrateObservationRosterLocalScheduleSnapshot() {
  const adapter = window.OlliPhoneAttendanceAdapter;
  if (!adapter || typeof adapter.hydrateLocalAttendanceSnapshot !== 'function') return false;
  try {
    return adapter.hydrateLocalAttendanceSnapshot(new Date(), { render: false });
  } catch (error) {
    console.warn('관찰노트 로컬 수업 스냅샷 복원 실패:', error?.message || error);
    return false;
  }
}

function refreshObservationRosterScheduleInBackground() {
  if (getObservationRosterSortCriterion() !== 'lessonDay' || typeof syncOlliTodayAttendanceSchedule !== 'function') return;
  const beforeSignature = getObservationRosterScheduleSignature();
  syncOlliTodayAttendanceSchedule(new Date(), { render: false, skipLocal: true })
    .then(() => {
      if (!isObservationRosterScreenVisible()) return;
      if (getObservationRosterScheduleSignature() !== beforeSignature) renderObservationMemoRoster();
    })
    .catch(() => {});
}

function renderObservationRosterList() {
  const container = document.getElementById('memoStudentRosterView');
  if (!container) return;
  const criterion = getObservationRosterSortCriterion();
  const students = getObservationRosterStudentsForCurrentSort();
  const sortLabel = getObservationRosterSortLabel(criterion);
  const title = '학생 목록';
  const rows = students.map(student => {
    const studentId = escapeHtml(String(student?.id || ''));
    const meta = getObservationRosterMeta(student);
    return `<div class="memoBodyRosterRow">
      <button type="button" class="memoBodyRosterStudentBtn" onclick="openObservationMemoStudentFromRoster('${studentId}')">
        <span class="memoBodyRosterText"><span class="memoBodyRosterName">${escapeHtml(student?.name || '이름 없음')}</span>${meta ? `<span class="memoBodyRosterMeta">${escapeHtml(meta)}</span>` : ''}</span>
      </button>
    </div>`;
  }).join('');
  const emptyText = observationRosterSearchQuery ? '검색된 학생이 없습니다.' : '등록된 학생이 없습니다.';
  const rosterContent = observationRosterSearchFocused && !observationRosterSearchQuery
    ? ''
    : (rows || `<div class="memoBodyRosterEmpty">${escapeHtml(emptyText)}</div>`);
  container.innerHTML = `<div class="memoBodyRosterScroll"><div class="memoBodyRosterContent"><div class="memoBodyRosterHeader"><div class="memoBodyRosterTitle">${escapeHtml(title)}</div><div class="memoBodyRosterDay"><span class="memoBodyRosterSortPrefix">정렬</span><span class="memoBodyRosterSortValue"> · ${escapeHtml(sortLabel)}</span></div></div><div class="memoBodyRosterList">${rosterContent}</div></div></div>`;
  bindObservationRosterScrollSurface();
  scheduleObservationRosterScrollToUtility();
}
function renderObservationRosterUtility() {
  const mount = document.getElementById('observationRosterUtilityMount');
  if (!mount) return;
  mount.innerHTML = renderObservationRosterFooter();
  bindObservationRosterFooterEvents();
  bindObservationRosterUtilitySurface();
  bindObservationRosterUtilityTracking();
  scheduleObservationRosterScrollToUtility();
}
function renderObservationMemoRoster() {
  renderObservationRosterList();
  const currentInput = getObservationRosterSearchInput();
  if (!currentInput || document.activeElement !== currentInput) {
    renderObservationRosterUtility();
  } else {
    bindObservationRosterUtilitySurface();
    bindObservationRosterUtilityTracking();
  }
  syncObservationRosterViewport();
}
function applyObservationMemoNavigationIcons() {
  const studentListBtn = document.getElementById('memoStudentListBtn');
  if (studentListBtn) {
    studentListBtn.setAttribute('aria-label', '학생 목록으로 돌아가기');
    studentListBtn.setAttribute('title', '학생 목록');
    studentListBtn.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M15.2 5.8L9 12l6.2 6.2"></path></svg>`;
  }
}

function getObservationMemoScreen() {
  return document.getElementById('studentMemoScreen');
}

function getObservationRosterScreen() {
  return document.getElementById('observationRosterScreen');
}

function getObservationMemoPage() {
  return getObservationMemoScreen()?.querySelector('.memoPageInner') || null;
}

function getObservationMemoEditor() {
  return document.getElementById('memoEditor');
}

function isObservationMemoEditorView() {
  return getObservationMemoScreen()?.getAttribute('data-memo-body-view') === 'editor';
}

function isObservationMemoScreenVisible() {
  const screen = getObservationMemoScreen();
  if (!screen) return false;
  try { return getComputedStyle(screen).display !== 'none'; }
  catch (_) { return screen.style.display !== 'none'; }
}

function getObservationMemoStudentId() {
  try {
    return String(typeof currentMemoStudent !== 'undefined' && currentMemoStudent?.id ? currentMemoStudent.id : '');
  } catch (_) {
    return '';
  }
}

function clearObservationMemoSlideClasses() {
  const screen = getObservationMemoScreen();
  if (!screen) return;
  screen.classList.remove('observation-editor-slide-enter', 'observation-editor-slide-leave');
}

function isObservationRosterScreenVisible() {
  const screen = getObservationRosterScreen();
  if (!screen) return false;
  try { return getComputedStyle(screen).display !== 'none'; }
  catch (_) { return screen.style.display !== 'none'; }
}

function setObservationPersistentNavVisible(visible) {
  const layer = document.getElementById('observationPersistentNavLayer');
  if (!layer) return;
  const active = !!visible;
  layer.classList.toggle('show', active);
  layer.setAttribute('aria-hidden', active ? 'false' : 'true');
}

window.setObservationPersistentNavVisible = setObservationPersistentNavVisible;

function showObservationRosterScreenShell() {
  const rosterScreen = getObservationRosterScreen();
  if (!rosterScreen) return;
  setObservationPersistentNavVisible(true);
  rosterScreen.style.animation = '';
  rosterScreen.style.transform = '';
  rosterScreen.style.visibility = '';
  rosterScreen.style.display = 'flex';
  renderObservationMemoRoster();
}

function hideObservationRosterScreen() {
  const rosterScreen = getObservationRosterScreen();
  if (!rosterScreen) return;
  releaseObservationRosterUtilityViewportLock();
  observationRosterKeyboardBaselineBottom = 0;
  observationRosterKeyboardTransitionActive = false;
  observationRosterLastViewportSignature = '';
  rosterScreen.classList.remove('observation-keyboard-open','observation-roster-viewport-moving','observation-roster-viewport-locked');
  rosterScreen.style.display = 'none';
}

function closeObservationRosterToRecordRoom(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const input = document.getElementById('memoRosterSearchInput');
  try { input?.blur(); } catch (_) {}
  setObservationPersistentNavVisible(false);
  hideObservationRosterScreen();
  try {
    if (typeof currentObservationView !== 'undefined') currentObservationView = observationRosterActiveDivision;
    if (typeof currentRecordView !== 'undefined') currentRecordView = observationRosterActiveDivision;
  } catch (_) {}
  if (typeof showRecordRoom === 'function') showRecordRoom();
}

function runObservationMemoPageSlide(className, onComplete) {
  const screen = getObservationMemoScreen();
  if (!screen) {
    if (typeof onComplete === 'function') onComplete();
    return;
  }

  if (observationMemoSlideTimer) {
    clearTimeout(observationMemoSlideTimer);
    observationMemoSlideTimer = null;
  }

  clearObservationMemoSlideClasses();
  void screen.offsetWidth;
  screen.classList.add(className);

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (observationMemoSlideTimer) {
      clearTimeout(observationMemoSlideTimer);
      observationMemoSlideTimer = null;
    }
    screen.removeEventListener('animationend', handleAnimationEnd);
    screen.classList.remove(className);
    if (typeof onComplete === 'function') onComplete();
  };
  const handleAnimationEnd = event => {
    if (event.target !== screen) return;
    finish();
  };

  screen.addEventListener('animationend', handleAnimationEnd);
  observationMemoSlideTimer = setTimeout(finish, OBSERVATION_MEMO_SLIDE_MS + 100);

  requestAnimationFrame(() => {
    try {
      const animationName = getComputedStyle(screen).animationName || '';
      if (!animationName || animationName === 'none') finish();
    } catch (_) {}
  });
}

function createObservationMemoSnapshot(editor) {
  const value = String(editor?.value || '');
  let selectionStart = value.length;
  let selectionEnd = value.length;
  try {
    if (Number.isFinite(editor?.selectionStart)) selectionStart = editor.selectionStart;
    if (Number.isFinite(editor?.selectionEnd)) selectionEnd = editor.selectionEnd;
  } catch (_) {}
  return { value, selectionStart, selectionEnd };
}

function sameObservationMemoSnapshot(a, b) {
  return !!a && !!b && a.value === b.value && a.selectionStart === b.selectionStart && a.selectionEnd === b.selectionEnd;
}

function trimObservationMemoHistory(stack) {
  if (stack.length > OBSERVATION_MEMO_HISTORY_LIMIT) {
    stack.splice(0, stack.length - OBSERVATION_MEMO_HISTORY_LIMIT);
  }
}

function getObservationMemoHistoryNow() {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  } catch (_) {}
  return Date.now();
}

function clearObservationMemoActionIdleTimer() {
  if (observationMemoActionIdleTimer) {
    clearTimeout(observationMemoActionIdleTimer);
    observationMemoActionIdleTimer = null;
  }
}

function hasObservationMemoPendingUndoAction() {
  const hangul = observationMemoHangulTransaction;
  const hangulChanged = !!(
    hangul
    && hangul.baseline
    && hangul.lastAfter
    && !sameObservationMemoSnapshot(hangul.baseline, hangul.lastAfter)
  );
  return !!observationMemoCurrentAction || observationMemoUndoStack.length > 0 || hangulChanged;
}

function updateObservationMemoHistoryButtons() {
  const undoBtn = document.getElementById('observationMemoUndoBtn');
  const redoBtn = document.getElementById('observationMemoRedoBtn');
  if (undoBtn) {
    undoBtn.disabled = !hasObservationMemoPendingUndoAction();
    undoBtn.setAttribute('aria-disabled', undoBtn.disabled ? 'true' : 'false');
  }
  if (redoBtn) {
    redoBtn.disabled = observationMemoRedoStack.length === 0;
    redoBtn.setAttribute('aria-disabled', redoBtn.disabled ? 'true' : 'false');
  }
}

function resetObservationMemoHistory() {
  clearObservationMemoActionIdleTimer();
  observationMemoUndoStack = [];
  observationMemoRedoStack = [];
  observationMemoCurrentAction = null;
  observationMemoPendingActionInput = null;
  observationMemoHistoryStudentId = getObservationMemoStudentId();
  observationMemoCompositionSnapshot = null;
  observationMemoIsComposing = false;
  clearObservationMemoHangulTransaction();
  updateObservationMemoHistoryButtons();
}

function ensureObservationMemoHistorySession() {
  const studentId = getObservationMemoStudentId();
  if (studentId !== observationMemoHistoryStudentId) resetObservationMemoHistory();
}

function isObservationMemoHangulText(value) {
  const text = String(value || '');
  return !!text && /^[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uAC00-\uD7AF\uD7B0-\uD7FF]+$/.test(text);
}

function splitObservationMemoGraphemes(value) {
  const text = String(value || '');
  if (!text) return [];
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter('ko', { granularity:'grapheme' });
      return Array.from(segmenter.segment(text), item => item.segment);
    }
  } catch (_) {}
  return Array.from(text);
}

function getObservationMemoTextChange(beforeValue, afterValue) {
  const before = String(beforeValue || '');
  const after = String(afterValue || '');
  let start = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (start < maxPrefix && before[start] === after[start]) start += 1;

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  return {
    beforeText: before.slice(start, beforeEnd),
    afterText: after.slice(start, afterEnd)
  };
}

function getObservationMemoActionDeltaCount(type, before, after) {
  const change = getObservationMemoTextChange(before?.value, after?.value);
  const inserted = splitObservationMemoGraphemes(change.afterText).length;
  const removed = splitObservationMemoGraphemes(change.beforeText).length;
  if (type === 'typing') return Math.max(1, inserted);
  if (type === 'deleting') return Math.max(1, removed);
  return Math.max(1, inserted, removed);
}

function isObservationMemoGroupedActionType(type) {
  return type === 'typing' || type === 'deleting';
}

function shouldMergeObservationMemoAction(action, type, before, timestamp, deltaCount, meta = {}) {
  if (!action || !isObservationMemoGroupedActionType(type) || action.type !== type) return false;
  if (!sameObservationMemoSnapshot(action.after, before)) return false;
  if (timestamp - action.lastAt > OBSERVATION_MEMO_ACTION_IDLE_MS) return false;
  if (timestamp - action.startedAt > OBSERVATION_MEMO_ACTION_MAX_MS) return false;
  if ((action.graphemeCount || 0) + deltaCount > OBSERVATION_MEMO_ACTION_MAX_GRAPHEMES) return false;
  if (type === 'deleting' && String(action.direction || '') !== String(meta.direction || '')) return false;
  return true;
}

function finalizeObservationMemoCurrentAction() {
  clearObservationMemoActionIdleTimer();
  const action = observationMemoCurrentAction;
  observationMemoCurrentAction = null;
  if (!action || !action.before || !action.after || sameObservationMemoSnapshot(action.before, action.after)) {
    updateObservationMemoHistoryButtons();
    return null;
  }
  observationMemoUndoStack.push(action);
  trimObservationMemoHistory(observationMemoUndoStack);
  updateObservationMemoHistoryButtons();
  return action;
}

function scheduleObservationMemoActionIdleCommit() {
  clearObservationMemoActionIdleTimer();
  if (!observationMemoCurrentAction || observationMemoHangulTransaction) return;
  observationMemoActionIdleTimer = setTimeout(() => {
    observationMemoActionIdleTimer = null;
    finalizeObservationMemoCurrentAction();
  }, OBSERVATION_MEMO_ACTION_IDLE_MS);
}

function recordObservationMemoActionEdit(type, before, after, meta = {}) {
  if (!type || !before || !after || sameObservationMemoSnapshot(before, after)) return false;
  ensureObservationMemoHistorySession();

  const timestamp = Number.isFinite(Number(meta.timestamp))
    ? Number(meta.timestamp)
    : getObservationMemoHistoryNow();
  const deltaCount = getObservationMemoActionDeltaCount(type, before, after);
  const direction = String(meta.direction || '');

  observationMemoRedoStack = [];

  if (shouldMergeObservationMemoAction(
    observationMemoCurrentAction,
    type,
    before,
    timestamp,
    deltaCount,
    { direction }
  )) {
    observationMemoCurrentAction.after = after;
    observationMemoCurrentAction.lastAt = timestamp;
    observationMemoCurrentAction.graphemeCount += deltaCount;
  } else {
    finalizeObservationMemoCurrentAction();
    observationMemoCurrentAction = {
      type,
      before,
      after,
      startedAt:timestamp,
      lastAt:timestamp,
      graphemeCount:deltaCount,
      direction
    };
  }

  if (isObservationMemoGroupedActionType(type)) {
    if (!meta.suppressIdle) scheduleObservationMemoActionIdleCommit();
  } else {
    finalizeObservationMemoCurrentAction();
  }

  updateObservationMemoHistoryButtons();
  return true;
}

function classifyObservationMemoAction(inputType, before) {
  const type = String(inputType || '');
  if (type === 'insertLineBreak' || type === 'insertParagraph') return { type:'newline', direction:'' };
  if (type === 'insertFromPaste') return { type:'paste', direction:'' };
  if (type === 'deleteByCut') return { type:'cut', direction:'' };
  if (type === 'insertReplacementText') return { type:'replace', direction:'' };
  if (type.startsWith('insert') && before?.selectionStart !== before?.selectionEnd) {
    return { type:'replace', direction:'' };
  }
  if (type.startsWith('delete')) {
    const direction = /Backward$/i.test(type) ? 'backward' : (/Forward$/i.test(type) ? 'forward' : type);
    return { type:'deleting', direction };
  }
  if (type.startsWith('insert')) return { type:'typing', direction:'' };
  return { type:'replace', direction:'' };
}

function createObservationMemoHangulTransaction(before, timestamp = getObservationMemoHistoryNow()) {
  if (!before) return null;
  const start = Math.max(0, Math.min(before.value.length, Number(before.selectionStart) || 0));
  const end = Math.max(start, Math.min(before.value.length, Number(before.selectionEnd) || start));
  return {
    baseline: before,
    prefix: before.value.slice(0, start),
    suffix: before.value.slice(end),
    committedCount:0,
    lastCommittedSnapshot:before,
    lastAfter:before,
    lastInputAt:timestamp
  };
}

function getObservationMemoHangulSegment(transaction, after) {
  if (!transaction || !after) return null;
  const value = String(after.value || '');
  const prefix = String(transaction.prefix || '');
  const suffix = String(transaction.suffix || '');
  if (!value.startsWith(prefix)) return null;
  if (suffix && !value.endsWith(suffix)) return null;
  const segmentEnd = value.length - suffix.length;
  if (segmentEnd < prefix.length) return null;
  return value.slice(prefix.length, segmentEnd);
}

function buildObservationMemoHangulCommittedSnapshots(transaction, after) {
  const segment = getObservationMemoHangulSegment(transaction, after);
  if (segment == null || (segment && !isObservationMemoHangulText(segment))) {
    return { valid:false, committedCount:transaction?.committedCount || 0, snapshots:[] };
  }

  const graphemes = splitObservationMemoGraphemes(segment);
  const stableCount = Math.max(0, graphemes.length - 1);
  const previousCommitted = Math.max(0, Number(transaction?.committedCount) || 0);
  const snapshots = [];

  for (let count = previousCommitted + 1; count <= stableCount; count += 1) {
    const committedText = graphemes.slice(0, count).join('');
    const value = transaction.prefix + committedText + transaction.suffix;
    const caret = transaction.prefix.length + committedText.length;
    snapshots.push({ value, selectionStart:caret, selectionEnd:caret });
  }

  return {
    valid:true,
    committedCount:Math.max(previousCommitted, stableCount),
    snapshots
  };
}

function cancelObservationMemoPendingHangulDelete() {
  if (observationMemoPendingHangulDeleteTimer) {
    clearTimeout(observationMemoPendingHangulDeleteTimer);
    observationMemoPendingHangulDeleteTimer = null;
  }
  observationMemoPendingHangulDelete = null;
}

function clearObservationMemoHangulTransaction() {
  cancelObservationMemoPendingHangulDelete();
  observationMemoHangulTransaction = null;
  observationMemoPendingHangulBeforeInput = null;
}

function beginObservationMemoHangulTransaction(before, timestamp = getObservationMemoHistoryNow()) {
  if (!before) return false;
  const transaction = createObservationMemoHangulTransaction(before, timestamp);
  if (!transaction) return false;
  clearObservationMemoActionIdleTimer();
  observationMemoHangulTransaction = transaction;
  updateObservationMemoHistoryButtons();
  return true;
}

function advanceObservationMemoHangulTransaction(after, timestamp = getObservationMemoHistoryNow()) {
  const transaction = observationMemoHangulTransaction;
  if (!transaction || !after) return false;
  const result = buildObservationMemoHangulCommittedSnapshots(transaction, after);
  if (!result.valid) return false;

  let previous = transaction.lastCommittedSnapshot || transaction.baseline;
  result.snapshots.forEach(snapshot => {
    recordObservationMemoActionEdit('typing', previous, snapshot, {
      timestamp,
      suppressIdle:true
    });
    previous = snapshot;
  });

  if (result.snapshots.length) transaction.lastCommittedSnapshot = previous;
  transaction.committedCount = result.committedCount;
  transaction.lastAfter = after;
  transaction.lastInputAt = timestamp;
  clearObservationMemoActionIdleTimer();
  updateObservationMemoHistoryButtons();
  return true;
}

function finalizeObservationMemoHangulForAction(editor, afterOverride = null) {
  const transaction = observationMemoHangulTransaction;
  if (!transaction) return false;
  const after = afterOverride || createObservationMemoSnapshot(editor);
  const before = transaction.lastCommittedSnapshot || transaction.baseline;
  if (before && after && !sameObservationMemoSnapshot(before, after)) {
    recordObservationMemoActionEdit('typing', before, after, {
      timestamp:transaction.lastInputAt || getObservationMemoHistoryNow(),
      suppressIdle:true
    });
  }
  observationMemoHangulTransaction = null;
  observationMemoPendingHangulBeforeInput = null;
  cancelObservationMemoPendingHangulDelete();
  updateObservationMemoHistoryButtons();
  return true;
}

function commitObservationMemoPendingHangulDeleteAsUserEdit() {
  const pending = observationMemoPendingHangulDelete;
  if (!pending) return false;

  if (observationMemoPendingHangulDeleteTimer) {
    clearTimeout(observationMemoPendingHangulDeleteTimer);
    observationMemoPendingHangulDeleteTimer = null;
  }
  observationMemoPendingHangulDelete = null;

  if (observationMemoHangulTransaction) {
    finalizeObservationMemoHangulForAction(getObservationMemoEditor(), pending.before);
  }

  observationMemoPendingHangulBeforeInput = null;
  const after = pending.after || createObservationMemoSnapshot(getObservationMemoEditor());
  recordObservationMemoActionEdit('deleting', pending.before, after, {
    timestamp:getObservationMemoHistoryNow(),
    direction:'backward'
  });
  return true;
}

function scheduleObservationMemoPendingHangulDeleteCommit() {
  if (!observationMemoPendingHangulDelete) return;
  if (observationMemoPendingHangulDeleteTimer) clearTimeout(observationMemoPendingHangulDeleteTimer);
  observationMemoPendingHangulDeleteTimer = setTimeout(() => {
    observationMemoPendingHangulDeleteTimer = null;
    commitObservationMemoPendingHangulDeleteAsUserEdit();
  }, 32);
}

function finalizeObservationMemoCompositionHistory(editor) {
  if (observationMemoIsComposing && observationMemoCompositionSnapshot && editor) {
    const after = createObservationMemoSnapshot(editor);
    if (!sameObservationMemoSnapshot(observationMemoCompositionSnapshot, after)) {
      recordObservationMemoActionEdit('typing', observationMemoCompositionSnapshot, after, {
        timestamp:getObservationMemoHistoryNow()
      });
    }
  }
  observationMemoCompositionSnapshot = null;
  observationMemoIsComposing = false;
}

function finalizeObservationMemoHistoryBoundary(editor = getObservationMemoEditor()) {
  if (observationMemoPendingHangulDelete) {
    commitObservationMemoPendingHangulDeleteAsUserEdit();
  }
  if (observationMemoHangulTransaction && editor) {
    finalizeObservationMemoHangulForAction(editor);
  }
  if (observationMemoIsComposing) {
    finalizeObservationMemoCompositionHistory(editor);
  }
  observationMemoPendingActionInput = null;
  finalizeObservationMemoCurrentAction();
  updateObservationMemoHistoryButtons();
}

function dispatchObservationMemoHistoryInput(editor) {
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function applyObservationMemoSnapshot(editor, snapshot) {
  if (!editor || !snapshot) return;
  editor.value = snapshot.value;
  try { editor.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd); } catch (_) {}
  dispatchObservationMemoHistoryInput(editor);
  try { editor.focus({ preventScroll: true }); } catch (_) { try { editor.focus(); } catch (_) {} }
  requestAnimationFrame(() => {
    resizeObservationMemoEditorToContent();
  });
}

function undoObservationMemoEdit() {
  const editor = getObservationMemoEditor();
  if (!editor || !isObservationMemoEditorView() || editor.readOnly || editor.disabled) return;
  ensureObservationMemoHistorySession();
  finalizeObservationMemoHistoryBoundary(editor);

  const action = observationMemoUndoStack.pop();
  if (!action?.before) {
    updateObservationMemoHistoryButtons();
    return;
  }

  observationMemoRedoStack.push(action);
  trimObservationMemoHistory(observationMemoRedoStack);
  applyObservationMemoSnapshot(editor, action.before);
  updateObservationMemoHistoryButtons();
}

function redoObservationMemoEdit() {
  const editor = getObservationMemoEditor();
  if (!editor || !isObservationMemoEditorView() || editor.readOnly || editor.disabled) return;
  ensureObservationMemoHistorySession();
  finalizeObservationMemoHistoryBoundary(editor);

  const action = observationMemoRedoStack.pop();
  if (!action?.after) {
    updateObservationMemoHistoryButtons();
    return;
  }

  observationMemoUndoStack.push(action);
  trimObservationMemoHistory(observationMemoUndoStack);
  applyObservationMemoSnapshot(editor, action.after);
  updateObservationMemoHistoryButtons();
}

function flushObservationMemoBeforeDone() {
  try {
    const dirty = typeof hasObservationMemoDirtyChanges === 'function' ? hasObservationMemoDirtyChanges() : true;
    if (!dirty || typeof flushMemoAutoSave !== 'function') return;
    const result = flushMemoAutoSave();
    if (result && typeof result.catch === 'function') {
      result.catch(error => console.warn('관찰노트 Done 저장 보류:', error?.message || error));
    }
  } catch (error) {
    console.warn('관찰노트 Done 저장 상태 확인 실패:', error?.message || error);
  }
}

function finishObservationMemoEditing() {
  const editor = getObservationMemoEditor();
  finalizeObservationMemoHistoryBoundary(editor);
  flushObservationMemoBeforeDone();
  try { editor?.blur(); } catch (_) {}
  const screen = getObservationMemoScreen();
  if (screen) screen.classList.remove('observation-editor-keyboard-open');
  observationMemoKeyboardBaselineBottom = 0;
}

function ensureObservationMemoEditingActions() {
  const actions = document.querySelector('#studentMemoScreen .memoHeaderActions');
  if (!actions) return null;
  let group = document.getElementById('observationMemoEditingActions');
  if (group) return group;

  group = document.createElement('div');
  group.id = 'observationMemoEditingActions';
  group.className = 'observationMemoEditingActions';
  group.setAttribute('aria-label', '메모 편집 도구');
  group.innerHTML = `
    <button type="button" id="observationMemoUndoBtn" class="observationMemoEditAction" aria-label="뒤로가기" title="뒤로가기" disabled>
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9.2 5.5L4.7 10l4.5 4.5"></path><path d="M5.1 10h8.1c4.3 0 6.8 2.4 6.8 5.8 0 3.5-2.6 5.7-6.5 5.7H9.8"></path></svg>
    </button>
    <button type="button" id="observationMemoRedoBtn" class="observationMemoEditAction" aria-label="앞으로가기" title="앞으로가기" disabled>
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M14.8 5.5l4.5 4.5-4.5 4.5"></path><path d="M18.9 10h-8.1C6.5 10 4 12.4 4 15.8c0 3.5 2.6 5.7 6.5 5.7h3.7"></path></svg>
    </button>
`;
  actions.appendChild(group);

  group.querySelectorAll('button').forEach(button => {
    // iOS 26 WebKit can still blur the active textarea when pointerdown is
    // cancelled on a clickable button. Cancelling mousedown keeps memo focus.
    button.addEventListener('mousedown', event => event.preventDefault());
  });
  document.getElementById('observationMemoUndoBtn')?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    undoObservationMemoEdit();
  });
  document.getElementById('observationMemoRedoBtn')?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    redoObservationMemoEdit();
  });
  updateObservationMemoHistoryButtons();
  return group;
}

function getObservationMemoViewportBottom() {
  const viewport = window.visualViewport;
  if (!viewport) return Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
  return Number(viewport.offsetTop || 0) + Number(viewport.height || 0);
}

function captureObservationMemoKeyboardBaseline(force = false) {
  const currentBottom = getObservationMemoViewportBottom();
  const layoutBottom = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
  const candidate = Math.max(currentBottom, layoutBottom);
  if (force || !observationMemoKeyboardBaselineBottom) observationMemoKeyboardBaselineBottom = candidate;
}

function syncObservationMemoKeyboardState() {
  if (observationMemoKeyboardRaf) cancelAnimationFrame(observationMemoKeyboardRaf);
  observationMemoKeyboardRaf = requestAnimationFrame(() => {
    observationMemoKeyboardRaf = 0;
    const screen = getObservationMemoScreen();
    const editor = getObservationMemoEditor();
    if (!screen) return;
    const active = !!(editor && document.activeElement === editor && isObservationMemoEditorView());
    if (!active) {
      screen.classList.remove('observation-editor-keyboard-open');
      screen.style.setProperty('--olli-observation-content-lift', '0px');
      return;
    }

    if (!observationMemoKeyboardBaselineBottom) captureObservationMemoKeyboardBaseline(true);
    const currentBottom = getObservationMemoViewportBottom();
    const inset = Math.max(0, observationMemoKeyboardBaselineBottom - currentBottom);
    const viewport = window.visualViewport;
    const viewportShrunk = viewport ? (Math.max(window.innerHeight || 0, observationMemoKeyboardBaselineBottom) - viewport.height) > OBSERVATION_MEMO_KEYBOARD_THRESHOLD : true;
    const open = !viewport || inset > OBSERVATION_MEMO_KEYBOARD_THRESHOLD || viewportShrunk;
    screen.classList.toggle('observation-editor-keyboard-open', open);
    screen.style.setProperty('--olli-observation-content-lift', Math.max(0, inset) + 'px');
    if (open) {
      ensureObservationMemoEditingActions();
    }
  });
}

function bindObservationMemoEditorEvents() {
  if (window.__olliObservationMemoEditorEventsBound) return;
  window.__olliObservationMemoEditorEventsBound = true;

  document.addEventListener('pointerdown', event => {
    if (event.target?.id !== 'memoEditor' || !isObservationMemoEditorView()) return;
    const editor = event.target;
    if (event.pointerType === 'touch' && document.activeElement !== editor) {
      captureObservationMemoKeyboardBaseline(true);
      try { editor.focus({ preventScroll:true }); }
      catch (_) { editor.focus(); }
      return;
    }
    if (document.activeElement === editor) {
      finalizeObservationMemoHistoryBoundary(editor);
    }
    captureObservationMemoKeyboardBaseline(true);
  }, true);

  document.addEventListener('beforeinput', event => {
    const editor = event.target;
    if (!editor || editor.id !== 'memoEditor' || !isObservationMemoEditorView()) return;
    if (editor.readOnly || editor.disabled) return;

    const inputType = String(event.inputType || '');
    if (inputType === 'historyUndo' || inputType === 'historyRedo') return;
    if (event.isComposing || observationMemoIsComposing) return;

    const timestamp = getObservationMemoHistoryNow();
    const before = createObservationMemoSnapshot(editor);
    const nativeHangulInsert = inputType === 'insertText' && isObservationMemoHangulText(event.data);

    if (nativeHangulInsert) {
      if (observationMemoPendingHangulDeleteTimer) {
        clearTimeout(observationMemoPendingHangulDeleteTimer);
        observationMemoPendingHangulDeleteTimer = null;
      }
      observationMemoPendingActionInput = null;
      observationMemoPendingHangulBeforeInput = before;
      if (!observationMemoHangulTransaction) {
        beginObservationMemoHangulTransaction(before, timestamp);
      } else {
        observationMemoHangulTransaction.lastInputAt = timestamp;
        clearObservationMemoActionIdleTimer();
      }
      return;
    }

    if (inputType === 'deleteContentBackward' && observationMemoHangulTransaction) {
      if (observationMemoPendingHangulDelete) {
        commitObservationMemoPendingHangulDeleteAsUserEdit();
      }
      observationMemoPendingActionInput = null;
      observationMemoPendingHangulDelete = { before, after:null, timestamp };
      observationMemoPendingHangulBeforeInput = null;
      clearObservationMemoActionIdleTimer();
      return;
    }

    if (observationMemoPendingHangulDelete) {
      commitObservationMemoPendingHangulDeleteAsUserEdit();
    }
    if (observationMemoHangulTransaction) {
      finalizeObservationMemoHangulForAction(editor, before);
    }

    const action = classifyObservationMemoAction(inputType, before);
    observationMemoPendingActionInput = {
      type:action.type,
      direction:action.direction,
      before,
      timestamp,
      inputType
    };
  }, true);

  document.addEventListener('input', event => {
    const editor = event.target;
    if (!editor || editor.id !== 'memoEditor' || !isObservationMemoEditorView()) return;
    if (editor.readOnly || editor.disabled || event.isComposing || observationMemoIsComposing) return;

    const inputType = String(event.inputType || '');
    const timestamp = getObservationMemoHistoryNow();

    if (inputType === 'deleteContentBackward' && observationMemoPendingHangulDelete) {
      observationMemoPendingHangulDelete.after = createObservationMemoSnapshot(editor);
      scheduleObservationMemoPendingHangulDeleteCommit();
      return;
    }

    if (inputType === 'insertText' && isObservationMemoHangulText(event.data)) {
      if (observationMemoPendingHangulDeleteTimer) {
        clearTimeout(observationMemoPendingHangulDeleteTimer);
        observationMemoPendingHangulDeleteTimer = null;
      }

      const after = createObservationMemoSnapshot(editor);
      if (!observationMemoHangulTransaction && observationMemoPendingHangulBeforeInput) {
        beginObservationMemoHangulTransaction(observationMemoPendingHangulBeforeInput, timestamp);
      }

      if (observationMemoHangulTransaction) {
        advanceObservationMemoHangulTransaction(after, timestamp);
      }

      cancelObservationMemoPendingHangulDelete();
      observationMemoPendingHangulBeforeInput = null;
      updateObservationMemoHistoryButtons();
      return;
    }

    if (observationMemoPendingHangulDelete) {
      commitObservationMemoPendingHangulDeleteAsUserEdit();
    }

    const pending = observationMemoPendingActionInput;
    observationMemoPendingActionInput = null;
    if (pending) {
      const after = createObservationMemoSnapshot(editor);
      recordObservationMemoActionEdit(pending.type, pending.before, after, {
        timestamp,
        direction:pending.direction
      });
    }
  }, true);

  document.addEventListener('compositionstart', event => {
    const editor = event.target;
    if (!editor || editor.id !== 'memoEditor' || !isObservationMemoEditorView()) return;
    if (observationMemoPendingHangulDelete) {
      commitObservationMemoPendingHangulDeleteAsUserEdit();
    }
    if (observationMemoHangulTransaction) {
      finalizeObservationMemoHangulForAction(editor);
    }
    observationMemoPendingActionInput = null;
    ensureObservationMemoHistorySession();
    observationMemoIsComposing = true;
    observationMemoCompositionSnapshot = createObservationMemoSnapshot(editor);
    clearObservationMemoActionIdleTimer();
  }, true);

  document.addEventListener('compositionend', event => {
    const editor = event.target;
    if (!editor || editor.id !== 'memoEditor' || !isObservationMemoEditorView()) return;
    const before = observationMemoCompositionSnapshot;
    const after = createObservationMemoSnapshot(editor);
    observationMemoCompositionSnapshot = null;
    observationMemoIsComposing = false;
    if (before && !sameObservationMemoSnapshot(before, after)) {
      recordObservationMemoActionEdit('typing', before, after, {
        timestamp:getObservationMemoHistoryNow()
      });
    }
    updateObservationMemoHistoryButtons();
  }, true);

  document.addEventListener('focusin', event => {
    const editor = event.target;
    if (!editor || editor.id !== 'memoEditor' || !isObservationMemoEditorView()) return;
    if (editor.readOnly || editor.disabled) return;
    ensureObservationMemoEditingActions();
    ensureObservationMemoHistorySession();
    captureObservationMemoKeyboardBaseline(true);
    syncObservationMemoKeyboardState();
    if (observationMemoKeyboardSettleTimer) clearTimeout(observationMemoKeyboardSettleTimer);
    observationMemoKeyboardSettleTimer = setTimeout(() => {
      observationMemoKeyboardSettleTimer = null;
      syncObservationMemoKeyboardState();
    }, 120);
  }, true);

  document.addEventListener('focusout', event => {
    if (event.target?.id !== 'memoEditor') return;
    setTimeout(() => {
      const editor = getObservationMemoEditor();
      if (editor && document.activeElement === editor && isObservationMemoEditorView()) return;
      const screen = getObservationMemoScreen();
      if (screen) {
        screen.classList.remove('observation-editor-keyboard-open');
        screen.style.setProperty('--olli-observation-content-lift', '0px');
      }
      observationMemoKeyboardBaselineBottom = 0;
      if (observationMemoKeyboardSettleTimer) {
        clearTimeout(observationMemoKeyboardSettleTimer);
        observationMemoKeyboardSettleTimer = null;
      }
      finalizeObservationMemoHistoryBoundary(editor);
    }, 120);
  }, true);

  document.addEventListener('selectionchange', () => {
    const editor = document.activeElement;
    if (!editor || editor.id !== 'memoEditor' || !isObservationMemoEditorView()) return;

    const current = createObservationMemoSnapshot(editor);
    if (
      !observationMemoIsComposing
      && !observationMemoPendingHangulDelete
      && !observationMemoPendingHangulBeforeInput
      && observationMemoHangulTransaction?.lastAfter
    ) {
      const last = observationMemoHangulTransaction.lastAfter;
      if (current.selectionStart !== last.selectionStart || current.selectionEnd !== last.selectionEnd) {
        finalizeObservationMemoHangulForAction(editor, current);
        finalizeObservationMemoCurrentAction();
      }
    } else if (observationMemoCurrentAction?.after) {
      const expected = observationMemoCurrentAction.after;
      if (
        current.value === expected.value
        && (current.selectionStart !== expected.selectionStart || current.selectionEnd !== expected.selectionEnd)
      ) {
        finalizeObservationMemoCurrentAction();
      }
    }
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncObservationMemoKeyboardState);
  }

  window.addEventListener('pagehide', () => {
    if (observationMemoSlideTimer) clearTimeout(observationMemoSlideTimer);
    if (observationMemoKeyboardRaf) cancelAnimationFrame(observationMemoKeyboardRaf);
    if (observationMemoKeyboardSettleTimer) clearTimeout(observationMemoKeyboardSettleTimer);
    observationMemoSlideTimer = null;
    observationMemoKeyboardRaf = 0;
    observationMemoKeyboardSettleTimer = null;
    clearObservationMemoActionIdleTimer();
    observationMemoCurrentAction = null;
    observationMemoPendingActionInput = null;
    observationMemoCompositionSnapshot = null;
    observationMemoIsComposing = false;
    clearObservationMemoHangulTransaction();
    setObservationPersistentNavVisible(false);
    clearObservationMemoSlideClasses();
  });
}

function setObservationMemoEditorMode() {
  const editor = document.getElementById('elementaryMemoWrap');
  const result = document.getElementById('memoFeedbackResultArea');
  const analysisBtn = document.getElementById('memoBottomAnalysisBtn');
  const feedbackBtn = document.getElementById('memoFeedbackBtn');
  const studentListBtn = document.getElementById('memoStudentListBtn');
  const screen = getObservationMemoScreen();

  if (editor) editor.style.display = 'block';
  if (result) result.style.display = '';
  if (studentListBtn) {
    studentListBtn.hidden = false;
    studentListBtn.style.display = 'inline-flex';
    studentListBtn.style.visibility = 'visible';
    studentListBtn.style.opacity = '1';
    studentListBtn.style.pointerEvents = 'auto';
  }
  if (analysisBtn) {
    analysisBtn.hidden = false;
    analysisBtn.style.display = 'inline-flex';
    analysisBtn.style.visibility = 'visible';
    analysisBtn.style.opacity = '1';
    analysisBtn.style.pointerEvents = 'auto';
  }
  if (feedbackBtn) {
    feedbackBtn.hidden = false;
    feedbackBtn.style.display = 'inline-flex';
    feedbackBtn.style.visibility = 'visible';
  }
  if (screen) screen.setAttribute('data-memo-body-view', 'editor');
  setObservationPersistentNavVisible(true);

  applyObservationMemoNavigationIcons();
  ensureObservationMemoEditingActions();
}

function setObservationMemoRosterMode(enabled) {
  if (enabled) return completeObservationMemoRosterNavigation();
  return setObservationMemoEditorMode();
}

function flushObservationMemoBeforeRosterNavigation() {
  if (!currentMemoStudent || !['elementary', 'kinder'].includes(currentMemoType)) return;
  try {
    const dirty = typeof hasObservationMemoDirtyChanges === 'function' ? hasObservationMemoDirtyChanges() : false;
    if (dirty && typeof flushMemoAutoSave === 'function') flushMemoAutoSave();
  } catch (err) {
    console.warn('학생 목록 이동 전 관찰노트 저장 상태 확인 실패:', err?.message || err);
  }
}

function completeObservationMemoRosterNavigation(options = {}) {
  if (typeof closeMemoModeMenu === 'function') closeMemoModeMenu();
  if (!['elementary', 'kinder'].includes(currentMemoType)) currentMemoType = 'elementary';

  const navigationManaged = options?.navigationManaged === true;
  const record = document.getElementById('recordRoomScreen');
  const memoScreen = getObservationMemoScreen();
  if (record && !navigationManaged) record.style.display = 'none';
  if (memoScreen) {
    clearObservationMemoSlideClasses();
    memoScreen.classList.remove('observation-editor-keyboard-open');
    memoScreen.style.animation = '';
    memoScreen.style.transform = '';
    memoScreen.style.visibility = '';
    memoScreen.style.display = 'none';
  }
  if (getObservationRosterSortCriterion() === 'lessonDay') hydrateObservationRosterLocalScheduleSnapshot();
  showObservationRosterScreenShell();
  refreshObservationRosterScheduleInBackground();
}

function showObservationMemoRoster(event, options = {}) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  flushObservationMemoBeforeRosterNavigation();

  const memoScreen = getObservationMemoScreen();
  const shouldSlideOut = !!(memoScreen && isObservationMemoScreenVisible());
  if (shouldSlideOut && ['elementary', 'kinder'].includes(currentMemoType)) {
    setObservationRosterDivision(currentMemoType);
  }
  if (shouldSlideOut) {
    const editor = getObservationMemoEditor();
    finalizeObservationMemoHistoryBoundary(editor);
    try { editor?.blur(); } catch (_) {}
    memoScreen.classList.remove('observation-editor-keyboard-open');
    observationMemoKeyboardBaselineBottom = 0;
    showObservationRosterScreenShell();
    runObservationMemoPageSlide('observation-editor-slide-leave', () => {
      memoScreen.style.display = 'none';
      memoScreen.style.transform = '';
      clearObservationMemoSlideClasses();
      resetObservationMemoHistory();
      renderObservationMemoRoster();
    });
    return;
  }

  completeObservationMemoRosterNavigation(options);
}

function resizeObservationMemoEditorToContent() {
  const editor = document.getElementById('memoEditor');
  const screen = document.getElementById('studentMemoScreen');
  const page = getObservationMemoPage();
  if (!editor || screen?.getAttribute('data-memo-body-view') !== 'editor') return;

  const scrollTop = page?.scrollTop || 0;
  const minHeight = parseFloat(getComputedStyle(editor).minHeight) || 0;
  editor.style.height = 'auto';
  const nextHeight = Math.max(editor.scrollHeight, minHeight);
  if (nextHeight > 0) editor.style.height = `${nextHeight}px`;
  if (page && document.activeElement === editor) page.scrollTop = scrollTop;
}

function scheduleObservationMemoEditorResize() {
  [0, 60, 180].forEach(delay => {
    setTimeout(() => resizeObservationMemoEditorToContent(), delay);
  });
}

document.addEventListener('input', event => {
  if (event.target?.id === 'memoEditor') {
    requestAnimationFrame(() => {
      resizeObservationMemoEditorToContent();
    });
  }
});
window.addEventListener('resize', () => {
  requestAnimationFrame(() => {
    if (document.activeElement?.id === 'memoEditor') syncObservationMemoKeyboardState();
    else resizeObservationMemoEditorToContent();
  });
});

function enforceObservationMemoPageOwnership() {
  const quickNoteScreen = document.getElementById('kinderChatFeedbackScreen');
  if (quickNoteScreen) {
    quickNoteScreen.style.display = 'none';
    quickNoteScreen.setAttribute('aria-hidden', 'true');
    quickNoteScreen.classList.remove('vivizac-slide-in', 'vivizac-slide-out');
  }

  if (typeof window.setKinderChatFeedbackPersistentTopVisible === 'function') {
    window.setKinderChatFeedbackPersistentTopVisible(false);
  } else {
    const quickTop = document.getElementById('kcfPersistentTopLayer');
    if (quickTop) {
      quickTop.classList.remove('show');
      quickTop.setAttribute('aria-hidden', 'true');
    }
  }

  // 메모장은 뒤로가기만 자체 소유하고, 공용 상단 레이어의 Work만 유지한다.
  setObservationPersistentNavVisible(true);
}

function openObservationMemoStudentFromRoster(studentId) {
  const rosterScreen = getObservationRosterScreen();
  const memoScreen = getObservationMemoScreen();
  const page = getObservationMemoPage();
  if (page) page.scrollTop = 0;

  enforceObservationMemoPageOwnership();

  if (typeof openStudentMemoPageById !== 'function') {
    console.error('관찰노트 메모 진입 함수가 준비되지 않았습니다.');
    return false;
  }

  let opened = false;
  try {
    opened = openStudentMemoPageById(studentId) !== false;
  } catch (error) {
    console.error('관찰노트 학생 메모 열기 실패:', error?.message || error);
    return false;
  }
  if (!opened) return false;

  enforceObservationMemoPageOwnership();
  requestAnimationFrame(enforceObservationMemoPageOwnership);
  setTimeout(enforceObservationMemoPageOwnership, 80);

  try { setObservationMemoEditorMode(); }
  catch (error) { console.warn('관찰노트 편집 화면 모드 초기화 실패:', error?.message || error); }

  try { resetObservationMemoHistory(); } catch (_) {}
  try { resizeObservationMemoEditorToContent(); } catch (_) {}

  if (rosterScreen) rosterScreen.style.display = 'flex';
  if (memoScreen) {
    memoScreen.style.display = 'flex';
    memoScreen.style.visibility = '';
    memoScreen.removeAttribute('aria-hidden');
    memoScreen.removeAttribute('inert');
  }

  runObservationMemoPageSlide('observation-editor-slide-enter', () => {
    hideObservationRosterScreen();
    clearObservationMemoSlideClasses();
    if (page) page.scrollTop = 0;
    scheduleObservationMemoEditorResize();
  });
  return true;
}

/* 관찰노트 진입점: 기존처럼 마지막 학생을 자동 선택하지 않고 오늘 학생 목록을 먼저 보여준다. */
function openObservationNoteFromRecord(options = {}) {
  const savedDivision = getObservationRosterSavedDivision();
  const explicitDivision = String(options?.division || '').trim();
  let division = savedDivision || (explicitDivision === 'kinder' || explicitDivision === 'elementary' ? explicitDivision : '');
  if (!division) {
    try {
      const view = String(
        (typeof currentObservationView !== 'undefined' && currentObservationView) ||
        (typeof currentRecordView !== 'undefined' && currentRecordView) ||
        ''
      );
      division = view === 'kinder' ? 'kinder' : 'elementary';
    } catch (_) {
      division = 'elementary';
    }
  }

  setObservationRosterDivision(division);
  showObservationMemoRoster(null, { navigationManaged: options?.navigationManaged === true });
  return true;
}

/* 학생 목록 복귀의 호환 진입점. 상단 뒤로가기 버튼도 같은 showObservationMemoRoster()를 사용한다. */
function toggleMemoStudentSelectPopup(event) {
  showObservationMemoRoster(event);
}
function closeMemoStudentSelectPopup() {}
function refreshMemoStudentSelectPopupIfOpen() {
  if (isObservationRosterScreenVisible()) renderObservationMemoRoster();
}

function initObservationRosterPhoneUi() {
  applyObservationMemoNavigationIcons();
  ensureObservationMemoEditingActions();
  bindObservationMemoEditorEvents();
  bindObservationRosterViewport();
  window.addEventListener('pointerup', endObservationRosterScrollGesture, { passive:true });
  window.addEventListener('pointercancel', endObservationRosterScrollGesture, { passive:true });
  window.addEventListener('touchend', endObservationRosterScrollGesture, { passive:true });
  window.addEventListener('touchcancel', endObservationRosterScrollGesture, { passive:true });
  if (!observationRosterOutsideClickBound) {
    observationRosterOutsideClickBound = true;
    document.addEventListener('click', event => {
      if (!observationRosterSortPopupOpen) return;
      if (event.target?.closest?.('.memoRosterSortWrap')) return;
      observationRosterSortPopupOpen = false;
      if (isObservationRosterScreenVisible()) renderObservationRosterUtility();
    });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initObservationRosterPhoneUi);
else initObservationRosterPhoneUi();

/* Load the one-shot local draft rescue module from a cache-busted URL. The rescue
   module only reads local memo entries and backs divergent content up as recovery
   conflicts; it never overwrites the current server draft. */
import('./olli-observation-local-recovery-phone.js?v=20260909-local-recovery-1')
  .catch(error => console.warn('관찰노트 로컬 복구 모듈 로드 실패:', error?.message || error));
