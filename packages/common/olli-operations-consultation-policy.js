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
