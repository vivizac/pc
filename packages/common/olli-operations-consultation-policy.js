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
  const academyId=ensureOlliConsultationContext();
  const normalized=normalizeOlliConsultationRulesByType(rules);
  if(!academyId||!window.OlliConsultationServer)throw new Error('상담 공통 서버를 사용할 수 없습니다.');
  const saved=await window.OlliConsultationServer.setRules(normalized);
  if(typeof writeOlliLocal==='function')writeOlliLocal('consultation_rules',{academyId},
    normalizeOlliConsultationRulesByType(saved),
    {syncStatus:'synced',lastSyncedAt:new Date().toISOString(),retryCount:0});
  refreshOlliConsultationViews();
  return normalizeOlliConsultationRulesByType(saved);
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

function getConsultationCompletedItem(taskKey, progress = getOlliConsultationProgress()){
  return progress?.completed?.[taskKey] || null;
}

function getConsultationDueTasksForStudent(student, referenceDate = new Date()){
  if (getStudentStatus(student) !== 'active') return [];
  return calculateOlliConsultationTasks(student, {
    enrolled: getStudentEnrollmentDateForStats(student),
    now: referenceDate,
    progress: getOlliConsultationProgress(),
    rules: getOlliConsultationRules(student?.type)
  });
}

function getDueConsultationRuleLabelsForStudent(student){
  return Array.from(new Set(getConsultationDueTasksForStudent(student).map(task => task.label).filter(Boolean)));
}

function isAcademyConsultationCompletedForCurrentList(student){
  const tasks = getConsultationDueTasksForStudent(student);
  return tasks.length > 0 && tasks.every(task => task.completed);
}
