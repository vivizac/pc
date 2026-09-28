/* 시작 페이지 개인 설정 */
const OLLI_DEFAULT_START_PAGE_FALLBACK_KEY = 'olli_default_start_page_fallback';
const OLLI_START_PAGE_LABELS = {
  observation_note: '관찰노트',
  kinder_attendance: '퀵노트',
  director_dashboard: '학원관리'
};
const OLLI_START_PAGE_SETUP_DONE_PREFIX = 'olli_start_page_setup_done_';
function getOlliStartPageStableKey(){
  const accountPart = String(
    localStorage.getItem(OLLI_ACCOUNT_ID_KEY) ||
    localStorage.getItem(OLLI_ACCOUNT_LOGIN_ID_KEY) ||
    localStorage.getItem('olli_current_member_id') ||
    'local'
  ).trim() || 'local';
  const academyPart = String(
    localStorage.getItem('olli_current_academy_id') ||
    localStorage.getItem('olli_current_academy_code') ||
    'academy'
  ).trim() || 'academy';
  const rolePart = String(localStorage.getItem('olli_current_member_role') || '').trim() || 'role';
  return `${accountPart}_${academyPart}_${rolePart}`.replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
}
function getOlliStartPageSetupDoneKey(){
  return OLLI_START_PAGE_SETUP_DONE_PREFIX + getOlliStartPageStableKey();
}
function isOlliStartPageSetupDoneForCurrentContext(){
  return localStorage.getItem(getOlliStartPageSetupDoneKey()) === 'true';
}
function markOlliStartPageSetupDoneForCurrentContext(){
  localStorage.setItem(getOlliStartPageSetupDoneKey(), 'true');
}
function getOlliCachedSelectedAcademyDefaultStartPage(){
  try {
    const academyId = String(localStorage.getItem('olli_current_academy_id') || '').trim();
    const academyCode = String(localStorage.getItem('olli_current_academy_code') || '').trim().toUpperCase();
    const academies = typeof readOlliCachedAccountAcademies === 'function' ? readOlliCachedAccountAcademies() : [];
    const matched = academies.find(item => academyId && String(item.academy_id || item.academyId || '').trim() === academyId)
      || academies.find(item => academyCode && String(item.academy_code || item.academyCode || '').trim().toUpperCase() === academyCode);
    return normalizeOlliStartPage(matched?.default_start_page || matched?.defaultStartPage || '');
  } catch (_) {
    return '';
  }
}
function normalizeOlliStartPage(page){
  if (page === 'memo' || page === 'observation' || page === 'observation_note' || page === 'record_observation') return 'observation_note';
  if (
    page === 'kinder' || page === 'record_kinder' || page === 'one_minute_feedback'
    || page === 'kinder_attendance' || page === 'quicknote' || page === 'quick_note'
  ) return 'kinder_attendance';
  // 출석부는 더 이상 시작 페이지가 아닙니다. 예전 저장값은 퀵노트로 이관합니다.
  if (
    page === 'elementary' || page === 'record_elementary' || page === 'attendance'
    || page === 'elementary_attendance'
  ) return 'kinder_attendance';
  if (page === 'director' || page === 'dashboard' || page === 'academy_management' || page === 'director_dashboard') return 'director_dashboard';
  return OLLI_START_PAGE_LABELS[page] ? page : '';
}
function canAccessOlliStartPageAcademyManagement(){
  const role = typeof getOlliCurrentRole === 'function' ? getOlliCurrentRole() : (localStorage.getItem('olli_current_member_role') || '');
  return role === 'owner' || role === 'manager' || role === 'super_admin';
}
function getOlliStartPageOptionsForCurrentRole(){
  const options = [
    { value: 'observation_note', label: '관찰노트' },
    { value: 'kinder_attendance', label: '퀵노트' }
  ];
  if (canAccessOlliStartPageAcademyManagement()) options.push({ value: 'director_dashboard', label: '학원관리' });
  return options;
}
function isOlliStartPageAllowedForCurrentRole(page){
  const normalized = normalizeOlliStartPage(page);
  return getOlliStartPageOptionsForCurrentRole().some(item => item.value === normalized);
}
function getOlliAllowedStartPage(page){
  const normalized = normalizeOlliStartPage(page);
  if (normalized && isOlliStartPageAllowedForCurrentRole(normalized)) return normalized;
  return 'observation_note';
}
function getOlliStartPageLabel(page){
  return OLLI_START_PAGE_LABELS[getOlliAllowedStartPage(page)] || '관찰노트';
}
function getOlliStartPageMemberKey(){
  const memberId = localStorage.getItem('olli_current_member_id') || '';
  if (memberId) return 'member_' + memberId;
  const role = localStorage.getItem('olli_current_member_role') || (localStorage.getItem('olli_owner_logged_in') === 'true' ? 'owner' : (localStorage.getItem('olli_teacher_logged_in') === 'true' ? 'teacher' : 'guest'));
  const academyId = localStorage.getItem('olli_current_academy_id') || localStorage.getItem('olli_current_academy_code') || 'local';
  return role + '_' + academyId;
}
function getOlliDefaultStartPage(){
  const memberKey = getOlliStartPageMemberKey();
  const stableKey = getOlliStartPageStableKey();
  const keys = [
    'olli_default_start_page_' + memberKey,
    'olli_default_start_page_' + stableKey
  ];
  for (const key of keys) {
    const saved = normalizeOlliStartPage(localStorage.getItem(key) || '');
    if (saved) return getOlliAllowedStartPage(saved);
  }

  const serverDefault = getOlliCachedSelectedAcademyDefaultStartPage();
  if (serverDefault) return getOlliAllowedStartPage(serverDefault);

  // 전역 fallback은 예전 버전 호환용입니다.
  // 새 학원에 처음 연결된 경우에는 fallback 때문에 시작 페이지 질문이 건너뛰지 않도록,
  // 현재 학원에서 이미 한 번 설정한 흔적이 있을 때만 사용합니다.
  const fallback = normalizeOlliStartPage(localStorage.getItem(OLLI_DEFAULT_START_PAGE_FALLBACK_KEY) || '');
  if (fallback && isOlliStartPageSetupDoneForCurrentContext()) return getOlliAllowedStartPage(fallback);
  return '';
}
async function saveOlliDefaultStartPage(page){
  const normalized = getOlliAllowedStartPage(page) || 'observation_note';
  const memberId = localStorage.getItem('olli_current_member_id') || '';
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || localStorage.getItem('olli_current_academy_id') || '';

  if (!memberId || !academyId) {
    throw new Error('현재 학원 또는 멤버 정보를 확인하지 못해 시작 페이지를 저장할 수 없습니다.');
  }

  let row = null;
  try {
    const rows = await supabase('PATCH', `academy_members?academy_id=eq.${encodeURIComponent(academyId)}&id=eq.${encodeURIComponent(memberId)}`, {
      default_start_page: normalized
    });
    row = Array.isArray(rows) ? rows[0] : null;
  } catch (err) {
    console.warn('default_start_page Supabase 저장 실패:', err);
    if (typeof recordOlliStorageIssue === 'function') {
      recordOlliStorageIssue({
        feature: 'member_default_start_page',
        resource: 'academy_members',
        operation: 'save',
        message: err && (err.message || err),
        member_id: memberId
      });
    }
    throw err;
  }

  if (!row || normalizeOlliStartPage(row.default_start_page || '') !== normalized) {
    throw new Error('시작 페이지 서버 저장을 확인하지 못했습니다.');
  }

  const memberKey = getOlliStartPageMemberKey();
  const stableKey = getOlliStartPageStableKey();
  localStorage.setItem('olli_default_start_page_' + memberKey, normalized);
  localStorage.setItem('olli_default_start_page_' + stableKey, normalized);
  localStorage.setItem(OLLI_DEFAULT_START_PAGE_FALLBACK_KEY, normalized);
  markOlliStartPageSetupDoneForCurrentContext();

  try {
    const academies = typeof readOlliCachedAccountAcademies === 'function' ? readOlliCachedAccountAcademies() : [];
    const updated = academies.map(item => {
      const itemAcademyId = String(item.academy_id || item.academyId || '').trim();
      const itemMemberId = String(item.member_id || item.memberId || '').trim();
      if (itemAcademyId === String(academyId) && (!itemMemberId || itemMemberId === String(memberId))) {
        return { ...item, default_start_page: normalized, defaultStartPage: normalized, member_default_start_page: normalized, start_page: normalized, startPage: normalized };
      }
      return item;
    });
    if (updated.length && typeof applyOlliAccessibleAcademies === 'function') applyOlliAccessibleAcademies(updated);
  } catch (err) {
    console.warn('시작 페이지 학원 캐시 갱신 건너뜀:', err);
  }

  updateOlliStartPageSettingUI();
  return normalized;
}
function getOlliPhoneWritableAccountSessionToken(){
  try {
    return String(localStorage.getItem('olli_account_session_token_v1') || '').trim();
  } catch (_) {
    return '';
  }
}
function hasOlliPhoneWritableAccountSession(){
  return !!getOlliPhoneWritableAccountSessionToken();
}
function showOlliPhoneAccountLoginForWritableSession(){
  try { hideOlliAppScreensForRoute(); } catch (_) {}
  if (typeof showOlliOwnerLogin === 'function') {
    showOlliOwnerLogin();
    return;
  }
  if (typeof showOlliLoginEntry === 'function') showOlliLoginEntry();
}
function invalidateOlliPhoneWritableAccountSession(reason = ''){
  try { localStorage.removeItem('olli_account_session_token_v1'); } catch (_) {}
  console.warn('폰 계정 세션 서버 검증 실패. 계정 로그인이 필요합니다.', reason || 'INVALID_ACCOUNT_SESSION');
  showOlliPhoneAccountLoginForWritableSession();
}
function holdOlliPhoneWritableAccountSession(reason = ''){
  console.warn('폰 계정 세션을 서버에서 일시적으로 확인하지 못했습니다. 기존 세션과 로컬 데이터는 유지합니다.', reason || 'TEMPORARY_SESSION_CHECK_FAILURE');
}
const OLLI_PHONE_AUTH_REVALIDATE_TTL = 60000;
let olliPhoneAuthValidationPromise = null;
let olliPhoneAuthValidatedAt = 0;
let olliPhoneLegacyBootstrapPromise = null;

function getOlliPhoneLegacyDeviceId(){
  try {
    if (typeof getOlliLoginDeviceId === 'function') {
      const id = String(getOlliLoginDeviceId() || '').trim();
      if (id) return id;
    }
  } catch (_) {}
  try {
    return String(
      localStorage.getItem('olli_account_device_id_v1')
      || localStorage.getItem('olli_device_id_v1')
      || ''
    ).trim();
  } catch (_) {
    return '';
  }
}
function getOlliPhoneLegacyDeviceName(){
  try {
    if (typeof getOlliDeviceName === 'function') {
      const name = String(getOlliDeviceName() || '').trim();
      if (name) return name;
    }
  } catch (_) {}
  try {
    const ua = String(navigator?.userAgent || '');
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/Android/i.test(ua)) return 'Android';
  } catch (_) {}
  return 'Phone';
}
function saveOlliPhoneLegacyAccountSession(result){
  const sessionToken = String(result?.session_token || '').trim();
  if (!sessionToken) return false;

  try {
    if (typeof saveOlliAccountLoginState === 'function' && Array.isArray(result?.academies) && result.academies.length) {
      const preferredAcademyCode = String(localStorage.getItem('olli_current_academy_code') || '').trim();
      saveOlliAccountLoginState(result, preferredAcademyCode);
      return !!getOlliPhoneWritableAccountSessionToken();
    }
  } catch (error) {
    console.warn('레거시 기기 계정 세션 상태 반영 실패:', error?.message || error);
  }

  try {
    localStorage.setItem('olli_account_session_token_v1', sessionToken);
    if (result?.account_id) localStorage.setItem('olli_account_id_v1', String(result.account_id));
    if (result?.account_name) localStorage.setItem('olli_account_name_v1', String(result.account_name));
    if (result?.device_id) localStorage.setItem('olli_account_device_id_v1', String(result.device_id));
    if (Array.isArray(result?.academies) && result.academies.length) {
      localStorage.setItem('olli_account_academies_v1', JSON.stringify(result.academies));
    }
    return true;
  } catch (_) {
    return false;
  }
}
async function restoreOlliPhoneLegacyRegisteredDeviceSession(){
  if (typeof callOlliTestRpc !== 'function') return false;
  const deviceId = getOlliPhoneLegacyDeviceId();
  if (!deviceId) return false;

  try {
    const result = await callOlliTestRpc('olli_restore_teacher_session_by_device', {
      p_device_id: deviceId,
      p_device_name: getOlliPhoneLegacyDeviceName()
    });
    if (!result || result.ok !== true || !result.session_token) return false;
    return saveOlliPhoneLegacyAccountSession(result);
  } catch (error) {
    console.warn('레거시 승인 기기 세션 복구 실패:', error?.message || error);
    return false;
  }
}
function shouldAttemptOlliPhoneLegacyDeviceBootstrap(){
  if (hasOlliPhoneWritableAccountSession()) return false;

  let teacherLoggedIn = false;
  let currentRole = '';
  try {
    teacherLoggedIn = localStorage.getItem('olli_teacher_logged_in') === 'true';
    currentRole = String(localStorage.getItem('olli_current_member_role') || '').trim().toLowerCase();
  } catch (_) {}

  if (!teacherLoggedIn && currentRole !== 'teacher' && currentRole !== 'manager') return false;
  return !!getOlliPhoneLegacyDeviceId();
}

async function bootstrapOlliPhoneAccountSession(){
  if (hasOlliPhoneWritableAccountSession()) return true;
  if (!shouldAttemptOlliPhoneLegacyDeviceBootstrap()) return false;
  if (olliPhoneLegacyBootstrapPromise) return olliPhoneLegacyBootstrapPromise;

  olliPhoneLegacyBootstrapPromise = (async () => {
    const restored = await restoreOlliPhoneLegacyRegisteredDeviceSession();
    return restored === true && hasOlliPhoneWritableAccountSession();
  })();

  try {
    return await olliPhoneLegacyBootstrapPromise;
  } finally {
    olliPhoneLegacyBootstrapPromise = null;
  }
}

async function requireOlliPhoneWritableAccountSession(){
  const token = getOlliPhoneWritableAccountSessionToken();

  if (!token) {
    olliPhoneAuthValidatedAt = 0;
    invalidateOlliPhoneWritableAccountSession('NO_ACCOUNT_SESSION');
    return false;
  }
  if (typeof restoreOlliAccountSession !== 'function') {
    holdOlliPhoneWritableAccountSession('SESSION_VALIDATOR_UNAVAILABLE');
    return false;
  }

  try {
    const restored = await restoreOlliAccountSession({ silent: true, allowCachedFallback: false });
    const reason = String(restored?.reason || '').trim();
    const valid = restored?.restored === true
      && restored?.authoritative === true
      && restored?.degraded !== true;
    if (valid) {
      olliPhoneAuthValidatedAt = Date.now();
      return true;
    }

    if (restored?.blocked === true || reason === 'NO_ACCOUNT_SESSION' || reason === 'NO_ACCESSIBLE_ACADEMY' || reason === 'SESSION_INVALID') {
      olliPhoneAuthValidatedAt = 0;
      invalidateOlliPhoneWritableAccountSession(reason || 'SESSION_NOT_RESTORED');
      return false;
    }

    holdOlliPhoneWritableAccountSession(reason || 'SESSION_NOT_AUTHORITATIVE');
    return false;
  } catch (error) {
    holdOlliPhoneWritableAccountSession(error?.message || 'SESSION_VALIDATION_ERROR');
    return false;
  }
}

async function refreshOlliPhoneAccountSessionValidation(options = {}){
  if (globalThis.navigator?.onLine === false) return hasOlliPhoneWritableAccountSession();
  if (!hasOlliPhoneWritableAccountSession()) return false;

  const force = options?.force === true;
  const now = Date.now();
  if (!force && olliPhoneAuthValidatedAt > 0 && now - olliPhoneAuthValidatedAt < OLLI_PHONE_AUTH_REVALIDATE_TTL) {
    return true;
  }

  if (olliPhoneAuthValidationPromise) return olliPhoneAuthValidationPromise;
  olliPhoneAuthValidationPromise = requireOlliPhoneWritableAccountSession();

  try {
    return await olliPhoneAuthValidationPromise;
  } finally {
    olliPhoneAuthValidationPromise = null;
  }
}

function bindOlliPhoneAccountSessionLifecycle(){
  if (window.__olliPhoneAccountSessionLifecycleBound) return;
  window.__olliPhoneAccountSessionLifecycleBound = true;

  const refresh = (force = false) => {
    if (!hasOlliPhoneWritableAccountSession()) return;
    setTimeout(() => { void refreshOlliPhoneAccountSessionValidation({ force }); }, 0);
  };

  window.addEventListener('focus', () => refresh(false));
  window.addEventListener('online', () => refresh(true));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh(false);
  });
}

window.requireOlliPhoneWritableAccountSession = requireOlliPhoneWritableAccountSession;
window.bootstrapOlliPhoneAccountSession = bootstrapOlliPhoneAccountSession;
window.refreshOlliPhoneAccountSessionValidation = refreshOlliPhoneAccountSessionValidation;
bindOlliPhoneAccountSessionLifecycle();

function isOlliLoggedInForStartPage(){
  if (!hasOlliPhoneWritableAccountSession()) return false;
  return localStorage.getItem('olli_owner_logged_in') === 'true'
    || localStorage.getItem('olli_teacher_logged_in') === 'true'
    || !!localStorage.getItem('olli_current_academy_id')
    || !!localStorage.getItem('olli_current_academy_code');
}
function hideOlliAppScreensForRoute(){
  ['studentMemoScreen','mainPageScreen','','','settingsPageScreen','settingsDetailScreen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}
async function enterOlliByStartPage(page, options = {}){
  const localFirst = options?.localFirst === true;
  if (localFirst) {
    if (!hasOlliPhoneWritableAccountSession()) return false;
  } else if (!(await requireOlliPhoneWritableAccountSession())) {
    return false;
  }
  const normalized = getOlliAllowedStartPage(page);
  hideOlliLoginScreens();
  hideOlliAppScreensForRoute();
  studentSelectionMode = false;
  if (selectedStudentIds && typeof selectedStudentIds.clear === 'function') selectedStudentIds.clear();
  currentRecordMode = 'class';
  if (normalized === 'observation_note') {
    currentObservationView = 'elementary';
    currentRecordView = 'elementary';
    setObservationButtonSide('elementary', false);
    await showRecordRoom({ localOnly: localFirst });
    if (typeof openObservationNoteFromRecord === 'function') {
      openObservationNoteFromRecord();
    }
    return true;
  }
  if (normalized === 'kinder_attendance') {
    currentObservationView = 'kinder';
    currentRecordView = 'kinder';
    setObservationButtonSide('kinder', false);
    if (typeof openKinderChatFeedbackPage === 'function') {
      openKinderChatFeedbackPage();
    } else {
      await showRecordRoom({ localOnly: localFirst });
    }
    return true;
  }
  if (normalized === 'director_dashboard') {
    currentObservationView = 'elementary';
    currentRecordView = 'academy';
    setObservationButtonSide('elementary', false);
    if (typeof syncRecordAcademyPageState === 'function') syncRecordAcademyPageState();
    await showRecordRoom({ localOnly: localFirst });
    if (typeof syncRecordAcademyPageState === 'function') syncRecordAcademyPageState();
    requestAnimationFrame(() => {
      if (typeof syncRecordAcademyPageState === 'function') syncRecordAcademyPageState();
    });
    return true;
  }
  currentObservationView = 'elementary';
  currentRecordView = 'elementary';
  setObservationButtonSide('elementary', false);
  await showRecordRoom({ localOnly: localFirst });
  return true;
}
function renderOlliStartPageSetupOptions(){
  const grid = document.getElementById('olliStartPageChoiceGrid');
  if (!grid) return;
  grid.innerHTML = getOlliStartPageOptionsForCurrentRole().map(item => {
    return '<button class="olliStartPageChoiceBtn" type="button" onclick="selectOlliStartPageAndEnter(\'' + item.value + '\')">' + item.label + '</button>';
  }).join('');
}
function showOlliStartPageSetup(){
  showOlliLoginScreenById('olliStartPageSetupScreen');
  renderOlliStartPageSetupOptions();
}
async function selectOlliStartPageAndEnter(page){
  const saved = await saveOlliDefaultStartPage(page);
  await enterOlliByStartPage(saved);
}
async function enterOlliAfterLoginOrSetup(options = {}){
  const localFirst = options?.localFirst === true;
  if (localFirst) {
    if (!hasOlliPhoneWritableAccountSession()) return false;
  } else if (!(await requireOlliPhoneWritableAccountSession())) {
    return false;
  }

  if (typeof recoverOlliCurrentMemberContextFromCache === 'function') recoverOlliCurrentMemberContextFromCache();
  if (typeof refreshOlliRoleBasedVisibilityUI === 'function') refreshOlliRoleBasedVisibilityUI();

  if (!localFirst) {
    if (typeof validateOlliCurrentAcademyStillExists === 'function') {
      const academyCheck = await validateOlliCurrentAcademyStillExists({ silent: true });
      if (academyCheck && academyCheck.blocked) return false;
    }
    if (typeof ensureOlliCurrentAcademyAccessAllowed === 'function') {
      const allowed = await ensureOlliCurrentAcademyAccessAllowed({ refresh: true, autoPersistExpired: true });
      if (!allowed) return false;
    }

    if (typeof refreshOlliDefaultStartPageFromSupabase === 'function') {
      try { await refreshOlliDefaultStartPageFromSupabase({ silent: true }); } catch (err) { console.warn('시작 페이지 서버 새로고침 실패:', err); }
    }
  }

  let page = getOlliDefaultStartPage();
  if (page) {
    markOlliStartPageSetupDoneForCurrentContext();
    return enterOlliByStartPage(page, { localFirst });
  }

  // 학원을 처음 만들거나 처음 승인받아 연결된 경우에만 시작 페이지를 묻습니다.
  // 이후 재접속에서는 저장된 시작 페이지로 바로 들어갑니다.
  if (!isOlliStartPageSetupDoneForCurrentContext()) {
    showOlliStartPageSetup();
    return true;
  }

  page = getOlliAllowedStartPage('observation_note');
  if (!localFirst) await saveOlliDefaultStartPage(page);
  return enterOlliByStartPage(page, { localFirst });
}
function updateOlliStartPageSettingUI(){
  const page = getOlliDefaultStartPage() || 'observation_note';
  const value = document.getElementById('settingsStartPageValue');
  if (value) value.textContent = getOlliStartPageLabel(page);
  document.querySelectorAll('[data-start-page-option]').forEach(btn => {
    const active = normalizeOlliStartPage(btn.getAttribute('data-start-page-option')) === page;
    btn.classList.toggle('active', active);
    const check = btn.querySelector('.check');
    if (check) check.textContent = active ? '✓' : '';
  });
}
