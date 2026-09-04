(function pcShellModule(global) {
  'use strict';

  // 화면 이름은 바뀔 수 있지만 기존 저장값·onclick 호환을 위해 route key는 유지합니다.
  const SECTION = Object.freeze({
    ACADEMY: 'academy',
    PERSONALITY_RECORDS: 'attendance',
    CONSULTATION: 'consultation',
    SCHEDULE: 'schedule'
  });
  const sectionTitles = {
    academy: '학생관리',
    attendance: '성향기록부',
    consultation: '상담기록',
    schedule: '시간표 • 출석부'
  };
  const state = {
    section: 'academy',
    searchValues: { academy: '', attendance: '' },
    academyFilter: 'all',
    academySelectedStudentRef: '',
    attendanceDivision: 'all',
    attendanceDay: ''
  };

  function activeStudents(type) {
    const list = typeof getStudentsByType === 'function' ? getStudentsByType(type) : [];
    return (Array.isArray(list) ? list : []).filter((student) => {
      try { return typeof getStudentStatus !== 'function' || getStudentStatus(student) === 'active'; }
      catch (_) { return true; }
    });
  }

  function sortedStudents(type) {
    const list = activeStudents(type);
    if (type === 'kinder' && typeof sortKinderStudents === 'function') return sortKinderStudents(list);
    if (type === 'elementary' && typeof sortElementaryStudents === 'function') return sortElementaryStudents(list);
    return list;
  }

  function hideMainScreensExcept(targetId) {
    document.querySelectorAll('.pageScreen').forEach((screen) => {
      if (screen.id !== targetId) screen.style.display = 'none';
    });
  }

  function updateRecordLayout() {
    const body = document.getElementById('recordBodyNew');
    if (!body) return;
    body.classList.toggle('pcAcademyLayout', state.section === 'academy');
    body.classList.toggle('pcAttendanceLayout', state.section === SECTION.PERSONALITY_RECORDS);
    const panel = document.getElementById('pcAcademyDetailPanel');
    if (panel && state.section !== 'academy') panel.style.display = 'none';
    else if (panel) panel.style.display = '';
    const attendancePanel = document.getElementById('pcAttendanceDetailPanel');
    if (attendancePanel && state.section !== SECTION.PERSONALITY_RECORDS) attendancePanel.style.display = 'none';
    else if (attendancePanel) attendancePanel.style.display = '';
  }

  function feature(name) {
    return global[name] || null;
  }

  function personalityRecordsFeature() {
    return feature('OlliPcPersonalityRecords') || feature('OlliPcAttendance');
  }

  function showRecordRoomImmediately(view) {
    hideMainScreensExcept('recordRoomScreen');
    const record = document.getElementById('recordRoomScreen');
    const pill = document.getElementById('recordSearchPill');
    const input = document.getElementById('searchName');
    if (record) {
      record.style.display = 'flex';
      record.classList.remove('record-search-open', 'record-search-has-query');
    }
    if (pill) pill.classList.remove('active');
    if (input) input.value = '';
    try {
      if (typeof currentRecordView !== 'undefined') currentRecordView = view;
      if ((view === 'elementary' || view === 'kinder') && typeof currentObservationView !== 'undefined') currentObservationView = view;
    } catch (_) {}
    if (typeof global.updateRecordHeaderUI === 'function') global.updateRecordHeaderUI();
    if (typeof global.updateNotificationButtons === 'function') global.updateNotificationButtons();
    updateRecordLayout();
  }

  function renderContext() {
    const elementary = sortedStudents('elementary');
    const kinder = sortedStudents('kinder');
    if (state.section === 'academy') return feature('OlliPcStudentManagement')?.renderContext(elementary, kinder);
    if (state.section === SECTION.PERSONALITY_RECORDS) return personalityRecordsFeature()?.renderContext(elementary, kinder);
    const title = document.getElementById('olliPcContextTitle');
    const body = document.getElementById('olliPcContextBody');
    if (!title || !body) return;
    title.textContent = state.section === 'consultation' ? '상담 명단' : '빠른 보기';
    body.innerHTML = '';
  }

  function setChrome(section) {
    const search = document.getElementById('olliPcSearch');
    if (search && Object.prototype.hasOwnProperty.call(state.searchValues, state.section)) {
      state.searchValues[state.section] = String(search.value || '');
    }
    state.section = section || state.section;
    const shell = document.getElementById('olliPcShell');
    const topbar = document.getElementById('olliPcTopbar');
    if (shell) {
      shell.classList.add('visible');
      shell.dataset.pcSection = state.section;
    }
    if (topbar) topbar.classList.add('visible');
    document.querySelectorAll('[data-pc-nav]').forEach((button) => button.classList.toggle('active', button.dataset.pcNav === state.section));

    const title = document.getElementById('olliPcTopbarTitle');
    if (title) {
      title.classList.remove('olliTtTopbarSchedule');
      if (state.section === 'schedule') {
        title.textContent = '';
        if (typeof global.olliTtRenderScheduleHeader === 'function') global.olliTtRenderScheduleHeader();
      } else title.textContent = sectionTitles[state.section] || 'OLLI';
    }

    const sortButton = document.getElementById('olliPcSortBtn');
    const searchable = state.section === SECTION.ACADEMY || state.section === SECTION.PERSONALITY_RECORDS;
    if (search) {
      search.style.display = searchable ? '' : 'none';
      if (searchable) search.value = state.searchValues[state.section] || '';
    }
    const sortVisible = state.section === SECTION.PERSONALITY_RECORDS;
    if (sortButton) sortButton.style.visibility = sortVisible ? 'visible' : 'hidden';
    if (!sortVisible) document.getElementById('recordSortPopup')?.classList.remove('show');
    renderContext();
    updateRecordLayout();
  }

  async function openSection(section) {
    // 이전 PC 관찰노트 route/탭 호출은 성향기록부로 안전하게 흡수합니다.
    if (section === 'feedback' || section === 'observation') section = SECTION.PERSONALITY_RECORDS;
    if (section !== SECTION.PERSONALITY_RECORDS) personalityRecordsFeature()?.unmountEditor?.();
    setChrome(section);

    if (section === SECTION.ACADEMY) return feature('OlliPcStudentManagement')?.open();
    if (section === SECTION.PERSONALITY_RECORDS) return personalityRecordsFeature()?.open();
    if (section === SECTION.SCHEDULE) {
      const targetView = typeof currentObservationView !== 'undefined' && currentObservationView === 'kinder' ? 'kinder' : 'elementary';
      showRecordRoomImmediately(targetView);
      if (typeof global.olliPcSetAttendanceView === 'function') global.olliPcSetAttendanceView('schedule');
    }
  }

  function handleTopSearch(value) {
    if (Object.prototype.hasOwnProperty.call(state.searchValues, state.section)) state.searchValues[state.section] = String(value || '');
    if (state.section === SECTION.PERSONALITY_RECORDS) return personalityRecordsFeature()?.renderList(value);
    if (state.section === 'academy') return feature('OlliPcStudentManagement')?.handleSearch(value);
  }

  function visibleMainPage() {
    const ids = ['recordRoomScreen', 'studentMemoScreen', 'kinderRiskMemoScreen', 'kinderChatFeedbackScreen'];
    return ids.find((id) => {
      const element = document.getElementById(id);
      return element && getComputedStyle(element).display !== 'none';
    }) || '';
  }

  function syncFromVisiblePage() {
    const loginVisible = Array.from(document.querySelectorAll('.olliLoginScreen')).some((element) => getComputedStyle(element).display !== 'none');
    const settingsVisible = ['settingsPageScreen', 'settingsDetailScreen'].some((id) => {
      const element = document.getElementById(id);
      return element && getComputedStyle(element).display !== 'none';
    });
    const shell = document.getElementById('olliPcShell');
    const topbar = document.getElementById('olliPcTopbar');
    if (loginVisible || settingsVisible) {
      shell?.classList.remove('visible');
      topbar?.classList.remove('visible');
      return;
    }
    const page = visibleMainPage();
    if (!page) return;
    let nextSection = state.section;
    if (page === 'recordRoomScreen' && !['academy', 'attendance', 'schedule'].includes(nextSection)) {
      nextSection = typeof currentRecordView !== 'undefined' && currentRecordView === 'academy' ? 'academy' : 'attendance';
    } else if (page === 'studentMemoScreen' || page === 'kinderRiskMemoScreen' || page === 'kinderChatFeedbackScreen') {
      // PC에서 과거 관찰노트 단독 화면이 열리면 성향기록부로 되돌립니다.
      redirectLegacyStandaloneEditor(page);
      return;
    }
    if (nextSection !== state.section || shell?.dataset.pcSection !== nextSection) setChrome(nextSection);
    else {
      shell?.classList.add('visible');
      topbar?.classList.add('visible');
      updateRecordLayout();
    }
    if (state.section === 'academy') setTimeout(() => feature('OlliPcStudentManagement')?.bindRows(), 0);
  }

  function getStudentAddDivision() {
    try {
      if (typeof currentRecordView !== 'undefined' && (currentRecordView === 'kinder' || currentRecordView === 'elementary')) return currentRecordView;
    } catch (_) {}
    try {
      if (typeof currentObservationView !== 'undefined' && (currentObservationView === 'kinder' || currentObservationView === 'elementary')) return currentObservationView;
    } catch (_) {}
    return 'elementary';
  }

  function ensureStudentAddDivisionTabs() {
    const card = document.querySelector('#studentModal .modalCard');
    if (!card) return null;
    let tabs = card.querySelector('.olliPcStudentAddTabs');
    if (!tabs) {
      tabs = document.createElement('div');
      tabs.className = 'olliPcStudentAddTabs';
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', '학생 추가 부서 선택');
      tabs.innerHTML = '<button type="button" data-pc-student-add-division="elementary" role="tab">초등부 학생 추가</button>'
        + '<button type="button" data-pc-student-add-division="kinder" role="tab">유치부 학생 추가</button>';
      const title = card.querySelector('#studentModalTitle');
      if (title) title.insertAdjacentElement('afterend', tabs);
      else card.insertBefore(tabs, card.firstChild);
      tabs.addEventListener('click', (event) => {
        const button = event.target.closest('[data-pc-student-add-division]');
        if (button) setStudentAddDivision(button.dataset.pcStudentAddDivision);
      });
    }
    return tabs;
  }

  function syncStudentAddDivisionTabs(division) {
    const next = division === 'kinder' ? 'kinder' : 'elementary';
    const tabs = ensureStudentAddDivisionTabs();
    if (!tabs) return;
    tabs.querySelectorAll('[data-pc-student-add-division]').forEach((button) => {
      const active = button.dataset.pcStudentAddDivision === next;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const title = document.getElementById('studentModalTitle');
    if (title) title.textContent = '학생 추가';
  }

  function setStudentAddDivision(division) {
    const next = division === 'kinder' ? 'kinder' : 'elementary';
    try { if (typeof currentRecordView !== 'undefined') currentRecordView = next; } catch (_) {}
    try { if (typeof currentObservationView !== 'undefined') currentObservationView = next; } catch (_) {}
    try { global.currentRecordView = next; } catch (_) {}
    try { global.currentObservationView = next; } catch (_) {}
    if (typeof global.olliPrepareStudentAddExtra === 'function') global.olliPrepareStudentAddExtra(next);
    syncStudentAddDivisionTabs(next);
    const nameInput = document.getElementById('studentNameInput');
    if (nameInput) setTimeout(() => nameInput.focus(), 0);
  }

  function installStudentAddDivisionTabs() {
    const original = global.openStudentModal;
    if (typeof original === 'function' && !original.__olliPcStudentAddTabsWrapped) {
      const wrapped = function(...args) {
        const result = original.apply(this, args);
        setTimeout(() => syncStudentAddDivisionTabs(getStudentAddDivision()), 0);
        return result;
      };
      wrapped.__olliPcStudentAddTabsWrapped = true;
      global.openStudentModal = wrapped;
    }
    global.pcSetStudentAddDivision = setStudentAddDivision;
    setTimeout(() => syncStudentAddDivisionTabs(getStudentAddDivision()), 0);
  }

  function installStudentScheduleSync() {
    const original = global.confirmStudent;
    if (typeof original !== 'function' || original.__olliPcScheduleSyncWrapped) return;
    const wrapped = async function(...args) {
      const result = await original.apply(this, args);
      const modal = document.getElementById('studentModal');
      const modalStillOpen = modal && getComputedStyle(modal).display !== 'none';
      if (modalStillOpen) return result;
      try {
        const timetableService = global.OlliTimetableService;
        if (timetableService && typeof timetableService.syncLegacyStudents === 'function') {
          await timetableService.syncLegacyStudents();
        }
        if (typeof global.olliTtRefreshSchedule === 'function') {
          await global.olliTtRefreshSchedule();
        }
      } catch (error) {
        console.warn('학생 등록 시간표 동기화 실패:', error && (error.message || error));
      }
      return result;
    };
    wrapped.__olliPcScheduleSyncWrapped = true;
    global.confirmStudent = wrapped;
  }

  function isEditorEmbedded(screenId) {
    const host = document.getElementById('pcAttendanceSharedEditorHost');
    const screen = document.getElementById(screenId);
    return !!(host && screen && host.contains(screen));
  }

  function legacyStudentForScreen(pageId, explicitStudentId) {
    if (explicitStudentId) {
      try {
        if (typeof findStudentById === 'function') return findStudentById(explicitStudentId);
      } catch (_) {}
    }

    if (pageId === 'studentMemoScreen' || pageId === 'kinderRiskMemoScreen') {
      try {
        if (typeof currentMemoStudent !== 'undefined' && currentMemoStudent) return currentMemoStudent;
      } catch (_) {}
      return activeStudents(pageId === 'kinderRiskMemoScreen' ? 'kinder' : 'elementary')[0] || null;
    }

    if (pageId === 'kinderChatFeedbackScreen') {
      const inputName = String(document.getElementById('kcfInput')?.value || '').split(/\n/)[0].trim();
      const kinder = activeStudents('kinder');
      return kinder.find((student) => String(student.name || '').trim() === inputName) || kinder[0] || null;
    }

    return null;
  }

  function openPersonalityRecordForStudent(studentId, division) {
    const nextDivision = division === 'kinder' ? 'kinder' : division === 'elementary' ? 'elementary' : 'all';
    try {
      if (nextDivision !== 'all' && typeof currentObservationView !== 'undefined') currentObservationView = nextDivision;
      if (nextDivision !== 'all') global.currentObservationView = nextDivision;
    } catch (_) {}

    return Promise.resolve(openSection(SECTION.PERSONALITY_RECORDS)).then(() => {
      const records = personalityRecordsFeature();
      if (!records) return;
      if (nextDivision !== 'all') {
        state.attendanceDivision = nextDivision;
        records.renderList?.();
      }
      if (studentId) setTimeout(() => records.selectStudent?.(studentId), 0);
    });
  }

  function redirectLegacyStandaloneEditor(pageId, explicitStudentId) {
    const student = legacyStudentForScreen(pageId, explicitStudentId);
    const division = pageId === 'kinderChatFeedbackScreen' || pageId === 'kinderRiskMemoScreen'
      ? 'kinder'
      : (student?.type === 'kinder' ? 'kinder' : 'elementary');
    openPersonalityRecordForStudent(student?.id || explicitStudentId || '', division);
    return true;
  }

  function installLegacyObservationRedirects() {
    const originalMemoOpen = global.openStudentMemoPageById;
    if (typeof originalMemoOpen === 'function' && !originalMemoOpen.__olliPcPersonalityRedirect) {
      const wrappedMemoOpen = function pcOpenMemoInsidePersonality(studentId) {
        if (isEditorEmbedded('studentMemoScreen')) {
          return originalMemoOpen.apply(this, arguments);
        }
        redirectLegacyStandaloneEditor('studentMemoScreen', studentId);
      };
      wrappedMemoOpen.__olliPcPersonalityRedirect = true;
      wrappedMemoOpen.__olliOriginal = originalMemoOpen;
      global.openStudentMemoPageById = wrappedMemoOpen;
    }

    const originalObservationOpen = global.openObservationNoteFromRecord;
    if (typeof originalObservationOpen === 'function' && !originalObservationOpen.__olliPcPersonalityRedirect) {
      const wrappedObservationOpen = function pcOpenObservationInsidePersonality() {
        const student = legacyStudentForScreen('studentMemoScreen', '');
        return openPersonalityRecordForStudent(student?.id || '', 'elementary');
      };
      wrappedObservationOpen.__olliPcPersonalityRedirect = true;
      wrappedObservationOpen.__olliOriginal = originalObservationOpen;
      global.openObservationNoteFromRecord = wrappedObservationOpen;
    }

    const originalKinderOpen = global.openKinderChatFeedbackPage;
    if (typeof originalKinderOpen === 'function' && !originalKinderOpen.__olliPcPersonalityRedirect) {
      const wrappedKinderOpen = function pcOpenKinderFeedbackInsidePersonality() {
        if (isEditorEmbedded('kinderChatFeedbackScreen')) {
          return originalKinderOpen.apply(this, arguments);
        }
        const student = legacyStudentForScreen('kinderChatFeedbackScreen', '');
        return openPersonalityRecordForStudent(student?.id || '', 'kinder');
      };
      wrappedKinderOpen.__olliPcPersonalityRedirect = true;
      wrappedKinderOpen.__olliOriginal = originalKinderOpen;
      global.openKinderChatFeedbackPage = wrappedKinderOpen;
    }
  }

  function openPersonalityRecordsSort(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    let view = 'elementary';
    if (state.attendanceDivision === 'kinder') view = 'kinder';
    else if (state.attendanceDivision === 'all') {
      try { view = currentObservationView === 'kinder' ? 'kinder' : 'elementary'; }
      catch (_) {}
    }
    const popup = document.getElementById('recordSortPopup');
    const bottom = document.querySelector('#olliPcShell .olliPcSidebarBottom');
    if (!popup || !bottom) return;
    if (popup.parentElement !== bottom) bottom.appendChild(popup);
    if (typeof global.refreshRecordSortPopup === 'function') global.refreshRecordSortPopup(view);
    popup.classList.toggle('show');
  }

  function refreshSidebarRoster() {
    if (state.section === SECTION.PERSONALITY_RECORDS) personalityRecordsFeature()?.renderList?.();
  }

  const core = { SECTION, state, activeStudents, sortedStudents, hideMainScreensExcept, showRecordRoomImmediately, updateRecordLayout, renderContext, setChrome, openSection, syncFromVisiblePage };
  global.OlliPcCore = core;
  global.__olliPcAcademySelectedStudentRef = '';
  global.pcSyncFromVisiblePage = syncFromVisiblePage;
  global.pcOpenSection = openSection;
  global.pcHandleTopSearch = handleTopSearch;
  global.pcFilterAttendanceDivision = (division) => personalityRecordsFeature()?.filterDivision(division);
  global.pcFilterAttendanceDay = (day) => personalityRecordsFeature()?.filterDay(day);
  global.pcRenderAttendanceList = (value) => personalityRecordsFeature()?.renderList(value);
  global.pcFilterAcademy = (type) => feature('OlliPcStudentManagement')?.filter(type);
  global.pcSelectAcademyConsultationStudent = (ref, event) => feature('OlliPcStudentManagement')?.selectConsultationStudent(ref, event);
  global.pcRefreshAcademyConsultationCompletionState = () => feature('OlliPcStudentManagement')?.refreshConsultationCompletionState();
  global.pcOpenSidebarSort = openPersonalityRecordsSort;
  global.pcRefreshSidebarRoster = refreshSidebarRoster;

  function normalizeSidebarChrome() {
    // 구버전 index 캐시와 섞여도 관찰노트 메뉴가 다시 노출되지 않도록 안전망만 유지합니다.
    document.querySelectorAll('#olliPcShell [data-pc-nav="observation"]').forEach((button) => button.remove());
    const brand = document.querySelector('#olliPcShell .olliPcBrandLogo');
    if (brand) brand.textContent = 'olli';
    document.getElementById('olliPcTopArchiveBtn')?.remove();
  }

  function start() {
    normalizeSidebarChrome();
    installLegacyObservationRedirects();
    installStudentAddDivisionTabs();
    installStudentScheduleSync();
    feature('OlliPcStudentManagement')?.start();
    setTimeout(syncFromVisiblePage, 0);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncFromVisiblePage();
    });
    global.addEventListener('focus', syncFromVisiblePage);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(window);
