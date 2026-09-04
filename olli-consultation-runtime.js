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


