(function pcStudentManagementModule(global) {
  'use strict';

  const consultationStatusCache = new Map();
  const consultationStatusInFlight = new Map();
  let serverTodoItems = [];
  let serverTodoAcademyId = '';
  let serverTodoLoadPromise = null;
  let serverTodoRealtimeWatcher = null;
  let materialOrderItems = [];
  let materialOrderAcademyId = '';
  let materialOrderSessionToken = '';
  let materialOrderLoadPromise = null;
  let materialOrderError = false;

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

  function materialsForCurrentAcademy() {
    const context = todoServerContext();
    return context.academyId === materialOrderAcademyId
      && context.sessionToken === materialOrderSessionToken ? materialOrderItems : [];
  }

  async function loadMaterialOrders(options = {}) {
    const opts = { render: true, ...options };
    const context = todoServerContext();
    if (!context.academyId || !context.sessionToken) {
      materialOrderItems = [];
      materialOrderAcademyId = '';
      materialOrderSessionToken = '';
      materialOrderError = false;
      if (opts.render && core()?.state?.section === 'academy') renderMaterialOrders();
      return false;
    }
    if (materialOrderLoadPromise && materialOrderAcademyId === context.academyId
        && materialOrderSessionToken === context.sessionToken) return materialOrderLoadPromise;

    const academyId = context.academyId;
    const sessionToken = context.sessionToken;
    materialOrderAcademyId = academyId;
    materialOrderSessionToken = sessionToken;
    materialOrderLoadPromise = (async () => {
      const result = await callTodoRpc('olli_team_material_requests_list', {
        p_session_token: sessionToken,
        p_academy_id: academyId,
        p_limit: 300
      });
      if (result?.ok !== true) throw new Error(result?.message || '재료주문 목록을 불러오지 못했습니다.');
      const current = todoServerContext();
      if (current.academyId !== academyId || current.sessionToken !== sessionToken) return false;
      materialOrderItems = Array.isArray(result.items) ? result.items : [];
      materialOrderError = false;
      if (opts.render && core()?.state?.section === 'academy') renderMaterialOrders();
      return true;
    })().catch((error) => {
      const current = todoServerContext();
      if (current.academyId === academyId && current.sessionToken === sessionToken) {
        materialOrderError = true;
        if (opts.render && core()?.state?.section === 'academy') renderMaterialOrders();
      }
      console.warn('PC 학생관리 재료주문 조회 실패:', error?.message || error);
      return false;
    }).finally(() => { materialOrderLoadPromise = null; });
    return materialOrderLoadPromise;
  }

  function renderMaterialOrders() {
    const host = document.getElementById('pcAcademyMaterialsSection');
    if (!host) return;
    const ranking = { requested: 0, on_hold: 1, ordered: 2, arrived: 3 };
    const items = materialsForCurrentAcademy().slice().sort((a, b) => {
      const rankA = ranking[a?.status] ?? 4;
      const rankB = ranking[b?.status] ?? 4;
      return rankA - rankB || String(b?.created_at || '').localeCompare(String(a?.created_at || ''));
    });
    const statusLabels = { requested: '요청', on_hold: '보류', ordered: '주문완료', arrived: '도착' };
    const count = items.filter((item) => item.status === 'requested' || item.status === 'on_hold').length;
    const rows = items.map((item) => {
      const status = String(item?.status || 'requested');
      const date = String(item?.needed_on || '').trim();
      const neededText = date ? '필요일 ' + escape(date) : '필요일 미설정';
      return '<button type="button" class="pcAcademyMaterialRow" onclick="pcOpenAcademyMaterials()" title="업무의 재료주문 화면에서 확인">'
        + '<span class="pcAcademyMaterialMain"><strong>'+escape(item?.item_name || '재료')+'</strong>'
        + '<small>'+escape(item?.quantity_text || '수량 미지정')+' · '+neededText+'</small></span>'
        + '<span class="pcAcademyMaterialStatus '+escape(status)+'">'+escape(statusLabels[status] || status)+'</span>'
        + '</button>';
    }).join('');
    const empty = materialOrderError
      ? '<div class="pcAcademyMaterialEmpty">재료주문을 불러오지 못했습니다. 재료주문 화면에서 확인해 주세요.</div>'
      : '<div class="pcAcademyMaterialEmpty">현재 진행 중인 재료주문이 없습니다.</div>';
    host.innerHTML = '<div class="pcAcademySectionHeader"><div><div class="pcAcademySectionTitle">재료주문</div>'
      + '<div class="pcAcademySectionSub">기존 주문 목록과 실시간으로 연결됩니다.</div></div>'
      + '<span class="pcAcademySectionCount">'+count+'건 대기</span></div>'
      + '<button type="button" class="pcAcademyMaterialsOpen" onclick="pcOpenAcademyMaterials()">재료주문 화면 열기 <span aria-hidden="true">›</span></button>'
      + '<div class="pcAcademyMaterialsList">'+(rows || empty)+'</div>';
  }

  async function openMaterials() {
    if (typeof global.pcOpenSection !== 'function') return;
    await Promise.resolve(global.pcOpenSection('talk'));
    const tab = document.querySelector('#olliPcTeamTalkScreen [data-team-talk-workspace-tab="materials"]');
    if (tab) tab.click();
  }

  function dueLabelsForStudent(student) {
    try { return typeof getDueConsultationRuleLabelsForStudent === 'function' ? getDueConsultationRuleLabelsForStudent(student) : []; }
    catch (_) { return []; }
  }

  function consultationStudentRef(student) {
    return student?.id ? 'id:'+student.id : 'name:'+String(student?.name || '').trim();
  }

  function consultationStatusKey(student, labels) {
    const months=typeof getConsultationSummaryMonthsFromLabels==='function'
      ?getConsultationSummaryMonthsFromLabels(labels):0;
    const task=global.OlliConsultationServer?.getPrimaryTask?.(student,months);
    const academyId=typeof global.getOlliCurrentAcademyId==='function'
      ?global.getOlliCurrentAcademyId():'';
    return global.OlliConsultationServer?.getCacheKey?.(academyId,task)
      || 'unbound|'+String(academyId)+'|'+consultationStudentRef(student);
  }

  function consultationStatusChipHtml(student, labels) {
    const key=consultationStatusKey(student,labels);
    const cached=consultationStatusCache.get(key)
      || global.OlliConsultationServer?.readCachedStatus?.(key);
    // PC도 로컬 캐시를 먼저 그리고, 서버 응답이 오면 조용히 갱신합니다.
    const status = cached?.status === 'ready' ? 'ready' : (cached?.status === 'error' ? 'error' : 'insufficient');
    const label = status === 'ready' ? '준비완료' : (status === 'error' ? '확인오류' : '자료부족');
    return '<span class="recordAcademyConsultStatusChip '+status+'" data-pc-consult-material-status="'+status+'">'+label+'</span>';
  }

  function updateConsultationStatusChip(student, labels, status, reason = '') {
    const ref = consultationStudentRef(student);
    const normalizedStatus = status === 'ready' ? 'ready' : (status === 'insufficient' ? 'insufficient' : 'error');
    const label = normalizedStatus === 'ready' ? '준비완료' : (normalizedStatus === 'insufficient' ? '자료부족' : '확인오류');
    const key=consultationStatusKey(student,labels);
    consultationStatusCache.set(key,{status:normalizedStatus,reason:String(reason||''),checkedAt:Date.now()});
    if(normalizedStatus!=='error')
      global.OlliConsultationServer?.writeCachedStatus?.(key,{status:normalizedStatus});
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
      const legacyButton = row.querySelector('.recordAcademyConsultLegacyReviewBtn');
      if(legacyButton) legacyButton.hidden = normalizedStatus === 'ready';
    });
  }

  async function resolveConsultationStatus(student, labels) {
    const key = consultationStatusKey(student, labels);
    if (consultationStatusInFlight.has(key)) return consultationStatusInFlight.get(key);
    const promise = (async () => {
      try {
        const core=global.OlliConsultationServer;
        const months=typeof getConsultationSummaryMonthsFromLabels==='function'
          ?getConsultationSummaryMonthsFromLabels(labels):0;
        const task=core?.getPrimaryTask?.(student,months);
        if(!task?.key||!core?.checkSummaryStatus)
          throw new Error('상담 공통 서버 조회를 준비하지 못했습니다.');
        const material=await core.checkSummaryStatus(student,task);
        const status=material.status;
        updateConsultationStatusChip(student,labels,status,material?.reason||'');
      } catch (error) {
        console.warn('PC 상담 자료 상태 확인 실패:', student?.name || '', error?.message || error);
        const key=consultationStatusKey(student,labels);
        const cached=consultationStatusCache.get(key)||global.OlliConsultationServer?.readCachedStatus?.(key);
        if(cached?.status!=='ready')
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
      + '</div><div class="pcAcademyWorkOrderGrid"><section class="recordAcademyConsultSection pcAcademyTodoSection" id="pcAcademyTodoSection"></section>'
      + '<section class="recordAcademyConsultSection pcAcademyMaterialsSection" id="pcAcademyMaterialsSection"></section></div>';
    renderTodoCard();
    renderMaterialOrders();
    loadServerTodos({ render:true }).catch(() => {});
    loadMaterialOrders({ render:true }).catch(() => {});
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
    host.innerHTML = '<div class="pcAcademySectionHeader"><div><div class="pcAcademySectionTitle">학원 업무</div><div class="pcAcademySectionSub">업무와 메모를 한곳에서 관리해요.</div></div><span class="pcAcademySectionCount">'+remaining+'개 남음</span></div>'
      + '<form class="pcAcademyTodoForm" onsubmit="pcAddAcademyTodo(event)"><input id="pcAcademyTodoInput" type="text" maxlength="80" autocomplete="off" placeholder="할 일을 입력해 주세요"><button type="submit">추가</button></form>'
      + '<div class="pcAcademyTodoList">'+rows+'</div>';
  }

  // 상담 대상 여부와 상담 피드백 범위는 규칙을 따르되, 학생 카드에는 실제 재원 개월 수를 표시합니다.
  function consultationTenureChips(student, dueLabels) {
    try {
      const enrolled = typeof getStudentEnrollmentDateForStats === 'function'
        ? getStudentEnrollmentDateForStats(student)
        : null;
      const elapsedMonths = typeof monthsBetweenByCalendar === 'function'
        ? monthsBetweenByCalendar(enrolled, new Date())
        : NaN;
      if (Number.isInteger(elapsedMonths) && elapsedMonths >= 0) {
        return [elapsedMonths + '개월'];
      }
    } catch (_) {}
    return dueLabels.length
      ? dueLabels.map((label) => typeof getOlliConsultationRuleShortLabel === 'function' ? getOlliConsultationRuleShortLabel(label) : label)
      : ['상담 예정'];
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
        const chips = consultationTenureChips(student, dueLabels);
        const ref = consultationStudentRef(student);
        return '<div class="recordAcademyConsultListItem" data-pc-student-ref="'+escape(ref)+'">'
          + '<div class="recordAcademyConsultStudentMain"><div class="recordAcademyListName">'+escape(student.name)+global.renderOlliStudentWeekendBadges(student)+'</div><div class="recordAcademyChipRow">'+chips.map((label) => '<span class="recordAcademyInfoChip recordAcademyRuleChip">'+escape(label)+'</span>').join('')+'</div></div>'
          + '<div class="recordAcademyConsultActions">'
          + consultationStatusChipHtml(student, dueLabels)
          + (['owner','super_admin'].includes(typeof global.getOlliCurrentRole==='function'?global.getOlliCurrentRole():'')
            ? '<button type="button" class="recordAcademyConsultLegacyReviewBtn"'
              +' onclick="OlliPcStudentManagement.openLegacyReview(\''+jsSingleQuote(student.id)+'\')"'
              +(consultationStatusCache.get(consultationStatusKey(student,dueLabels))?.status==='ready'?' hidden':'')
              +'>기존 기록 연결</button>' : '')
          + '</div></div>';
      }).join('') : '<div class="recordAcademyConsultGroupEmpty">예정 학생 없음</div>';
      return '<div class="recordAcademyConsultGroup" data-pc-division="'+group.type+'"><div class="recordAcademyConsultGroupTitle"><span>'+group.label+'</span><span>'+group.students.length+'명</span></div><div class="recordAcademyList">'+rows+'</div></div>';
    }).join('');
  }

  async function openLegacyReview(studentId){
    if(!['owner','super_admin'].includes(typeof global.getOlliCurrentRole==='function'?global.getOlliCurrentRole():''))return;
    const student=consultationStudents().find(s=>String(s.id||'')===String(studentId||''));
    const task=global.OlliConsultationServer?.getPrimaryTask?.(student);
    if(!student||!task||!global.OlliConsultationManualUI?.openLegacyReview){
      alert('학생 또는 기존 피드백 연결 화면을 확인해 주세요.');return;
    }
    await global.OlliConsultationManualUI.openLegacyReview({
      studentId:student.id,studentName:student.name,taskKey:task.key,
      onLinked:async()=>{renderConsultationPanel();await resolveConsultationStatus(student,dueLabelsForStudent(student));}
    });
  }
  function renderConsultationPanel(due = consultationStudents()) {
    const panel = document.getElementById('pcAcademyDetailPanel');
    if (!panel) return;
    panel.innerHTML = '<div class="pcAcademySectionHeader pcAcademyConsultHeader"><div><div class="pcAcademyDetailName">상담예정 학생</div><div class="pcAcademyDetailSub">이번 달 상담이 필요한 학생</div></div><span class="pcAcademySectionCount">'+due.length+'명</span></div>'
      + (global.OlliConsultationMessages?.isOwner() ? '<button type="button" class="recordAcademyConsultCompleteBtn" onclick="OlliConsultationMessages.open()">상담 예약 안내</button>' : '')
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
    bindTodoRealtime();
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
      const visible = core()?.state?.section === 'academy';
      const [tasksOk, ordersOk] = await Promise.all([
        loadServerTodos({ render: visible }),
        loadMaterialOrders({ render: visible })
      ]);
      return tasksOk || ordersOk;
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

  global.OlliPcStudentManagement = { renderContext, renderDashboard, renderTodoCard, renderMaterialOrders, renderConsultationPanel, openLegacyReview, loadServerTodos, loadMaterialOrders, open, filter, handleSearch, resolveStudent, bindRows, start };
  global.pcOpenAcademyMaterials = openMaterials;
  global.pcAddAcademyTodo = addTodo;
  global.pcToggleAcademyTodo = toggleTodo;
  global.pcDeleteAcademyTodo = deleteTodo;
})(window);
