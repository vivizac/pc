function getConsultationSummaryMonthsFromLabels(labels) {
  const values = (Array.isArray(labels) ? labels : [])
    .map(label => {
      const match = String(label || '').match(/(\d+)/);
      return match ? Number(match[1]) : 0;
    })
    .filter(value => Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : 1;
}

function getConsultationSummaryRecordDate(row) {
  // 실제 수업일(date)이 있으면 업로드/생성일(created_at)보다 우선합니다.
  return row?.date || row?.created_at || row?.updated_at || '';
}

function parseConsultationSummaryRecordDate(row) {
  const raw = getConsultationSummaryRecordDate(row);
  if (!raw) return null;
  const text = String(raw).trim();
  const direct = new Date(text);
  if (!isNaN(direct.getTime())) return direct;

  const nums = text.match(/\d+/g)?.map(Number) || [];
  if (nums.length >= 3) {
    const d = new Date(nums[0], nums[1] - 1, nums[2]);
    return isNaN(d.getTime()) ? null : d;
  }
  if (nums.length >= 2 && row?.year) {
    const d = new Date(Number(row.year), nums[0] - 1, nums[1]);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}


function getConsultationRuleOptionsFromLabels(labels) {
  const labelSet = new Set((Array.isArray(labels) ? labels : []).map(item => String(item || '').trim()).filter(Boolean));
  const activeKeys = new Set(typeof getOlliConsultationRules === 'function' ? getOlliConsultationRules() : []);
  return OLLI_CONSULTATION_RULE_OPTIONS.filter(option => {
    if (labelSet.has(option.label)) return true;
    if (labelSet.has(getOlliConsultationRuleShortLabel(option.label))) return true;
    if (activeKeys.has(option.key) && labelSet.has(option.label)) return true;
    return false;
  });
}

function getConsultationMaterialContext(student, months, labels = [], referenceDate = new Date()) {
  const enrolled = getStudentEnrollmentDateForStats(student);
  const now = referenceDate instanceof Date && !isNaN(referenceDate.getTime()) ? referenceDate : new Date();
  const safeMonths = Number(months) || getConsultationSummaryMonthsFromLabels(labels) || 1;
  if (!enrolled) {
    return { enrolled: null, start: null, end: null, baseEnd: null, completedMonths: safeMonths, summaryMonths: safeMonths, labels: Array.isArray(labels) ? labels : [] };
  }
  const dueOptions = getConsultationRuleOptionsFromLabels(labels);
  const repeatOption = dueOptions.find(option => option.type === 'repeat');
  const onceOption = dueOptions.find(option => option.type === 'once');
  let completedMonths = safeMonths;
  if (repeatOption) {
    const elapsed = monthsBetweenByCalendar(enrolled, now);
    completedMonths = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : repeatOption.interval;
  } else if (onceOption) {
    completedMonths = onceOption.month;
  }
  completedMonths = Math.max(1, Number(completedMonths) || safeMonths || 1);
  let blockStartMonths = 0;
  if (repeatOption) {
    blockStartMonths = Math.floor((completedMonths - 1) / 12) * 12;
  }
  const start = addMonthsSafe(enrolled, blockStartMonths);
  start.setHours(0, 0, 0, 0);
  const baseEndExclusive = addMonthsSafe(enrolled, completedMonths);
  const baseEnd = new Date(baseEndExclusive.getTime());
  baseEnd.setDate(baseEnd.getDate() - 1);
  baseEnd.setHours(23, 59, 59, 999);
  const graceEnd = new Date(now.getTime());
  graceEnd.setHours(23, 59, 59, 999);
  if (graceEnd < baseEnd) graceEnd.setTime(baseEnd.getTime());
  return {
    enrolled,
    start,
    end: graceEnd,
    baseEnd,
    completedMonths,
    summaryMonths: safeMonths,
    blockStartMonths,
    labels: Array.isArray(labels) ? labels : [],
    dueOptions
  };
}

function isDateWithinRange(date, start, end) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return false;
  if (start instanceof Date && !isNaN(start.getTime()) && date < start) return false;
  if (end instanceof Date && !isNaN(end.getTime()) && date > end) return false;
  return true;
}

function getMonthStart(year, monthNumber) {
  return new Date(Number(year), Number(monthNumber) - 1, 1, 0, 0, 0, 0);
}

function getMonthEnd(year, monthNumber) {
  return new Date(Number(year), Number(monthNumber), 0, 23, 59, 59, 999);
}

function getNextMonthEnd(year, monthNumber) {
  return new Date(Number(year), Number(monthNumber) + 1, 0, 23, 59, 59, 999);
}

function buildElementaryFeedbackSlotWindows(student, context) {
  const months = getElementaryGroupFeedbackMonths(student?.group, student);
  if (!Array.isArray(months) || !months.length || !context?.start || !context?.baseEnd) return [];
  const monthSet = new Set(months.map(Number));
  const startCursor = new Date(context.start.getFullYear(), context.start.getMonth(), 1);
  const endCursor = new Date(context.baseEnd.getFullYear(), context.baseEnd.getMonth(), 1);
  const slots = [];
  for (let cursor = new Date(startCursor.getTime()); cursor <= endCursor; cursor.setMonth(cursor.getMonth() + 1)) {
    const monthNumber = cursor.getMonth() + 1;
    if (!monthSet.has(monthNumber)) continue;
    const slotStart = getMonthStart(cursor.getFullYear(), monthNumber);
    const slotEnd = getNextMonthEnd(cursor.getFullYear(), monthNumber);
    slots.push({
      year: cursor.getFullYear(),
      month: monthNumber,
      start: slotStart,
      end: slotEnd,
      label: `${cursor.getFullYear()}년 ${monthNumber}월`
    });
  }
  return slots;
}

function pickElementaryFeedbackRowsBySlots(student, rows, context) {
  const slots = buildElementaryFeedbackSlotWindows(student, context);
  const generalRows = (Array.isArray(rows) ? rows : [])
    .filter(row => row?.source_table === 'feedbacks')
    .filter(row => row._summaryDate instanceof Date && !isNaN(row._summaryDate.getTime()))
    .sort((a, b) => (a._summaryDate?.getTime() || 0) - (b._summaryDate?.getTime() || 0));
  const matched = [];
  const used = new Set();
  const slotStates = slots.map(slot => {
    const candidates = generalRows.filter(row => {
      const key = row.id ? `${row.source_table}:${row.id}` : `${row.source_table}:${getConsultationSummaryRecordDate(row)}:${String(row.content || '').slice(0, 60)}`;
      return !used.has(key) && isDateWithinRange(row._summaryDate, slot.start, slot.end);
    }).sort((a, b) => (b._summaryDate?.getTime() || 0) - (a._summaryDate?.getTime() || 0));
    const selected = candidates[0] || null;
    if (selected) {
      const key = selected.id ? `${selected.source_table}:${selected.id}` : `${selected.source_table}:${getConsultationSummaryRecordDate(selected)}:${String(selected.content || '').slice(0, 60)}`;
      used.add(key);
      matched.push(selected);
    }
    return { ...slot, fulfilled: !!selected, row: selected };
  });
  return { slots, slotStates, rows: matched };
}

function getConsultationFeedbackMaterialMode(student, months, labels = []) {
  const safeMonths = Number(months) || getConsultationSummaryMonthsFromLabels(labels) || 1;
  const type = String(student?.type || '').trim();
  if (safeMonths === 1 && type === 'elementary') return 'elementary_one_month_records';
  if (safeMonths === 1 && type === 'kinder') return 'kinder_one_month_summary';
  if (type === 'elementary') return 'elementary_summary_slots';
  return 'standard_summary';
}

function formatConsultationRecordRowsForPreview(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '상담에 사용할 수업 기록이 없습니다.';
  return list.map((row, index) => {
    const date = row._summaryDate
      ? `${row._summaryDate.getFullYear()}.${String(row._summaryDate.getMonth() + 1).padStart(2, '0')}.${String(row._summaryDate.getDate()).padStart(2, '0')}`
      : String(row.date || row.created_at || '날짜 미확인');
    return `${index + 1}. [${date}]\n${String(row.content || '').trim()}`;
  }).join('\n\n');
}

async function prepareConsultationFeedbackMaterial(student, months, labels = []) {
  const safeMonths = Number(months) || getConsultationSummaryMonthsFromLabels(labels) || 1;
  const mode = getConsultationFeedbackMaterialMode(student, safeMonths, labels);
  const context = getConsultationMaterialContext(student, safeMonths, labels);
  const rows = await loadConsultationSummaryFeedbackRows(student, safeMonths, {
    labels,
    context,
    mode,
    sourceTables: mode === 'kinder_one_month_summary' || mode === 'elementary_one_month_records' || mode === 'elementary_summary_slots'
      ? ['feedbacks']
      : ['feedbacks', 'fail_feedbacks']
  });

  if (mode === 'elementary_one_month_records') {
    const records = rows.filter(row => row.source_table === 'feedbacks');
    return {
      mode,
      status: records.length ? 'ready' : 'insufficient',
      rows: records,
      content: formatConsultationRecordRowsForPreview(records),
      context
    };
  }

  if (mode === 'kinder_one_month_summary') {
    const records = rows.filter(row => row.source_table === 'feedbacks');
    if (records.length < 4) {
      return { mode, status: 'insufficient', rows: records, context, reason: '유치부 1개월 상담은 일반 피드백이 최소 4개 필요합니다.' };
    }
    return { mode, status: 'ready', rows: records, context };
  }

  if (mode === 'elementary_summary_slots') {
    const picked = pickElementaryFeedbackRowsBySlots(student, rows, context);
    const expectedCount = picked.slots.length;
    const requiredCount = Math.max(2, expectedCount);
    if (!expectedCount) {
      return { mode, status: 'insufficient', rows: [], context, slots: picked.slotStates, reason: '그룹별 피드백 발송월 설정이 없습니다.' };
    }
    if (picked.rows.length < requiredCount || picked.slotStates.some(slot => !slot.fulfilled)) {
      return { mode, status: 'insufficient', rows: picked.rows, context, slots: picked.slotStates, reason: `필요 피드백 ${requiredCount}개 중 ${picked.rows.length}개만 확인되었습니다.` };
    }
    return { mode, status: 'ready', rows: picked.rows, context, slots: picked.slotStates };
  }

  return {
    mode,
    status: rows.length ? 'ready' : 'insufficient',
    rows,
    context
  };
}

function normalizeConsultationSummaryFeedbackRows(rows, sourceTable, months, options = {}) {
  const periodStart = options?.periodStart || options?.context?.start || null;
  const periodEnd = options?.periodEnd || options?.context?.end || null;
  const cutoff = getCutoffDate(Number(months) || 1);
  cutoff.setHours(0, 0, 0, 0);
  return filterOlliActiveRows(rows)
    .map(row => ({ ...row, source_table: sourceTable, _summaryDate: parseConsultationSummaryRecordDate(row) }))
    .filter(row => String(row?.content || '').trim())
    .filter(row => {
      if (!row._summaryDate) return false;
      if (periodStart || periodEnd) return isDateWithinRange(row._summaryDate, periodStart, periodEnd);
      return row._summaryDate >= cutoff;
    })
    .sort((a, b) => (a._summaryDate?.getTime() || 0) - (b._summaryDate?.getTime() || 0));
}

function dedupeConsultationSummaryFeedbackRows(rows) {
  const seen = new Set();
  const result = [];
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const key = row?.id
      ? `${row.source_table || ''}:${row.id}`
      : `${row.source_table || ''}:${getConsultationSummaryRecordDate(row)}:${String(row.content || '').slice(0, 60)}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(row);
  });
  return result;
}

async function loadConsultationSummaryFeedbackRows(student, months, options = {}) {
  const academyId = requireOlliAcademyId('상담용 종합 피드백 생성');
  const safeMonths = Number(months) || 1;
  const encodedAcademyId = encodeURIComponent(academyId);
  const encodedStudentId = student?.id ? encodeURIComponent(student.id) : '';
  const encodedName = encodeURIComponent(String(student?.name || '').trim());
  const requestedTables = Array.isArray(options.sourceTables) && options.sourceTables.length
    ? options.sourceTables
    : ['feedbacks', 'fail_feedbacks'];
  const requests = [];

  if (encodedStudentId) {
    requestedTables.forEach(table => {
      requests.push({ table, path: `${table}?select=*&academy_id=eq.${encodedAcademyId}&student_id=eq.${encodedStudentId}&order=id.desc&limit=300` });
    });
  } else if (encodedName) {
    // 학생코드가 없는 과거 기록만 이름으로 보조 조회합니다.
    // 학생코드가 있는 학생은 동명이인 혼선을 막기 위해 student_id로만 조회합니다.
    requestedTables.forEach(table => {
      requests.push({ table, path: `${table}?select=*&academy_id=eq.${encodedAcademyId}&student_name=eq.${encodedName}&order=id.desc&limit=300` });
    });
  }

  const settled = await Promise.all(requests.map(async request => {
    try {
      const rows = await supabase('GET', request.path);
      return normalizeConsultationSummaryFeedbackRows(rows, request.table, safeMonths, options);
    } catch (err) {
      console.warn('상담용 피드백 기록 조회 실패:', request.table, err.message || err);
      return [];
    }
  }));

  return dedupeConsultationSummaryFeedbackRows(settled.flat())
    .sort((a, b) => (a._summaryDate?.getTime() || 0) - (b._summaryDate?.getTime() || 0));
}

function getConsultationFeedbackPromptType(student, months) {
  const safeMonths = Number(months) || 1;
  const type = String(student?.type || '').trim();
  if (type === 'kinder' && safeMonths === 1) return KINDER_ONE_MONTH_PROMPT_TYPE;
  return 'summary';
}

function buildConsultationSummaryFeedbackUserText(student, months, rows, labels = []) {
  const studentTypeLabel = student?.type === 'kinder' ? '유치부' : '초등부';
  const enrolledAt = getEnrolledAtFromStudent(student) || '등록일 미확인';
  const promptType = getConsultationFeedbackPromptType(student, months);
  const recordLines = (Array.isArray(rows) ? rows : []).map((row, index) => {
    const date = row._summaryDate
      ? `${row._summaryDate.getFullYear()}.${String(row._summaryDate.getMonth()+1).padStart(2,'0')}.${String(row._summaryDate.getDate()).padStart(2,'0')}`
      : String(row.date || row.created_at || '날짜 미확인');
    const typeLabel = row.source_table === 'fail_feedbacks' ? '실패·성장 피드백' : '수업 피드백';
    return `${index + 1}. [${date} / ${typeLabel}]\n${String(row.content || '').trim()}`;
  }).join('\n\n');

  if (promptType === KINDER_ONE_MONTH_PROMPT_TYPE) {
    return `[피드백 코드명]\n- ${KINDER_ONE_MONTH_PROMPT_TYPE}\n\n[학생 정보]\n- 이름: ${student?.name || ''}\n- 구분: ${studentTypeLabel}\n- 등록일: ${enrolledAt}\n- 상담 기준: 유치부 1개월 상담\n\n[작성 기준]\n- 아래 기록은 첫 한 달 동안의 일반 수업 피드백입니다.\n- 장기 성장 분석처럼 쓰지 말고, 초기 적응과 성향 관찰, 앞으로의 지도 방향 중심으로 작성해 주세요.\n- 자료 안에 없는 내용을 과장하거나 추측하지 말고, 관찰 가능한 흐름 안에서 정리해 주세요.\n\n[최근 1개월 저장 피드백]\n${recordLines}`;
  }

  return `[학생 정보]\n- 이름: ${student?.name || ''}\n- 구분: ${studentTypeLabel}\n- 등록일: ${enrolledAt}\n- 상담 기준: ${(Array.isArray(labels) && labels.length ? labels.map(getOlliConsultationRuleShortLabel).join(', ') : `${months}개월`)}\n\n[최근 ${months}개월 저장 피드백]\n${recordLines}`;
}

function buildConsultationFeedbackMessages(student, months, userText) {
  return [{ role: 'user', content: userText }];
}

async function fetchConsultationFeedbackByPromptType(promptType, messages) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ promptType, messages })
  });

  const rawText = await res.text();
  let data;
  try { data = rawText ? JSON.parse(rawText) : {}; } catch { data = { raw: rawText }; }
  return { res, data };
}

async function createSummaryFeedbackFromRows(student, months, rows, labels = []) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error(`최근 ${months}개월 안에 사용할 수 있는 저장 피드백이 없습니다.`);
  }
  const promptType = getConsultationFeedbackPromptType(student, months);
  const userText = buildConsultationSummaryFeedbackUserText(student, months, rows, labels);
  const messages = buildConsultationFeedbackMessages(student, months, userText);
  const { res, data } = await fetchConsultationFeedbackByPromptType(promptType, messages);

  if (!res.ok) throw new Error(getApiErrorMessage(res.status, data));

  const rawReply = String(data.reply || '').trim();
  if (!rawReply) throw new Error('응답 본문이 비어 있습니다.');
  return parseReplyType(rawReply).cleanText;
}

const academyConsultationSummaryState = {
  running: false,
  items: {},
  expandedKey: ''
};
let academyConsultationAutoCheckTimer = null;
let academyManagementDashboardRenderTimer = null;
let academyManagementLoadToken = 0;

function scheduleRecordAcademyManagementDashboardRender(delay = 120) {
  if (currentRecordView !== 'academy') return;
  if (academyManagementDashboardRenderTimer) clearTimeout(academyManagementDashboardRenderTimer);
  academyManagementDashboardRenderTimer = setTimeout(() => {
    academyManagementDashboardRenderTimer = null;
    if (currentRecordView === 'academy') renderRecordAcademyManagementDashboard();
  }, Math.max(0, Number(delay) || 0));
}

function scheduleAcademyConsultationSummaryAutoCheck(delay = 900) {
  if (typeof runAcademyConsultationSummaryAutoCheck !== 'function') return;
  if (academyConsultationAutoCheckTimer) clearTimeout(academyConsultationAutoCheckTimer);
  const safeDelay = Math.max(0, Number(delay) || 0);
  academyConsultationAutoCheckTimer = setTimeout(() => {
    academyConsultationAutoCheckTimer = null;
    if (currentRecordView !== 'academy') return;
    const runCheck = () => {
      if (currentRecordView === 'academy') runAcademyConsultationSummaryAutoCheck();
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(runCheck, { timeout: 1500 });
    } else {
      setTimeout(runCheck, 0);
    }
  }, safeDelay);
}

function getAcademyConsultationMonthKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getAcademyConsultationSummaryKey(student, months) {
  const academyId = (typeof getOlliCurrentAcademyId === 'function') ? getOlliCurrentAcademyId() : '';
  const safeMonths = Number(months) || 1;
  const studentPart = student?.id
    ? `id:${student.id}`
    : `name:${String(student?.name || '').trim()}`;
  return `${academyId}|${getAcademyConsultationMonthKey()}|${safeMonths}|${studentPart}`;
}

function getAcademyConsultationSummaryItem(student, months) {
  const key = getAcademyConsultationSummaryKey(student, months);
  return academyConsultationSummaryState.items[key] || { status: 'insufficient' };
}

function setAcademyConsultationSummaryItem(key, patch) {
  academyConsultationSummaryState.items[key] = {
    ...(academyConsultationSummaryState.items[key] || {}),
    ...(patch || {})
  };
}

function getAcademyConsultationSummaryStatusLabel(status) {
  const normalized = String(status || 'insufficient');
  if (normalized === 'ready') return '준비완료';
  return '자료부족';
}

function getAcademyConsultationSummaryDisplayStatus(status) {
  return String(status || '') === 'ready' ? 'ready' : 'insufficient';
}

function isSummaryFeedbackRowForMonth(row, monthKey) {
  const d = parseConsultationSummaryRecordDate(row);
  return !!d && getAcademyConsultationMonthKey(d) === monthKey;
}

async function findSavedConsultationSummaryFeedback(student, months) {
  const academyId = requireOlliAcademyId('상담용 종합 피드백 확인');
  const safeMonths = Number(months) || 1;
  const year = new Date().getFullYear();
  const monthKey = getAcademyConsultationMonthKey();
  const encodedAcademyId = encodeURIComponent(academyId);
  const encodedStudentId = student?.id ? encodeURIComponent(student.id) : '';
  const encodedName = encodeURIComponent(String(student?.name || '').trim());
  const paths = [];

  if (encodedStudentId) {
    paths.push(`summary_feedbacks?select=*&academy_id=eq.${encodedAcademyId}&student_id=eq.${encodedStudentId}&summary_months=eq.${safeMonths}&year=eq.${year}&order=id.desc&limit=50`);
  } else if (encodedName) {
    // 학생코드가 없는 과거 저장본만 이름으로 보조 조회합니다.
    paths.push(`summary_feedbacks?select=*&academy_id=eq.${encodedAcademyId}&student_name=eq.${encodedName}&summary_months=eq.${safeMonths}&year=eq.${year}&order=id.desc&limit=50`);
  }

  const settled = await Promise.all(paths.map(async path => {
    try {
      return await supabase('GET', path);
    } catch (err) {
      console.warn('상담용 종합 피드백 저장본 확인 실패:', err.message || err);
      return [];
    }
  }));

  const seen = new Set();
  const rows = filterOlliActiveRows(settled.flat())
    .filter(row => row && String(row.content || '').trim())
    .filter(row => isSummaryFeedbackRowForMonth(row, monthKey))
    .filter(row => {
      const key = row.id || `${row.student_id || ''}:${row.student_name || ''}:${row.date || row.created_at || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const ad = parseConsultationSummaryRecordDate(a)?.getTime() || 0;
      const bd = parseConsultationSummaryRecordDate(b)?.getTime() || 0;
      return bd - ad;
    });

  return rows[0] || null;
}

async function saveConsultationSummaryFeedbackAuto(student, months, content) {
  const year = new Date().getFullYear();
  const date = new Date().toLocaleDateString('ko-KR');
  const payload = addOlliAcademyToPayload({
    student_id: student?.id || null,
    student_name: student?.name || '',
    content,
    summary_months: Number(months) || null,
    year,
    date
  }, '상담용 종합 피드백 자동 저장');
  return await saveFeedbackRowVerified('summary_feedbacks', payload, '상담용 종합 피드백 자동 저장');
}

function renderAcademyConsultationSummaryPreview(key) {
  const item = academyConsultationSummaryState.items[key] || {};
  const title = item.mode === 'elementary_one_month_records'
    ? `${item.studentName || ''} 1개월 수업 기록`
    : (item.studentName
      ? `${item.studentName} ${item.months || ''}개월 상담 피드백`
      : '상담 피드백');
  let content = '';
  let muted = false;

  if (item.status === 'ready') {
    content = String(item.content || '').trim() || (item.mode === 'elementary_one_month_records' ? '저장된 수업 기록이 비어 있습니다.' : '저장된 상담 피드백 내용이 비어 있습니다.');
  } else if (item.status === 'generating') {
    content = '상담용 종합 피드백을 자동 생성하고 있습니다. 잠시 후 다시 확인해 주세요.';
    muted = true;
  } else if (item.status === 'insufficient') {
    content = item.reason || '상담 기준 기간 안에 사용할 수 있는 저장 피드백이 부족합니다.';
    muted = true;
  } else if (item.status === 'error') {
    content = item.error || '상담용 종합 피드백 생성 중 오류가 발생했습니다.';
    muted = true;
  } else {
    content = '저장된 상담 피드백을 확인하고 있습니다.';
    muted = true;
  }

  return `<div class="recordAcademyConsultPreview">
    <div class="recordAcademyConsultPreviewTitle">${escapeHtml(title)}</div>
    <div class="recordAcademyConsultPreviewText${muted ? ' muted' : ''}">${escapeHtml(content)}</div>
  </div>`;
}

function toggleAcademyConsultationSummaryPreview(key) {
  academyConsultationSummaryState.expandedKey = academyConsultationSummaryState.expandedKey === key ? '' : key;
  if (currentRecordView === 'academy') renderRecordAcademyManagementDashboard();
}

async function runAcademyConsultationSummaryAutoCheck() {
  if (academyConsultationSummaryState.running) return;
  const currentRole = typeof getOlliCurrentRole === 'function' ? getOlliCurrentRole() : '';
  if (!['owner', 'manager', 'super_admin'].includes(currentRole)) return;
  if (currentRecordView !== 'academy') return;

  const dueStudents = getThisMonthConsultationDueStudents(getAcademyManagementStudentsForStats());
  if (!dueStudents.length) return;

  academyConsultationSummaryState.running = true;
  try {
    for (const student of dueStudents) {
      if (currentRecordView !== 'academy') break;

      const labels = getDueConsultationRuleLabelsForStudent(student);
      const summaryMonths = getConsultationSummaryMonthsFromLabels(labels);
      const key = getAcademyConsultationSummaryKey(student, summaryMonths);
      const existingState = academyConsultationSummaryState.items[key] || null;
      const keepReadyStatus = existingState && existingState.status === 'ready';
      if (existingState && (existingState.status === 'generating' || existingState.status === 'checking')) continue;

      setAcademyConsultationSummaryItem(key, {
        ...(keepReadyStatus ? { status: 'ready' } : { status: 'checking' }),
        studentName: student.name || '',
        studentDivision: student.type === 'kinder' ? 'kinder' : 'elementary',
        months: summaryMonths
      });

      try {
        const material = await prepareConsultationFeedbackMaterial(student, summaryMonths, labels);
        if (material.mode === 'elementary_one_month_records') {
          setAcademyConsultationSummaryItem(key, {
            status: material.status,
            mode: material.mode,
            content: material.status === 'ready' ? material.content : '',
            reason: material.status === 'ready' ? '' : '초등부 1개월 상담에 사용할 일반 피드백이 없습니다.',
            studentName: student.name || '',
            studentDivision: 'elementary',
            months: summaryMonths
          });
          scheduleRecordAcademyManagementDashboardRender(120);
          continue;
        }

        const saved = await findSavedConsultationSummaryFeedback(student, summaryMonths);
        if (saved) {
          setAcademyConsultationSummaryItem(key, {
            status: 'ready',
            mode: material.mode,
            content: String(saved.content || '').trim(),
            savedRow: saved,
            studentName: student.name || '',
            studentDivision: student.type === 'kinder' ? 'kinder' : 'elementary',
            months: summaryMonths
          });
          scheduleRecordAcademyManagementDashboardRender(120);
          continue;
        }

        if (material.status !== 'ready' || !material.rows.length) {
          setAcademyConsultationSummaryItem(key, {
            status: 'insufficient',
            mode: material.mode,
            reason: material.reason || '상담 기준 기간 안에 사용할 수 있는 저장 피드백이 부족합니다.',
            studentName: student.name || '',
            studentDivision: student.type === 'kinder' ? 'kinder' : 'elementary',
            months: summaryMonths
          });
          scheduleRecordAcademyManagementDashboardRender(120);
          continue;
        }

        setAcademyConsultationSummaryItem(key, {
          ...(keepReadyStatus ? { status: 'ready' } : { status: 'generating' }),
          mode: material.mode,
          studentName: student.name || '',
          studentDivision: student.type === 'kinder' ? 'kinder' : 'elementary',
          months: summaryMonths
        });

        const reply = await createSummaryFeedbackFromRows(student, summaryMonths, material.rows, labels);
        const savedRow = await saveConsultationSummaryFeedbackAuto(student, summaryMonths, reply);
        setAcademyConsultationSummaryItem(key, {
          status: 'ready',
          mode: material.mode,
          content: reply,
          savedRow,
          studentName: student.name || '',
          studentDivision: student.type === 'kinder' ? 'kinder' : 'elementary',
          months: summaryMonths
        });
        renderRecordAcademyManagementDashboard();
      } catch (err) {
        console.error('상담용 종합 피드백 자동 생성 오류:', err);
        if (keepReadyStatus) {
          setAcademyConsultationSummaryItem(key, {
            status: 'ready',
            error: err.message || '알 수 없는 오류입니다.',
            studentName: student.name || '',
            studentDivision: student.type === 'kinder' ? 'kinder' : 'elementary',
            months: summaryMonths
          });
        } else {
          setAcademyConsultationSummaryItem(key, {
            status: 'insufficient',
            error: err.message || '알 수 없는 오류입니다.',
            studentName: student.name || '',
            studentDivision: student.type === 'kinder' ? 'kinder' : 'elementary',
            months: summaryMonths
          });
        }
      }
    }
  } finally {
    academyConsultationSummaryState.running = false;
    scheduleRecordAcademyManagementDashboardRender(120);
  }
}

window.toggleAcademyConsultationSummaryPreview = toggleAcademyConsultationSummaryPreview;
window.runAcademyConsultationSummaryAutoCheck = runAcademyConsultationSummaryAutoCheck;

async function requestConsultationSummaryFeedback(studentId, studentName, months, btn) {
  if (loading) return;
  const students = getAcademyManagementStudentsForStats();
  const targetId = String(studentId || '').trim();
  const targetName = String(studentName || '').trim();
  let student = null;
  if (targetId) {
    student = students.find(item => String(item.id || '') === targetId) || null;
  } else if (targetName) {
    const matches = students.filter(item => String(item.name || '').trim() === targetName);
    if (matches.length === 1) student = matches[0];
    else if (matches.length > 1) {
      alert('같은 이름의 학생이 여러 명 있습니다. 학생 목록에서 해당 학생을 다시 선택해 주세요.');
      return;
    }
  }
  if (!student) {
    alert('학생 정보를 찾을 수 없습니다. 학생 목록을 새로고침한 뒤 다시 시도해 주세요.');
    return;
  }

  const labels = getDueConsultationRuleLabelsForStudent(student);
  const summaryMonths = Number(months) || getConsultationSummaryMonthsFromLabels(labels);

  loading = true;
  showFeedbackLoading('summary');
  if (btn) {
    btn.disabled = true;
    btn.dataset.originalText = btn.textContent || '상담 피드백';
    btn.textContent = '생성 중...';
  }

  try {
    const material = await prepareConsultationFeedbackMaterial(student, summaryMonths, labels);
    if (material.mode === 'elementary_one_month_records') {
      alert(material.status === 'ready'
        ? '초등부 1개월 상담은 종합피드백이 아니라 성향 기록지의 일반 피드백을 확인해 주세요.'
        : '초등부 1개월 상담에 사용할 일반 피드백이 없습니다.');
      return;
    }
    if (material.status !== 'ready' || !material.rows.length) {
      throw new Error(material.reason || `최근 ${summaryMonths}개월 안에 사용할 수 있는 저장 피드백이 부족합니다.`);
    }
    const reply = await createSummaryFeedbackFromRows(student, summaryMonths, material.rows, labels);
    currentSaveType = 'summary';
    addRecordSummaryPopup(reply, `${student.name} ${summaryMonths}개월 상담 피드백`, {
      studentId: student.id || '',
      studentName: student.name,
      studentDivision: student.type === 'kinder' ? 'kinder' : 'elementary',
      months: summaryMonths
    });
  } catch (err) {
    console.error('상담용 종합 피드백 생성 오류:', err);
    alert(`상담용 종합 피드백 생성 중 오류가 발생했어요.\n\n${err.message || '알 수 없는 오류입니다.'}`);
  } finally {
    hideFeedbackLoading();
    loading = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || '상담 피드백';
      delete btn.dataset.originalText;
    }
  }
}

async function requestSummaryFeedbackFromRecords(studentName, encodedRecords, months) {
  if (loading) return;
  let records = [];
  try { records = JSON.parse(decodeURIComponent(encodedRecords || '[]')); } catch { records = []; }
  const allStudents = getAllStudents();
  const studentId = String(records.find(row => row && row.student_id)?.student_id || '').trim();
  const displayName = String(studentName || records.find(row => row && row.student_name)?.student_name || '').trim();
  let student = null;

  if (studentId) {
    student = allStudents.find(item => String(item.id || '').trim() === studentId) || {
      id: studentId,
      name: displayName,
      type: getPreferredStudentTypeForSave ? getPreferredStudentTypeForSave() : 'elementary'
    };
  } else if (displayName) {
    const matches = allStudents.filter(item => String(item.name || '').trim() === displayName);
    if (matches.length === 1) {
      student = matches[0];
    } else if (matches.length > 1) {
      alert('같은 이름의 학생이 여러 명 있습니다. 학생코드가 있는 학생 기록에서 다시 생성해 주세요.');
      return;
    } else {
      student = {
        name: displayName,
        type: getPreferredStudentTypeForSave ? getPreferredStudentTypeForSave() : 'elementary'
      };
    }
  }

  if (!student) {
    alert('학생 정보를 찾을 수 없습니다. 학생 목록을 새로고침한 뒤 다시 시도해 주세요.');
    return;
  }

  const summaryMonths = Number(months) || 6;
  const rows = normalizeConsultationSummaryFeedbackRows(records, 'feedbacks', summaryMonths);

  loading = true;
  showFeedbackLoading('summary');
  try {
    const reply = await createSummaryFeedbackFromRows(student, summaryMonths, rows, [`${summaryMonths}개월`]);
    currentSaveType = 'summary';
    addRecordSummaryPopup(reply, `${student.name || displayName} ${summaryMonths}개월 종합 피드백`, {
      studentId: student.id || '',
      studentName: student.name || displayName,
      studentDivision: student.type === 'kinder' ? 'kinder' : 'elementary',
      months: summaryMonths
    });
  } catch (err) {
    console.error('종합 피드백 생성 오류:', err);
    alert(`종합 피드백 생성 중 오류가 발생했어요.

${err.message || '알 수 없는 오류입니다.'}`);
  } finally {
    hideFeedbackLoading();
    loading = false;
  }
}
window.requestConsultationSummaryFeedback = requestConsultationSummaryFeedback;
window.requestSummaryFeedbackFromRecords = requestSummaryFeedbackFromRecords;

