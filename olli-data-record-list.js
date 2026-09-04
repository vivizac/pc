const RECORD_SORT_BY_VIEW_KEY = 'olli_record_sort_settings_by_view_v3';
const RECORD_SORT_DAYS = ['월','화','수','목','금','토','일'];
const RECORD_SORT_DAY_NAMES = {0:'일',1:'월',2:'화',3:'수',4:'목',5:'금',6:'토'};

function readRecordSortState() {
  const fallback = { elementary: { criteria: 'initial' }, kinder: { criteria: 'initial' } };
  try {
    const parsed = JSON.parse(localStorage.getItem(RECORD_SORT_BY_VIEW_KEY) || '{}');
    return {
      elementary: Object.assign({}, fallback.elementary, parsed.elementary || {}),
      kinder: Object.assign({}, fallback.kinder, parsed.kinder || {})
    };
  } catch {
    return fallback;
  }
}
function getRecordSortCriteria(view) {
  const state = readRecordSortState();
  const criteria = (state[view] && state[view].criteria) || 'initial';
  if (criteria === 'lessonDayTeacher') return 'lessonDay';
  return criteria;
}
function cleanRecordSortText(value) {
  return String(value || '').trim();
}
function safeRecordSortNumber(value) {
  const match = cleanRecordSortText(value).match(/\d+/);
  const n = match ? Number(match[0]) : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 999;
}
function normalizeRecordSortTeacher(value) {
  return cleanRecordSortText(value).replace(/T$/i, '').trim();
}
function getRecordSortTeacherValue(student) {
  return normalizeRecordSortTeacher(student?.homeroom_teacher || student?.teacher || student?.teacher_name || student?.teacherName || '');
}
function getRecordSortTendencyValue(student) {
  return cleanRecordSortText(student?.tendency || student?.personality || student?.personalityType || student?.personality_type || student?.tendencyType || student?.tendency_type || student?.group_tendency || student?.type_label || student?.character || '');
}
function getRecordSortSchoolValue(student) {
  return cleanRecordSortText(student?.school || student?.elementary_school || student?.schoolName || '');
}
function getRecordSortGradeValue(student) {
  return cleanRecordSortText(student?.grade || student?.school_grade || student?.class_grade || '');
}
function getRecordSortKindergartenValue(student) {
  return cleanRecordSortText(student?.kindergarten || student?.school || '');
}
function normalizeRecordSortDayText(value) {
  return cleanRecordSortText(value).replace(/요일/g, '').replace(/[·,\/]/g, ' ');
}
function parseRecordSortDays(student) {
  const raw = normalizeRecordSortDayText(student?.lesson_day || student?.lessonDay || student?.days || student?.day || '');
  return RECORD_SORT_DAYS.filter(day => raw.includes(day));
}
function todayRecordSortDay() {
  return RECORD_SORT_DAY_NAMES[(new Date()).getDay()] || '월';
}
function todayRecordSortDayIndex() {
  const idx = RECORD_SORT_DAYS.indexOf(todayRecordSortDay());
  return idx < 0 ? 0 : idx;
}
function recordSortDayDistance(day) {
  const idx = RECORD_SORT_DAYS.indexOf(day);
  if (idx < 0) return 999;
  return (idx - todayRecordSortDayIndex() + RECORD_SORT_DAYS.length) % RECORD_SORT_DAYS.length;
}
function getRecordSortDayRank(student) {
  const selected = parseRecordSortDays(student);
  if (!selected.length) return 999;
  return Math.min(...selected.map(recordSortDayDistance));
}
function getPrimaryRecordSortDayLabel(student) {
  const selected = parseRecordSortDays(student);
  if (!selected.length) return '요일없음';
  return selected.slice().sort((a,b) => recordSortDayDistance(a) - recordSortDayDistance(b))[0] || selected[0];
}
function getRecordSortInitial(value) {
  const text = cleanRecordSortText(value);
  if (!text) return '힣';
  const code = text.charCodeAt(0);
  if (code >= 0xAC00 && code <= 0xD7A3) {
    const choseong = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
    return choseong[Math.floor((code - 0xAC00) / 588)] || text[0];
  }
  return text[0] || '힣';
}
function compareRecordSortName(a,b) {
  return cleanRecordSortText(a?.name).localeCompare(cleanRecordSortText(b?.name), 'ko');
}
function compareRecordSortString(a,b) {
  const av = cleanRecordSortText(a);
  const bv = cleanRecordSortText(b);
  if (!av && bv) return 1;
  if (av && !bv) return -1;
  return av.localeCompare(bv, 'ko');
}
function compareElementaryByRecordSort(a,b) {
  const criterion = getRecordSortCriteria('elementary');
  let result = 0;
  if (criterion === 'tendency') {
    result = (getRecordSortTendencyValue(a) ? 0 : 1) - (getRecordSortTendencyValue(b) ? 0 : 1);
    if (result !== 0) return result;
    result = compareRecordSortString(getRecordSortTendencyValue(a), getRecordSortTendencyValue(b));
  } else if (criterion === 'group') result = compareElementaryGroupFeedbackOrder(a,b);
  else if (criterion === 'grade') result = safeRecordSortNumber(getRecordSortGradeValue(a)) - safeRecordSortNumber(getRecordSortGradeValue(b));
  else if (criterion === 'school') result = compareRecordSortString(getRecordSortSchoolValue(a), getRecordSortSchoolValue(b));
  else if (criterion === 'lessonDay') result = getRecordSortDayRank(a) - getRecordSortDayRank(b);
  else if (criterion === 'teacher') result = compareRecordSortString(getRecordSortTeacherValue(a), getRecordSortTeacherValue(b));
  else result = getRecordSortInitial(a?.name).localeCompare(getRecordSortInitial(b?.name), 'ko');

  if (result !== 0) return result;
  if (criterion !== 'teacher') {
    const teacherResult = compareRecordSortString(getRecordSortTeacherValue(a), getRecordSortTeacherValue(b));
    if (teacherResult !== 0) return teacherResult;
  }
  if (criterion !== 'group') {
    const groupResult = compareElementaryGroupFeedbackOrder(a,b);
    if (groupResult !== 0) return groupResult;
  }
  if (criterion !== 'grade') {
    const gradeResult = safeRecordSortNumber(getRecordSortGradeValue(a)) - safeRecordSortNumber(getRecordSortGradeValue(b));
    if (gradeResult !== 0) return gradeResult;
  }
  return compareRecordSortName(a,b);
}
function compareKinderByRecordSort(a,b) {
  const criterion = getRecordSortCriteria('kinder');
  let result = 0;
  if (criterion === 'age') result = safeRecordSortNumber(a?.age) - safeRecordSortNumber(b?.age);
  else if (criterion === 'lessonDay') result = getRecordSortDayRank(a) - getRecordSortDayRank(b);
  else if (criterion === 'kindergarten') result = compareRecordSortString(getRecordSortKindergartenValue(a), getRecordSortKindergartenValue(b));
  else if (criterion === 'teacher') result = compareRecordSortString(getRecordSortTeacherValue(a), getRecordSortTeacherValue(b));
  else if (criterion === 'tendency') result = compareRecordSortString(getRecordSortTendencyValue(a), getRecordSortTendencyValue(b));
  else result = getRecordSortInitial(a?.name).localeCompare(getRecordSortInitial(b?.name), 'ko');

  if (result !== 0) return result;
  if (criterion !== 'teacher') {
    const teacherResult = compareRecordSortString(getRecordSortTeacherValue(a), getRecordSortTeacherValue(b));
    if (teacherResult !== 0) return teacherResult;
  }
  return compareRecordSortName(a,b);
}
function getRecordSortSectionKey(student, view) {
  try {
    if (typeof getStudentStatus === 'function' && getStudentStatus(student) !== 'active') return 'status:' + getStudentStatus(student);
  } catch {}
  if (view === 'elementary') {
    const criterion = getRecordSortCriteria('elementary');
    if (criterion === 'group') return 'group:' + (getElementaryCurrentFeedbackGroupRank(student) === 0 ? '이번달' : '일반') + ':' + (cleanRecordSortText(student?.group) || '그룹없음');
    if (criterion === 'lessonDay') return 'day:' + getPrimaryRecordSortDayLabel(student);
    if (criterion === 'teacher') return 'teacher:' + (getRecordSortTeacherValue(student) || '담임없음');
    if (criterion === 'tendency') return 'tendency:' + (getRecordSortTendencyValue(student) || '성향없음');
    if (criterion === 'grade') return 'grade:' + (getRecordSortGradeValue(student) || '학년없음');
    if (criterion === 'school') return 'school:' + (getRecordSortSchoolValue(student) || '학교없음');
    return 'initial:' + getRecordSortInitial(student?.name);
  }
  if (view === 'kinder') {
    const criterion = getRecordSortCriteria('kinder');
    if (criterion === 'lessonDay') return 'day:' + getPrimaryRecordSortDayLabel(student);
    if (criterion === 'teacher') return 'teacher:' + (getRecordSortTeacherValue(student) || '담임없음');
    if (criterion === 'tendency') return 'tendency:' + (getRecordSortTendencyValue(student) || '성향없음');
    if (criterion === 'age') return 'age:' + (cleanRecordSortText(student?.age) || '나이없음');
    if (criterion === 'kindergarten') return 'kindergarten:' + (getRecordSortKindergartenValue(student) || '유치원없음');
    return 'initial:' + getRecordSortInitial(student?.name);
  }
  return 'initial:' + getRecordSortInitial(student?.name);
}
function sortElementaryStudents(students) {
  return [...(students || [])].sort((a,b) => {
    const statusRank = getStudentStatusRank(a) - getStudentStatusRank(b);
    if (statusRank !== 0) return statusRank;
    return compareElementaryByRecordSort(a,b);
  });
}




function getElementaryGroupSectionKey(student, cycleGroups = null) {
  return getRecordSortSectionKey(student, 'elementary');
}

function sortKinderStudents(students) {
  return [...(students || [])].sort((a,b) => {
    const statusRank = getStudentStatusRank(a) - getStudentStatusRank(b);
    if (statusRank !== 0) return statusRank;
    return compareKinderByRecordSort(a,b);
  });
}

function sortStudentsForRecord(students) {
  const list = [...(students || [])];
  const hasElementary = list.some(student => student.type === 'elementary');
  const hasKinder = list.some(student => student.type === 'kinder');

  if (hasElementary && !hasKinder) return sortElementaryStudents(list);
  if (hasKinder && !hasElementary) return sortKinderStudents(list);

  const elementary = sortElementaryStudents(list.filter(student => student.type === 'elementary'));
  const kinder = sortKinderStudents(list.filter(student => student.type === 'kinder'));
  return [...elementary, ...kinder];
}

function getElementaryGroupLetter(group) {
  const map = { '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E', '6': 'F' };
  return map[String(group || '').trim()] || '';
}

/* elementary group icons: uploaded SVG set v6 */
const GROUP_ICON_IMAGES = {
  '1': `data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22108%22%20height%3D%22108%22%20viewBox%3D%220%200%20108%20108%22%20fill%3D%22none%22%3E%0A%20%20%3Cpolygon%20points%3D%2254.00%2C20.00%2083.44%2C37.00%2083.44%2C71.00%2054.00%2C88.00%2024.56%2C71.00%2024.56%2C37.00%22%20fill%3D%22none%22%20stroke%3D%22%23CFCFD4%22%20stroke-width%3D%224%22%20stroke-linejoin%3D%22round%22%2F%3E%0A%20%20%3Cpolygon%20points%3D%2254.00%2C39.00%2058.40%2C43.38%2064.61%2C43.39%2064.62%2C49.60%2069.00%2C54.00%2064.62%2C58.40%2064.61%2C64.61%2058.40%2C64.62%2054.00%2C69.00%2049.60%2C64.62%2043.39%2C64.61%2043.38%2C58.40%2039.00%2C54.00%2043.38%2C49.60%2043.39%2C43.39%2049.60%2C43.38%22%20fill%3D%22black%22%20stroke%3D%22black%22%20stroke-width%3D%228%22%20stroke-linejoin%3D%22round%22%2F%3E%0A%20%20%3Cpolygon%20points%3D%2254.00%2C46.00%2056.34%2C49.01%2060.00%2C48.00%2058.99%2C51.66%2062.00%2C54.00%2058.99%2C56.34%2060.00%2C60.00%2056.34%2C58.99%2054.00%2C62.00%2051.66%2C58.99%2048.00%2C60.00%2049.01%2C56.34%2046.00%2C54.00%2049.01%2C51.66%2048.00%2C48.00%2051.66%2C49.01%22%20fill%3D%22white%22%20stroke%3D%22white%22%20stroke-width%3D%223%22%20stroke-linejoin%3D%22round%22%2F%3E%0A%3C%2Fsvg%3E`,
  '2': `data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22108%22%20height%3D%22108%22%20viewBox%3D%220%200%20108%20108%22%20fill%3D%22none%22%3E%3Cpolygon%20points%3D%2254.00,20.00%2083.44,37.00%2083.44,71.00%2054.00,88.00%2024.56,71.00%2024.56,37.00%22%20fill%3D%22none%22%20stroke%3D%22%23CFCFD4%22%20stroke-width%3D%224%22%20stroke-linejoin%3D%22round%22%2F%3E%3Crect%20x%3D%2238%22%20y%3D%2234%22%20width%3D%228%22%20height%3D%2240%22%20rx%3D%224%22%20fill%3D%22black%22%2F%3E%3Crect%20x%3D%2250%22%20y%3D%2234%22%20width%3D%228%22%20height%3D%2240%22%20rx%3D%224%22%20fill%3D%22black%22%2F%3E%3Crect%20x%3D%2262%22%20y%3D%2234%22%20width%3D%228%22%20height%3D%2240%22%20rx%3D%224%22%20fill%3D%22black%22%2F%3E%3C%2Fsvg%3E`,
  '3': `data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22108%22%20height%3D%22108%22%20viewBox%3D%220%200%20108%20108%22%20fill%3D%22none%22%3E%3Cpolygon%20points%3D%2254.00,20.00%2083.44,37.00%2083.44,71.00%2054.00,88.00%2024.56,71.00%2024.56,37.00%22%20fill%3D%22none%22%20stroke%3D%22%23CFCFD4%22%20stroke-width%3D%224%22%20stroke-linejoin%3D%22round%22%2F%3E%3Ccircle%20cx%3D%2245%22%20cy%3D%2245%22%20r%3D%229%22%20fill%3D%22black%22%2F%3E%3Ccircle%20cx%3D%2263%22%20cy%3D%2245%22%20r%3D%229%22%20fill%3D%22black%22%2F%3E%3Ccircle%20cx%3D%2245%22%20cy%3D%2263%22%20r%3D%229%22%20fill%3D%22black%22%2F%3E%3Ccircle%20cx%3D%2263%22%20cy%3D%2263%22%20r%3D%229%22%20fill%3D%22black%22%2F%3E%3Crect%20x%3D%2245%22%20y%3D%2236%22%20width%3D%2218%22%20height%3D%2236%22%20rx%3D%229%22%20transform%3D%22rotate(45%2054%2054)%22%20fill%3D%22black%22%2F%3E%3Crect%20x%3D%2245%22%20y%3D%2236%22%20width%3D%2218%22%20height%3D%2236%22%20rx%3D%229%22%20transform%3D%22rotate(-45%2054%2054)%22%20fill%3D%22black%22%2F%3E%3C%2Fsvg%3E`,
  '4': `data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22108%22%20height%3D%22108%22%20viewBox%3D%220%200%20108%20108%22%20fill%3D%22none%22%3E%3Cpolygon%20points%3D%2254.00,20.00%2083.44,37.00%2083.44,71.00%2054.00,88.00%2024.56,71.00%2024.56,37.00%22%20fill%3D%22none%22%20stroke%3D%22%23CFCFD4%22%20stroke-width%3D%224%22%20stroke-linejoin%3D%22round%22%2F%3E%3Crect%20x%3D%2238%22%20y%3D%2238%22%20width%3D%2232%22%20height%3D%2232%22%20rx%3D%224%22%20fill%3D%22black%22%2F%3E%3Crect%20x%3D%2246%22%20y%3D%2246%22%20width%3D%2216%22%20height%3D%2216%22%20rx%3D%222%22%20fill%3D%22white%22%2F%3E%3C%2Fsvg%3E`,
  '5': `data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22108%22%20height%3D%22108%22%20viewBox%3D%220%200%20108%20108%22%20fill%3D%22none%22%3E%3Cpolygon%20points%3D%2254.00,20.00%2083.44,37.00%2083.44,71.00%2054.00,88.00%2024.56,71.00%2024.56,37.00%22%20fill%3D%22none%22%20stroke%3D%22%23CFCFD4%22%20stroke-width%3D%224%22%20stroke-linejoin%3D%22round%22%2F%3E%3Ccircle%20cx%3D%2244%22%20cy%3D%2244%22%20r%3D%228.5%22%20fill%3D%22black%22%2F%3E%3Ccircle%20cx%3D%2264%22%20cy%3D%2244%22%20r%3D%228.5%22%20fill%3D%22black%22%2F%3E%3Ccircle%20cx%3D%2244%22%20cy%3D%2264%22%20r%3D%228.5%22%20fill%3D%22black%22%2F%3E%3Ccircle%20cx%3D%2264%22%20cy%3D%2264%22%20r%3D%228.5%22%20fill%3D%22black%22%2F%3E%3C%2Fsvg%3E`,
  '6': `data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22108%22%20height%3D%22108%22%20viewBox%3D%220%200%20108%20108%22%20fill%3D%22none%22%3E%3Cpolygon%20points%3D%2254.00,20.00%2083.44,37.00%2083.44,71.00%2054.00,88.00%2024.56,71.00%2024.56,37.00%22%20fill%3D%22none%22%20stroke%3D%22%23CFCFD4%22%20stroke-width%3D%224%22%20stroke-linejoin%3D%22round%22%2F%3E%3Crect%20x%3D%2238%22%20y%3D%2238%22%20width%3D%2232%22%20height%3D%2232%22%20rx%3D%224%22%20fill%3D%22black%22%20transform%3D%22rotate(45%2054%2054)%22%2F%3E%3C%2Fsvg%3E`
};

const KINDER_LEAD_HEXAGON_ICON = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' fill='none'%3E%3Cpath d='M32 4 56 18v28L32 60 8 46V18L32 4Z' stroke='%23C5C5CB' stroke-width='3' stroke-linejoin='round'/%3E%3Cpath d='M18 46l14-9 14 9' stroke='%23C5C5CB' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E`;

function getElementaryGroupImageSrc(group) {
  return GROUP_ICON_IMAGES[String(group || '').trim()] || '';
}

function renderKinderLeadIcon(student) {
  if (studentSelectionMode) {
    return `<span class="${getSelectionCircleClass(student, 'kinderSignalCircle')}"></span>`;
  }
  return renderRecordAttendanceLeadIcon(student);
}

function renderRecordBoardLeadIcon() {
  return `<span class="recordBoardLeadIcon" aria-hidden="true">
    <svg class="recordBoardLeadIconSvg" xmlns="http://www.w3.org/2000/svg" width="36" height="35" viewBox="0 0 36 35" role="img" aria-label="record board toggle icon">
      <polygon points="20.5,5.5 31,11.7 31,23.8 20.5,30.5 10,23.8 10,11.7" fill="#efefef" stroke="#efefef" stroke-width="2" stroke-linejoin="round"/>
      <g class="recordBoardIconPlus">
        <path d="M20.5 12.8 L20.5 22.8" fill="none" stroke="#111111" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M15.5 17.8 L25.5 17.8" fill="none" stroke="#111111" stroke-width="1.6" stroke-linecap="round"/>
      </g>
      <g class="recordBoardIconMinus">
        <path d="M15.5 17.8 L25.5 17.8" fill="none" stroke="#111111" stroke-width="1.6" stroke-linecap="round"/>
      </g>
    </svg>
  </span>`;
}

function renderElementaryDefaultNoGroupIcon() {
  return `<span class="elementaryDefaultNoGroupIcon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="36" height="35" viewBox="0 0 36 35" role="img" aria-label="hexagon with center dot">
  <polygon points="20.5,5.5 31,11.7 31,23.8 20.5,30.5 10,23.8 10,11.7" fill="#ffffff" stroke="#d9d9d9" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="20.5" cy="17.8" r="6" fill="#000000"/>
</svg></span>`;
}

function renderGroupIconImage(group, className = 'elementaryGroupIcon') {
  const groupKey = String(group || '').trim();
  const src = getElementaryGroupImageSrc(groupKey);
  if (!src) return '';
  return `<span class="${className} group-${escapeHtml(groupKey)}" title="${escapeHtml(groupKey)}그룹"><img src="${src}" alt="그룹 아이콘"></span>`;
}

function initGroupChoiceIcons() {
  document.querySelectorAll('#elementaryGroupToggleRow .groupIconChoiceBtn').forEach(btn => {
    const group = btn.dataset.group;
    btn.textContent = getElementaryGroupLetter(group) || String(group || '').trim();
  });
}

function renderElementaryLeadIcon(student) {
  if (studentSelectionMode) {
    return `<span class="${getSelectionCircleClass(student, 'elementaryEmptyCircle')}"></span>`;
  }
  return renderKinderLeadIcon(student);
}

function getSelectionCircleClass(student, baseClass) {
  const classes = [baseClass];
  if (studentSelectionMode) classes.push('selectionCircle');
  if (selectedStudentIds.has(student.id)) classes.push('selected');
  return classes.join(' ');
}

function clearSelectedStudentIds() {
  selectedStudentIds.clear();
  updateRecordHeaderUI();
}

function toggleStudentSelection(studentId) {
  if (selectedStudentIds.has(studentId)) selectedStudentIds.delete(studentId);
  else selectedStudentIds.add(studentId);
  updateRecordHeaderUI();
  const searchValue = document.getElementById('searchName')?.value.trim() || '';
  loadRecords(searchValue);
}

function exitStudentSelectionMode() {
  studentSelectionMode = false;
  clearSelectedStudentIds();
  const searchValue = document.getElementById('searchName')?.value.trim() || '';
  loadRecords(searchValue);
}


function clearStudentRowSelection() {
  document.querySelectorAll('.studentRowSelected').forEach(el => el.classList.remove('studentRowSelected'));
}


function triggerLightHaptic() {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  } catch (e) {}
}

function cancelStudentLongPress() {
  if (studentLongPressTimer) {
    clearTimeout(studentLongPressTimer);
    studentLongPressTimer = null;
  }
  if (studentPressAnimTimer) {
    clearTimeout(studentPressAnimTimer);
    studentPressAnimTimer = null;
  }
  if (studentPressAnimReleaseTimer) {
    clearTimeout(studentPressAnimReleaseTimer);
    studentPressAnimReleaseTimer = null;
  }
  if (studentActionPopupTimer) {
    clearTimeout(studentActionPopupTimer);
    studentActionPopupTimer = null;
  }
  clearStudentRowSelection();
}

function getPointerPoint(e) {
  const p = e.touches && e.touches[0] ? e.touches[0] : e;
  return { x: p.clientX || 0, y: p.clientY || 0 };
}

function startStudentLongPress(e, studentId) {
  if (studentSelectionMode) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  cancelStudentLongPress();
  const row = e.currentTarget;
  const point = getPointerPoint(e);
  studentLongPressStart = point;

  // 버튼 반응은 롱프레스 확정보다 먼저 짧게만 보여준다.
  // 100ms에 살짝 올라가고, 280ms에 바로 내려오게 해서
  // 팝업은 버튼이 완전히 내려간 뒤 500ms에 열리게 한다.
  studentPressAnimTimer = setTimeout(() => {
    studentPressAnimTimer = null;
    clearStudentRowSelection();
    if (row) row.classList.add('studentRowSelected');

    studentPressAnimReleaseTimer = setTimeout(() => {
      studentPressAnimReleaseTimer = null;
      if (row) row.classList.remove('studentRowSelected');
    }, 180);
  }, 100);

  studentLongPressTimer = setTimeout(() => {
    studentLongPressTimer = null;
    suppressNextStudentClick = true;

    // 팝업은 버튼이 완전히 내려간 뒤에만 연다.
    if (studentPressAnimTimer) {
      clearTimeout(studentPressAnimTimer);
      studentPressAnimTimer = null;
    }
    if (studentPressAnimReleaseTimer) {
      clearTimeout(studentPressAnimReleaseTimer);
      studentPressAnimReleaseTimer = null;
    }
    if (row) row.classList.remove('studentRowSelected');

    triggerLightHaptic();
    studentActionPopupTimer = setTimeout(() => {
      studentActionPopupTimer = null;
      openStudentActionMenu(studentId, row);
    }, 20);
  }, 480);
}

function moveStudentLongPress(e) {
  if (!studentLongPressTimer) return;
  const point = getPointerPoint(e);
  const dx = Math.abs(point.x - studentLongPressStart.x);
  const dy = Math.abs(point.y - studentLongPressStart.y);
  if (dx > 10 || dy > 10) cancelStudentLongPress();
}

function handleStudentRowClick(e, studentId) {
  if (studentSelectionMode) {
    e.preventDefault();
    e.stopPropagation();
    suppressNextStudentClick = false;
    toggleStudentSelection(studentId);
    return;
  }

  if (suppressNextStudentClick) {
    e.preventDefault();
    e.stopPropagation();
    suppressNextStudentClick = false;
    return;
  }

  const student = findStudentById(studentId);
  if (!student) return;
  openAttendanceStudentFeedbackSheet(student);
}


