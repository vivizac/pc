/* Phone-only elementary analysis extensions: local/archive record storage and archived-record read-only guard. */

function getElementaryRecordsKey(student) { return student?.id ? ELEMENTARY_RECORDS_PREFIX + student.id : ''; }

function getElementaryMemoRecords(student) { const key = getElementaryRecordsKey(student); if (!key) return []; try { const raw = localStorage.getItem(key); const list = raw ? JSON.parse(raw) : []; return Array.isArray(list) ? list : []; } catch { return []; } }
function setElementaryMemoRecords(student, records) { const key = getElementaryRecordsKey(student); if (!key) return; localStorage.setItem(key, JSON.stringify(Array.isArray(records) ? records.slice(0, 80) : [])); }

// Full server-read history stays in memory while the student is open. Local
// storage is only a bounded offline preview, never the authoritative list.
const memoFeedbackArchiveFullHistory = new Map();
const MEMO_FEEDBACK_ARCHIVE_OFFLINE_SERVER_CACHE_LIMIT = 80;
const MEMO_FEEDBACK_ARCHIVE_MEMORY_STUDENT_LIMIT = 6;

function getMemoFeedbackArchiveKey(student) { return student?.id ? `${MEMO_FEEDBACK_ARCHIVE_PREFIX}${student.id}` : ''; }
function getMemoFeedbackArchiveItems(student) {
  const key = getMemoFeedbackArchiveKey(student);
  if (!key) return [];
  if (memoFeedbackArchiveFullHistory.has(key)) return memoFeedbackArchiveFullHistory.get(key).slice();
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(item => String(item?.content || '').trim()) : [];
  } catch (error) {
    console.warn('피드백 보관함 로컬 조회 실패 (원본은 유지):', error?.name || 'StorageError');
    return [];
  }
}
function isMemoFeedbackArchiveServerConfirmed(item) {
  const sourceTable = String(item?.sourceTable || item?.row?.source_table || '').trim();
  return (sourceTable === 'feedbacks' || sourceTable === 'fail_feedbacks') && !!item?.row?.id;
}
function setMemoFeedbackArchiveItems(student, items) {
  const key = getMemoFeedbackArchiveKey(student);
  if (!key) return;
  const list = Array.isArray(items) ? items.filter(item => String(item?.content || '').trim()) : [];
  // Update the visible full history first, without trimming server records.
  memoFeedbackArchiveFullHistory.delete(key);
  memoFeedbackArchiveFullHistory.set(key, list);
  while (memoFeedbackArchiveFullHistory.size > MEMO_FEEDBACK_ARCHIVE_MEMORY_STUDENT_LIMIT) {
    memoFeedbackArchiveFullHistory.delete(memoFeedbackArchiveFullHistory.keys().next().value);
  }

  // Preserve every unconfirmed/local-only record in the offline snapshot.
  // Only confirmed server records are limited to 80 for iOS storage safety.
  const pending = list.filter(item => !isMemoFeedbackArchiveServerConfirmed(item));
  const confirmed = list.filter(isMemoFeedbackArchiveServerConfirmed)
    .slice(0, MEMO_FEEDBACK_ARCHIVE_OFFLINE_SERVER_CACHE_LIMIT);
  try {
    localStorage.setItem(key, JSON.stringify([...pending, ...confirmed]));
  } catch (error) {
    // Do not delete the old snapshot, clear other keys or discard the memory
    // history if the iPhone localStorage quota is exceeded.
    console.warn('피드백 보관함 로컬 캐시 저장 실패 (서버 기록 유지):', error?.name || 'StorageError');
    if (typeof window.recordOlliFeedbackStorageCheck === 'function') {
      window.recordOlliFeedbackStorageCheck('elementary_feedback_archive', 'save', 'failed', {
        phase:'write', count:list.length, error,
        reason:typeof getOlliFeedbackStorageErrorReason === 'function'
          ? getOlliFeedbackStorageErrorReason(error, 'write') : 'storage_exception'
      });
    }
  }
}
function addMemoFeedbackArchiveItem(student, content, meta = {}) {
  if (!student?.id || !String(content || '').trim()) return null;
  const sourceTable = meta.sourceTable || meta.source_table || meta.tableName || meta.table_name || '';
  const row = meta.row || null;
  const item = {
    id: meta.id || row?.id || `memo_feedback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content: String(content || '').trim(),
    createdAt: meta.createdAt || meta.created_at || row?.date || row?.created_at || row?.updated_at || new Date().toISOString(),
    sourceTable,
    row,
    feedbackType: meta.feedbackType || meta.feedback_type || row?.feedback_type || '',
    feedbackMonth: meta.feedbackMonth || row?.feedback_month || '',
    feedbackMonthNumber: meta.feedbackMonthNumber || row?.feedback_month_number || null
  };
  const items = getMemoFeedbackArchiveItems(student).filter(existing => String(existing?.id || '') !== String(item.id || ''));
  setMemoFeedbackArchiveItems(student, [item, ...items]);
  return item;
}
function formatMemoFeedbackArchiveDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${d} ${hh}:${mm}`;
}

function getMemoFeedbackArchiveRowDate(row) {
  // 기록 보관함에서도 실제 수업일(date)을 우선 표시합니다.
  return row?.date || row?.created_at || row?.updated_at || '';
}
function normalizeMemoFeedbackArchiveRows(rows, sourceTable = '') {
  const list = filterOlliActiveRows(rows);
  return list
    .filter(row => String(row?.content || '').trim())
    .map(row => ({
      id: row.id || `${sourceTable || 'feedback'}_${Math.random().toString(36).slice(2, 8)}`,
      content: String(row.content || '').trim(),
      createdAt: getMemoFeedbackArchiveRowDate(row),
      sourceTable: sourceTable || row.source_table || '',
      feedbackType: row.feedback_type || '',
      feedbackMonth: row.feedback_month || '',
      feedbackMonthNumber: row.feedback_month_number || null,
      row: { ...row, source_table: sourceTable || row.source_table || '' }
    }));
}

async function loadMemoFeedbackArchiveItemsFromSupabase(student) {
  if (!student?.id) throw new Error('피드백을 조회할 학생 ID가 없습니다.');
  const requestedAcademyId = String(typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '');
  const readLimit = 5000; // Protected feedback RPC's existing server-side hard limit.
  if (!isSupabaseConfigured()) throw new Error('Supabase 연결을 확인해 주세요.');
  const existingItems = getMemoFeedbackArchiveItems(student);
  const secureReader = typeof window.loadOlliFeedbackRowsSecure === 'function'
    ? window.loadOlliFeedbackRowsSecure
    : null;

  if (!secureReader) throw new Error('피드백 보관함 보호 조회 모듈이 준비되지 않았습니다.');

  const results = await Promise.allSettled([
    secureReader('feedbacks', student, 5000),
    secureReader('fail_feedbacks', student, 5000)
  ]);

  if (results.some(result => result.status === 'rejected')) {
    throw new Error('피드백 보관함 서버 조회 실패: ' + results.filter(result => result.status === 'rejected').map(result => result.reason?.message || '연결 오류').join(', '));
  }

  // The existing RPC caps p_limit at 5,000. A full page is potentially
  // incomplete: never replace a previously visible list with an unknown tail.
  if (results.some(result => !Array.isArray(result.value)
    || result.value.length >= readLimit)) {
    throw new Error('피드백 보관함 조회 결과가 불완전해 기존 기록을 유지합니다.');
  }
  if (String(typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') !== requestedAcademyId) {
    throw new Error('학원이 변경되어 이전 학원의 피드백 목록 적용을 건너뜁니다.');
  }
  const feedbackItems = normalizeMemoFeedbackArchiveRows(results[0].value, 'feedbacks');
  const failItems = normalizeMemoFeedbackArchiveRows(results[1].value, 'fail_feedbacks');
  const otherItems = existingItems.filter(item => {
    const sourceTable = String(item?.sourceTable || item?.row?.source_table || '').trim();
    // Older local-only entries may be labelled with a source table even
    // though they do not yet have a verified server row ID.
    return sourceTable !== 'feedbacks' && sourceTable !== 'fail_feedbacks' || !item?.row?.id;
  });

  const seen = new Set();
  const items = [...feedbackItems, ...failItems, ...otherItems]
    .filter(item => {
      const sourceTable = String(item?.sourceTable || item?.row?.source_table || '').trim();
      const rowId = String(item?.id || item?.row?.id || '').trim();
      const fallback = `${String(item?.createdAt || '')}:${String(item?.content || '')}`;
      const key = `${sourceTable || 'local'}:${rowId || fallback}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const at = new Date(a.createdAt || a.row?.date || '').getTime() || 0;
      const bt = new Date(b.createdAt || b.row?.date || '').getTime() || 0;
      return bt - at;
    });
  setMemoFeedbackArchiveItems(student, items);
  return items;
}

function formatElementaryRecordLabel(record) { const y = record?.year || getCurrentYear(); const m = record?.month || (new Date().getMonth() + 1); return `${y}년 ${m}월 기록`; }
function archiveCurrentElementaryMemoRecord(student, content, analysis) { if (!student?.id || !String(content || '').trim()) return; const now = new Date(); const record = { id: `elem_record_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(), label: `${now.getFullYear()}년 ${now.getMonth() + 1}월 기록`, content, analysis: normalizeElementaryAnalysisState(analysis), createdAt: now.toISOString() }; const records = getElementaryMemoRecords(student); records.unshift(record); setElementaryMemoRecords(student, records); saveStudentNoteArchiveToSupabase(student, record).catch(err => console.warn('노트기록 Supabase 저장 실패:', err.message || err)); return record; }

/* Phone override: archived elementary records are read-only. */
function openElementaryAnalysisModal() {
  if (!currentMemoStudent || currentMemoType !== 'elementary') return;
  if (viewingArchivedElementaryRecord) {
    alert('과거 수업 기록은 읽기 전용입니다. 현재 기록을 선택한 뒤 분석을 추가해 주세요.');
    return;
  }
  renderElementaryAnalysisOptions();
  // 분석 팝업은 항상 새 입력 상태로 시작합니다.
  // 오늘의 분석 카드는 학생별로 저장해 유지하되, 팝업 선택지/기타 입력칸은 재오픈 시 이전 값이 다시 채워지지 않게 분리합니다.
  elementaryAnalysisDraft = getEmptyElementaryAnalysisState();
  fillElementaryAnalysisModal(elementaryAnalysisDraft);
  document.querySelectorAll('#elementaryAnalysisModal [data-group-panel]').forEach(el => { el.style.display = 'none'; });
  resetElementaryAnalysisModalScroll();
  const modal = document.getElementById('elementaryAnalysisModal');
  if (modal) modal.style.display = 'flex';
  requestAnimationFrame(resetElementaryAnalysisModalScroll);
}
