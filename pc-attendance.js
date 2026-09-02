(function pcAttendanceModule(global) {
  'use strict';

  const state = {
    selectedStudentId: '',
    loadToken: 0,
    legacyOpenFeedback: null,
    actionsWrapped: false
  };

  function core() { return global.OlliPcCore; }
  function escape(value) {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(String(value ?? ''));
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }
  function isPcAttendance() {
    return core()?.state?.section === 'attendance' && (!global.matchMedia || global.matchMedia('(min-width: 900px)').matches);
  }

  function studentMatchesDay(student, day) {
    if (!day) return true;
    try {
      if (typeof parseRecordSortDays === 'function') return parseRecordSortDays(student).includes(day);
    } catch (_) {}
    const raw = String(student.lesson_day || student.lessonDay || student.days || student.day || '').replace(/요일/g, '');
    return raw.includes(day);
  }

  function renderContext(elementary, kinder) {
    const app = core();
    const title = document.getElementById('olliPcContextTitle');
    const body = document.getElementById('olliPcContextBody');
    if (!title || !body) return;
    const dayButtons = ['월', '화', '수', '목', '금', '토'].map((day) =>
      '<button class="olliPcQuickBtn '+(app.state.attendanceDay === day ? 'active' : '')+'" onclick="pcFilterAttendanceDay(\''+day+'\')"><span>'+day+'요일</span><span></span></button>'
    ).join('');
    title.textContent = '빠른 보기';
    body.innerHTML =
      '<button class="olliPcQuickBtn '+(app.state.attendanceDivision === 'all' ? 'active' : '')+'" onclick="pcFilterAttendanceDivision(\'all\')"><span>전체</span><span>'+(elementary.length + kinder.length)+'</span></button>'+
      '<button class="olliPcQuickBtn '+(app.state.attendanceDivision === 'elementary' ? 'active' : '')+'" onclick="pcFilterAttendanceDivision(\'elementary\')"><span>초등부</span><span>'+elementary.length+'</span></button>'+
      '<button class="olliPcQuickBtn '+(app.state.attendanceDivision === 'kinder' ? 'active' : '')+'" onclick="pcFilterAttendanceDivision(\'kinder\')"><span>유치부</span><span>'+kinder.length+'</span></button>'+
      '<div class="olliPcContextSectionLabel">요일</div>'+dayButtons;
  }

  function ensureDetailPanel() {
    let panel = document.getElementById('pcAttendanceDetailPanel');
    if (panel) return panel;
    const host = document.getElementById('recordBodyNew');
    if (!host) return null;
    panel = document.createElement('aside');
    panel.id = 'pcAttendanceDetailPanel';
    panel.className = 'pcAttendanceDetailPanel';
    panel.setAttribute('aria-label', '선택 학생 관찰기록');
    const academyPanel = document.getElementById('pcAcademyDetailPanel');
    host.insertBefore(panel, academyPanel || null);
    panel.addEventListener('click', (event) => {
      if (event.target.closest('.attendanceFeedbackSheetCardActions, .attendanceSummaryRegenerateBtn')) return;
      const card = event.target.closest('.attendanceFeedbackSheetCard');
      if (!card || !panel.contains(card)) return;
      event.preventDefault();
      event.stopPropagation();
      card.classList.toggle('open');
    }, true);
    renderEmptyDetail();
    return panel;
  }

  function renderEmptyDetail() {
    const panel = ensureDetailPanel();
    if (!panel) return;
    panel.innerHTML = '<div class="pcAttendanceDetailHead"><div><div class="pcAttendanceDetailTitle">관찰기록</div><div class="pcAttendanceDetailSub">학생의 수업 기록과 성장 기록을 확인합니다.</div></div></div>'
      + '<div class="pcAttendanceDetailEmpty"><span class="pcAttendanceDetailEmptyIcon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4.5" y="4.5" width="15" height="15" rx="3"></rect><path d="M8 9h8M8 13h5"></path></svg></span><strong>학생을 선택해 주세요.</strong><span>왼쪽 명단에서 학생 이름을 누르면<br>관찰기록이 이곳에 표시됩니다.</span></div>';
  }

  function getStudentMeta(student) {
    try {
      const bits = student?.type === 'kinder'
        ? (typeof getKinderMetaBits === 'function' ? getKinderMetaBits(student) : [])
        : (typeof getElementaryMetaBits === 'function' ? getElementaryMetaBits(student) : []);
      return Array.isArray(bits) ? bits.filter(Boolean).join(' · ') : '';
    } catch (_) { return ''; }
  }

  function renderLoadingDetail(student) {
    const panel = ensureDetailPanel();
    if (!panel) return;
    const division = student?.type === 'kinder' ? '유치부' : '초등부';
    const meta = getStudentMeta(student);
    panel.innerHTML = '<div class="pcAttendanceDetailHead"><div><div class="pcAttendanceStudentLine"><span class="pcAttendanceDivisionChip">'+division+'</span><div class="pcAttendanceDetailTitle">'+escape(student?.name || '학생')+' 관찰기록</div></div><div class="pcAttendanceDetailSub">'+escape(meta || '저장된 관찰기록을 불러오고 있습니다.')+'</div></div></div>'
      + '<div class="pcAttendanceDetailLoading"><span></span><span></span><span></span></div>';
  }

  function renderRecordSection(title, items, emptyText, student, kind) {
    let cards = '';
    try {
      cards = typeof renderAttendanceFeedbackSheetCards === 'function'
        ? renderAttendanceFeedbackSheetCards(items, emptyText, student, { kind, hidePreview: true })
        : '';
    } catch (_) {}
    return '<section class="attendanceFeedbackSheetSection pcAttendanceRecordSection"><div class="pcAttendanceRecordSectionHead"><div class="attendanceFeedbackSheetSectionTitle">'+title+'</div><span>'+items.length+'개</span></div><div class="attendanceFeedbackSheetScroll">'+(cards || '<div class="attendanceFeedbackSheetEmpty">'+emptyText+'</div>')+'</div></section>';
  }

  function renderDetail(student, data) {
    const panel = ensureDetailPanel();
    if (!panel) return;
    const feedbacks = Array.isArray(data?.feedbacks) ? data.feedbacks : [];
    const summaries = Array.isArray(data?.summaries) ? data.summaries : [];
    const division = student?.type === 'kinder' ? '유치부' : '초등부';
    const meta = getStudentMeta(student);

    // 기존 복사·삭제·재생성 기능이 사용하는 상태를 그대로 갱신합니다.
    try {
      if (typeof renderAttendanceStudentFeedbackSheet === 'function') {
        renderAttendanceStudentFeedbackSheet(student, { feedbacks, summaries });
      }
    } catch (_) {}

    panel.innerHTML = '<div class="pcAttendanceDetailHead"><div><div class="pcAttendanceStudentLine"><span class="pcAttendanceDivisionChip">'+division+'</span><div class="pcAttendanceDetailTitle">'+escape(student?.name || '학생')+' 관찰기록</div></div><div class="pcAttendanceDetailSub">'+escape(meta || '학생의 수업 기록과 성장 기록')+'</div></div></div>'
      + '<div class="pcAttendanceDetailBody">'
      + renderRecordSection('수업 기록', feedbacks, '저장된 관찰기록이 없습니다.', student, 'feedback')
      + renderRecordSection('종합 성장 기록', summaries, '저장된 종합 성장 기록이 없습니다.', student, 'summary')
      + '</div>';
  }

  function renderDetailError(student, error) {
    const panel = ensureDetailPanel();
    if (!panel) return;
    panel.innerHTML = '<div class="pcAttendanceDetailHead"><div><div class="pcAttendanceDetailTitle">'+escape(student?.name || '학생')+' 관찰기록</div><div class="pcAttendanceDetailSub">기록을 불러오지 못했습니다.</div></div></div>'
      + '<div class="pcAttendanceDetailEmpty error"><strong>관찰기록을 불러오지 못했어요.</strong><span>'+escape(error?.message || '잠시 후 다시 선택해 주세요.')+'</span><button type="button" onclick="pcSelectAttendanceStudent(\''+escape(student?.id || '')+'\')">다시 불러오기</button></div>';
  }

  async function selectStudent(studentOrId) {
    const student = typeof studentOrId === 'object' ? studentOrId : (typeof findStudentById === 'function' ? findStudentById(studentOrId) : null);
    if (!student) return;
    state.selectedStudentId = String(student.id || '');
    decorateRows();
    renderLoadingDetail(student);
    const token = ++state.loadToken;
    try {
      const data = typeof loadAttendanceStudentFeedbackSheetItems === 'function'
        ? await loadAttendanceStudentFeedbackSheetItems(student)
        : { feedbacks: [], summaries: [] };
      if (token !== state.loadToken || !isPcAttendance()) return;
      renderDetail(student, data);
    } catch (error) {
      if (token !== state.loadToken || !isPcAttendance()) return;
      renderDetailError(student, error);
    }
  }

  function extractRowStudentId(row) {
    const existing = String(row?.dataset?.pcAttendanceStudentId || '');
    if (existing) return existing;
    const onclick = String(row?.getAttribute('onclick') || '');
    const match = onclick.match(/handleStudentRowClick\(event,'([^']+)'\)/);
    return match ? match[1] : '';
  }

  function decorateRows() {
    const list = document.getElementById('recordList');
    if (!list) return;
    list.querySelectorAll('.elementaryStudentRow,.kinderStudentRow').forEach((row) => {
      const id = extractRowStudentId(row);
      if (id) row.dataset.pcAttendanceStudentId = id;
      row.classList.toggle('pcAttendanceSelected', !!id && id === state.selectedStudentId);
      row.setAttribute('aria-pressed', !!id && id === state.selectedStudentId ? 'true' : 'false');
    });
  }

  function ensureRosterHeader(count) {
    const list = document.getElementById('recordList');
    if (!list) return;
    const header = document.createElement('div');
    header.className = 'pcAttendanceRosterHead';
    header.innerHTML = '<div><div class="pcAttendanceRosterTitle">학생 명단</div><div class="pcAttendanceRosterSub">이름을 눌러 관찰기록을 확인하세요.</div></div><span>'+count+'명</span>';
    list.insertBefore(header, list.firstChild);
  }

  function bindRosterClicks() {
    const list = document.getElementById('recordList');
    if (!list || list.__olliPcAttendanceClickBound) return;
    list.__olliPcAttendanceClickBound = true;
    list.addEventListener('click', (event) => {
      if (!isPcAttendance() || event.target.closest('.recordAttendanceLeadBtn')) return;
      const row = event.target.closest('.elementaryStudentRow,.kinderStudentRow');
      if (!row || !list.contains(row)) return;
      const studentId = extractRowStudentId(row);
      if (!studentId) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      selectStudent(studentId);
    }, true);
  }

  function installLegacyBridge() {
    if (!state.legacyOpenFeedback && typeof global.openAttendanceStudentFeedbackSheet === 'function') {
      state.legacyOpenFeedback = global.openAttendanceStudentFeedbackSheet;
      global.openAttendanceStudentFeedbackSheet = function pcAwareAttendanceFeedback(studentOrId) {
        if (isPcAttendance()) return selectStudent(studentOrId);
        return state.legacyOpenFeedback.apply(this, arguments);
      };
    }
    if (state.actionsWrapped) return;
    state.actionsWrapped = true;
    ['confirmAttendanceRecordDelete', 'regenerateAttendanceSummaryFeedback'].forEach((name) => {
      const original = global[name];
      if (typeof original !== 'function') return;
      global[name] = async function pcAttendanceActionRefresh() {
        const result = await original.apply(this, arguments);
        if (isPcAttendance() && state.selectedStudentId) selectStudent(state.selectedStudentId);
        return result;
      };
    });
  }

  async function open() {
    const app = core();
    app.hideMainScreensExcept('recordRoomScreen');
    ensureDetailPanel();
    bindRosterClicks();
    installLegacyBridge();
    state.selectedStudentId = '';
    state.loadToken += 1;
    renderEmptyDetail();
    if (typeof showRecordRoom === 'function') await showRecordRoom();
    if (typeof openRecordAttendanceDashboard === 'function') await openRecordAttendanceDashboard();
    else if (typeof currentRecordView !== 'undefined') currentRecordView = typeof currentObservationView !== 'undefined' && currentObservationView === 'kinder' ? 'kinder' : 'elementary';
    app.state.attendanceDivision = 'all';
    app.state.attendanceDay = '';
    app.updateRecordLayout();
    app.renderContext();
    renderList();
  }

  function renderList(searchValue) {
    const app = core();
    if (app.state.section !== 'attendance') return;
    const list = document.getElementById('recordList');
    const dashboard = document.getElementById('recordAcademyDashboard');
    if (!list) return;
    ensureDetailPanel();
    bindRosterClicks();
    installLegacyBridge();
    if (dashboard) dashboard.classList.remove('show');
    list.style.display = '';

    const query = String(searchValue ?? app.state.searchValues.attendance ?? '').trim();
    const elementary = app.activeStudents('elementary').filter((student) => studentMatchesDay(student, app.state.attendanceDay) && (!query || String(student.name || '').includes(query)));
    const kinder = app.activeStudents('kinder').filter((student) => studentMatchesDay(student, app.state.attendanceDay) && (!query || String(student.name || '').includes(query)));
    let html = '';
    if (app.state.attendanceDivision === 'all' || app.state.attendanceDivision === 'elementary') {
      try { html += typeof renderElementaryStudentRows === 'function' ? renderElementaryStudentRows(typeof sortStudentsForRecord === 'function' ? sortStudentsForRecord(elementary) : elementary) : ''; }
      catch (_) {}
    }
    if (app.state.attendanceDivision === 'all' || app.state.attendanceDivision === 'kinder') {
      try { html += typeof renderKinderStudentRows === 'function' ? renderKinderStudentRows(typeof sortStudentsForRecord === 'function' ? sortStudentsForRecord(kinder) : kinder) : ''; }
      catch (_) {}
    }
    const visibleCount = (app.state.attendanceDivision === 'elementary' ? elementary.length : app.state.attendanceDivision === 'kinder' ? kinder.length : elementary.length + kinder.length);
    list.innerHTML = html || '<div class="recordEmpty">조건에 맞는 학생이 없습니다.</div>';
    ensureRosterHeader(visibleCount);
    decorateRows();
    app.renderContext();
  }

  function filterDivision(division) {
    core().state.attendanceDivision = division || 'all';
    renderList();
  }

  function filterDay(day) {
    const app = core();
    app.state.attendanceDay = app.state.attendanceDay === day ? '' : day;
    renderList();
  }

  global.OlliPcAttendance = { studentMatchesDay, renderContext, ensureDetailPanel, open, renderList, filterDivision, filterDay, selectStudent, decorateRows };
  global.pcSelectAttendanceStudent = selectStudent;
})(window);
