(function pcShellModule(global) {
  'use strict';

  const sectionTitles = {
    academy: '학생관리',
    attendance: '성향기록부',
    observation: '관찰기록',
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
    body.classList.toggle('pcAttendanceLayout', state.section === 'attendance');
    const panel = document.getElementById('pcAcademyDetailPanel');
    if (panel && state.section !== 'academy') panel.style.display = 'none';
    else if (panel) panel.style.display = '';
    const attendancePanel = document.getElementById('pcAttendanceDetailPanel');
    if (attendancePanel && state.section !== 'attendance') attendancePanel.style.display = 'none';
    else if (attendancePanel) attendancePanel.style.display = '';
  }

  function feature(name) {
    return global[name] || null;
  }

  function renderContext() {
    const elementary = sortedStudents('elementary');
    const kinder = sortedStudents('kinder');
    if (state.section === 'academy') return feature('OlliPcStudentManagement')?.renderContext(elementary, kinder);
    if (state.section === 'attendance') return feature('OlliPcAttendance')?.renderContext(elementary, kinder);
    if (state.section === 'observation') return feature('OlliPcObservation')?.renderContext(elementary, kinder);
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
      if (state.section === 'observation') feature('OlliPcObservation')?.renderTopbar(title);
      else if (state.section === 'schedule') {
        title.textContent = '';
        if (typeof global.olliTtRenderScheduleHeader === 'function') global.olliTtRenderScheduleHeader();
      } else title.textContent = sectionTitles[state.section] || 'OLLI';
    }

    const archive = document.getElementById('olliPcTopArchiveBtn');
    const sortButton = document.getElementById('olliPcSortBtn');
    const searchable = state.section === 'academy' || state.section === 'attendance';
    if (search) {
      search.style.display = searchable ? '' : 'none';
      if (searchable) search.value = state.searchValues[state.section] || '';
    }
    if (archive) archive.classList.toggle('show', state.section === 'observation');
    if (sortButton) sortButton.style.visibility = state.section === 'observation' ? 'visible' : 'hidden';
    if (state.section !== 'observation') document.getElementById('recordSortPopup')?.classList.remove('show');
    renderContext();
    updateRecordLayout();
  }

  async function openSection(section) {
    if (section === 'feedback') {
      state.observationTab = 'feedback';
      section = 'observation';
    } else if (section === 'observation') state.observationTab = 'observation';
    setChrome(section);

    if (section === 'academy') return feature('OlliPcStudentManagement')?.open();
    if (section === 'attendance') return feature('OlliPcAttendance')?.open();
    if (section === 'observation') return feature('OlliPcObservation')?.open();
    if (section === 'schedule') {
      hideMainScreensExcept('recordRoomScreen');
      if (typeof showRecordRoom === 'function') await showRecordRoom();
      if (typeof openRecordAttendanceDashboard === 'function') await openRecordAttendanceDashboard();
      else if (typeof currentRecordView !== 'undefined') currentRecordView = typeof currentObservationView !== 'undefined' && currentObservationView === 'kinder' ? 'kinder' : 'elementary';
      if (typeof global.olliPcSetAttendanceView === 'function') global.olliPcSetAttendanceView('schedule');
    }
  }

  function setObservationTab(tab) {
    const next = tab === 'feedback' ? 'feedback' : 'observation';
    if (state.section === 'observation' && state.observationTab === next) return;
    return openSection(next === 'feedback' ? 'feedback' : 'observation');
  }

  function handleTopSearch(value) {
    if (Object.prototype.hasOwnProperty.call(state.searchValues, state.section)) state.searchValues[state.section] = String(value || '');
    if (state.section === 'attendance') return feature('OlliPcAttendance')?.renderList(value);
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

  const core = { state, activeStudents, sortedStudents, hideMainScreensExcept, updateRecordLayout, renderContext, setChrome, openSection, syncFromVisiblePage };
  global.OlliPcCore = core;
  global.__olliPcAcademySelectedStudentRef = '';
  global.pcSyncFromVisiblePage = syncFromVisiblePage;
  global.pcOpenSection = openSection;
  global.pcSetObservationTab = setObservationTab;
  global.pcHandleTopSearch = handleTopSearch;
  global.pcFilterAttendanceDivision = (division) => feature('OlliPcAttendance')?.filterDivision(division);
  global.pcFilterAttendanceDay = (day) => feature('OlliPcAttendance')?.filterDay(day);
  global.pcRenderAttendanceList = (value) => feature('OlliPcAttendance')?.renderList(value);
  global.pcFilterAcademy = (type) => feature('OlliPcStudentManagement')?.filter(type);
  global.pcSelectAcademyConsultationStudent = (ref, event) => feature('OlliPcStudentManagement')?.selectConsultationStudent(ref, event);
  global.pcRefreshAcademyConsultationCompletionState = () => feature('OlliPcStudentManagement')?.refreshConsultationCompletionState();
  global.pcOpenRosterStudentInfo = (id, event) => feature('OlliPcObservation')?.openStudentInfo(id, event);
  global.pcOpenSidebarSort = (event) => feature('OlliPcObservation')?.openSidebarSort(event);
  global.pcRefreshSidebarRoster = () => feature('OlliPcObservation')?.refreshRoster();
  global.pcSelectRosterStudent = (id, mode) => feature('OlliPcObservation')?.selectStudent(id, mode);
  global.pcOpenTopArchive = () => feature('OlliPcObservation')?.openArchive();

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
