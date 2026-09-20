(function pcStudentManagementModule(global) {
  'use strict';

  const consultationStatusCache = new Map();
  const consultationStatusInFlight = new Map();
  let serverTodoItems = [];
  let serverTodoAcademyId = '';
  let serverTodoLoadPromise = null;
  let serverTodoRealtimeWatcher = null;

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
  function legacyTodos() {
    try {
      const progress = typeof getOlliConsultationProgress === 'function' ? getOlliConsultationProgress() : {};
      return Array.isArray(progress?.todos) ? progress.todos : [];
    } catch (_) { return []; }
  }

  function todoServerContext() {
    let academyId = '';
    try {
      academyId = String(global.OlliStorageCore?.AcademyContext?.getCurrent?.()?.academyId || '').trim();
    } catch (_) {}
    if (!academyId) {
      try { academyId = String(localStorage.getItem('olli_current_academy_id') || '').trim(); } catch (_) {}
    }
    let sessionToken = '';
    try { sessionToken = String(localStorage.getItem('olli_account_session_token_v1') || '').trim(); } catch (_) {}
    return { academyId, sessionToken };
  }

  async function callTodoRpc(name, params) {
    if (typeof global.supabase !== 'function' && typeof supabase !== 'function') {
      throw new Error('Supabase 연결 함수를 찾지 못했습니다.');
    }
    const call = typeof global.supabase === 'function' ? global.supabase : supabase;
    return call('POST', 'rpc/' + name, params);
  }

  function serverTodosForCurrentAcademy() {
    const academyId = todoServerContext().academyId;
    if (!academyId || academyId !== serverTodoAcademyId) return [];
    return serverTodoItems;
  }

  function todos() {
    const serverItems = serverTodosForCurrentAcademy().map((item) => ({ ...item, _source: 'server' }));
    const legacyItems = legacyTodos().map((item) => ({ ...item, _source: 'legacy' }));
    return [...serverItems, ...legacyItems];
  }

  async function loadServerTodos(options = {}) {
    const opts = { render: true, ...options };
    const context = todoServerContext();
    if (!context.academyId || !context.sessionToken) {
      serverTodoItems = [];
      serverTodoAcademyId = '';
      if (opts.render && core()?.state?.section === 'academy') renderTodoCard();
      return false;
    }

    if (serverTodoLoadPromise && serverTodoAcademyId === context.academyId) return serverTodoLoadPromise;

    const requestedAcademyId = context.academyId;
    serverTodoLoadPromise = (async () => {
      const payload = await callTodoRpc('olli_academy_tasks_list', {
        p_session_token: context.sessionToken,
        p_academy_id: requestedAcademyId,
        p_limit: 200
      });
      if (!payload || payload.ok !== true) throw new Error(payload?.message || '할 일 목록을 불러오지 못했습니다.');

      const current = todoServerContext();
      if (current.academyId !== requestedAcademyId || current.sessionToken !== context.sessionToken) return false;

      serverTodoAcademyId = requestedAcademyId;
      serverTodoItems = Array.isArray(payload.tasks) ? payload.tasks : [];
      if (opts.render && core()?.state?.section === 'academy') renderTodoCard();
      return true;
    })().catch((error) => {
      console.warn('PC 공유 할 일 조회 실패:', error?.message || error);
      return false;
    }).finally(() => {
      serverTodoLoadPromise = null;
    });

    return serverTodoLoadPromise;
  }

  function dueLabelsForStudent(student) {
    try { return typeof getDueConsultationRuleLabelsForStudent === 'function' ? getDueConsultationRuleLabelsForStudent(student) : []; }
    catch (_) { return []; }
  }

  function consultationStudentRef(student) {
    return student?.id ? 'id:'+student.id : 'name:'+String(student?.name || '').trim();
  }

  function consultationStatusKey(student, labels) {
    return consultationStudentRef(student)+'|'+(Array.isArray(labels) ? labels.join('|') : '');
  }

  function consultationStatusChipHtml(student, labels) {
    const cached = consultationStatusCache.get(consultationStatusKey(student, labels));
    const status = cached?.status === 'ready' ? 'ready' : (cached?.status === 'insufficient' ? 'insufficient' : 'checking');
    const label = status === 'ready' ? '준비완료' : (status === 'insufficient' ? '자료부족' : '확인중');
    return '<span class="recordAcademyConsultStatusChip '+status+'" data-pc-consult-material-status="'+status+'">'+label+'</span>';
  }

  function updateConsultationStatusChip(student, labels, status, reason = '') {
    const ref = consultationStudentRef(student);
    const normalizedStatus = status === 'ready' ? 'ready' : (status === 'insufficient' ? 'insufficient' : 'error');
    const label = normalizedStatus === 'ready' ? '준비완료' : (normalizedStatus === 'insufficient' ? '자료부족' : '확인오류');
    consultationStatusCache.set(consultationStatusKey(student, labels), { status: normalizedStatus, reason: String(reason || ''), checkedAt: Date.now() });
    document.querySelectorAll('#pcAcademyDetailPanel .recordAcademyConsultListItem').forEach((row) => {
      if (String(row.dataset.pcStudentRef || '') !== ref) return;
      const chip = row.querySelector('.recordAcademyConsultStatusChip');
      if (!chip) return;
      chip.classList.remove('ready', 'insufficient', 'checking', 'generating', 'error');
      chip.classList.add(normalizedStatus);
      chip.dataset.pcConsultMaterialStatus = normalizedStatus;
      chip.textContent = label;
      if (reason) chip.title = String(reason);
      else chip.removeAttribute('title');
    });
  }

  async function resolveConsultationStatus(student, labels) {
    const key = consultationStatusKey(student, labels);
    if (consultationStatusInFlight.has(key)) return consultationStatusInFlight.get(key);
    const promise = (async () => {
      if (typeof prepareConsultationFeedbackMaterial !== 'function') {
        updateConsultationStatusChip(student, labels, 'error', '상담 자료 확인 기능을 불러오지 못했습니다.');
        return;
      }
      try {
        const months = typeof getConsultationSummaryMonthsFromLabels === 'function'
          ? getConsultationSummaryMonthsFromLabels(labels)
          : 1;
        const material = await prepareConsultationFeedbackMaterial(student, months, labels);
        const status = material?.status === 'ready' ? 'ready' : 'insufficient';
        updateConsultationStatusChip(student, labels, status, material?.reason || '');
      } catch (error) {
        console.warn('PC 상담 자료 상태 확인 실패:', student?.name || '', error?.message || error);
        updateConsultationStatusChip(student, labels, 'error', error?.message || '상담 자료 상태를 확인하지 못했습니다.');
      }
    })().finally(() => consultationStatusInFlight.delete(key));
    consultationStatusInFlight.set(key, promise);
    return promise;
  }

  function refreshConsultationMaterialStatuses(due) {
    (Array.isArray(due) ? due : []).forEach((student) => {
      const labels = dueLabelsForStudent(student);
      resolveConsultationStatus(student, labels);
    });
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
    const activeElement = document.activeElement;
    const todoFocus = activeElement && activeElement.id === 'pcAcademyTodoInput'
      ? {
          value: activeElement.value || '',
          start: Number.isInteger(activeElement.selectionStart) ? activeElement.selectionStart : null,
          end: Number.isInteger(activeElement.selectionEnd) ? activeElement.selectionEnd : null
        }
      : null;
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
    loadServerTodos({ render:true }).catch(() => {});
    renderConsultationPanel(due);
    filter(core().state.academyFilter);
    handleSearch(core().state.searchValues.academy);
    if (todoFocus) {
      const nextInput = document.getElementById('pcAcademyTodoInput');
      if (nextInput) {
        nextInput.value = todoFocus.value;
        try { nextInput.focus({ preventScroll: true }); } catch (_) { nextInput.focus(); }
        if (todoFocus.start !== null && todoFocus.end !== null) {
          try { nextInput.setSelectionRange(todoFocus.start, todoFocus.end); } catch (_) {}
        }
      }
    }
  }

  function renderTodoCard() {
    const host = document.getElementById('pcAcademyTodoSection');
    if (!host) return;
    const items = todos().slice().sort((a, b) => Number(a.completed) - Number(b.completed) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
    const remaining = items.filter((item) => !item.completed).length;
    const rows = items.length ? items.map((item) => {
      const id = escape(item.id);
      const origin = item._source === 'server' && item.origin === 'chat'
        ? '<span class="pcAcademyTodoOrigin">올리톡</span>'
        : '';
      return '<div class="pcAcademyTodoItem'+(item.completed ? ' completed' : '')+'" data-todo-source="'+escape(item._source || 'legacy')+'">'
        + '<button type="button" class="pcAcademyTodoCheck" aria-label="'+(item.completed ? '완료 취소' : '완료')+'" aria-pressed="'+(item.completed ? 'true' : 'false')+'" onclick="pcToggleAcademyTodo(\''+id+'\')"><span></span></button>'
        + '<div class="pcAcademyTodoTextWrap"><div class="pcAcademyTodoText">'+escape(item.text)+'</div>'+origin+'</div>'
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
        const dueLabels = dueLabelsForStudent(student);
        const chips = dueLabels.length ? dueLabels.map((label) => typeof getOlliConsultationRuleShortLabel === 'function' ? getOlliConsultationRuleShortLabel(label) : label) : ['상담 예정'];
        let completed = false;
        try { completed = typeof isAcademyConsultationCompletedForCurrentList === 'function' && isAcademyConsultationCompletedForCurrentList(student); } catch (_) {}
        const ref = consultationStudentRef(student);
        const refJs = jsSingleQuote(ref);
        return '<div class="recordAcademyConsultListItem" data-pc-student-ref="'+escape(ref)+'">'
          + '<div class="recordAcademyConsultStudentMain"><div class="recordAcademyListName">'+escape(student.name)+'</div><div class="recordAcademyChipRow">'+chips.map((label) => '<span class="recordAcademyInfoChip recordAcademyRuleChip">'+escape(label)+'</span>').join('')+'</div></div>'
          + '<div class="recordAcademyConsultActions">'
          + consultationStatusChipHtml(student, dueLabels)
          + '<button type="button" class="recordAcademyConsultCompleteBtn'+(completed ? ' active' : '')+'" aria-pressed="'+(completed ? 'true' : 'false')+'" onclick="toggleAcademyConsultationCompleted(\''+refJs+'\', event)">'+(completed ? '완료' : '상담')+'</button>'
          + '</div></div>';
      }).join('') : '<div class="recordAcademyConsultGroupEmpty">예정 학생 없음</div>';
      return '<div class="recordAcademyConsultGroup" data-pc-division="'+group.type+'"><div class="recordAcademyConsultGroupTitle"><span>'+group.label+'</span><span>'+group.students.length+'명</span></div><div class="recordAcademyList">'+rows+'</div></div>';
    }).join('');
  }

  function renderConsultationPanel(due = consultationStudents()) {
    const panel = document.getElementById('pcAcademyDetailPanel');
    if (!panel) return;
    panel.innerHTML = '<div class="pcAcademySectionHeader pcAcademyConsultHeader"><div><div class="pcAcademyDetailName">상담예정 학생</div><div class="pcAcademyDetailSub">이번 달 상담이 필요한 학생</div></div><span class="pcAcademySectionCount">'+due.length+'명</span></div>'
      + '<div class="pcAcademyConsultationList">'+consultationListHtml(due)+'</div>';
    refreshConsultationMaterialStatuses(due);
  }

  async function persistTodos(nextTodos) {
    if (typeof getOlliConsultationProgress !== 'function' || typeof saveOlliConsultationProgressShared !== 'function') return;
    const progress = getOlliConsultationProgress();
    await saveOlliConsultationProgressShared({ ...progress, todos: nextTodos });
  }

  async function addTodo(event) {
    event?.preventDefault();
    const input = document.getElementById('pcAcademyTodoInput');
    const text = String(input?.value || '').trim();
    if (!text) { input?.focus(); return; }

    const context = todoServerContext();
    if (!context.academyId || !context.sessionToken) {
      const now = new Date().toISOString();
      const next = [{ id: 'todo_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2, 7), text, completed: false, created_at: now, completed_at: '' }, ...legacyTodos()];
      if (input) input.value = '';
      await persistTodos(next);
      renderTodoCard();
      setTimeout(() => document.getElementById('pcAcademyTodoInput')?.focus(), 0);
      return;
    }

    try {
      if (input) input.disabled = true;
      await callTodoRpc('olli_academy_task_create', {
        p_session_token: context.sessionToken,
        p_academy_id: context.academyId,
        p_text: text,
        p_assigned_to_member_id: null
      });
      if (input) input.value = '';
      await loadServerTodos({ render:true });
    } catch (error) {
      console.warn('PC 공유 할 일 추가 실패:', error);
      if (typeof global.showPushToast === 'function') global.showPushToast('할 일을 추가하지 못했습니다.');
      else alert('할 일을 추가하지 못했습니다.\n' + (error?.message || error));
    } finally {
      if (input) input.disabled = false;
      setTimeout(() => document.getElementById('pcAcademyTodoInput')?.focus(), 0);
    }
  }

  async function toggleTodo(id) {
    const item = todos().find((entry) => String(entry.id) === String(id));
    if (!item) return;

    if (item._source === 'server') {
      const context = todoServerContext();
      if (!context.academyId || !context.sessionToken) return;
      try {
        await callTodoRpc('olli_academy_task_set_completed', {
          p_session_token: context.sessionToken,
          p_academy_id: context.academyId,
          p_task_id: String(item.id),
          p_completed: !item.completed
        });
        await loadServerTodos({ render:true });
      } catch (error) {
        console.warn('PC 공유 할 일 완료 변경 실패:', error);
      }
      return;
    }

    const now = new Date().toISOString();
    const next = legacyTodos().map((entry) => String(entry.id) === String(id)
      ? { ...entry, completed: !entry.completed, completed_at: entry.completed ? '' : now }
      : entry);
    await persistTodos(next);
    renderTodoCard();
  }

  async function deleteTodo(id) {
    const item = todos().find((entry) => String(entry.id) === String(id));
    if (!item) return;

    if (item._source === 'server') {
      const context = todoServerContext();
      if (!context.academyId || !context.sessionToken) return;
      try {
        await callTodoRpc('olli_academy_task_delete', {
          p_session_token: context.sessionToken,
          p_academy_id: context.academyId,
          p_task_id: String(item.id)
        });
        await loadServerTodos({ render:true });
      } catch (error) {
        console.warn('PC 공유 할 일 삭제 실패:', error);
      }
      return;
    }

    const next = legacyTodos().filter((entry) => String(entry.id) !== String(id));
    await persistTodos(next);
    renderTodoCard();
  }

  function open() {
    const app = core();
    app.showRecordRoomImmediately('academy');
    app.updateRecordLayout();
    renderDashboard();
    loadServerTodos({ render:true }).catch(() => {});
    if (typeof loadRecords === 'function') Promise.resolve(loadRecords('')).catch((error) => console.warn('학생관리 백그라운드 동기화 실패:', error));
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

  function bindTodoRealtime() {
    if (serverTodoRealtimeWatcher || typeof global.OlliRealtime?.watchDomain !== 'function') return;
    serverTodoRealtimeWatcher = global.OlliRealtime.watchDomain('chat', async (context) => {
      if (!context?.isCurrent?.()) return false;
      return loadServerTodos({ render: core()?.state?.section === 'academy' });
    });
  }

  function start() {
    const dashboard = document.getElementById('recordAcademyDashboard');
    if (!dashboard) return;
    bindTodoRealtime();
    if (dashboard.__olliPcStudentManagementObserver) return;
    dashboard.__olliPcStudentManagementObserver = new MutationObserver(() => {
      if (core().state.section === 'academy') setTimeout(bindRows, 0);
    });
    dashboard.__olliPcStudentManagementObserver.observe(dashboard, { childList: true, subtree: true });
    if (typeof currentRecordView !== 'undefined' && currentRecordView === 'academy') renderDashboard();
  }

  global.OlliPcStudentManagement = { renderContext, renderDashboard, renderTodoCard, renderConsultationPanel, loadServerTodos, open, filter, handleSearch, resolveStudent, refreshConsultationCompletionState, bindRows, start };
  global.pcAddAcademyTodo = addTodo;
  global.pcToggleAcademyTodo = toggleTodo;
  global.pcDeleteAcademyTodo = deleteTodo;
})(window);
