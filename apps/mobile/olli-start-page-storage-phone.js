
/* 2026-07-04: 시작 페이지 설정은 기기별 localStorage만 기준으로 저장합니다.
   - Supabase academy_members.default_start_page 컬럼을 사용하지 않습니다.
   - 최초 선택과 설정 변경이 같은 로컬 키를 사용합니다.
   - 계정 + 학원 + 권한 기준으로 분리 저장합니다. */
(function(){
  var PATCH_FLAG = '__olliStartPageLocalOnlyFinalPatchApplied';
  if (window[PATCH_FLAG]) return;
  window[PATCH_FLAG] = true;

  var FALLBACK_KEY = 'olli_default_start_page_fallback';

  function text(value) {
    return String(value == null ? '' : value).trim();
  }
  function normalize(page) {
    try {
      if (typeof window.normalizeOlliStartPage === 'function') return window.normalizeOlliStartPage(page) || '';
    } catch (_) {}
    page = text(page);
    if (page === 'memo' || page === 'observation' || page === 'observation_note' || page === 'record_observation') return 'observation_note';
    if (page === 'kinder' || page === 'record_kinder' || page === 'one_minute_feedback' || page === 'kinder_attendance' || page === 'quicknote' || page === 'quick_note') return 'kinder_attendance';
    // 출석부 시작 페이지는 폐기되었습니다. 예전 저장값은 퀵노트로 이관합니다.
    if (page === 'elementary' || page === 'record_elementary' || page === 'attendance' || page === 'elementary_attendance') return 'kinder_attendance';
    if (page === 'director' || page === 'dashboard' || page === 'academy_management' || page === 'director_dashboard') return 'director_dashboard';
    return '';
  }
  function allowed(page) {
    var normalized = normalize(page);
    if (!normalized) return '';
    try {
      if (typeof window.getOlliAllowedStartPage === 'function') return window.getOlliAllowedStartPage(normalized) || normalized;
    } catch (_) {}
    return normalized;
  }
  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return ''; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }
  function lsRemove(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  }
  function memberKey() {
    try { if (typeof window.getOlliStartPageMemberKey === 'function') return text(window.getOlliStartPageMemberKey()); } catch (_) {}
    var memberId = text(lsGet('olli_current_member_id'));
    if (memberId) return 'member_' + memberId;
    var role = text(lsGet('olli_current_member_role')) || (lsGet('olli_owner_logged_in') === 'true' ? 'owner' : (lsGet('olli_teacher_logged_in') === 'true' ? 'teacher' : 'guest'));
    var academy = text(lsGet('olli_current_academy_id')) || text(lsGet('olli_current_academy_code')) || 'local';
    return (role + '_' + academy).replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
  }
  function stableKey() {
    try { if (typeof window.getOlliStartPageStableKey === 'function') return text(window.getOlliStartPageStableKey()); } catch (_) {}
    var account = text(lsGet('olli_account_id')) || text(lsGet('olli_account_login_id')) || text(lsGet('olli_current_member_id')) || 'local';
    var academy = text(lsGet('olli_current_academy_id')) || text(lsGet('olli_current_academy_code')) || 'academy';
    var role = text(lsGet('olli_current_member_role')) || 'role';
    return (account + '_' + academy + '_' + role).replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
  }
  function setupDoneKey() {
    try { if (typeof window.getOlliStartPageSetupDoneKey === 'function') return text(window.getOlliStartPageSetupDoneKey()); } catch (_) {}
    return 'olli_start_page_setup_done_' + stableKey();
  }
  function isSetupDone() {
    try { if (typeof window.isOlliStartPageSetupDoneForCurrentContext === 'function') return !!window.isOlliStartPageSetupDoneForCurrentContext(); } catch (_) {}
    return lsGet(setupDoneKey()) === 'true';
  }
  function markSetupDone() {
    lsSet(setupDoneKey(), 'true');
    try { if (typeof window.markOlliStartPageSetupDoneForCurrentContext === 'function') window.markOlliStartPageSetupDoneForCurrentContext(); } catch (_) {}
  }
  function currentStorageKeys() {
    var keys = [];
    var mk = memberKey();
    var sk = stableKey();
    if (mk) keys.push('olli_default_start_page_' + mk);
    if (sk) keys.push('olli_default_start_page_' + sk);
    if (mk && sk) keys.push('olli_start_page_local_' + mk + '_' + sk);
    return Array.from(new Set(keys.filter(Boolean)));
  }
  function removeOldDurableKeysForCurrentContext() {
    var account = text(lsGet('olli_account_id')) || text(lsGet('olli_account_login_id')) || text(lsGet('olli_current_member_id'));
    var academy = text(lsGet('olli_current_academy_id')) || text(lsGet('olli_current_academy_code'));
    if (!account || !academy) return;
    try {
      Object.keys(localStorage).forEach(function(key){
        if (key.indexOf('olli_default_start_page_account_academy_') !== 0) return;
        if (key.indexOf(account) >= 0 || key.indexOf(academy) >= 0) lsRemove(key);
      });
    } catch (_) {}
  }
  function writeLocalStartPage(page) {
    var normalized = allowed(page) || 'observation_note';
    currentStorageKeys().forEach(function(key){ lsSet(key, normalized); });
    lsSet(FALLBACK_KEY, normalized);
    removeOldDurableKeysForCurrentContext();
    markSetupDone();
    updateCachedAcademies(normalized);
    return normalized;
  }
  function readLocalStartPage() {
    var keys = currentStorageKeys();
    for (var i = 0; i < keys.length; i += 1) {
      var page = normalize(lsGet(keys[i]));
      if (page) return allowed(page);
    }
    var fallback = normalize(lsGet(FALLBACK_KEY));
    if (fallback && isSetupDone()) return allowed(fallback);
    return '';
  }
  function getAcademyId() {
    try { if (typeof window.getOlliCurrentAcademyId === 'function') return text(window.getOlliCurrentAcademyId()); } catch (_) {}
    return text(lsGet('olli_current_academy_id'));
  }
  function getAcademyCode() {
    return text(lsGet('olli_current_academy_code')).toUpperCase();
  }
  function getMemberId() {
    return text(lsGet('olli_current_member_id'));
  }
  function isCurrentAcademyItem(item) {
    if (!item || typeof item !== 'object') return false;
    var id = text(item.academy_id || item.academyId || item.id);
    var code = text(item.academy_code || item.academyCode || item.code).toUpperCase();
    var mid = text(item.member_id || item.memberId || item.academy_member_id || item.academyMemberId || item.membership_id || item.membershipId);
    var currentId = getAcademyId();
    var currentCode = getAcademyCode();
    var currentMember = getMemberId();
    return !!((currentId && id === currentId) || (currentCode && code === currentCode) || (currentMember && mid === currentMember));
  }
  function updateCachedAcademies(page) {
    var normalized = allowed(page);
    if (!normalized) return;
    try {
      var key = 'olli_account_academies_v1';
      try { if (typeof OLLI_ACCOUNT_ACADEMIES_KEY !== 'undefined') key = OLLI_ACCOUNT_ACADEMIES_KEY; } catch (_) {}
      var raw = JSON.parse(lsGet(key) || '[]');
      if (!Array.isArray(raw)) return;
      var changed = false;
      raw.forEach(function(item){
        if (!item || typeof item !== 'object' || !isCurrentAcademyItem(item)) return;
        item.default_start_page = normalized;
        item.defaultStartPage = normalized;
        item.member_default_start_page = normalized;
        item.start_page = normalized;
        item.startPage = normalized;
        changed = true;
      });
      if (changed) lsSet(key, JSON.stringify(raw));
    } catch (_) {}
  }
  function updateUI() {
    var page = window.getOlliDefaultStartPage() || 'observation_note';
    var value = document.getElementById('settingsStartPageValue');
    if (value) {
      var label = page;
      try { if (typeof window.getOlliStartPageLabel === 'function') label = window.getOlliStartPageLabel(page); } catch (_) {}
      value.textContent = label || '관찰노트';
    }
    document.querySelectorAll('[data-start-page-option]').forEach(function(btn){
      var active = normalize(btn.getAttribute('data-start-page-option')) === normalize(page);
      btn.classList.toggle('active', active);
      var check = btn.querySelector('.check');
      if (check) check.textContent = active ? '✓' : '';
    });
  }

  window.refreshOlliDefaultStartPageFromSupabase = async function(){
    return window.getOlliDefaultStartPage() || '';
  };
  try { refreshOlliDefaultStartPageFromSupabase = window.refreshOlliDefaultStartPageFromSupabase; } catch (_) {}

  window.getOlliDefaultStartPage = function(){
    return readLocalStartPage();
  };
  try { getOlliDefaultStartPage = window.getOlliDefaultStartPage; } catch (_) {}

  window.saveOlliDefaultStartPage = async function(page){
    var saved = writeLocalStartPage(page);
    updateUI();
    return saved;
  };
  try { saveOlliDefaultStartPage = window.saveOlliDefaultStartPage; } catch (_) {}

  window.selectOlliStartPageAndEnter = async function(page){
    var saved = await window.saveOlliDefaultStartPage(page);
    if (typeof window.enterOlliByStartPage === 'function') await window.enterOlliByStartPage(saved);
  };
  try { selectOlliStartPageAndEnter = window.selectOlliStartPageAndEnter; } catch (_) {}

  window.updateOlliStartPageSettingUI = updateUI;
  try { updateOlliStartPageSettingUI = window.updateOlliStartPageSettingUI; } catch (_) {}

  // 시작 페이지 저장소는 저장/읽기만 소유합니다.
  // 앱 진입 흐름은 olli-auth-entry-phone-adapter.js의 enterOlliAfterLoginOrSetup 하나만 사용합니다.

  setTimeout(updateUI, 0);
  setTimeout(updateUI, 250);
})();
