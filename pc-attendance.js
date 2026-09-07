(function pcAttendanceModule(global) {
  'use strict';

  const PC_SORT_MODES = Object.freeze({ DAY: 'day', GROUP: 'group', GRADE: 'grade' });
  const PC_SORT_TIME_ORDER = ['1시', '2시', '3시', '4시', '5시', '6시', '7시'];
  const PC_GROUP_LABELS = { '1': 'A그룹', '2': 'B그룹', '3': 'C그룹', '4': 'D그룹', '5': 'E그룹', '6': 'F그룹' };
  const PC_DAY_NAMES = { 0: '일', 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토' };

  const state = {
    selectedStudentId: '',
    loadToken: 0,
    legacyOpenFeedback: null,
    actionsWrapped: false,
    editorScreen: null,
    editorAnchor: null,
    editorStudentId: '',
    editorDivision: '',
    recordCache: new Map(),
    sortMode: PC_SORT_MODES.DAY
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

  function todayPcAttendanceDay() {
    return PC_DAY_NAMES[new Date().getDay()] || '월';
  }

  function normalizeSortMode(mode) {
    return Object.values(PC_SORT_MODES).includes(mode) ? mode : PC_SORT_MODES.DAY;
  }

  function removeLegacyPcSortControl() {
    document.getElementById('olliPcSortBtn')?.remove();
    try { delete global.pcOpenSidebarSort; } catch (_) { global.pcOpenSidebarSort = undefined; }
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

  function getStudentGroupKey(student) {
    const raw = String(student?.group || student?.group_no || '').trim();
    const match = raw.match(/[1-6]/);
    return match ? match[0] : '';
  }

  function getStudentGradeNumber(student) {
    const raw = String(student?.grade || student?.school_grade || student?.studentGrade || student?.class_grade || '').trim();
    const match = raw.match(/\d+/);
    const grade = match ? Number(match[0]) : NaN;
    return Number.isFinite(grade) && grade > 0 ? grade : 999;
  }

  function getLessonTimeText(student) {
    return String(student?.lesson_time || student?.class_time || student?.lessonTime || student?.classTime || '').trim();
  }

  function extractTimeLabels(value) {
    const text = String(value || '');
    const found = [];
    text.replace(/(?:오후\s*)?([1-7])\s*(?:시|:00)?/g, (_, hour) => {
      const label = `${Number(hour)}시`;
      if (!found.includes(label)) found.push(label);
      return '';
    });
    return found.sort((a, b) => PC_SORT_TIME_ORDER.indexOf(a) - PC_SORT_TIME_ORDER.indexOf(b));
  }

  function getStudentTimesForDay(student, day) {
    const raw = getLessonTimeText(student);
    if (!raw) return [];
    const segments = raw.split(/[·,\/|\n]+/).map((value) => value.trim()).filter(Boolean);
    const daySpecific = [];
    let hasDaySpecificData = false;
    segments.forEach((segment) => {
      const dayMatch = segment.match(/([월화수목금토일])(?:요일)?/);
      if (!dayMatch) return;
      hasDaySpecificData = true;
      if (dayMatch[1] !== day) return;
      extractTimeLabels(segment).forEach((time) => {
        if (!daySpecific.includes(time)) daySpecific.push(time);
      });
    });
    if (hasDaySpecificData) return daySpecific;
    const days = (() => {
      try { return typeof parseRecordSortDays === 'function' ? parseRecordSortDays(student) : []; }
      catch (_) { return []; }
    })();
    if (days.length === 1 && days[0] === day) return extractTimeLabels(raw);
    return extractTimeLabels(raw);
  }

  function getStudentPrimaryTimeForDay(student, day) {
    return getStudentTimesForDay(student, day)[0] || '';
  }

  function compareStudentsByName(a, b) {
    return String(a?.name || '').localeCompare(String(b?.name || ''), 'ko');
  }

  function renderPcSortDivider(label) {
    return '<div class="pcAttendanceSortDivider"><span>'+escape(label)+'</span></div>';
  }

  function renderPlainRows(students, division) {
    try {
      const renderer = division === 'kinder' ? global.renderKinderStudentRows || renderKinderStudentRows : global.renderElementaryStudentRows || renderElementaryStudentRows;
      const html = typeof renderer === 'function' ? renderer(students) : '';
      return String(html || '').replace(/\s+groupBreak(?=[\s"])/g, '');
    } catch (_) {
      return '';
    }
  }

  function renderGroupedRows(students, division, keyGetter, labelGetter, keySorter) {
    const groups = new Map();
    students.forEach((student) => {
      const key = keyGetter(student);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(student);
    });
    const keys = Array.from(groups.keys()).sort(keySorter);
    return keys.map((key) => {
      const members = groups.get(key).slice().sort(compareStudentsByName);
      return renderPcSortDivider(labelGetter(key)) + renderPlainRows(members, division);
    }).join('');
  }

  function renderStudentsForSortMode(students, division) {
    const mode = normalizeSortMode(state.sortMode);
    if (!students.length) return '';

    if (mode === PC_SORT_MODES.DAY) {
      const today = todayPcAttendanceDay();
      const todayStudents = students.filter((student) => studentMatchesDay(student, today));
      return renderGroupedRows(
        todayStudents,
        division,
        (student) => getStudentPrimaryTimeForDay(student, today) || '미지정',
        (key) => key === '미지정' ? '시간 미지정' : key,
        (a, b) => {
          if (a === '미지정') return 1;
          if (b === '미지정') return -1;
          return PC_SORT_TIME_ORDER.indexOf(a) - PC_SORT_TIME_ORDER.indexOf(b);
        }
      );
    }

    if (mode === PC_SORT_MODES.GROUP) {
      return renderGroupedRows(
        students,
        division,
        (student) => getStudentGroupKey(student) || '미지정',
        (key) => key === '미지정' ? '그룹 미지정' : (PC_GROUP_LABELS[key] || `${key}그룹`),
        (a, b) => {
          if (a === '미지정') return 1;
          if (b === '미지정') return -1;
          return Number(a) - Number(b);
        }
      );
    }

    return renderGroupedRows(
      students,
      division,
      (student) => {
        const grade = getStudentGradeNumber(student);
        return grade === 999 ? '미지정' : String(grade);
      },
      (key) => key === '미지정' ? '학년 미지정' : `${key}학년`,
      (a, b) => {
        if (a === '미지정') return 1;
        if (b === '미지정') return -1;
        return Number(a) - Number(b);
      }
    );
  }

  function renderContext(elementary, kinder) {
    const app = core();
    const title = document.getElementById('olliPcContextTitle');
    const body = document.getElementById('olliPcContextBody');
    if (!title || !body) return;
    const sortButtons = [
      [PC_SORT_MODES.DAY, '요일별'],
      [PC_SORT_MODES.GROUP, '그룹별'],
      [PC_SORT_MODES.GRADE, '학년별']
    ].map(([mode, label]) =>
      '<button class="olliPcQuickBtn '+(state.sortMode === mode ? 'active' : '')+'" onclick="pcSetAttendanceSortMode(\''+mode+'\')"><span>'+label+'</span><span></span></button>'
    ).join('');
    title.textContent = '빠른 보기';
    body.innerHTML =
      '<button class="olliPcQuickBtn '+(app.state.attendanceDivision === 'elementary' ? 'active' : '')+'" onclick="pcFilterAttendanceDivision(\'elementary\')"><span>초등부</span><span>'+elementary.length+'</span></button>'+
      '<button class="olliPcQuickBtn '+(app.state.attendanceDivision === 'kinder' ? 'active' : '')+'" onclick="pcFilterAttendanceDivision(\'kinder\')"><span>유치부</span><span>'+kinder.length+'</span></button>'+
      '<div class="olliPcContextSectionLabel">정렬</div>'+sortButtons;
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
      if (!wasSelected || !body?.dataset?.recordStudentId || body.dataset.recordStudentId !== nextStudentId) {
        renderCombinedRecords(student, cached);
      }
      const currentBody = document.getElementById('pcAttendanceCombinedBody');
      if (currentBody) currentBody.dataset.recordStudentId = nextStudentId;
    } else if (body) {
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
    removeLegacyPcSortControl();
    const app = core();
    const targetView = typeof currentObservationView !== 'undefined' && currentObservationView === 'kinder' ? 'kinder' : 'elementary';
    app.showRecordRoomImmediately(targetView);
    ensureDetailPanel();
    bindRosterClicks();
    installLegacyBridge();
    state.selectedStudentId = '';
    state.loadToken += 1;
    state.sortMode = PC_SORT_MODES.DAY;
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
    removeLegacyPcSortControl();
    if (dashboard) dashboard.classList.remove('show');
    list.style.display = '';
    const previousScrollTop = list.scrollTop;

    const query = String(searchValue ?? app.state.searchValues.attendance ?? '').trim();
    const elementary = app.activeStudents('elementary').filter((student) => studentMatchesPcAttendanceSearch(student, query));
    const kinder = app.activeStudents('kinder').filter((student) => studentMatchesPcAttendanceSearch(student, query));
    let html = '';
    if (app.state.attendanceDivision === 'all' || app.state.attendanceDivision === 'elementary') {
      html += renderStudentsForSortMode(elementary, 'elementary');
    }
    if (app.state.attendanceDivision === 'all' || app.state.attendanceDivision === 'kinder') {
      html += renderStudentsForSortMode(kinder, 'kinder');
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
    if (!day) return;
    state.sortMode = PC_SORT_MODES.DAY;
    renderList();
  }

  function setSortMode(mode) {
    state.sortMode = normalizeSortMode(mode);
    renderList();
  }

  const api = { studentMatchesDay, renderContext, ensureDetailPanel, open, renderList, filterDivision, filterDay, setSortMode, selectStudent, decorateRows, unmountEditor: unmountSharedEditor };
  global.OlliPcPersonalityRecords = api;
  global.OlliPcAttendance = api;
  global.pcSelectAttendanceStudent = selectStudent;
  global.pcSetAttendanceSortMode = setSortMode;

  removeLegacyPcSortControl();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', removeLegacyPcSortControl, { once: true });
})(window);
