function getAttendanceFeedbackRowDate(row) {
  // 기존 피드백 가져오기는 과거 수업일을 date에 저장하므로 date를 최우선으로 사용합니다.
  return row?.date || row?.created_at || row?.updated_at || '';
}

function formatAttendanceFeedbackSheetDate(value) {
  if (!value) return '날짜 정보 없음';
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    const hh = String(parsed.getHours()).padStart(2, '0');
    const mm = String(parsed.getMinutes()).padStart(2, '0');
    return `${y}.${m}.${d} ${hh}:${mm}`;
  }
  return String(value || '').trim() || '날짜 정보 없음';
}

function getAttendanceFeedbackTitleDate(item) {
  const row = item?.row || item || {};
  const monthSource = row.feedback_month_number || item?.feedbackMonthNumber || row.feedback_month || item?.feedbackMonth || row.month || '';
  const monthMatch = String(monthSource || '').match(/(\d{1,2})/);
  const date = new Date(item?.createdAt || getAttendanceFeedbackRowDate(row));
  const month = monthMatch ? Number(monthMatch[1]) : (!Number.isNaN(date.getTime()) ? date.getMonth() + 1 : '');
  const day = !Number.isNaN(date.getTime()) ? date.getDate() : '';
  return { month, day };
}

function getAttendanceFeedbackItemTitle(item, student, kind = 'feedback') {
  const isKinder = student?.type === 'kinder';
  const { month, day } = getAttendanceFeedbackTitleDate(item);
  if (kind === 'summary') {
    const row = item?.row || item || {};
    const monthsSource = row.summary_months || row.summaryMonths || row.months || item?.summary_months || item?.months || month || '';
    const monthsMatch = String(monthsSource || '').match(/(\d{1,2})/);
    const months = monthsMatch ? Number(monthsMatch[1]) : '';
    return months ? `${months}개월 성장 기록` : '종합 성장 기록';
  }
  if (isKinder) {
    if (month && day) return `${month}월 ${day}일 관찰 기록`;
    if (month) return `${month}월 관찰 기록`;
    return '관찰 기록';
  }
  if (month) return `${month}월 관찰 기록`;
  return '관찰 기록';
}

function normalizeAttendanceFeedbackRows(rows, sourceTable = '') {
  return filterOlliActiveRows(rows)
    .filter(row => String(row?.content || '').trim())
    .map(row => ({
      id: `${sourceTable || row.source_table || 'feedback'}_${row.id || Math.random().toString(36).slice(2, 8)}`,
      rowId: row.id || '',
      sourceTable: sourceTable || row.source_table || '',
      content: String(row.content || '').trim(),
      createdAt: getAttendanceFeedbackRowDate(row),
      row: { ...row, source_table: sourceTable || row.source_table || '' }
    }));
}

function buildAttendanceStudentFeedbackPath(table, student, limit = 80) {
  const studentId = String(student?.id || '').trim();
  const studentName = String(student?.name || '').trim();
  let path = `${table}?select=*&order=created_at.desc&limit=${limit}`;
  if (studentId) {
    path += `&student_id=eq.${encodeURIComponent(studentId)}`;
  } else if (studentName) {
    // 학생코드가 없는 과거 기록만 이름으로 보조 조회합니다.
    path += `&student_name=eq.${encodeURIComponent(studentName)}`;
  }
  return appendOlliAcademyFilter(path);
}

async function loadAttendanceStudentFeedbackSheetItems(student) {
  if (!student || !isSupabaseConfigured()) return { feedbacks: [], summaries: [] };
  const requests = [
    { table: 'feedbacks', type: 'feedbacks', promise: supabase('GET', buildAttendanceStudentFeedbackPath('feedbacks', student, 80)) },
    { table: 'fail_feedbacks', type: 'feedbacks', promise: supabase('GET', buildAttendanceStudentFeedbackPath('fail_feedbacks', student, 80)) },
    { table: 'summary_feedbacks', type: 'summaries', promise: supabase('GET', buildAttendanceStudentFeedbackPath('summary_feedbacks', student, 50)) }
  ];
  const settled = await Promise.allSettled(requests.map(item => item.promise));
  const feedbacks = [];
  const summaries = [];
  settled.forEach((result, index) => {
    const request = requests[index];
    if (result.status !== 'fulfilled') {
      console.warn(`${request.table} 피드백 불러오기 실패:`, result.reason?.message || result.reason);
      return;
    }
    const rows = normalizeAttendanceFeedbackRows(result.value, request.table);
    if (request.type === 'summaries') summaries.push(...rows);
    else feedbacks.push(...rows);
  });
  const sortByDateDesc = (a, b) => (new Date(b.createdAt || '').getTime() || 0) - (new Date(a.createdAt || '').getTime() || 0);
  return {
    feedbacks: feedbacks.sort(sortByDateDesc),
    summaries: summaries.sort(sortByDateDesc)
  };
}

const attendanceStudentFeedbackSheetState = {
  student: null,
  data: { feedbacks: [], summaries: [] }
};

function getSummaryRegenerateIconSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20 11a8 8 0 1 0-2.35 5.65" />
    <path d="M20 5v6h-6" />
  </svg>`;
}

function getSummaryMonthsFromAttendanceItem(item) {
  const row = item?.row || item || {};
  const candidates = [row.summary_months, row.summaryMonths, row.months, item?.summary_months, item?.months];
  for (const value of candidates) {
    const match = String(value || '').match(/(\d{1,2})/);
    if (match) return Number(match[1]) || 6;
  }
  const title = getAttendanceFeedbackItemTitle(item, attendanceStudentFeedbackSheetState.student || {}, 'summary');
  const titleMatch = String(title || '').match(/(\d{1,2})\s*개월/);
  return titleMatch ? Number(titleMatch[1]) || 6 : 6;
}

async function softDeleteAttendanceSummaryFeedback(item) {
  requireOlliAcademyId('종합 피드백 재생성');
  const row = item?.row || item || {};
  const recordId = String(row.id || item?.rowId || '').trim();
  if (!recordId) throw new Error('삭제할 종합 피드백의 서버 ID가 없습니다.');
  if (!window.OlliRecordTrash) throw new Error('휴지통 기능이 준비되지 않았습니다.');
  return await window.OlliRecordTrash.move('summary_feedbacks', recordId, 'summary_feedback_regenerated');
}

async function regenerateAttendanceSummaryFeedback(itemId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (loading) return;
  const state = attendanceStudentFeedbackSheetState;
  const student = state.student;
  const item = (state.data?.summaries || []).find(summary => String(summary.id || '') === String(itemId || '')) || null;
  if (!student || !item) {
    alert('재생성할 종합 성장 기록을 찾을 수 없습니다. 성향 기록지를 다시 열어 주세요.');
    return;
  }
  const btn = event?.currentTarget || null;
  const summaryMonths = getSummaryMonthsFromAttendanceItem(item);
  const labels = [`${summaryMonths}개월`];
  loading = true;
  if (btn) btn.disabled = true;
  try { showFeedbackLoading('summary'); } catch (_) {}
  try {
    const material = await prepareConsultationFeedbackMaterial(student, summaryMonths, labels);
    if (material.mode === 'elementary_one_month_records') throw new Error('초등부 1개월 상담은 종합 성장 기록 재생성 대상이 아닙니다.');
    if (material.status !== 'ready' || !material.rows.length) throw new Error(material.reason || `최근 ${summaryMonths}개월 안에 사용할 수 있는 저장 피드백이 없습니다.`);
    const reply = await createSummaryFeedbackFromRows(student, summaryMonths, material.rows, labels);
    await softDeleteAttendanceSummaryFeedback(item);
    await saveConsultationSummaryFeedbackAuto(student, summaryMonths, reply);
    const refreshed = await loadAttendanceStudentFeedbackSheetItems(student);
    renderAttendanceStudentFeedbackSheet(student, refreshed);
    try { showPushToast('종합 성장 기록을 다시 생성했어요.'); } catch (_) {}
  } catch (err) {
    console.error('종합 성장 기록 재생성 오류:', err);
    alert(`종합 성장 기록 재생성 중 오류가 발생했어요.\n\n${err.message || '알 수 없는 오류입니다.'}`);
  } finally {
    try { hideFeedbackLoading(); } catch (_) {}
    if (btn) btn.disabled = false;
    loading = false;
  }
}

window.regenerateAttendanceSummaryFeedback = regenerateAttendanceSummaryFeedback;

function getAttendanceFeedbackSheetItemById(itemId, kind = 'feedback') {
  const list = kind === 'summary'
    ? (attendanceStudentFeedbackSheetState.data?.summaries || [])
    : (attendanceStudentFeedbackSheetState.data?.feedbacks || []);
  return list.find(item => String(item?.id || '') === String(itemId || '')) || null;
}

async function copyAttendanceFeedbackSheetItem(itemId, kind = 'feedback', event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const item = getAttendanceFeedbackSheetItemById(itemId, kind);
  const content = String(item?.content || '').trim();
  if (!content) return;

  const btn = event?.currentTarget || null;
  const originalText = btn ? (btn.textContent || '복사') : '복사';

  try {
    let copied = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(content);
        copied = true;
      } catch (_) {}
    }
    if (!copied) {
      const temp = document.createElement('textarea');
      temp.value = content;
      temp.setAttribute('readonly', '');
      temp.style.position = 'fixed';
      temp.style.opacity = '0';
      document.body.appendChild(temp);
      temp.select();
      copied = document.execCommand('copy');
      temp.remove();
    }

    if (!copied) throw new Error('clipboard_failed');

    if (btn) showOlliCopySuccess(btn, { restoreHtml: originalText, restoreDisabled: false });
    if (typeof showPushToast === 'function') showPushToast('기록을 복사했어요.');
  } catch (err) {
    if (btn) {
      btn.textContent = '복사 실패';
      setTimeout(() => { btn.textContent = originalText; }, 1200);
    }
    if (typeof showPushToast === 'function') showPushToast('복사에 실패했어요.');
  }
}

async function performAttendanceFeedbackSheetItemDelete(itemId, kind = 'feedback') {
  const state = attendanceStudentFeedbackSheetState;
  const student = state.student;
  const item = getAttendanceFeedbackSheetItemById(itemId, kind);
  if (!student || !item) {
    if (typeof showPushToast === 'function') showPushToast('삭제할 기록을 찾지 못했어요.');
    return;
  }

  const row = item?.row || {};
  const rowId = String(row.id || item.rowId || '').trim();
  const tableName = kind === 'summary'
    ? 'summary_feedbacks'
    : String(item.sourceTable || row.source_table || 'feedbacks').trim();

  if (!rowId) {
    alert('삭제할 기록의 서버 ID를 찾지 못했습니다.');
    return;
  }

  try {
    if (!window.OlliRecordTrash) throw new Error('휴지통 기능이 준비되지 않았습니다.');
    await window.OlliRecordTrash.move(tableName, rowId, 'manual_delete_from_student_record');

    const refreshed = await loadAttendanceStudentFeedbackSheetItems(student);
    renderAttendanceStudentFeedbackSheet(student, refreshed);
    if (typeof showPushToast === 'function') showPushToast('기록을 휴지통으로 이동했어요.');
  } catch (err) {
    console.error('학생 기록 삭제 오류:', err);
    alert(`기록 삭제 중 오류가 발생했어요.\n\n${err.message || '알 수 없는 오류입니다.'}`);
  }
}

let attendanceRecordDeletePending = null;

function ensureAttendanceRecordDeleteOverlay() {
  let overlay = document.getElementById('attendanceRecordDeleteOverlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'attendanceRecordDeleteOverlay';
  overlay.className = 'attendanceRecordDeleteOverlay';
  overlay.innerHTML = `
    <div class="attendanceRecordDeleteDialog" role="dialog" aria-modal="true" aria-labelledby="attendanceRecordDeleteTitle" onclick="event.stopPropagation()">
      <div class="attendanceRecordDeleteTitle" id="attendanceRecordDeleteTitle">기록을 삭제할까요?</div>
      <div class="attendanceRecordDeleteDesc" id="attendanceRecordDeleteDesc">삭제한 기록은 휴지통에서 복구할 수 있습니다.</div>
      <div class="attendanceRecordDeleteActions">
        <button type="button" class="attendanceRecordDeleteBtn cancel" onclick="closeAttendanceRecordDeleteOverlay()">취소</button>
        <button type="button" class="attendanceRecordDeleteBtn confirm" id="attendanceRecordDeleteConfirmBtn" onclick="confirmAttendanceRecordDelete()">삭제</button>
      </div>
    </div>`;
  overlay.addEventListener('click', function(event) {
    if (event.target === overlay) closeAttendanceRecordDeleteOverlay();
  });
  document.body.appendChild(overlay);
  return overlay;
}

function openAttendanceRecordDeleteOverlay(itemId, kind = 'feedback', event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const item = getAttendanceFeedbackSheetItemById(itemId, kind);
  const student = attendanceStudentFeedbackSheetState.student;
  if (!item || !student) {
    if (typeof showPushToast === 'function') showPushToast('삭제할 기록을 찾지 못했어요.');
    return;
  }

  attendanceRecordDeletePending = { itemId: String(itemId || ''), kind };
  const overlay = ensureAttendanceRecordDeleteOverlay();
  const title = getAttendanceFeedbackItemTitle(item, student, kind);
  const titleEl = document.getElementById('attendanceRecordDeleteTitle');
  const descEl = document.getElementById('attendanceRecordDeleteDesc');
  if (titleEl) titleEl.textContent = `${title}을 삭제할까요?`;
  if (descEl) descEl.textContent = '삭제한 기록은 휴지통에서 복구할 수 있습니다.';
  overlay.classList.add('show');
}

function closeAttendanceRecordDeleteOverlay() {
  const overlay = document.getElementById('attendanceRecordDeleteOverlay');
  if (overlay) overlay.classList.remove('show');
  attendanceRecordDeletePending = null;
}

async function confirmAttendanceRecordDelete() {
  const pending = attendanceRecordDeletePending;
  if (!pending) return;

  const btn = document.getElementById('attendanceRecordDeleteConfirmBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '삭제 중...';
  }

  try {
    await performAttendanceFeedbackSheetItemDelete(pending.itemId, pending.kind);
    const overlay = document.getElementById('attendanceRecordDeleteOverlay');
    if (overlay) overlay.classList.remove('show');
    attendanceRecordDeletePending = null;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '삭제';
    }
  }
}

window.copyAttendanceFeedbackSheetItem = copyAttendanceFeedbackSheetItem;
window.openAttendanceRecordDeleteOverlay = openAttendanceRecordDeleteOverlay;
window.closeAttendanceRecordDeleteOverlay = closeAttendanceRecordDeleteOverlay;
window.confirmAttendanceRecordDelete = confirmAttendanceRecordDelete;

function renderAttendanceFeedbackSheetCards(items, emptyText, student, options = {}) {
  if (!items.length) return `<div class="attendanceFeedbackSheetEmpty">${escapeHtml(emptyText)}</div>`;
  const kind = options.kind === 'summary' ? 'summary' : 'feedback';
  const hidePreview = !!options.hidePreview;
  return items.map(item => {
    const id = escapeHtml(String(item.id || ''));
    const title = getAttendanceFeedbackItemTitle(item, student, kind);
    const dateText = formatAttendanceFeedbackSheetDate(item.createdAt || item.row?.date || '');
    const content = item.content || '';
    const preview = content.replace(/\s+/g, ' ').trim();
    const summaryRegenerateButton = kind === 'summary'
      ? `<button type="button" class="attendanceSummaryRegenerateBtn" onclick="regenerateAttendanceSummaryFeedback('${escapeJsSingleQuote(String(item.id || ''))}', event)" aria-label="종합 성장 기록 재생성">${getSummaryRegenerateIconSvg()}</button>`
      : '';
    return `<article class="attendanceFeedbackSheetCard${hidePreview ? ' noPreview' : ''}" data-attendance-feedback-id="${id}" onclick="toggleAttendanceFeedbackSheetCard('${escapeJsSingleQuote(String(item.id || ''))}')">
      ${summaryRegenerateButton}
      <div class="attendanceFeedbackSheetCardTitle">${escapeHtml(title)}</div>
      <div class="attendanceFeedbackSheetCardDate">${escapeHtml(dateText)}</div>
      ${hidePreview ? '' : `<div class="attendanceFeedbackSheetPreview">${escapeHtml(preview)}</div>`}
      <div class="attendanceFeedbackSheetFullText">${escapeHtml(content)}</div>
      <div class="attendanceFeedbackSheetCardActions" onclick="event.stopPropagation()">
        <button type="button" class="attendanceFeedbackSheetActionBtn" onclick="copyAttendanceFeedbackSheetItem('${escapeJsSingleQuote(String(item.id || ''))}', '${kind}', event)">복사</button>
        <button type="button" class="attendanceFeedbackSheetActionBtn delete" onclick="openAttendanceRecordDeleteOverlay('${escapeJsSingleQuote(String(item.id || ''))}', '${kind}', event)">삭제</button>
      </div>
    </article>`;
  }).join('');
}

function renderAttendanceStudentFeedbackSheet(student, data, statusText = '') {
  const titleEl = document.getElementById('attendanceFeedbackSheetTitle');
  const subtitleEl = document.getElementById('attendanceFeedbackSheetSubtitle');
  const body = document.getElementById('attendanceFeedbackSheetBody');
  if (titleEl) titleEl.textContent = `${student?.name || '학생'}의 성향 기록지`;
  if (subtitleEl) subtitleEl.textContent = '';
  if (!body) return;
  attendanceStudentFeedbackSheetState.student = student || null;
  attendanceStudentFeedbackSheetState.data = {
    feedbacks: Array.isArray(data?.feedbacks) ? data.feedbacks : [],
    summaries: Array.isArray(data?.summaries) ? data.summaries : []
  };
  const feedbacks = attendanceStudentFeedbackSheetState.data.feedbacks;
  const summaries = attendanceStudentFeedbackSheetState.data.summaries;
  body.innerHTML = `<section class="attendanceFeedbackSheetSection">
    <div class="attendanceFeedbackSheetSectionTitle">수업 기록</div>
    <div class="attendanceFeedbackSheetScroll">${renderAttendanceFeedbackSheetCards(feedbacks, '저장된 피드백이 없습니다.', student, { kind: 'feedback', hidePreview: true })}</div>
  </section>
  <section class="attendanceFeedbackSheetSection">
    <div class="attendanceFeedbackSheetSectionTitle">종합 성장 기록</div>
    <div class="attendanceFeedbackSheetScroll">${renderAttendanceFeedbackSheetCards(summaries, '저장된 종합 피드백이 없습니다.', student, { kind: 'summary', hidePreview: true })}</div>
  </section>`;
}

async function openAttendanceStudentFeedbackSheet(studentOrId) {
  const student = typeof studentOrId === 'object' ? studentOrId : findStudentById(studentOrId);
  if (!student) return;
  const sheet = document.getElementById('attendanceStudentFeedbackSheet');
  const body = document.getElementById('attendanceFeedbackSheetBody');
  const titleEl = document.getElementById('attendanceFeedbackSheetTitle');
  const subtitleEl = document.getElementById('attendanceFeedbackSheetSubtitle');
  if (!sheet || !body) return;
  if (titleEl) titleEl.textContent = `${student.name || '학생'}의 성향 기록지`;
  if (subtitleEl) subtitleEl.textContent = '';
  body.innerHTML = '<div class="attendanceFeedbackSheetEmpty">피드백을 불러오고 있어요.</div>';
  if (sheet.parentElement !== document.body) document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('show'));
  try {
    const data = await loadAttendanceStudentFeedbackSheetItems(student);
    if (!sheet.classList.contains('show')) return;
    renderAttendanceStudentFeedbackSheet(student, data);
  } catch (err) {
    console.error('출석부 학생 피드백 불러오기 오류:', err);
    if (subtitleEl) subtitleEl.textContent = '';
    body.innerHTML = `<div class="attendanceFeedbackSheetEmpty">피드백을 불러오지 못했어요.<br>${escapeHtml(err.message || '알 수 없는 오류입니다.')}</div>`;
  }
}

function closeAttendanceStudentFeedbackSheet() {
  const sheet = document.getElementById('attendanceStudentFeedbackSheet');
  if (sheet) sheet.classList.remove('show');
  attendanceStudentFeedbackSheetState.student = null;
  attendanceStudentFeedbackSheetState.data = { feedbacks: [], summaries: [] };
}

function toggleAttendanceFeedbackSheetCard(id) {
  const safeId = String(id || '');
  const card = document.querySelector(`#attendanceStudentFeedbackSheet .attendanceFeedbackSheetCard[data-attendance-feedback-id="${CSS.escape(safeId)}"]`);
  if (!card) return;
  card.classList.toggle('open');
}






