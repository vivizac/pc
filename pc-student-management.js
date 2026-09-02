(function pcStudentManagementModule(global) {
  'use strict';

  function core() { return global.OlliPcCore; }
  function escape(value) {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(String(value ?? ''));
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }
  function jsSingleQuote(value) {
    if (typeof global.escapeJsSingleQuote === 'function') return global.escapeJsSingleQuote(String(value ?? ''));
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]/g, ' ');
  }
  function students() {
    try { return typeof getAcademyManagementStudentsForStats === 'function' ? getAcademyManagementStudentsForStats() : []; }
    catch (_) { return []; }
  }
  function consultationStudents(list = students()) {
    try { return typeof getThisMonthConsultationDueStudents === 'function' ? getThisMonthConsultationDueStudents(list) : []; }
    catch (_) { return []; }
  }
  function todos() {
    try {
      const progress = typeof getOlliConsultationProgress === 'function' ? getOlliConsultationProgress() : {};
      return Array.isArray(progress?.todos) ? progress.todos : [];
    } catch (_) { return []; }
  }

  function renderContext(elementary, kinder) {
    const title = document.getElementById('olliPcContextTitle');
    const body = document.getElementById('olliPcContextBody');
    if (!title || !body) return;
    const due = consultationStudents(typeof getAcademyManagementStudentsForStats === 'function' ? students() : [...elementary, ...kinder]);
    const elementaryCount = due.filter((student) => student.type === 'elementary').length;
    const kinderCount = due.filter((student) => student.type === 'kinder').length;
    const filter = core().state.academyFilter;
    title.textContent = '상담 보기';
    body.innerHTML =
      '<button class="olliPcQuickBtn '+(filter === 'all' ? 'active' : '')+'" onclick="pcFilterAcademy(\'all\')"><span>전체</span><span>'+due.length+'</span></button>'+
      '<button class="olliPcQuickBtn '+(filter === 'elementary' ? 'active' : '')+'" onclick="pcFilterAcademy(\'elementary\')"><span>초등부</span><span>'+elementaryCount+'</span></button>'+
      '<button class="olliPcQuickBtn '+(filter === 'kinder' ? 'active' : '')+'" onclick="pcFilterAcademy(\'kinder\')"><span>유치부</span><span>'+kinderCount+'</span></button>';
  }

  function buildStatCard(label, value, subText = '') {
    const subHtml = String(subText || '').split(' · ').filter(Boolean).map((part) => escape(part)).join('<br>');
    return '<div class="recordAcademyStatCard"><div class="recordAcademyStatLabel">'+escape(label)+'</div>'+
      '<div class="recordAcademyStatBody"><div class="recordAcademyStatValue">'+escape(value ?? 0)+'</div>'+
      (subHtml ? '<div class="recordAcademyStatSub">'+subHtml+'</div>' : '')+'</div></div>';
  }

  function renderDashboard() {
    const dashboard = document.getElementById('recordAcademyDashboard');
    if (!dashboard) return;
    const allStudents = students();
    const active = allStudents.filter((student) => typeof isAcademyManagementActiveStudent !== 'function' || isAcademyManagementActiveStudent(student));
    const thisYearRegistered = allStudents.filter((student) => {
      const enrolled = typeof getStudentEnrollmentDateForStats === 'function' ? getStudentEnrollmentDateForStats(student) : null;
      return typeof isCurrentYearDate === 'function' && isCurrentYearDate(enrolled) && (typeof getStudentStatus !== 'function' || getStudentStatus(student) !== 'inactive');
    });
    const thisMonthRegistered = allStudents.filter((student) => {
      const enrolled = typeof getStudentEnrollmentDateForStats === 'function' ? getStudentEnrollmentDateForStats(student) : null;
      return typeof isCurrentMonthYear === 'function' && isCurrentMonthYear(enrolled) && (typeof getStudentStatus !== 'function' || getStudentStatus(student) !== 'inactive');
    });
    const thisMonthWithdrawn = allStudents.filter((student) => {
      if (typeof getStudentStatus === 'function' && getStudentStatus(student) !== 'withdrawn') return false;
      const date = typeof getStudentWithdrawalDateForStats === 'function' ? getStudentWithdrawalDateForStats(student) : null;
      return date && typeof isCurrentMonthYear === 'function' ? isCurrentMonthYear(date) : false;
    });
    const thisYearWithdrawn = allStudents.filter((student) => {
      if (typeof getStudentStatus === 'function' && getStudentStatus(student) !== 'withdrawn') return false;
      const date = typeof getStudentWithdrawalDateForStats === 'function' ? getStudentWithdrawalDateForStats(student) : null;
      return date && typeof isCurrentYearDate === 'function' ? isCurrentYearDate(date) : true;
    });
    const paused = allStudents.filter((student) => typeof getStudentStatus === 'function' && getStudentStatus(student) === 'paused');
    const due = consultationStudents(allStudents);
    const activeElementary = active.filter((student) => student.type === 'elementary').length;
    const activeKinder = active.filter((student) => student.type === 'kinder').length;
    const consultationElementary = due.filter((student) => student.type === 'elementary').length;
    const consultationKinder = due.filter((student) => student.type === 'kinder').length;
    const month = new Date().getMonth() + 1;

    dashboard.innerHTML = '<div class="recordAcademyStatGrid">'
      + buildStatCard('원생수', active.length, '초등부 '+activeElementary+'명 · 유치부 '+activeKinder+'명')
      + buildStatCard(month+'월 상담', due.length, '초등부 '+consultationElementary+'명 · 유치부 '+consultationKinder+'명')
      + buildStatCard('올해 등록', thisYearRegistered.length, '이달 등록 '+thisMonthRegistered.length+'명 · 이달 퇴원 '+thisMonthWithdrawn.length+'명')
      + buildStatCard('올해 퇴원', thisYearWithdrawn.length, '휴원 '+paused.length+'명 · 퇴원 '+thisYearWithdrawn.length+'명')
      + '</div><section class="recordAcademyConsultSection pcAcademyTodoSection" id="pcAcademyTodoSection"></section>';
    renderTodoCard();
    renderConsultationPanel(due);
    filter(core().state.academyFilter);
    handleSearch(core().state.searchValues.academy);
  }

  function renderTodoCard() {
    const host = document.getElementById('pcAcademyTodoSection');
    if (!host) return;
    const items = todos().slice().sort((a, b) => Number(a.completed) - Number(b.completed) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
    const remaining = items.filter((item) => !item.completed).length;
    const rows = items.length ? items.map((item) => {
      const id = escape(item.id);
      return '<div class="pcAcademyTodoItem'+(item.completed ? ' completed' : '')+'">'
        + '<button type="button" class="pcAcademyTodoCheck" aria-label="'+(item.completed ? '완료 취소' : '완료')+'" aria-pressed="'+(item.completed ? 'true' : 'false')+'" onclick="pcToggleAcademyTodo(\''+id+'\')"><span></span></button>'
        + '<div class="pcAcademyTodoText">'+escape(item.text)+'</div>'
        + '<button type="button" class="pcAcademyTodoDelete" aria-label="할 일 삭제" title="삭제" onclick="pcDeleteAcademyTodo(\''+id+'\')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>'
        + '</div>';
    }).join('') : '<div class="pcAcademyTodoEmpty"><span>오늘 처리할 일을 적어보세요.</span><small>추가한 할 일은 학원 구성원에게 함께 표시됩니다.</small></div>';
    host.innerHTML = '<div class="pcAcademySectionHeader"><div><div class="pcAcademySectionTitle">할 일</div><div class="pcAcademySectionSub">업무와 메모를 한곳에서 관리해요.</div></div><span class="pcAcademySectionCount">'+remaining+'개 남음</span></div>'
      + '<form class="pcAcademyTodoForm" onsubmit="pcAddAcademyTodo(event)"><input id="pcAcademyTodoInput" type="text" maxlength="80" autocomplete="off" placeholder="할 일을 입력해 주세요"><button type="submit">추가</button></form>'
      + '<div class="pcAcademyTodoList">'+rows+'</div>';
  }

  function consultationListHtml(due) {
    if (!due.length) return '<div class="pcAcademyConsultEmpty">이번 달 상담 예정 학생이 없습니다.</div>';
    const groups = [
      { type: 'elementary', label: '초등부', students: due.filter((student) => student.type === 'elementary') },
      { type: 'kinder', label: '유치부', students: due.filter((student) => student.type === 'kinder') }
    ];
    return groups.map((group) => {
      const rows = group.students.length ? group.students.map((student) => {
        let dueLabels = [];
        try { dueLabels = typeof getDueConsultationRuleLabelsForStudent === 'function' ? getDueConsultationRuleLabelsForStudent(student) : []; } catch (_) {}
        const chips = dueLabels.length ? dueLabels.map((label) => typeof getOlliConsultationRuleShortLabel === 'function' ? getOlliConsultationRuleShortLabel(label) : label) : ['상담 예정'];
        let completed = false;
        try { completed = typeof isAcademyConsultationCompletedForCurrentList === 'function' && isAcademyConsultationCompletedForCurrentList(student); } catch (_) {}
        const ref = student.id ? 'id:'+student.id : 'name:'+String(student.name || '').trim();
        const refJs = jsSingleQuote(ref);
        return '<div class="recordAcademyConsultListItem" data-pc-student-ref="'+escape(ref)+'">'
          + '<div class="recordAcademyConsultStudentMain"><div class="recordAcademyListName">'+escape(student.name)+'</div><div class="recordAcademyChipRow">'+chips.map((label) => '<span class="recordAcademyInfoChip recordAcademyRuleChip">'+escape(label)+'</span>').join('')+'</div></div>'
          + '<button type="button" class="recordAcademyConsultCompleteBtn'+(completed ? ' active' : '')+'" aria-pressed="'+(completed ? 'true' : 'false')+'" onclick="toggleAcademyConsultationCompleted(\''+refJs+'\', event)">'+(completed ? '완료' : '상담')+'</button></div>';
      }).join('') : '<div class="recordAcademyConsultGroupEmpty">예정 학생 없음</div>';
      return '<div class="recordAcademyConsultGroup" data-pc-division="'+group.type+'"><div class="recordAcademyConsultGroupTitle"><span>'+group.label+'</span><span>'+group.students.length+'명</span></div><div class="recordAcademyList">'+rows+'</div></div>';
    }).join('');
  }

  function renderConsultationPanel(due = consultationStudents()) {
    const panel = document.getElementById('pcAcademyDetailPanel');
    if (!panel) return;
    panel.innerHTML = '<div class="pcAcademySectionHeader pcAcademyConsultHeader"><div><div class="pcAcademyDetailName">상담예정 학생</div><div class="pcAcademyDetailSub">이번 달 상담이 필요한 학생</div></div><span class="pcAcademySectionCount">'+due.length+'명</span></div>'
      + '<div class="pcAcademyConsultationList">'+consultationListHtml(due)+'</div>';
  }

  async function persistTodos(nextTodos) {
    if (typeof getOlliConsultationProgress !== 'function' || typeof saveOlliConsultationProgressShared !== 'function') return;
    const progress = getOlliConsultationProgress();
    await saveOlliConsultationProgressShared({ ...progress, todos: nextTodos });
  }
  function addTodo(event) {
    event?.preventDefault();
    const input = document.getElementById('pcAcademyTodoInput');
    const text = String(input?.value || '').trim();
    if (!text) { input?.focus(); return; }
    const now = new Date().toISOString();
    const next = [{ id: 'todo_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2, 7), text, completed: false, created_at: now, completed_at: '' }, ...todos()];
    if (input) input.value = '';
    persistTodos(next);
    renderTodoCard();
    setTimeout(() => document.getElementById('pcAcademyTodoInput')?.focus(), 0);
  }
  function toggleTodo(id) {
    const now = new Date().toISOString();
    const next = todos().map((item) => String(item.id) === String(id) ? { ...item, completed: !item.completed, completed_at: item.completed ? '' : now } : item);
    persistTodos(next);
    renderTodoCard();
  }
  function deleteTodo(id) {
    const next = todos().filter((item) => String(item.id) !== String(id));
    persistTodos(next);
    renderTodoCard();
  }

  async function open() {
    const app = core();
    app.hideMainScreensExcept('recordRoomScreen');
    if (typeof showRecordRoom === 'function') await showRecordRoom();
    if (typeof currentRecordView !== 'undefined' && currentRecordView !== 'academy' && typeof toggleRecordAcademyManagementMode === 'function') await toggleRecordAcademyManagementMode();
    app.updateRecordLayout();
    setTimeout(bindRows, 50);
  }

  function filter(type) {
    const app = core();
    app.state.academyFilter = type || 'all';
    document.querySelectorAll('#pcAcademyDetailPanel .recordAcademyConsultGroup').forEach((group) => {
      group.style.display = app.state.academyFilter === 'all' || group.dataset.pcDivision === app.state.academyFilter ? '' : 'none';
    });
    app.renderContext();
  }

  function handleSearch(value) {
    const query = String(value || '').trim();
    document.querySelectorAll('#pcAcademyDetailPanel .recordAcademyConsultListItem').forEach((row) => {
      const name = row.querySelector('.recordAcademyListName')?.textContent || '';
      row.style.display = !query || name.includes(query) ? '' : 'none';
    });
  }

  function resolveStudent(studentRef) {
    const ref = String(studentRef || '');
    const list = students();
    if (ref.startsWith('id:')) return list.find((student) => String(student.id || '') === ref.slice(3)) || null;
    if (ref.startsWith('name:')) return list.find((student) => String(student.name || '').trim() === ref.slice(5).trim()) || null;
    return null;
  }

  function refreshConsultationCompletionState() {
    if (core().state.section !== 'academy') return;
    document.querySelectorAll('#pcAcademyDetailPanel .recordAcademyConsultListItem').forEach((row) => {
      const student = resolveStudent(String(row.dataset.pcStudentRef || ''));
      const button = row.querySelector('.recordAcademyConsultCompleteBtn');
      if (!student || !button) return;
      const completed = isAcademyConsultationCompletedForCurrentList(student);
      button.classList.toggle('active', completed);
      button.setAttribute('aria-pressed', completed ? 'true' : 'false');
      button.textContent = completed ? '완료' : '상담';
    });
    renderTodoCard();
  }

  function bindRows() {
    const app = core();
    if (app.state.section !== 'academy') return;
    filter(app.state.academyFilter);
    handleSearch(app.state.searchValues.academy);
  }

  function start() {
    const dashboard = document.getElementById('recordAcademyDashboard');
    if (!dashboard || dashboard.__olliPcStudentManagementObserver) return;
    dashboard.__olliPcStudentManagementObserver = new MutationObserver(() => {
      if (core().state.section === 'academy') setTimeout(bindRows, 0);
    });
    dashboard.__olliPcStudentManagementObserver.observe(dashboard, { childList: true, subtree: true });
    if (typeof currentRecordView !== 'undefined' && currentRecordView === 'academy') renderDashboard();
  }

  global.OlliPcStudentManagement = { renderContext, renderDashboard, renderTodoCard, renderConsultationPanel, open, filter, handleSearch, resolveStudent, refreshConsultationCompletionState, bindRows, start };
  global.pcAddAcademyTodo = addTodo;
  global.pcToggleAcademyTodo = toggleTodo;
  global.pcDeleteAcademyTodo = deleteTodo;
})(window);
