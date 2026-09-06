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
