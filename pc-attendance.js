(function pcAttendanceModule(global) {
  'use strict';

  const state = {
    selectedStudentId: '',
    loadToken: 0,
    legacyOpenFeedback: null,
    actionsWrapped: false,
    editorScreen: null,
    editorAnchor: null,
    editorStudentId: '',
    editorDivision: '',
    recordCache: new Map()
  };

  function core() { return global.OlliPcCore; }
  function escape(value) {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(String(value ?? ''));
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }
  function isPcAttendance() {
    const sectionKey = core()?.SECTION?.PERSONALITY_RECORDS || 'attendance';
    return core()?.state?.section === sectionKey;
  }


  const PC_RECORD_CACHE_PREFIX = 'olli_pc_feedback_record_cache_v1';
  const PC_RECORD_CACHE_MAX_STUDENTS = 12;

  function getRecordCacheScope() {
    try {
      const academyId = typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '';
      return String(academyId || 'unscoped');
    } catch (_) {
      return 'unscoped';
    }
  }

  function getRecordCacheStorageKey(studentId) {
    return `${PC_RECORD_CACHE_PREFIX}_${getRecordCacheScope()}_${String(studentId || '')}`;
  }

  function getRecordCacheIndexKey() {
    return `${PC_RECORD_CACHE_PREFIX}_index_${getRecordCacheScope()}`;
  }

  function normalizeRecordData(data) {
    return {
      feedbacks: Array.isArray(data?.feedbacks) ? data.feedbacks : [],
      summaries: Array.isArray(data?.summaries) ? data.summaries : []
    };
  }

  function recordDataFingerprint(data) {
    const normalized = normalizeRecordData(data);
    const compact = (kind, items) => items.map((item) => [
      kind,
      String(item?.sourceTable || item?.row?.source_table || ''),
      String(item?.rowId || item?.row?.id || item?.id || ''),
      String(item?.createdAt || item?.row?.created_at || item?.row?.date || ''),
      String(item?.content || '')
    ]);
    return JSON.stringify([
      ...compact('feedback', normalized.feedbacks),
      ...compact('summary', normalized.summaries)
    ]);
  }

  function readRecordCache(student) {
    const studentId = String(student?.id || '');
    if (!studentId) return null;
    const memory = state.recordCache.get(studentId);
    if (memory?.data) return memory.data;
    try {
      const raw = localStorage.getItem(getRecordCacheStorageKey(studentId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const data = normalizeRecordData(parsed?.data);
      const entry = { data, fingerprint: parsed?.fingerprint || recordDataFingerprint(data), savedAt: parsed?.savedAt || 0 };
      state.recordCache.set(studentId, entry);
      return data;
    } catch (_) {
      return null;
    }
  }

  function rememberRecordCache(student, data) {
    const studentId = String(student?.id || '');
    if (!studentId) return;
    const normalized = normalizeRecordData(data);
    const entry = { data: normalized, fingerprint: recordDataFingerprint(normalized), savedAt: Date.now() };
    state.recordCache.set(studentId, entry);
    try {
      localStorage.setItem(getRecordCacheStorageKey(studentId), JSON.stringify(entry));
      const indexKey = getRecordCacheIndexKey();
      let ids = [];
      try { ids = JSON.parse(localStorage.getItem(indexKey) || '[]'); } catch (_) {}
      ids = [studentId, ...ids.filter((id) => String(id) !== studentId)];
      const evicted = ids.slice(PC_RECORD_CACHE_MAX_STUDENTS);
      ids = ids.slice(0, PC_RECORD_CACHE_MAX_STUDENTS);
      localStorage.setItem(indexKey, JSON.stringify(ids));
      evicted.forEach((id) => {
        state.recordCache.delete(String(id));
        localStorage.removeItem(getRecordCacheStorageKey(id));
      });
    } catch (_) {}
  }

  function dropRecordCache(studentId) {
    const id = String(studentId || '');
    if (!id) return;
    state.recordCache.delete(id);
    try {
      localStorage.removeItem(getRecordCacheStorageKey(id));
      const indexKey = getRecordCacheIndexKey();
      let ids = [];
      try { ids = JSON.parse(localStorage.getItem(indexKey) || '[]'); } catch (_) {}
      localStorage.setItem(indexKey, JSON.stringify(ids.filter((item) => String(item) !== id)));
    } catch (_) {}
  }

  function studentMatchesDay(student, day) {
    if (!day) return true;
    try {
      if (typeof parseRecordSortDays === 'function') return parseRecordSortDays(student).includes(day);
    } catch (_) {}
    const raw = String(student.lesson_day || student.lessonDay || student.days || student.day || '').replace(/요일/g, '');
    return raw.includes(day);
  }

  function normalizePcAttendanceSearchText(value) {
    const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
    const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
    const JONG = ['', 'ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
    const text = String(value || '').trim().normalize('NFC').toLowerCase();
    let out = '';
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code >= 0xAC00 && code <= 0xD7A3) {
        const index = code - 0xAC00;
        const cho = Math.floor(index / 588);
        const jung = Math.floor((index % 588) / 28);
        const jong = index % 28;
        out += (CHO[cho] || '') + (JUNG[jung] || '') + (JONG[jong] || '');
      } else if (code >= 0x1100 && code <= 0x1112) {
        out += CHO[code - 0x1100] || ch;
      } else if (code >= 0x1161 && code <= 0x1175) {
        out += JUNG[code - 0x1161] || ch;
      } else if (code >= 0x11A8 && code <= 0x11C2) {
        out += JONG[code - 0x11A7] || ch;
      } else {
        out += ch;
      }
    }
    return out.replace(/\s+/g, '');
  }

  function studentMatchesPcAttendanceSearch(student, query) {
    const q = String(query || '').trim();
    if (!q) return true;
    const name = String(student?.name || '').trim();
    if (!name) return false;
    if (name.toLowerCase().includes(q.toLowerCase())) return true;
    const normalizedName = normalizePcAttendanceSearchText(name);
    const normalizedQuery = normalizePcAttendanceSearchText(q);
    return !!normalizedQuery && normalizedName.includes(normalizedQuery);
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

  function saveSharedEditorDraft() {
    try {
      if (state.editorDivision === 'elementary' && typeof saveCurrentMemo === 'function') {
        Promise.resolve(saveCurrentMemo({ silent: true })).catch(() => {});
      } else if (state.editorDivision === 'kinder' && typeof saveKinderChatFeedbackDraft === 'function') {
        saveKinderChatFeedbackDraft();
      }
    } catch (_) {}
  }

  function unmountSharedEditor() {
    const screen = state.editorScreen;
    const anchor = state.editorAnchor;
    if (!screen) return;
    saveSharedEditorDraft();
    if (anchor?.parentNode) {
      const home = anchor.parentNode;
      home.insertBefore(screen, anchor.nextSibling);
      home.removeChild(anchor);
    }
    screen.classList.remove('pcAttendanceEmbeddedEditor');
    screen.style.display = 'none';
    state.editorScreen = null;
    state.editorAnchor = null;
    state.editorStudentId = '';
    state.editorDivision = '';
  }

  function moveScreenIntoHost(screen, host) {
    if (!screen || !host) return false;
    const anchor = document.createComment('olli-pc-shared-editor-home');
    screen.parentNode?.insertBefore(anchor, screen);
    state.editorScreen = screen;
    state.editorAnchor = anchor;
    host.appendChild(screen);
    screen.classList.add('pcAttendanceEmbeddedEditor');
    return true;
  }

  function restoreRecordRoomVisibility() {
    const recordRoom = document.getElementById('recordRoomScreen');
    if (recordRoom) recordRoom.style.display = 'flex';
    state.editorScreen?.style.setProperty('display', 'flex');
  }

  function mountSharedEditor(student) {
    const host = document.getElementById('pcAttendanceSharedEditorHost');
    if (!host || !student) return;
    const division = student.type === 'kinder' ? 'kinder' : 'elementary';
    const studentId = String(student.id || '');
    const screenId = division === 'kinder' ? 'kinderChatFeedbackScreen' : 'studentMemoScreen';
    const currentScreenMatches = state.editorScreen?.id === screenId && host.contains(state.editorScreen);

    if (currentScreenMatches && state.editorStudentId === studentId) {
      restoreRecordRoomVisibility();
      return;
    }

    unmountSharedEditor();
    const screen = document.getElementById(screenId);
    if (!moveScreenIntoHost(screen, host)) {
      host.innerHTML = '<div class="pcAttendanceEditorUnavailable">기록 화면을 불러오지 못했습니다.</div>';
      return;
    }
    state.editorStudentId = studentId;
    state.editorDivision = division;

    try {
      if (division === 'elementary' && typeof openStudentMemoPageById === 'function') {
        openStudentMemoPageById(student.id);
      } else if (division === 'kinder' && typeof openKinderChatFeedbackPage === 'function') {
        openKinderChatFeedbackPage();
        if (typeof global.selectKinderChatFeedbackStudentFromManage === 'function') {
          global.selectKinderChatFeedbackStudentFromManage(student.id, null);
        }
      }
    } catch (error) {
      console.warn('성향기록부 공유 기록 화면 연결 실패:', error);
    }
    restoreRecordRoomVisibility();
  }

  function recordWorkspaceHtml(student, recordContent) {
    return '<div class="pcAttendanceDetailBody">'
      + '<section class="pcAttendanceEditorCard" aria-label="수업 기록 작성">'
      + '<div class="pcAttendanceSharedEditorHost" id="pcAttendanceSharedEditorHost"></div>'
      + '</section>'
      + '<section class="pcAttendanceCombinedCard" aria-label="종합 성장 기록">'
      + '<div class="pcAttendanceCombinedBody" id="pcAttendanceCombinedBody">'+recordContent+'</div>'
      + '</section>'
      + '</div>';
  }

  function recordLoadingHtml() {
    return '<div class="pcAttendanceRecordLoading"><span></span><span></span><span></span></div>';
  }

  function recordQuietLoadingHtml() {
    return '<div class="attendanceFeedbackSheetEmpty">기록을 불러오고 있습니다.</div>';
  }

  function ensureRecordWorkspace(student) {
    const panel = ensureDetailPanel();
    if (!panel) return null;
    let host = document.getElementById('pcAttendanceSharedEditorHost');
    let body = document.getElementById('pcAttendanceCombinedBody');
    if (!host || !body || !panel.contains(host) || !panel.contains(body)) {
      unmountSharedEditor();
      panel.innerHTML = '<div class="pcAttendanceDetailHead"><div class="pcAttendanceDetailTitle">관찰기록</div></div>'
        + recordWorkspaceHtml(student, recordQuietLoadingHtml());
      host = document.getElementById('pcAttendanceSharedEditorHost');
      body = document.getElementById('pcAttendanceCombinedBody');
    }
    mountSharedEditor(student);
    return body;
  }

  function renderEmptyDetail() {
    const panel = ensureDetailPanel();
    if (!panel) return;
    unmountSharedEditor();
    panel.innerHTML = '<div class="pcAttendanceDetailHead"><div class="pcAttendanceDetailTitle">관찰기록</div></div>'
      + '<div class="pcAttendanceDetailEmpty"><span class="pcAttendanceDetailEmptyIcon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4.5" y="4.5" width="15" height="15" rx="3"></rect><path d="M8 9h8M8 13h5"></path></svg></span><strong>학생을 선택해 주세요.</strong><span>왼쪽 명단에서 학생 이름을 누르면<br>관찰기록이 이곳에 표시됩니다.</span></div>';
  }

  function renderLoadingDetail(student) {
    const body = ensureRecordWorkspace(student);
    if (body) body.innerHTML = recordQuietLoadingHtml();
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

  function renderCombinedRecords(student, data) {
    const feedbacks = Array.isArray(data?.feedbacks) ? data.feedbacks : [];
    const summaries = Array.isArray(data?.summaries) ? data.summaries : [];

    // 기존 복사·삭제·재생성 기능이 사용하는 상태를 그대로 갱신합니다.
    try {
      if (typeof renderAttendanceStudentFeedbackSheet === 'function') {
        renderAttendanceStudentFeedbackSheet(student, { feedbacks, summaries });
      }
    } catch (_) {}
    const body = document.getElementById('pcAttendanceCombinedBody');
    if (!body) return;
    body.innerHTML = renderRecordSection('수업 기록', feedbacks, '저장된 관찰기록이 없습니다.', student, 'feedback')
      + renderRecordSection('종합 성장 기록', summaries, '저장된 종합 성장 기록이 없습니다.', student, 'summary');
  }

  function renderDetailError(student, error) {
    const body = document.getElementById('pcAttendanceCombinedBody');
    if (!body) return;
    body.innerHTML = '<div class="pcAttendanceRecordError"><strong>기록을 불러오지 못했어요.</strong><span>'+escape(error?.message || '잠시 후 다시 선택해 주세요.')+'</span><button type="button" onclick="pcSelectAttendanceStudent(\''+escape(student?.id || '')+'\')">다시 불러오기</button></div>';
  }

  async function selectStudent(studentOrId) {
    const student = typeof studentOrId === 'object' ? studentOrId : (typeof findStudentById === 'function' ? findStudentById(studentOrId) : null);
    if (!student) return;
    const nextStudentId = String(student.id || '');
    const wasSelected = state.selectedStudentId === nextStudentId;
    state.selectedStudentId = nextStudentId;
    decorateRows();

    const body = ensureRecordWorkspace(student);
    const cached = readRecordCache(student);
    if (cached) {
      // 캐시를 즉시 표시하고 Supabase는 뒤에서 최신 상태만 확인합니다.
      if (!wasSelected || !body?.dataset?.recordStudentId || body.dataset.recordStudentId !== nextStudentId) {
        renderCombinedRecords(student, cached);
      }
      const currentBody = document.getElementById('pcAttendanceCombinedBody');
      if (currentBody) currentBody.dataset.recordStudentId = nextStudentId;
    } else if (body) {
      // 최초 1회만 조용한 로딩 상태를 사용하고 카드 전체 DOM은 다시 만들지 않습니다.
      body.dataset.recordStudentId = nextStudentId;
      body.innerHTML = recordQuietLoadingHtml();
    }

    const token = ++state.loadToken;
    try {
      const data = typeof loadAttendanceStudentFeedbackSheetItems === 'function'
        ? await loadAttendanceStudentFeedbackSheetItems(student)
        : { feedbacks: [], summaries: [] };
      if (token !== state.loadToken || !isPcAttendance()) return;

      const fresh = normalizeRecordData(data);
      const cachedFingerprint = cached ? recordDataFingerprint(cached) : '';
      const freshFingerprint = recordDataFingerprint(fresh);
      rememberRecordCache(student, fresh);

      // 서버 내용이 캐시와 같으면 DOM을 다시 그리지 않아 깜박임을 만들지 않습니다.
      if (!cached || cachedFingerprint !== freshFingerprint) {
        renderCombinedRecords(student, fresh);
        const currentBody = document.getElementById('pcAttendanceCombinedBody');
        if (currentBody) currentBody.dataset.recordStudentId = nextStudentId;
      }
    } catch (error) {
      if (token !== state.loadToken || !isPcAttendance()) return;
      if (!cached) renderDetailError(student, error);
      else console.warn('성향기록부 피드백 최신 확인 실패:', error);
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

  function ensureRosterHeader() {
    const list = document.getElementById('recordList');
    const app = core();
    if (!list || !app) return;
    const division = app.state.attendanceDivision === 'kinder' ? 'kinder' : 'elementary';
    const label = division === 'kinder' ? '유치부' : '초등부';
    const header = document.createElement('div');
    header.className = 'pcAttendanceRosterHead';
    header.innerHTML = '<div class="pcAttendanceRosterTitle">학생 명단</div><span class="pcAttendanceRosterDivision '+division+'">'+label+'</span>';
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
        if (isPcAttendance() && state.selectedStudentId) {
          dropRecordCache(state.selectedStudentId);
          selectStudent(state.selectedStudentId);
        }
        return result;
      };
    });
  }

  function open() {
    const app = core();
    const targetView = typeof currentObservationView !== 'undefined' && currentObservationView === 'kinder' ? 'kinder' : 'elementary';
    app.showRecordRoomImmediately(targetView);
    ensureDetailPanel();
    bindRosterClicks();
    installLegacyBridge();
    state.selectedStudentId = '';
    state.loadToken += 1;
    renderEmptyDetail();
    app.state.attendanceDivision = 'elementary';
    app.state.attendanceDay = '';
    app.updateRecordLayout();
    app.renderContext();
    renderList();
    if (typeof loadStudentsFromSupabase === 'function') {
      Promise.resolve(loadStudentsFromSupabase()).then((result) => {
        if (!isPcAttendance() || result?.changed !== true) return;
        renderList();
      }).catch((error) => console.warn('성향기록부 학생 백그라운드 동기화 실패:', error));
    }
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
    const previousScrollTop = list.scrollTop;

    const query = String(searchValue ?? app.state.searchValues.attendance ?? '').trim();
    const elementary = app.activeStudents('elementary').filter((student) => studentMatchesDay(student, app.state.attendanceDay) && studentMatchesPcAttendanceSearch(student, query));
    const kinder = app.activeStudents('kinder').filter((student) => studentMatchesDay(student, app.state.attendanceDay) && studentMatchesPcAttendanceSearch(student, query));
    let html = '';
    if (app.state.attendanceDivision === 'all' || app.state.attendanceDivision === 'elementary') {
      try { html += typeof renderElementaryStudentRows === 'function' ? renderElementaryStudentRows(typeof sortStudentsForRecord === 'function' ? sortStudentsForRecord(elementary) : elementary) : ''; }
      catch (_) {}
    }
    if (app.state.attendanceDivision === 'all' || app.state.attendanceDivision === 'kinder') {
      try { html += typeof renderKinderStudentRows === 'function' ? renderKinderStudentRows(typeof sortStudentsForRecord === 'function' ? sortStudentsForRecord(kinder) : kinder) : ''; }
      catch (_) {}
    }
    list.innerHTML = html || '<div class="recordEmpty">조건에 맞는 학생이 없습니다.</div>';
    ensureRosterHeader();
    decorateRows();
    list.scrollTop = previousScrollTop;
    app.renderContext();
  }

  function filterDivision(division) {
    core().state.attendanceDivision = division === 'kinder' ? 'kinder' : 'elementary';
    renderList();
  }

  function filterDay(day) {
    const app = core();
    app.state.attendanceDay = app.state.attendanceDay === day ? '' : day;
    renderList();
  }

  const api = { studentMatchesDay, renderContext, ensureDetailPanel, open, renderList, filterDivision, filterDay, selectStudent, decorateRows, unmountEditor: unmountSharedEditor };
  global.OlliPcPersonalityRecords = api;
  // 이전 배포의 외부 호출과 저장된 route key를 깨지 않기 위한 호환 별칭입니다.
  global.OlliPcAttendance = api;
  global.pcSelectAttendanceStudent = selectStudent;
})(window);
