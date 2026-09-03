(function pcShellModule(global) {
  'use strict';

  // 화면 이름은 바뀔 수 있지만 기존 저장값·onclick 호환을 위해 route key는 유지합니다.
  const SECTION = Object.freeze({
    ACADEMY: 'academy',
    PERSONALITY_RECORDS: 'attendance',
    OBSERVATION_NOTE: 'observation',
    CONSULTATION: 'consultation',
    SCHEDULE: 'schedule'
  });
  const sectionTitles = {
    academy: '학생관리',
    attendance: '성향기록부',
    observation: '관찰노트',
    consultation: '상담기록',
    schedule: '시간표'
  };
  const state = {
    section: 'academy',
    observationTab: 'observation',
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

  function observationNoteFeature() {
    return feature('OlliPcObservationNote') || feature('OlliPcObservation');
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
    if (state.section === SECTION.OBSERVATION_NOTE) return observationNoteFeature()?.renderContext(elementary, kinder);
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
      if (state.section === SECTION.OBSERVATION_NOTE) observationNoteFeature()?.renderTopbar(title);
      else if (state.section === 'schedule') {
        title.textContent = '';
        if (typeof global.olliTtRenderScheduleHeader === 'function') global.olliTtRenderScheduleHeader();
      } else title.textContent = sectionTitles[state.section] || 'OLLI';
    }

    const archive = document.getElementById('olliPcTopArchiveBtn');
    const sortButton = document.getElementById('olliPcSortBtn');
    const searchable = state.section === SECTION.ACADEMY || state.section === SECTION.PERSONALITY_RECORDS;
    if (search) {
      search.style.display = searchable ? '' : 'none';
      if (searchable) search.value = state.searchValues[state.section] || '';
    }
    if (archive) archive.classList.toggle('show', state.section === SECTION.OBSERVATION_NOTE);
    if (sortButton) sortButton.style.visibility = state.section === SECTION.OBSERVATION_NOTE ? 'visible' : 'hidden';
    if (state.section !== SECTION.OBSERVATION_NOTE) document.getElementById('recordSortPopup')?.classList.remove('show');
    renderContext();
    updateRecordLayout();
  }

  async function openSection(section) {
    if (section === 'feedback') {
      state.observationTab = 'feedback';
      section = SECTION.OBSERVATION_NOTE;
    } else if (section === SECTION.OBSERVATION_NOTE) state.observationTab = 'observation';
    setChrome(section);

    if (section === SECTION.ACADEMY) return feature('OlliPcStudentManagement')?.open();
    if (section === SECTION.PERSONALITY_RECORDS) return personalityRecordsFeature()?.open();
    if (section === SECTION.OBSERVATION_NOTE) return observationNoteFeature()?.open();
    if (section === SECTION.SCHEDULE) {
      const targetView = typeof currentObservationView !== 'undefined' && currentObservationView === 'kinder' ? 'kinder' : 'elementary';
      showRecordRoomImmediately(targetView);
      if (typeof global.olliPcSetAttendanceView === 'function') global.olliPcSetAttendanceView('schedule');
    }
  }

  function setObservationTab(tab) {
    const next = tab === 'feedback' ? 'feedback' : 'observation';
    if (state.section === SECTION.OBSERVATION_NOTE && state.observationTab === next) return;
    return openSection(next === 'feedback' ? 'feedback' : SECTION.OBSERVATION_NOTE);
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
    const previousObservationTab = state.observationTab;
    if (page === 'kinderChatFeedbackScreen') {
      state.observationTab = 'feedback';
      nextSection = 'observation';
    } else if (page === 'studentMemoScreen' || page === 'kinderRiskMemoScreen') {
      state.observationTab = 'observation';
      nextSection = 'observation';
    } else if (page === 'recordRoomScreen' && !['academy', 'attendance', 'schedule'].includes(nextSection)) {
      nextSection = typeof currentRecordView !== 'undefined' && currentRecordView === 'academy' ? 'academy' : 'attendance';
    }
    if (nextSection !== state.section || shell?.dataset.pcSection !== nextSection || previousObservationTab !== state.observationTab) setChrome(nextSection);
    else {
      shell?.classList.add('visible');
      topbar?.classList.add('visible');
      updateRecordLayout();
    }
    if (state.section === 'academy') setTimeout(() => feature('OlliPcStudentManagement')?.bindRows(), 0);
  }

  const core = { SECTION, state, activeStudents, sortedStudents, hideMainScreensExcept, showRecordRoomImmediately, updateRecordLayout, renderContext, setChrome, openSection, syncFromVisiblePage };
  global.OlliPcCore = core;
  global.__olliPcAcademySelectedStudentRef = '';
  global.pcSyncFromVisiblePage = syncFromVisiblePage;
  global.pcOpenSection = openSection;
  global.pcSetObservationTab = setObservationTab;
  global.pcHandleTopSearch = handleTopSearch;
  global.pcFilterAttendanceDivision = (division) => personalityRecordsFeature()?.filterDivision(division);
  global.pcFilterAttendanceDay = (day) => personalityRecordsFeature()?.filterDay(day);
  global.pcRenderAttendanceList = (value) => personalityRecordsFeature()?.renderList(value);
  global.pcFilterAcademy = (type) => feature('OlliPcStudentManagement')?.filter(type);
  global.pcSelectAcademyConsultationStudent = (ref, event) => feature('OlliPcStudentManagement')?.selectConsultationStudent(ref, event);
  global.pcRefreshAcademyConsultationCompletionState = () => feature('OlliPcStudentManagement')?.refreshConsultationCompletionState();
  global.pcOpenRosterStudentInfo = (id, event) => observationNoteFeature()?.openStudentInfo(id, event);
  global.pcOpenSidebarSort = (event) => observationNoteFeature()?.openSidebarSort(event);
  global.pcRefreshSidebarRoster = () => observationNoteFeature()?.refreshRoster();
  global.pcSelectRosterStudent = (id, mode) => observationNoteFeature()?.selectStudent(id, mode);
  global.pcOpenTopArchive = () => observationNoteFeature()?.openArchive();

  function start() {
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
