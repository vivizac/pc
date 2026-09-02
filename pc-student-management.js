(function pcStudentManagementModule(global) {
  'use strict';

  function core() { return global.OlliPcCore; }

  function renderContext(elementary, kinder) {
    const title = document.getElementById('olliPcContextTitle');
    const body = document.getElementById('olliPcContextBody');
    if (!title || !body) return;
    let due = [];
    try {
      const all = typeof getAcademyManagementStudentsForStats === 'function' ? getAcademyManagementStudentsForStats() : [...elementary, ...kinder];
      due = typeof getThisMonthConsultationDueStudents === 'function' ? getThisMonthConsultationDueStudents(all) : [];
    } catch (_) {}
    const elementaryCount = due.filter((student) => student.type === 'elementary').length;
    const kinderCount = due.filter((student) => student.type === 'kinder').length;
    const filter = core().state.academyFilter;
    title.textContent = '상담 보기';
    body.innerHTML =
      '<button class="olliPcQuickBtn '+(filter === 'all' ? 'active' : '')+'" onclick="pcFilterAcademy(\'all\')"><span>전체</span><span>'+due.length+'</span></button>'+
      '<button class="olliPcQuickBtn '+(filter === 'elementary' ? 'active' : '')+'" onclick="pcFilterAcademy(\'elementary\')"><span>초등부</span><span>'+elementaryCount+'</span></button>'+
      '<button class="olliPcQuickBtn '+(filter === 'kinder' ? 'active' : '')+'" onclick="pcFilterAcademy(\'kinder\')"><span>유치부</span><span>'+kinderCount+'</span></button>';
  }

  async function open() {
    const app = core();
    app.hideMainScreensExcept('recordRoomScreen');
    resetDetail();
    if (typeof showRecordRoom === 'function') await showRecordRoom();
    if (typeof currentRecordView !== 'undefined' && currentRecordView !== 'academy' && typeof toggleRecordAcademyManagementMode === 'function') await toggleRecordAcademyManagementMode();
    app.updateRecordLayout();
    setTimeout(bindRows, 50);
  }

  function filter(type) {
    const app = core();
    app.state.academyFilter = type || 'all';
    document.querySelectorAll('#recordAcademyDashboard .recordAcademyConsultGroup').forEach((group) => {
      const label = group.querySelector('.recordAcademyConsultGroupTitle')?.textContent || '';
      const isElementary = label.includes('초등');
      const isKinder = label.includes('유치');
      group.style.display = app.state.academyFilter === 'all'
        || (app.state.academyFilter === 'elementary' && isElementary)
        || (app.state.academyFilter === 'kinder' && isKinder) ? '' : 'none';
    });
    app.renderContext();
  }

  function handleSearch(value) {
    const query = String(value || '').trim();
    document.querySelectorAll('#recordAcademyDashboard .recordAcademyConsultListItem').forEach((row) => {
      const name = row.querySelector('.recordAcademyListName')?.textContent || '';
      row.style.display = !query || name.includes(query) ? '' : 'none';
    });
  }

  function resetDetail() {
    const app = core();
    app.state.academySelectedStudentRef = '';
    global.__olliPcAcademySelectedStudentRef = '';
    document.querySelectorAll('#recordAcademyDashboard .recordAcademyConsultListItem.pcSelected').forEach((row) => row.classList.remove('pcSelected'));
    const name = document.getElementById('pcAcademyDetailName');
    const sub = document.getElementById('pcAcademyDetailSub');
    const box = document.getElementById('pcAcademyDetailBox');
    if (name) name.textContent = '상담 학생';
    if (sub) sub.textContent = '상담 피드백';
    if (box) {
      box.classList.remove('hasContent');
      box.textContent = '학생을 선택하면 상담 자료를 확인할 수 있습니다.';
    }
  }

  function resolveStudent(studentRef) {
    const ref = String(studentRef || '');
    let students = [];
    try { students = typeof getAcademyManagementStudentsForStats === 'function' ? getAcademyManagementStudentsForStats() : []; }
    catch (_) {}
    if (ref.startsWith('id:')) return students.find((student) => String(student.id || '') === ref.slice(3)) || null;
    if (ref.startsWith('name:')) return students.find((student) => String(student.name || '').trim() === ref.slice(5).trim()) || null;
    return null;
  }

  function selectConsultationStudent(studentRef, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const student = resolveStudent(studentRef);
    if (!student) return;
    const selectedRef = String(studentRef || '');
    core().state.academySelectedStudentRef = selectedRef;
    global.__olliPcAcademySelectedStudentRef = selectedRef;
    document.querySelectorAll('#recordAcademyDashboard .recordAcademyConsultListItem').forEach((row) => {
      row.classList.toggle('pcSelected', String(row.dataset.pcStudentRef || '') === selectedRef);
    });
    showStudent(student);
  }

  function showStudent(student) {
    if (!student) return;
    const name = document.getElementById('pcAcademyDetailName');
    const sub = document.getElementById('pcAcademyDetailSub');
    const box = document.getElementById('pcAcademyDetailBox');
    if (name) name.textContent = student.name || '학생';
    let labels = [];
    try { labels = typeof getDueConsultationRuleLabelsForStudent === 'function' ? getDueConsultationRuleLabelsForStudent(student) : []; }
    catch (_) {}
    const months = typeof getConsultationSummaryMonthsFromLabels === 'function' ? getConsultationSummaryMonthsFromLabels(labels) : 1;
    if (sub) sub.textContent = months + '개월 상담 피드백';
    let content = '';
    try {
      const item = typeof getAcademyConsultationSummaryItem === 'function' ? getAcademyConsultationSummaryItem(student, months) : null;
      content = String(item?.content || '').trim();
    } catch (_) {}
    if (box) {
      box.classList.toggle('hasContent', !!content);
      box.textContent = content || '최근 기간 안에 저장된 피드백이 부족합니다.';
    }
  }

  function refreshConsultationCompletionState() {
    if (core().state.section !== 'academy') return;
    document.querySelectorAll('#recordAcademyDashboard .recordAcademyConsultListItem').forEach((row) => {
      const student = resolveStudent(String(row.dataset.pcStudentRef || ''));
      const button = row.querySelector('.recordAcademyConsultCompleteBtn');
      if (!student || !button) return;
      const completed = isAcademyConsultationCompletedForCurrentList(student);
      button.classList.toggle('active', completed);
      button.setAttribute('aria-pressed', completed ? 'true' : 'false');
    });
  }

  function bindRows() {
    const app = core();
    if (app.state.section !== 'academy') return;
    const selectedRef = app.state.academySelectedStudentRef;
    document.querySelectorAll('#recordAcademyDashboard .recordAcademyConsultListItem').forEach((row) => {
      row.classList.toggle('pcSelected', !!selectedRef && String(row.dataset.pcStudentRef || '') === selectedRef);
    });
    filter(app.state.academyFilter);
    handleSearch(app.state.searchValues.academy);
    if (selectedRef) {
      const student = resolveStudent(selectedRef);
      if (student) showStudent(student);
      else resetDetail();
    }
  }

  function start() {
    const dashboard = document.getElementById('recordAcademyDashboard');
    if (!dashboard || dashboard.__olliPcStudentManagementObserver) return;
    dashboard.__olliPcStudentManagementObserver = new MutationObserver(() => {
      if (core().state.section === 'academy') setTimeout(bindRows, 0);
    });
    dashboard.__olliPcStudentManagementObserver.observe(dashboard, { childList: true, subtree: true });
  }

  global.OlliPcStudentManagement = { renderContext, open, filter, handleSearch, resetDetail, resolveStudent, selectConsultationStudent, showStudent, refreshConsultationCompletionState, bindRows, start };
})(window);
