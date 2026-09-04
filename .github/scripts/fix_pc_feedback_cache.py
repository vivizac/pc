from pathlib import Path
import re

path = Path('pc-attendance.js')
s = path.read_text(encoding='utf-8')

old_state = """    editorStudentId: '',\n    editorDivision: ''\n  };"""
new_state = """    editorStudentId: '',\n    editorDivision: '',\n    recordCache: new Map()\n  };"""
if old_state not in s:
    raise SystemExit('state anchor not found')
s = s.replace(old_state, new_state, 1)

anchor = """  function isPcAttendance() {\n    const sectionKey = core()?.SECTION?.PERSONALITY_RECORDS || 'attendance';\n    return core()?.state?.section === sectionKey;\n  }\n"""
helpers = r'''

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
'''
if anchor not in s:
    raise SystemExit('isPcAttendance anchor not found')
s = s.replace(anchor, anchor + helpers, 1)

old_loading = """  function recordLoadingHtml() {\n    return '<div class=\"pcAttendanceRecordLoading\"><span></span><span></span><span></span></div>';\n  }\n"""
new_loading = """  function recordLoadingHtml() {\n    return '<div class=\"pcAttendanceRecordLoading\"><span></span><span></span><span></span></div>';\n  }\n\n  function recordQuietLoadingHtml() {\n    return '<div class=\"attendanceFeedbackSheetEmpty\">기록을 불러오고 있습니다.</div>';\n  }\n\n  function ensureRecordWorkspace(student) {\n    const panel = ensureDetailPanel();\n    if (!panel) return null;\n    let host = document.getElementById('pcAttendanceSharedEditorHost');\n    let body = document.getElementById('pcAttendanceCombinedBody');\n    if (!host || !body || !panel.contains(host) || !panel.contains(body)) {\n      unmountSharedEditor();\n      panel.innerHTML = '<div class=\"pcAttendanceDetailHead\"><div class=\"pcAttendanceDetailTitle\">관찰기록</div></div>'\n        + recordWorkspaceHtml(student, recordQuietLoadingHtml());\n      host = document.getElementById('pcAttendanceSharedEditorHost');\n      body = document.getElementById('pcAttendanceCombinedBody');\n    }\n    mountSharedEditor(student);\n    return body;\n  }\n"""
if old_loading not in s:
    raise SystemExit('recordLoadingHtml anchor not found')
s = s.replace(old_loading, new_loading, 1)

render_pattern = re.compile(r"  function renderLoadingDetail\(student\) \{.*?\n  \}\n\n  function renderRecordSection", re.S)
render_repl = """  function renderLoadingDetail(student) {\n    const body = ensureRecordWorkspace(student);\n    if (body) body.innerHTML = recordQuietLoadingHtml();\n  }\n\n  function renderRecordSection"""
s, count = render_pattern.subn(render_repl, s, count=1)
if count != 1:
    raise SystemExit(f'renderLoadingDetail replacement count={count}')

select_pattern = re.compile(r"  async function selectStudent\(studentOrId\) \{.*?\n  \}\n\n  function extractRowStudentId", re.S)
select_repl = r'''  async function selectStudent(studentOrId) {
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

  function extractRowStudentId'''
s, count = select_pattern.subn(select_repl, s, count=1)
if count != 1:
    raise SystemExit(f'selectStudent replacement count={count}')

old_refresh = """        const result = await original.apply(this, arguments);\n        if (isPcAttendance() && state.selectedStudentId) selectStudent(state.selectedStudentId);\n        return result;"""
new_refresh = """        const result = await original.apply(this, arguments);\n        if (isPcAttendance() && state.selectedStudentId) {\n          dropRecordCache(state.selectedStudentId);\n          selectStudent(state.selectedStudentId);\n        }\n        return result;"""
if old_refresh not in s:
    raise SystemExit('action refresh anchor not found')
s = s.replace(old_refresh, new_refresh, 1)

path.write_text(s, encoding='utf-8')
print('pc-attendance cache patch applied')
