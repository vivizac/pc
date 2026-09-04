function setupNotificationOnboardingOnce() {
  if (!('Notification' in window)) return;
  if (localStorage.getItem('olli_notification_onboarding_done') === '1') return;
  if (Notification.permission !== 'default') {
    localStorage.setItem('olli_notification_onboarding_done', '1');
    return;
  }

  const requestOnFirstGesture = async () => {
    document.removeEventListener('click', requestOnFirstGesture, true);
    document.removeEventListener('touchend', requestOnFirstGesture, true);

    try {
      const permission = await Notification.requestPermission();
      localStorage.setItem('olli_notification_onboarding_done', '1');
      if (permission === 'granted') {
        new Notification('올리', { body: '알림 설정이 완료되었습니다.', tag: 'olli-notification-ready' });
      }
    } catch (err) {
      console.warn('notification onboarding skipped:', err);
    }
  };

  document.addEventListener('click', requestOnFirstGesture, true);
  document.addEventListener('touchend', requestOnFirstGesture, true);
}

document.addEventListener('DOMContentLoaded', setupNotificationOnboardingOnce);

function uid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function getCurrentYear() {
  return new Date().getFullYear();
}


const ELEMENTARY_GROUP_FEEDBACK_MONTHS_KEY = 'olli_elementary_group_feedback_months_v1';
const ELEMENTARY_GROUP_MONTH_VALUES = [1,2,3,4,5,6,7,8,9,10,11,12];

function normalizeElementaryGroupMonths(value) {
  let raw = value;
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return [...new Set(raw.map(v => Number(v)).filter(n => Number.isFinite(n) && n >= 1 && n <= 12))].sort((a,b) => a - b);
  if (typeof raw === 'number') return raw >= 1 && raw <= 12 ? [raw] : [];
  raw = String(raw || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return normalizeElementaryGroupMonths(parsed);
  } catch(e) {}
  return [...new Set(raw.split(/[^0-9]+/).map(v => Number(v)).filter(n => Number.isFinite(n) && n >= 1 && n <= 12))].sort((a,b) => a - b);
}

function elementaryGroupMonthsToText(months) {
  const normalized = normalizeElementaryGroupMonths(months);
  return normalized.length ? normalized.join(',') : '';
}

function getElementaryGroupFeedbackMonthsStorageKey() {
  const academyId = (typeof getOlliCurrentAcademyId === 'function') ? getOlliCurrentAcademyId() : '';
  return academyId ? `${ELEMENTARY_GROUP_FEEDBACK_MONTHS_KEY}_${academyId}` : ELEMENTARY_GROUP_FEEDBACK_MONTHS_KEY;
}

function normalizeElementaryGroupFeedbackMonthsMap(value) {
  let raw = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch(e) { raw = {}; }
  }
  const map = {};
  Object.keys(raw || {}).forEach(group => {
    const months = normalizeElementaryGroupMonths(raw[group]);
    if (months.length) map[String(group)] = months;
  });
  return map;
}

function readElementaryGroupFeedbackMonthsMap() {
  try {
    const academyId = (typeof getOlliCurrentAcademyId === 'function') ? getOlliCurrentAcademyId() : '';
    if (academyId && typeof readOlliLocal === 'function') {
      const common = readOlliLocal('elementary_group_feedback_months', { academyId }, { fallback: {} });
      const commonMap = normalizeElementaryGroupFeedbackMonthsMap(common);
      if (Object.keys(commonMap).length) return commonMap;
    }

    const shared = readOlliSharedSettingLocal(OLLI_SHARED_SETTINGS_KEY_GROUP_MONTHS, null);
    const sharedMap = normalizeElementaryGroupFeedbackMonthsMap(shared);
    if (Object.keys(sharedMap).length) return sharedMap;
    const parsed = JSON.parse(localStorage.getItem(getElementaryGroupFeedbackMonthsStorageKey()) || '{}');
    return normalizeElementaryGroupFeedbackMonthsMap(parsed);
  } catch(e) {
    return {};
  }
}

function writeElementaryGroupFeedbackMonthsMap(map, options = {}) {
  const next = normalizeElementaryGroupFeedbackMonthsMap(map);
  localStorage.setItem(getElementaryGroupFeedbackMonthsStorageKey(), JSON.stringify(next));
  writeOlliSharedSettingLocal(OLLI_SHARED_SETTINGS_KEY_GROUP_MONTHS, next);
  if (!options.skipServerSync) scheduleOlliSharedSettingSave(OLLI_SHARED_SETTINGS_KEY_GROUP_MONTHS, next);
}

function getElementaryGroupFeedbackMonths(group, student = null) {
  const groupKey = String(group || student?.group || '').trim();
  const saved = readElementaryGroupFeedbackMonthsMap();
  if (groupKey && Array.isArray(saved[groupKey]) && saved[groupKey].length) return saved[groupKey];
  return normalizeElementaryGroupMonths(student?.group_months || student?.feedback_months || student?.feedbackMonths || student?.groupFeedbackMonths || '');
}

function setElementaryGroupFeedbackMonths(group, months) {
  const groupKey = String(group || '').trim();
  if (!groupKey) return [];
  const map = readElementaryGroupFeedbackMonthsMap();
  const normalized = normalizeElementaryGroupMonths(months);
  if (normalized.length) map[groupKey] = normalized;
  else delete map[groupKey];
  writeElementaryGroupFeedbackMonthsMap(map);
  try {
    const all = getAllStudents().map(student => {
      if (student.type === 'elementary' && String(student.group || '').trim() === groupKey) {
        return { ...student, group_months: elementaryGroupMonthsToText(normalized), feedback_months: elementaryGroupMonthsToText(normalized) };
      }
      return student;
    });
    setAllStudents(all);
  } catch(e) {}
  return normalized;
}

function toggleElementaryGroupFeedbackMonth(group, month) {
  const groupKey = String(group || '').trim();
  if (!groupKey) return [];
  const current = getElementaryGroupFeedbackMonths(groupKey);
  const n = Number(month);
  const next = current.includes(n) ? current.filter(v => v !== n) : [...current, n];
  return setElementaryGroupFeedbackMonths(groupKey, next);
}

function getElementaryGroupFeedbackMonthDisplay(group, student = null) {
  const months = getElementaryGroupFeedbackMonths(group, student);
  if (!months.length) return '';
  const currentMonth = new Date().getMonth() + 1;
  const closestMonth = months
    .map(month => ({ month, distance: (month - currentMonth + 12) % 12 }))
    .sort((a, b) => a.distance - b.distance || a.month - b.month)[0]?.month;
  return closestMonth ? `발송월 ${closestMonth}월` : '';
}

function getElementaryCurrentFeedbackGroupRank(student) {
  const months = getElementaryGroupFeedbackMonths(student?.group, student);
  if (!months.length) return 2;
  const currentMonth = new Date().getMonth() + 1;
  return months.includes(currentMonth) ? 0 : 1;
}

function getElementaryNextFeedbackMonthDistance(student) {
  const months = getElementaryGroupFeedbackMonths(student?.group, student);
  if (!months.length) return 999;
  const currentMonth = new Date().getMonth() + 1;
  return Math.min(...months.map(month => (month - currentMonth + 12) % 12));
}

function compareElementaryGroupFeedbackOrder(a, b) {
  let result = getElementaryCurrentFeedbackGroupRank(a) - getElementaryCurrentFeedbackGroupRank(b);
  if (result !== 0) return result;
  result = getElementaryNextFeedbackMonthDistance(a) - getElementaryNextFeedbackMonthDistance(b);
  if (result !== 0) return result;
  result = safeRecordSortNumber(a?.group) - safeRecordSortNumber(b?.group);
  if (result !== 0) return result;
  return 0;
}

function migrateStudentStorageIfNeeded() {
  try {
    const raw = localStorage.getItem(STUDENTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(item => item && item.id)) return;
    }

    const legacyElementaryRaw = localStorage.getItem('olli_elementary_students_v2');
    const legacyKinderRaw = localStorage.getItem('olli_kinder_students_v2');
    const legacyElementary = legacyElementaryRaw ? JSON.parse(legacyElementaryRaw) : [];
    const legacyKinder = legacyKinderRaw ? JSON.parse(legacyKinderRaw) : [];

    const next = [];
    if (Array.isArray(legacyElementary)) {
      legacyElementary.forEach(item => {
        const normalized = normalizeStudentObject(item, 'elementary');
        normalized.id = normalized.id || uid();
        next.push(normalized);
      });
    }
    if (Array.isArray(legacyKinder)) {
      legacyKinder.forEach(item => {
        const normalized = normalizeStudentObject(item, 'kinder');
        normalized.id = normalized.id || uid();
        next.push(normalized);
      });
    }

    if (next.length) {
      localStorage.setItem(STUDENTS_KEY, JSON.stringify(next));
    }
  } catch (e) {
    console.error('student storage migration error:', e);
  }
}

function normalizeStudentObject(item, fallbackType = 'elementary') {
  if (typeof item === 'string') {
    return {
      id: uid(), type: fallbackType, name: item, year: getCurrentYear(), month: '', day: '',
      enrolled_at: '', kindergarten: '', age: '', birth_year: '', school_entry_year: '', previous_division: '', division_changed_at: '', lesson_day: '', lesson_time: '', class_time: '', teacher: '', homeroom_teacher: '', group: '', group_months: '', feedback_months: '', personality: '', school: '', grade: '', className: '', memoUpdatedAt: '', status: 'active'
    };
  }
  return {
    id: item?.id || uid(),
    type: item?.type || item?.division || fallbackType,
    name: item?.name || item?.student_name || '',
    year: Number(item?.year || getCurrentYear()),
    month: String(item?.month ?? '').trim(),
    day: String(item?.day ?? '').trim(),
    enrolled_at: item?.enrolled_at || '',
    kindergarten: item?.kindergarten || '',
    age: item?.age || '',
    birth_year: item?.birth_year || item?.birthYear || '',
    school_entry_year: item?.school_entry_year || item?.schoolEntryYear || '',
    previous_division: item?.previous_division || item?.previousDivision || '',
    division_changed_at: item?.division_changed_at || item?.divisionChangedAt || '',
    lesson_day: item?.lesson_day || item?.lessonDay || item?.class_day || '',
    lesson_time: item?.lesson_time || item?.lessonTime || item?.class_time || item?.classTime || '',
    class_time: item?.class_time || item?.classTime || item?.lesson_time || item?.lessonTime || '',
    teacher: item?.teacher || item?.homeroom_teacher || item?.teacher_name || '',
    homeroom_teacher: item?.homeroom_teacher || item?.teacher || item?.teacher_name || '',
    group: item?.group || item?.group_no || '',
    group_months: elementaryGroupMonthsToText(item?.group_months || item?.feedback_months || item?.feedbackMonths || item?.groupFeedbackMonths || ''),
    feedback_months: elementaryGroupMonthsToText(item?.feedback_months || item?.group_months || item?.feedbackMonths || item?.groupFeedbackMonths || ''),
    personality: item?.personality || '',
    school: item?.school || '',
    grade: item?.grade || '',
    className: item?.className || item?.class_no || '',
    memoUpdatedAt: item?.memoUpdatedAt || '',
    status: item?.status || 'active',
    is_deleted: item?.is_deleted === true || String(item?.is_deleted || '').toLowerCase() === 'true',
    deleted_at: item?.deleted_at || '',
    deleted_by: item?.deleted_by || '',
    delete_reason: item?.delete_reason || item?.reason || '',
    withdrawn_at: item?.withdrawn_at || item?.withdrawal_at || item?.quit_at || '',
    paused_at: item?.paused_at || item?.pause_at || '',
    status_changed_at: item?.status_changed_at || '',
    updated_at: item?.updated_at || '',
    academy_id: item?.academy_id || (getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : '')
  };
}

function getStudentsStorageKey() {
  const academyId = getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : '';
  return academyId ? `${STUDENTS_KEY}_${academyId}` : STUDENTS_KEY;
}

function getAllStudents() {
  try {
    const storageKey = getStudentsStorageKey();
    let raw = localStorage.getItem(storageKey);

    // 기존 단일 학원용 로컬 학생 데이터가 남아 있는 경우, 현재 학원 저장소로 1회 이동합니다.
    if (!raw && storageKey !== STUDENTS_KEY) {
      const legacyRaw = localStorage.getItem(STUDENTS_KEY);
      if (legacyRaw) {
        localStorage.setItem(storageKey, legacyRaw);
        raw = legacyRaw;
      }
    }

    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];

    const academyId = getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : '';
    return list
      .map(item => normalizeStudentObject({ ...item, academy_id: item?.academy_id || academyId }, item?.type || 'elementary'))
      .filter(student => !academyId || !student.academy_id || student.academy_id === academyId)
      .filter(student => !isOlliSoftDeletedRow(student));
  } catch {
    return [];
  }
}

function setAllStudents(list) {
  const academyId = getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : '';
  const safeList = Array.isArray(list)
    ? list
        .map(item => normalizeStudentObject({ ...item, academy_id: item?.academy_id || academyId }, item?.type || 'elementary'))
        .filter(student => !isOlliSoftDeletedRow(student))
    : [];
  localStorage.setItem(getStudentsStorageKey(), JSON.stringify(safeList));
}

function getStudentsByType(type) {
  return getAllStudents().filter(student => student.type === type);
}

function saveStudent(student, options = {}) {
  const academyId = getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : '';
  const safeStudent = normalizeStudentObject({ ...student, academy_id: student?.academy_id || academyId }, student?.type || 'elementary');
  unmarkDeletedStudentId(safeStudent.id);
  const list = getAllStudents();
  const idx = list.findIndex(item => item.id === safeStudent.id);
  if (idx === -1) list.push(safeStudent);
  else list[idx] = safeStudent;
  setAllStudents(list);
  if (options.skipRemote) return Promise.resolve(safeStudent);
  return saveStudentToSupabase(safeStudent);
}

function findStudentById(id) {
  return getAllStudents().find(student => student.id === id) || null;
}

function getStudentStatus(student) {
  const raw = String(student?.status || '').trim().toLowerCase();
  if (['paused', 'pause', 'rest', '휴원', '휴원생'].includes(raw)) return 'paused';
  if (['withdrawn', 'withdraw', 'quit', '퇴원', '퇴원생'].includes(raw)) return 'withdrawn';
  if (['inactive', 'deleted', 'removed', '삭제'].includes(raw)) return 'inactive';
  return 'active';
}

function getStudentStatusLabel(student) {
  const status = getStudentStatus(student);
  if (status === 'paused') return '휴원';
  if (status === 'withdrawn') return '퇴원';
  return '';
}

function getStudentStatusRank(student) {
  const status = getStudentStatus(student);
  if (status === 'paused') return 1;
  if (status === 'withdrawn') return 2;
  return 0;
}

function getCurrentMonthNumber() {
  return new Date().getMonth() + 1;
}

function getOlliAcademicYear(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  return (d.getMonth() + 1) >= 3 ? year : year - 1;
}

function inferOlliBirthYearFromAge(age, date = new Date()) {
  const n = Number(String(age || '').replace(/[^0-9]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  return date.getFullYear() - n + 1;
}

function inferOlliSchoolEntryYearFromGrade(grade, date = new Date()) {
  const n = Number(String(grade || '').replace(/[^0-9]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  return getOlliAcademicYear(date) - n + 1;
}

function getElementaryAgeFromGrade(grade) {
  const n = Number(String(grade || '').replace(/[^0-9]/g, ''));
  if (!Number.isFinite(n) || n < 1 || n > 6) return '';
  return String(n + 7);
}

function normalizeElementaryGradeValue(value) {
  const n = Number(String(value || '').replace(/[^0-9]/g, ''));
  if (!Number.isFinite(n) || n < 1 || n > 6) return '';
  return String(n);
}

function formatElementaryGradeInputValue(value) {
  const grade = normalizeElementaryGradeValue(value);
  return grade ? `${grade}학년` : '';
}

function formatElementaryAgeInputValue(value) {
  const n = Number(String(value || '').replace(/[^0-9]/g, ''));
  return Number.isFinite(n) && n > 0 ? `${n}살` : '';
}

function focusElementaryGradeInput(input) {
  if (!input) return;
  input.value = normalizeElementaryGradeValue(input.value);
  requestAnimationFrame(() => {
    try { input.select(); } catch(e) {}
  });
}

function blurStudentElementaryGradeInput() {
  const gradeInput = document.getElementById('studentGradeInput');
  const grade = normalizeElementaryGradeValue(gradeInput?.value || '');
  if (gradeInput) gradeInput.value = formatElementaryGradeInputValue(grade);
  const ageInput = document.getElementById('studentElementaryAgeInput');
  if (ageInput) ageInput.value = formatElementaryAgeInputValue(getElementaryAgeFromGrade(grade));
}

function blurElementaryInfoGradeInput() {
  const gradeInput = document.getElementById('elementaryGradeInput');
  const grade = normalizeElementaryGradeValue(gradeInput?.value || '');
  if (gradeInput) gradeInput.value = formatElementaryGradeInputValue(grade);
  const ageInput = document.getElementById('elementaryAgeInput');
  if (ageInput) ageInput.value = formatElementaryAgeInputValue(getElementaryAgeFromGrade(grade));
}

function syncStudentElementaryAgeFromGrade() {
  const gradeInput = document.getElementById('studentGradeInput');
  const ageInput = document.getElementById('studentElementaryAgeInput');
  const grade = normalizeElementaryGradeValue(gradeInput?.value || '');
  if (ageInput) ageInput.value = formatElementaryAgeInputValue(getElementaryAgeFromGrade(grade));
}

function syncElementaryInfoAgeFromGrade() {
  const gradeInput = document.getElementById('elementaryGradeInput');
  const ageInput = document.getElementById('elementaryAgeInput');
  const grade = normalizeElementaryGradeValue(gradeInput?.value || '');
  if (ageInput) ageInput.value = formatElementaryAgeInputValue(getElementaryAgeFromGrade(grade));
}

function applyOlliStudentLifecycle(student, date = new Date()) {
  if (!student) return { student, changed: false };
  const next = { ...student };
  let changed = false;

  let age = Number(String(next.age || '').replace(/[^0-9]/g, ''));
  let grade = Number(String(next.grade || '').replace(/[^0-9]/g, ''));

  // 나이 자동 갱신은 유치부에만 적용합니다.
  if (next.type === 'kinder') {
    let birthYear = Number(next.birth_year);
    if ((!birthYear || !Number.isFinite(birthYear)) && age > 0) {
      birthYear = inferOlliBirthYearFromAge(age, date);
      next.birth_year = String(birthYear);
      changed = true;
    }

    if (birthYear && Number.isFinite(birthYear)) {
      const expectedAge = date.getFullYear() - birthYear + 1;
      if (expectedAge > 0 && expectedAge < 30 && String(next.age || '') !== String(expectedAge)) {
        next.age = String(expectedAge);
        changed = true;
      }
    }
  }

  if (next.type === 'elementary') {
    let entryYear = Number(next.school_entry_year);
    if ((!entryYear || !Number.isFinite(entryYear)) && grade >= 1 && grade <= 6) {
      entryYear = inferOlliSchoolEntryYearFromGrade(grade, date);
      next.school_entry_year = String(entryYear);
      changed = true;
    }
    if (entryYear && Number.isFinite(entryYear)) {
      const expectedGrade = getOlliAcademicYear(date) - entryYear + 1;
      if (expectedGrade >= 1 && expectedGrade <= 6 && String(next.grade || '') !== String(expectedGrade)) {
        next.grade = String(expectedGrade);
        changed = true;
      }
    }

    const expectedAge = getElementaryAgeFromGrade(next.grade);
    if (expectedAge && String(next.age || '') !== expectedAge) {
      next.age = expectedAge;
      changed = true;
    }

    // 초등부의 기존 '반' 정보는 더 이상 사용하지 않습니다.
    if (next.className) {
      next.className = '';
      changed = true;
    }
  }

  return { student: next, changed };
}

function getKinderElementaryTransferCandidates(date = new Date()) {
  if ((date.getMonth() + 1) < 3) return [];
  return getStudentsByType('kinder').filter(student => {
    if (getStudentStatus(student) !== 'active') return false;
    const adjusted = applyOlliStudentLifecycle(student, date).student;
    return Number(adjusted?.age) >= 8;
  });
}

let olliStudentLifecycleSyncInFlight = false;
async function syncOlliStudentLifecycleAfterLoad() {
  if (olliStudentLifecycleSyncInFlight) return;
  olliStudentLifecycleSyncInFlight = true;
  try {
    const now = new Date();
    const current = getAllStudents();
    const changed = [];
    const next = current.map(student => {
      const result = applyOlliStudentLifecycle(student, now);
      if (result.changed) changed.push(result.student);
      return result.student;
    });
    if (!changed.length) return;
    setAllStudents(next);

    // 기준값과 갱신된 나이/학년을 서버에도 저장해 다른 기기에서도 동일하게 보이도록 합니다.
    if (isSupabaseConfigured()) {
      for (const student of changed) {
        try {
          await ensureStudentSavedToSupabase(student);
        } catch (err) {
          console.warn('학생 연도 자동 갱신 서버 저장 보류:', student?.name || student?.id || '', err?.message || err);
        }
      }
    }
  } finally {
    olliStudentLifecycleSyncInFlight = false;
  }
}

function getElementaryCycleGroups(students = getStudentsByType('elementary')) {
  const groups = [...new Set(
    students
      .filter(student => getStudentStatus(student) === 'active')
      .map(student => Number(student.group))
      .filter(group => Number.isFinite(group) && group > 0)
  )];
  return groups.sort((a, b) => a - b);
}

function getRotatingElementaryGroupRank(student, groups = null) {
  const groupNumber = Number(student?.group);
  const activeGroups = groups || getElementaryCycleGroups();

  if (!Number.isFinite(groupNumber) || !activeGroups.includes(groupNumber)) return 999;
  if (!activeGroups.length) return 999;

  // 3월을 첫 번째 그룹(A/1그룹)의 기준월로 잡습니다.
  // 예: A,B,C 3개 그룹이면 3월 A → 4월 B → 5월 C → 6월 A 순서입니다.
  const baseMonth = 3;
  const currentMonth = getCurrentMonthNumber();
  const topIndex = ((currentMonth - baseMonth) % activeGroups.length + activeGroups.length) % activeGroups.length;
  const groupIndex = activeGroups.indexOf(groupNumber);

  return (groupIndex - topIndex + activeGroups.length) % activeGroups.length;
}

function getKinderAgeRank(student) {
  const age = Number(student?.age);
  return Number.isFinite(age) && age > 0 ? age : 999;
}

