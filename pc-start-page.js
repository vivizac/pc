(function pcStartPageModule(global){
  'use strict';
  if (global.__OLLI_PC_START_PAGE_V2__) return;
  global.__OLLI_PC_START_PAGE_V2__ = true;

  function isPc(){
    return !!(!global.matchMedia || global.matchMedia('(min-width: 900px)').matches);
  }

  const PAGES = {
    academy: { value:'academy', label:'학생관리' },
    attendance: { value:'attendance', label:'성향기록부' },
    schedule: { value:'schedule', label:'시간표 • 출석부' }
  };

  function normalizePc(page){
    page = String(page == null ? '' : page).trim();
    if (!page) return '';
    if (page === 'academy' || page === 'director' || page === 'dashboard' || page === 'academy_management' || page === 'director_dashboard') return 'academy';
    if (page === 'attendance' || page === 'personality_records' || page === 'personality' || page === 'memo' || page === 'observation' || page === 'observation_note' || page === 'record_observation' || page === 'kinder' || page === 'record_kinder' || page === 'one_minute_feedback' || page === 'kinder_attendance') return 'attendance';
    if (page === 'schedule' || page === 'timetable' || page === 'elementary' || page === 'record_elementary' || page === 'elementary_attendance') return 'schedule';
    return '';
  }

  function storageKey(){
    let stable = '';
    try { if (typeof global.getOlliStartPageStableKey === 'function') stable = String(global.getOlliStartPageStableKey() || ''); } catch (_) {}
    if (!stable) {
      let member = '';
      let academy = '';
      let role = '';
      try { member = localStorage.getItem('olli_current_member_id') || ''; } catch (_) {}
      try { academy = localStorage.getItem('olli_current_academy_id') || localStorage.getItem('olli_current_academy_code') || ''; } catch (_) {}
      try { role = localStorage.getItem('olli_current_member_role') || ''; } catch (_) {}
      stable = [member || 'member', academy || 'academy', role || 'role'].join('_');
    }
    stable = stable.replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
    return 'olli_pc_start_page_' + stable;
  }

  function readLocal(){
    try { return localStorage.getItem(storageKey()) || ''; } catch (_) { return ''; }
  }

  function writeLocal(page){
    try { localStorage.setItem(storageKey(), page); } catch (_) {}
  }

  const previous = {
    options: global.getOlliStartPageOptionsForCurrentRole,
    allowed: global.getOlliAllowedStartPage,
    label: global.getOlliStartPageLabel,
    get: global.getOlliDefaultStartPage,
    save: global.saveOlliDefaultStartPage,
    enter: global.enterOlliByStartPage,
    selectSetup: global.selectOlliStartPageAndEnter,
    selectSettings: global.selectSettingsStartPageOption,
    updateUI: global.updateOlliStartPageSettingUI,
    renderSetup: global.renderOlliStartPageSetupOptions
  };

  function pcOptions(){
    return [PAGES.academy, PAGES.attendance, PAGES.schedule].map((item) => ({ value:item.value, label:item.label }));
  }

  global.getOlliStartPageOptionsForCurrentRole = function(){
    if (!isPc()) return typeof previous.options === 'function' ? previous.options.apply(this, arguments) : [];
    return pcOptions();
  };

  global.getOlliAllowedStartPage = function(page){
    if (!isPc()) return typeof previous.allowed === 'function' ? previous.allowed.apply(this, arguments) : page;
    return normalizePc(page);
  };

  global.getOlliStartPageLabel = function(page){
    if (!isPc()) return typeof previous.label === 'function' ? previous.label.apply(this, arguments) : String(page || '');
    const normalized = normalizePc(page) || 'attendance';
    return PAGES[normalized].label;
  };

  global.getOlliDefaultStartPage = function(){
    if (!isPc()) return typeof previous.get === 'function' ? previous.get.apply(this, arguments) : '';
    const stored = normalizePc(readLocal());
    if (stored) return stored;
    let legacy = '';
    try { if (typeof previous.get === 'function') legacy = previous.get.apply(this, arguments) || ''; } catch (_) {}
    const migrated = normalizePc(legacy);
    if (migrated) writeLocal(migrated);
    return migrated;
  };

  global.saveOlliDefaultStartPage = async function(page){
    if (!isPc()) return typeof previous.save === 'function' ? previous.save.apply(this, arguments) : page;
    const normalized = normalizePc(page) || 'attendance';
    writeLocal(normalized);
    try { if (typeof global.markOlliStartPageSetupDoneForCurrentContext === 'function') global.markOlliStartPageSetupDoneForCurrentContext(); } catch (_) {}
    try { if (typeof global.updateOlliStartPageSettingUI === 'function') global.updateOlliStartPageSettingUI(); } catch (_) {}
    return normalized;
  };

  global.enterOlliByStartPage = async function(page){
    if (!isPc()) return typeof previous.enter === 'function' ? previous.enter.apply(this, arguments) : undefined;
    const normalized = normalizePc(page) || 'attendance';
    try { if (typeof global.hideOlliLoginScreens === 'function') global.hideOlliLoginScreens(); } catch (_) {}
    try { document.body.classList.remove('olli-login-open'); } catch (_) {}
    if (typeof global.pcOpenSection === 'function') {
      await Promise.resolve(global.pcOpenSection(normalized));
      try { if (typeof global.pcSyncFromVisiblePage === 'function') global.pcSyncFromVisiblePage(); } catch (_) {}
      return normalized;
    }
    if (typeof previous.enter === 'function') {
      const fallback = normalized === 'academy' ? 'director_dashboard' : (normalized === 'schedule' ? 'elementary_attendance' : 'observation_note');
      return previous.enter.call(this, fallback);
    }
    return normalized;
  };

  global.selectOlliStartPageAndEnter = async function(page){
    if (!isPc()) return typeof previous.selectSetup === 'function' ? previous.selectSetup.apply(this, arguments) : undefined;
    const saved = await global.saveOlliDefaultStartPage(page);
    return global.enterOlliByStartPage(saved);
  };

  global.selectSettingsStartPageOption = function(page){
    if (!isPc()) return typeof previous.selectSettings === 'function' ? previous.selectSettings.apply(this, arguments) : undefined;
    const normalized = normalizePc(page);
    document.querySelectorAll('.settingsStartPageOption[data-start-page-option]').forEach((btn) => {
      const active = normalizePc(btn.getAttribute('data-start-page-option')) === normalized;
      btn.classList.toggle('active', active);
      const check = btn.querySelector('.check');
      if (check) check.textContent = active ? '✓' : '';
    });
  };

  global.updateOlliStartPageSettingUI = function(){
    if (!isPc()) return typeof previous.updateUI === 'function' ? previous.updateUI.apply(this, arguments) : undefined;
    const page = global.getOlliDefaultStartPage() || 'attendance';
    const value = document.getElementById('settingsStartPageValue');
    if (value) value.textContent = global.getOlliStartPageLabel(page);
    document.querySelectorAll('[data-start-page-option]').forEach((btn) => {
      const active = normalizePc(btn.getAttribute('data-start-page-option')) === page;
      btn.classList.toggle('active', active);
      const check = btn.querySelector('.check');
      if (check) check.textContent = active ? '✓' : '';
    });
  };

  global.renderOlliStartPageSetupOptions = function(){
    if (!isPc()) return typeof previous.renderSetup === 'function' ? previous.renderSetup.apply(this, arguments) : undefined;
    const grid = document.getElementById('olliStartPageChoiceGrid');
    if (!grid) return;
    grid.innerHTML = pcOptions().map((item) => '<button class="olliStartPageChoiceBtn" type="button" onclick="selectOlliStartPageAndEnter(\'' + item.value + '\')">' + item.label + '</button>').join('');
  };

  try { getOlliStartPageOptionsForCurrentRole = global.getOlliStartPageOptionsForCurrentRole; } catch (_) {}
  try { getOlliAllowedStartPage = global.getOlliAllowedStartPage; } catch (_) {}
  try { getOlliStartPageLabel = global.getOlliStartPageLabel; } catch (_) {}
  try { getOlliDefaultStartPage = global.getOlliDefaultStartPage; } catch (_) {}
  try { saveOlliDefaultStartPage = global.saveOlliDefaultStartPage; } catch (_) {}
  try { enterOlliByStartPage = global.enterOlliByStartPage; } catch (_) {}
  try { selectOlliStartPageAndEnter = global.selectOlliStartPageAndEnter; } catch (_) {}
  try { selectSettingsStartPageOption = global.selectSettingsStartPageOption; } catch (_) {}
  try { updateOlliStartPageSettingUI = global.updateOlliStartPageSettingUI; } catch (_) {}
  try { renderOlliStartPageSetupOptions = global.renderOlliStartPageSetupOptions; } catch (_) {}

  try {
    if (typeof settingsSheetData !== 'undefined' && settingsSheetData?.startPage) {
      settingsSheetData.startPage.desc = 'PC 앱을 열었을 때 처음 보여줄 화면을 선택합니다.';
      settingsSheetData.startPage.html = function(){
        const current = global.getOlliDefaultStartPage() || 'attendance';
        const optionsHtml = pcOptions().map((item) => {
          const active = item.value === current;
          return '<button type="button" class="settingsStartPageOption ' + (active ? 'active' : '') + '" data-start-page-option="' + item.value + '" onclick="selectSettingsStartPageOption(\'' + item.value + '\')"><span>' + item.label + '</span><span class="check">' + (active ? '✓' : '') + '</span></button>';
        }).join('');
        return '<div class="settingsInputGroup">' + optionsHtml + '</div><div class="settingsMiniText">PC 시작 페이지는 학생관리, 성향기록부, 시간표 • 출석부 중에서 선택할 수 있습니다.</div>';
      };
      settingsSheetData.startPage.onSave = async function(){
        const selected = document.querySelector('.settingsStartPageOption.active[data-start-page-option]')?.getAttribute('data-start-page-option') || global.getOlliDefaultStartPage() || 'attendance';
        await global.saveOlliDefaultStartPage(selected);
      };
    }
  } catch (_) {}

  function refreshPcStartPageUi(){
    if (!isPc()) return;
    const value = document.getElementById('settingsStartPageValue');
    if (value) value.textContent = global.getOlliStartPageLabel(global.getOlliDefaultStartPage() || 'attendance');
    try { global.updateOlliStartPageSettingUI(); } catch (_) {}
  }

  global.OlliPcStartPage = { isPc, normalize: normalizePc, options: pcOptions };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshPcStartPageUi);
  else setTimeout(refreshPcStartPageUi, 0);
})(window);
