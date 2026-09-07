(function pcStartPageModule(global){
  'use strict';
  if (global.__OLLI_PC_START_PAGE_V3__) return;
  global.__OLLI_PC_START_PAGE_V3__ = true;

  function installPcTimetableMemoCardStyle(){
    if (document.getElementById('olliPcTimetableMemoCardCompactStyle')) return;
    const style = document.createElement('style');
    style.id = 'olliPcTimetableMemoCardCompactStyle';
    style.textContent = `
      #recordRoomScreen .olliTtCellMemoCard {
        min-height: 24px;
        padding: 3px 5px;
        border-color: transparent;
        gap: 5px;
      }
      #recordRoomScreen .olliTtCellMemoCard:hover { border-color: transparent; }
      #recordRoomScreen .olliTtCellMemoCard span {
        margin-top: 0;
        line-height: 1.25;
      }
      #recordRoomScreen .olliTtCellMemoCard strong { line-height: 1.25; }

      body.olliPcApp #recordRoomScreen .pcAttendanceSortDivider {
        gap: 7px;
        margin: 11px 0 7px;
        color: #aeb3bb;
        font-size: 9.5px;
        font-weight: 620;
        line-height: 1;
        letter-spacing: -.01em;
      }
      body.olliPcApp #recordRoomScreen .pcAttendanceSortDivider::before,
      body.olliPcApp #recordRoomScreen .pcAttendanceSortDivider::after {
        min-width: 10px;
        background: #eceef1;
      }
      body.olliPcApp #recordRoomScreen .pcAttendanceSortDivider span {
        padding: 0 1px;
      }
    `;
    document.head.appendChild(style);
  }
  installPcTimetableMemoCardStyle();

  const PAGES = {
    academy: { value: 'academy', label: '학생관리' },
    attendance: { value: 'attendance', label: '성향기록부' },
    schedule: { value: 'schedule', label: '시간표 • 출석부' }
  };

  function text(value){ return String(value == null ? '' : value).trim(); }
  function lsGet(key){ try { return localStorage.getItem(key) || ''; } catch (_) { return ''; } }
  function lsSet(key, value){ try { localStorage.setItem(key, value); } catch (_) {} }

  function normalizePc(page){
    page = text(page);
    if (!page) return '';
    if (page === 'academy' || page === 'director' || page === 'dashboard' || page === 'academy_management' || page === 'director_dashboard') return 'academy';
    if (page === 'attendance' || page === 'personality_records' || page === 'personality' || page === 'memo' || page === 'observation' || page === 'observation_note' || page === 'record_observation' || page === 'kinder' || page === 'record_kinder' || page === 'one_minute_feedback' || page === 'kinder_attendance') return 'attendance';
    if (page === 'schedule' || page === 'timetable' || page === 'elementary' || page === 'record_elementary' || page === 'elementary_attendance') return 'schedule';
    return '';
  }

  function getOlliStartPageStableKey(){
    const accountPart = text(lsGet('olli_account_id_v1') || lsGet('olli_account_login_id_v1') || lsGet('olli_current_member_id') || 'local') || 'local';
    const academyPart = text(lsGet('olli_current_academy_id') || lsGet('olli_current_academy_code') || 'academy') || 'academy';
    const rolePart = text(lsGet('olli_current_member_role') || 'role') || 'role';
    return `${accountPart}_${academyPart}_${rolePart}`.replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
  }

  function getOlliStartPageMemberKey(){
    const memberId = text(lsGet('olli_current_member_id'));
    if (memberId) return 'member_' + memberId;
    const role = text(lsGet('olli_current_member_role')) || (lsGet('olli_owner_logged_in') === 'true' ? 'owner' : (lsGet('olli_teacher_logged_in') === 'true' ? 'teacher' : 'guest'));
    const academy = text(lsGet('olli_current_academy_id') || lsGet('olli_current_academy_code') || 'local');
    return `${role}_${academy}`.replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
  }

  function storageKey(){ return 'olli_pc_start_page_' + getOlliStartPageStableKey(); }
  function setupDoneKey(){ return 'olli_pc_start_page_setup_done_' + getOlliStartPageStableKey(); }
  function isOlliStartPageSetupDoneForCurrentContext(){ return lsGet(setupDoneKey()) === 'true'; }
  function markOlliStartPageSetupDoneForCurrentContext(){ lsSet(setupDoneKey(), 'true'); }

  function pcOptions(){ return [PAGES.academy, PAGES.attendance, PAGES.schedule].map((item) => ({ value: item.value, label: item.label })); }

  function readLegacyStartPage(){
    const keys = [
      'olli_default_start_page_' + getOlliStartPageMemberKey(),
      'olli_default_start_page_' + getOlliStartPageStableKey(),
      'olli_default_start_page_fallback'
    ];
    for (const key of keys) {
      const migrated = normalizePc(lsGet(key));
      if (migrated) return migrated;
    }
    try {
      const academyId = text(lsGet('olli_current_academy_id'));
      const academyCode = text(lsGet('olli_current_academy_code')).toUpperCase();
      const academies = JSON.parse(lsGet('olli_account_academies_v1') || '[]');
      if (Array.isArray(academies)) {
        const matched = academies.find((item) => academyId && text(item?.academy_id || item?.academyId) === academyId)
          || academies.find((item) => academyCode && text(item?.academy_code || item?.academyCode).toUpperCase() === academyCode);
        const migrated = normalizePc(matched?.default_start_page || matched?.defaultStartPage || matched?.member_default_start_page || matched?.start_page || matched?.startPage || '');
        if (migrated) return migrated;
      }
    } catch (_) {}
    return '';
  }

  function getOlliDefaultStartPage(){
    const stored = normalizePc(lsGet(storageKey()));
    if (stored) return stored;
    const migrated = readLegacyStartPage();
    if (migrated) {
      lsSet(storageKey(), migrated);
      markOlliStartPageSetupDoneForCurrentContext();
    }
    return migrated;
  }

  async function saveOlliDefaultStartPage(page){
    const normalized = normalizePc(page) || 'attendance';
    lsSet(storageKey(), normalized);
    markOlliStartPageSetupDoneForCurrentContext();
    updateOlliStartPageSettingUI();
    return normalized;
  }

  function getOlliStartPageOptionsForCurrentRole(){ return pcOptions(); }
  function isOlliStartPageAllowedForCurrentRole(page){ return !!normalizePc(page); }
  function getOlliAllowedStartPage(page){ return normalizePc(page) || 'attendance'; }
  function getOlliStartPageLabel(page){ return PAGES[getOlliAllowedStartPage(page)]?.label || PAGES.attendance.label; }
  function canAccessOlliStartPageAcademyManagement(){ return true; }

  function isOlliLoggedInForStartPage(){
    return lsGet('olli_owner_logged_in') === 'true'
      || lsGet('olli_teacher_logged_in') === 'true'
      || !!lsGet('olli_current_academy_id')
      || !!lsGet('olli_current_academy_code');
  }

  function hideOlliAppScreensForRoute(){
    ['studentMemoScreen','kinderChatFeedbackScreen','mainPageScreen','settingsPageScreen','settingsDetailScreen'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  async function enterOlliByStartPage(page){
    const normalized = getOlliAllowedStartPage(page);
    try { if (typeof global.hideOlliLoginScreens === 'function') global.hideOlliLoginScreens(); } catch (_) {}
    try { document.body.classList.remove('olli-login-open'); } catch (_) {}
    hideOlliAppScreensForRoute();
    try { if (typeof studentSelectionMode !== 'undefined') studentSelectionMode = false; } catch (_) {}
    try { if (typeof selectedStudentIds !== 'undefined' && selectedStudentIds?.clear) selectedStudentIds.clear(); } catch (_) {}
    try { if (typeof currentRecordMode !== 'undefined') currentRecordMode = 'class'; } catch (_) {}
    if (typeof global.pcOpenSection === 'function') {
      await Promise.resolve(global.pcOpenSection(normalized));
      try { if (typeof global.pcSyncFromVisiblePage === 'function') global.pcSyncFromVisiblePage(); } catch (_) {}
      return normalized;
    }
    throw new Error('PC 화면 전환 모듈을 찾지 못했습니다.');
  }

  function renderOlliStartPageSetupOptions(){
    const grid = document.getElementById('olliStartPageChoiceGrid');
    if (!grid) return;
    grid.innerHTML = pcOptions().map((item) => `<button class="olliStartPageChoiceBtn" type="button" onclick="selectOlliStartPageAndEnter('${item.value}')">${item.label}</button>`).join('');
  }

  function showOlliStartPageSetup(){
    if (typeof global.showOlliLoginScreenById === 'function') global.showOlliLoginScreenById('olliStartPageSetupScreen');
    renderOlliStartPageSetupOptions();
  }

  async function selectOlliStartPageAndEnter(page){
    const saved = await saveOlliDefaultStartPage(page);
    return enterOlliByStartPage(saved);
  }

  async function enterOlliAfterLoginOrSetup(){
    try { if (typeof global.recoverOlliCurrentMemberContextFromCache === 'function') global.recoverOlliCurrentMemberContextFromCache(); } catch (_) {}
    try { if (typeof global.refreshOlliRoleBasedVisibilityUI === 'function') global.refreshOlliRoleBasedVisibilityUI(); } catch (_) {}
    if (typeof global.validateOlliCurrentAcademyStillExists === 'function') {
      const academyCheck = await global.validateOlliCurrentAcademyStillExists({ silent: true });
      if (academyCheck?.blocked) return;
    }
    if (typeof global.ensureOlliCurrentAcademyAccessAllowed === 'function') {
      const allowed = await global.ensureOlliCurrentAcademyAccessAllowed({ refresh: true, autoPersistExpired: true });
      if (!allowed) return;
    }
    const page = getOlliDefaultStartPage();
    if (page) return enterOlliByStartPage(page);
    showOlliStartPageSetup();
  }

  function selectSettingsStartPageOption(page){
    const normalized = getOlliAllowedStartPage(page);
    document.querySelectorAll('.settingsStartPageOption[data-start-page-option]').forEach((btn) => {
      const active = normalizePc(btn.getAttribute('data-start-page-option')) === normalized;
      btn.classList.toggle('active', active);
      const check = btn.querySelector('.check');
      if (check) check.textContent = active ? '✓' : '';
    });
  }

  function updateOlliStartPageSettingUI(){
    const page = getOlliDefaultStartPage() || 'attendance';
    const value = document.getElementById('settingsStartPageValue');
    if (value) value.textContent = getOlliStartPageLabel(page);
    document.querySelectorAll('[data-start-page-option]').forEach((btn) => {
      const active = normalizePc(btn.getAttribute('data-start-page-option')) === page;
      btn.classList.toggle('active', active);
      const check = btn.querySelector('.check');
      if (check) check.textContent = active ? '✓' : '';
    });
  }

  async function refreshOlliDefaultStartPageFromSupabase(){ return getOlliDefaultStartPage() || ''; }

  Object.assign(global, {
    normalizeOlliStartPage: normalizePc,
    getOlliStartPageStableKey,
    getOlliStartPageMemberKey,
    getOlliStartPageSetupDoneKey: setupDoneKey,
    isOlliStartPageSetupDoneForCurrentContext,
    markOlliStartPageSetupDoneForCurrentContext,
    getOlliStartPageOptionsForCurrentRole,
    isOlliStartPageAllowedForCurrentRole,
    getOlliAllowedStartPage,
    getOlliStartPageLabel,
    canAccessOlliStartPageAcademyManagement,
    getOlliDefaultStartPage,
    saveOlliDefaultStartPage,
    isOlliLoggedInForStartPage,
    hideOlliAppScreensForRoute,
    enterOlliByStartPage,
    renderOlliStartPageSetupOptions,
    showOlliStartPageSetup,
    selectOlliStartPageAndEnter,
    enterOlliAfterLoginOrSetup,
    selectSettingsStartPageOption,
    updateOlliStartPageSettingUI,
    refreshOlliDefaultStartPageFromSupabase
  });

  try {
    if (typeof settingsSheetData !== 'undefined' && settingsSheetData?.startPage) {
      settingsSheetData.startPage.desc = 'PC 앱을 열었을 때 처음 보여줄 화면을 선택합니다.';
      settingsSheetData.startPage.html = function(){
        const current = getOlliDefaultStartPage() || 'attendance';
        const optionsHtml = pcOptions().map((item) => {
          const active = item.value === current;
          return `<button type="button" class="settingsStartPageOption ${active ? 'active' : ''}" data-start-page-option="${item.value}" onclick="selectSettingsStartPageOption('${item.value}')"><span>${item.label}</span><span class="check">${active ? '✓' : ''}</span></button>`;
        }).join('');
        return `<div class="settingsInputGroup">${optionsHtml}</div><div class="settingsMiniText">PC 시작 페이지는 학생관리, 성향기록부, 시간표 • 출석부 중에서 선택할 수 있습니다.</div>`;
      };
      settingsSheetData.startPage.onSave = async function(){
        const selected = document.querySelector('.settingsStartPageOption.active[data-start-page-option]')?.getAttribute('data-start-page-option') || getOlliDefaultStartPage() || 'attendance';
        await saveOlliDefaultStartPage(selected);
      };
    }
  } catch (_) {}

  function refreshPcStartPageUi(){
    const value = document.getElementById('settingsStartPageValue');
    if (value) value.textContent = getOlliStartPageLabel(getOlliDefaultStartPage() || 'attendance');
    updateOlliStartPageSettingUI();
  }

  global.OlliPcStartPage = { normalize: normalizePc, options: pcOptions, storageKey };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshPcStartPageUi);
  else setTimeout(refreshPcStartPageUi, 0);
})(window);
