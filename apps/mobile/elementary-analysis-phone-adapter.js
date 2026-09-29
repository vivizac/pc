/* Phone-only elementary analysis extensions: local/archive record storage and archived-record read-only guard. */

function getElementaryRecordsKey(student) { return student?.id ? ELEMENTARY_RECORDS_PREFIX + student.id : ''; }

function getElementaryMemoRecords(student) { const key = getElementaryRecordsKey(student); if (!key) return []; try { const raw = localStorage.getItem(key); const list = raw ? JSON.parse(raw) : []; return Array.isArray(list) ? list : []; } catch { return []; } }
function setElementaryMemoRecords(student, records) { const key = getElementaryRecordsKey(student); if (!key) return; localStorage.setItem(key, JSON.stringify(Array.isArray(records) ? records.slice(0, 80) : [])); }

function getMemoFeedbackArchiveKey(student) { return student?.id ? `${MEMO_FEEDBACK_ARCHIVE_PREFIX}${student.id}` : ''; }
function getMemoFeedbackArchiveItems(student) {
  const key = getMemoFeedbackArchiveKey(student);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(item => String(item?.content || '').trim()) : [];
  } catch {
    return [];
  }
}
function setMemoFeedbackArchiveItems(student, items) {
  const key = getMemoFeedbackArchiveKey(student);
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(Array.isArray(items) ? items.slice(0, 80) : []));
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
  if (!student?.id || !isSupabaseConfigured()) return [];
  const existingItems = getMemoFeedbackArchiveItems(student);
  const secureReader = typeof window.loadOlliFeedbackRowsSecure === 'function'
    ? window.loadOlliFeedbackRowsSecure
    : null;

  if (!secureReader) {
    console.warn('피드백 보관함 보호 조회 모듈이 준비되지 않아 기존 로컬 보관함을 유지합니다.');
    return existingItems;
  }

  const results = await Promise.allSettled([
    secureReader('feedbacks', student, 120),
    secureReader('fail_feedbacks', student, 120)
  ]);

  if (results.every(result => result.status === 'rejected')) {
    console.warn('피드백 보관함 서버 조회 실패: 기존 로컬 보관함을 유지합니다.');
    return existingItems;
  }

  const existingBySource = sourceTable => existingItems.filter(item =>
    String(item?.sourceTable || item?.row?.source_table || '').trim() === sourceTable
  );
  const feedbackItems = results[0].status === 'fulfilled'
    ? normalizeMemoFeedbackArchiveRows(results[0].value, 'feedbacks')
    : existingBySource('feedbacks');
  const failItems = results[1].status === 'fulfilled'
    ? normalizeMemoFeedbackArchiveRows(results[1].value, 'fail_feedbacks')
    : existingBySource('fail_feedbacks');
  const otherItems = existingItems.filter(item => {
    const sourceTable = String(item?.sourceTable || item?.row?.source_table || '').trim();
    return sourceTable !== 'feedbacks' && sourceTable !== 'fail_feedbacks';
  });

  if (results[0].status === 'rejected') console.warn('피드백 보관함 불러오기 실패: 기존 feedbacks 로컬 항목을 유지합니다.', results[0].reason?.message || results[0].reason);
  if (results[1].status === 'rejected') console.warn('실패-성장 피드백 보관함 불러오기 실패: 기존 fail_feedbacks 로컬 항목을 유지합니다.', results[1].reason?.message || results[1].reason);

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
