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

// 연간 상담은 등록월부터 12개월씩 묶으며, 마지막 달의 피드백이 작성되었는지 별도로 확인합니다.
// 예: 2025년 4월 등록 → 2026년 3월 마지막 달, 3월 또는 4월에 쓴 마지막 성장 피드백 인정.
function getElementaryAnnualConsultationFinalMonth(context) {
  const enrolled = context?.enrolled;
  if (!(enrolled instanceof Date) || Number.isNaN(enrolled.getTime())) return null;
  const reference = context?.checkedAt instanceof Date ? context.checkedAt : new Date();
  const calendarMonths = (reference.getFullYear() - enrolled.getFullYear()) * 12
    + reference.getMonth() - enrolled.getMonth();
  const completedAnnualMonths = Math.max(12, Math.floor(calendarMonths / 12) * 12);
  const finalMonthStart = new Date(enrolled.getFullYear(), enrolled.getMonth() + completedAnnualMonths - 1, 1);
  const windowStart = new Date(enrolled.getFullYear(), enrolled.getMonth() + completedAnnualMonths - 12, 1);
  const followingMonthEnd = new Date(finalMonthStart.getFullYear(), finalMonthStart.getMonth() + 2, 0, 23, 59, 59, 999);
  return {
    windowStart,
    finalMonthStart,
    followingMonthEnd,
    label: `${finalMonthStart.getFullYear()}년 ${finalMonthStart.getMonth() + 1}월`
  };
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
    dueOptions,
    checkedAt: now
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
  const annualFinalMonth = mode === 'elementary_summary_slots' && safeMonths >= 12
    ? getElementaryAnnualConsultationFinalMonth(context)
    : null;
  if (annualFinalMonth && context) {
    context.start = annualFinalMonth.windowStart;
    if (!(context.end instanceof Date) || context.end > annualFinalMonth.followingMonthEnd) {
      context.end = annualFinalMonth.followingMonthEnd;
    }
  }
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
    const records = rows.filter(row => row.source_table === 'feedbacks'
      && (!row.feedback_type || String(row.feedback_type).toLowerCase() === 'growth'));
    const picked = pickElementaryFeedbackRowsBySlots(student, records, context);
    // 각 그룹의 이전 발송월 중 일부가 비어도, 실제 작성된 성장기록은 종합 피드백에 사용할 수 있습니다.
    const requiredCount = picked.slots.length === 1 ? 1 : 2;
    if (records.length < requiredCount) {
      return {
        mode, status: 'insufficient', rows: records, context, slots: picked.slotStates,
        reason: `상담 기간 내 성장 피드백이 최소 ${requiredCount}개 필요합니다. 현재 ${records.length}개가 확인되었습니다.`
      };
    }
    // 12개월 상담의 마지막 기록은 필수. 최종 월 또는 다음 달에 실제 성장 피드백이
    // 작성되어 있어야 하며, 과거 기록 2건만으로 미리 생성하지 않습니다.
    if (safeMonths >= 12) {
      if (!annualFinalMonth) {
        return {
          mode, status: 'insufficient', rows: records, context, slots: picked.slotStates,
          reason: '마지막 성장 피드백을 판정할 등록일 정보가 없습니다.'
        };
      }
      const hasFinalGrowth = records.some(row =>
        row._summaryDate instanceof Date
        && isDateWithinRange(row._summaryDate, annualFinalMonth.finalMonthStart, annualFinalMonth.followingMonthEnd));
      if (!hasFinalGrowth) {
        return {
          mode, status: 'insufficient', rows: records, context, slots: picked.slotStates,
          reason: `마지막 성장 피드백(${annualFinalMonth.label}분)이 아직 없습니다. 마지막 달 말이나 다음 달에 작성된 기록이 있어야 종합 피드백을 만들 수 있습니다.`
        };
      }
    }
    return { mode, status: 'ready', rows: records, context, slots: picked.slotStates };
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

function getConsultationSecureFeedbackReadFeature(table) {
  if (table === 'feedbacks') return 'general_feedback_records_read';
  if (table === 'fail_feedbacks') return 'growth_feedback_records_read';
  if (table === 'summary_feedbacks') return 'summary_feedback_records_read';
  throw new Error('지원하지 않는 상담용 피드백 테이블입니다: ' + table);
}

async function loadConsultationSummaryFeedbackRows(student, months, options = {}) {
  const academyId = requireOlliAcademyId('상담용 종합 피드백 생성');
  const safeMonths = Number(months) || 1;
  const studentId = String(student?.id || '').trim();
  const studentName = String(student?.name || '').trim();
  const requestedTables = Array.isArray(options.sourceTables) && options.sourceTables.length
    ? options.sourceTables
    : ['feedbacks', 'fail_feedbacks'];

  const core = window.OlliStorageCore;
  if (!core?.FeatureRegistry || !core?.ServerAdapter) {
    throw new Error('상담용 피드백 보호 조회 모듈이 준비되지 않았습니다.');
  }

  if (!studentId && !studentName) throw new Error('상담 학생의 식별 정보가 없습니다.');
  const identity = { academyId };
  if (studentId) identity.studentId = studentId;
  else if (studentName) identity.student_name = studentName;

  const settled = await Promise.all(requestedTables.map(async table => {
    const feature = getConsultationSecureFeedbackReadFeature(table);
    const spec = core.FeatureRegistry.require(feature);
    try {
      const rows = await core.ServerAdapter.read(spec, identity, { limit: 300 });
      return normalizeConsultationSummaryFeedbackRows(rows, table, safeMonths, options);
    } catch (err) {
      throw new Error(`상담 피드백 서버 조회 실패 (${table}): ${err?.message || '연결 오류'}`);
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

function getConsultationFeedbackRecordPurpose(row = {}) {
  const sourceTable = String(row.source_table || row.sourceTable || '').trim().toLowerCase();
  const rawType = String(row.feedback_type || row.feedbackType || '').trim().toLowerCase();
  if (sourceTable === 'fail_feedbacks' || rawType === 'fail') return 'fail';
  if (rawType === 'growth') return 'growth';
  if (rawType === 'class') return 'class';
  return 'legacy';
}

function getConsultationFeedbackRecordTypeLabel(row = {}) {
  const purpose = getConsultationFeedbackRecordPurpose(row);
  if (purpose === 'fail') return '실패·성장 피드백';
  if (purpose === 'growth') return '성장 피드백';
  return '수업 피드백';
}

function buildConsultationSummaryFeedbackUserText(student, months, rows, labels = []) {
  const studentTypeLabel = student?.type === 'kinder' ? '유치부' : '초등부';
  const enrolledAt = getEnrolledAtFromStudent(student) || '등록일 미확인';
  const promptType = getConsultationFeedbackPromptType(student, months);
  const recordLines = (Array.isArray(rows) ? rows : []).map((row, index) => {
    const date = row._summaryDate
      ? `${row._summaryDate.getFullYear()}.${String(row._summaryDate.getMonth()+1).padStart(2,'0')}.${String(row._summaryDate.getDate()).padStart(2,'0')}`
      : String(row.date || row.created_at || '날짜 미확인');
    const typeLabel = getConsultationFeedbackRecordTypeLabel(row);
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

async function fetchConsultationFeedbackByPromptType(promptType, messages, options = {}) {
  const studentDivision = options.studentDivision === 'kinder' ? 'kinder' : (options.studentDivision === 'elementary' ? 'elementary' : '');
  const studentId = String(options.studentId || '').trim();
  const studentName = String(options.studentName || '').trim();
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ promptType, studentId, studentName, studentDivision, messages })
  });

  const rawText = await res.text();
  let data;
  try { data = rawText ? JSON.parse(rawText) : {}; } catch { data = { raw: rawText }; }
  return { res, data };
}

async function createSummaryFeedbackFromRows() {
  throw new Error('종합 피드백은 올리 공통 서버에서만 생성할 수 있습니다.');
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
  const academyId=typeof getOlliCurrentAcademyId==='function'?getOlliCurrentAcademyId():'';
  const core=window.OlliConsultationServer;
  const task=core?.getPrimaryTask?.(student,months);
  return core?.getCacheKey?.(academyId,task)||'unbound|'+String(academyId)+'|'+String(student?.id||'');
}

function getAcademyConsultationSummaryItem(student, months) {
  const key = getAcademyConsultationSummaryKey(student, months);
  return academyConsultationSummaryState.items[key]
    || window.OlliConsultationServer?.readCachedStatus?.(key)
    || { status: 'insufficient' };
}

function setAcademyConsultationSummaryItem(key, patch) {
  const previous=academyConsultationSummaryState.items[key]||{};
  academyConsultationSummaryState.items[key]={...previous,...(patch||{})};
  if(['ready','insufficient'].includes(patch?.status))
    window.OlliConsultationServer?.writeCachedStatus?.(key,academyConsultationSummaryState.items[key]);
}

function getAcademyConsultationSummaryStatusLabel(status) {
  if (status === 'ready') return '준비완료';
  if (status === 'error') return '확인오류';
  return '자료부족';
}

function getAcademyConsultationSummaryDisplayStatus(status) {
  return status === 'ready' || status === 'error' ? status : 'insufficient';
}

function isSummaryFeedbackRowForMonth(row, monthKey) {
  const d = parseConsultationSummaryRecordDate(row);
  return !!d && getAcademyConsultationMonthKey(d) === monthKey;
}

async function loadConsultationSummaryFeedbackRowsSecure(student, limit = 50) {
  const academyId = requireOlliAcademyId('상담용 종합 피드백 확인');
  const studentId = String(student?.id || '').trim();
  const studentName = String(student?.name || '').trim();
  if (!studentId && !studentName) throw new Error('상담 학생의 식별 정보가 없습니다.');

  const core = window.OlliStorageCore;
  if (!core?.FeatureRegistry || !core?.ServerAdapter) {
    throw new Error('상담용 종합 피드백 보호 조회 모듈이 준비되지 않았습니다.');
  }

  const spec = core.FeatureRegistry.require('summary_feedback_records_read');
  return core.ServerAdapter.read(spec, {
    academyId,
    studentId,
    student_name: studentName
  }, { limit });
}

async function findSavedConsultationSummaryFeedback(student, months) {
  const safeMonths = Number(months) || 1;
  const year = new Date().getFullYear();
  const monthKey = getAcademyConsultationMonthKey();
  const sourceRows = await loadConsultationSummaryFeedbackRowsSecure(student, 50);

  const seen = new Set();
  const rows = filterOlliActiveRows(sourceRows)
    .filter(row => row && String(row.content || '').trim())
    .filter(row => Number(row.summary_months || 0) === safeMonths)
    .filter(row => Number(row.year || 0) === year)
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

function getConsultationSummaryServerTask(student, requestedMonths) {
  return window.OlliConsultationServer?.getPrimaryTask?.(student,requestedMonths)||null;
}

async function inspectConsultationSummaryFromServer(student, task) {
  const server=window.OlliConsultationServer;
  if(!server?.inspectSummary)throw new Error('종합 피드백 서버 조회 기능이 준비되지 않았습니다.');
  if(!student?.id||!task?.key)throw new Error('상담 학생 또는 회차 정보가 없습니다.');
  return server.checkSummaryStatus(student,task);
}

async function fetchConsultationSummaryFromServer(student, task) {
  const server = window.OlliConsultationServer;
  if (!server) throw new Error('종합 피드백 공통 서버가 준비되지 않았습니다.');
  if (!student?.id || !task?.key) throw new Error('상담 대상 학생 또는 상담 회차 정보가 없습니다.');
  return server.requestSummary(student.id, task.key);
}

async function runAcademyConsultationSummaryAutoCheck() {
  if (academyConsultationSummaryState.running || currentRecordView !== 'academy') return;
  if (!['owner','manager','super_admin'].includes(typeof getOlliCurrentRole === 'function' ? getOlliCurrentRole() : '')) return;
  const students = getThisMonthConsultationDueStudents(getAcademyManagementStudentsForStats());
  academyConsultationSummaryState.running = true;
  let pendingGeneration = false;
  try {
    for (const student of students) {
      if (currentRecordView !== 'academy') break;
      const task = getConsultationSummaryServerTask(student);
      if (!task) continue;
      const summaryMonths = task.ruleKey === 'every_12'?12:task.ruleKey==='every_6'?6:task.ruleKey==='after_3'?3:1;
      const key = getAcademyConsultationSummaryKey(student,summaryMonths);
      // 서버 재조회 중에는 마지막 로컬 상담 상태를 그대로 보여 줍니다.
      try {
        const result = await inspectConsultationSummaryFromServer(student,task);
        const status = result.status === 'ready'?'ready':'insufficient';
        if(status==='generating') pendingGeneration = true;
        // 서버에서 '생성중'이라도 이미 저장된 준비완료 기록을 가리지 않습니다.
        if (status !== 'generating' || getAcademyConsultationSummaryItem(student, summaryMonths).status !== 'ready') {
          setAcademyConsultationSummaryItem(key,{
            status,feedbackId:status==='ready'?result.feedbackId:null,
            mode:result.mode||'',content:status==='ready'?String(result.content||''):'',
            reason:result.reason||'',studentName:student.name,studentDivision:student.type,months:summaryMonths
          });
        }
      } catch (error) {
        if (getAcademyConsultationSummaryItem(student, summaryMonths).status !== 'ready') {
          setAcademyConsultationSummaryItem(key,{
            status:'error',error:error.message||'서버 오류',studentName:student.name,studentDivision:student.type,months:summaryMonths
          });
        }
      }
      scheduleRecordAcademyManagementDashboardRender(120);
    }
  } finally {
    academyConsultationSummaryState.running = false;
    scheduleRecordAcademyManagementDashboardRender(120);
    if(pendingGeneration) scheduleAcademyConsultationSummaryAutoCheck(6000);
  }
}

window.toggleAcademyConsultationSummaryPreview = toggleAcademyConsultationSummaryPreview;
window.runAcademyConsultationSummaryAutoCheck = runAcademyConsultationSummaryAutoCheck;

async function requestConsultationSummaryFeedback(studentId, studentName, months, btn) {
  const student=getAcademyManagementStudentsForStats().find(s=>String(s.id||'')===String(studentId||''))
    || getAcademyManagementStudentsForStats().find(s=>String(s.name||'')===String(studentName||''));
  if(!student){alert('학생을 찾지 못했습니다.');return;}
  const task=getConsultationSummaryServerTask(student,months);
  if(!task){alert('상담예정 회차가 없습니다.');return;}
  if(btn){btn.disabled=true;btn.textContent='확인중...';}
  try{
    const result=await fetchConsultationSummaryFromServer(student,task);
    if(result.status==='insufficient'){alert(result.reason||'상담 자료가 부족합니다.');return;}
    if(result.status==='generating'){alert('공통 서버에서 종합 피드백을 생성하고 있습니다.');return;}
    if(result.status!=='ready')throw new Error('알 수 없는 종합 피드백 처리 상태');
    const summaryMonths=task.ruleKey==='every_12'?12:task.ruleKey==='every_6'?6:task.ruleKey==='after_3'?3:1;
    const key=getAcademyConsultationSummaryKey(student,summaryMonths);
    setAcademyConsultationSummaryItem(key,{
      status:result.feedbackId?'ready':'insufficient',feedbackId:result.feedbackId||null,
      mode:result.mode||'',content:String(result.content||''),
      reason:result.feedbackId?'':'이번 상담 회차에 저장된 종합 피드백이 없습니다.',
      studentName:student.name,studentDivision:student.type,months:summaryMonths
    });
    academyConsultationSummaryState.expandedKey=key;
    if(typeof renderRecordAcademyManagementDashboard==='function')renderRecordAcademyManagementDashboard();
  }catch(error){alert('종합 피드백 서버 확인 실패: '+(error.message||error));}
  finally{if(btn){btn.disabled=false;btn.textContent=btn.dataset.originalText||'상담 피드백';}}
}

async function requestSummaryFeedbackFromRecords(studentName, encodedRecords, months) {
  if (loading) return;
  let records=[];
  try { records=JSON.parse(decodeURIComponent(encodedRecords||'[]')); } catch { records=[]; }
  if(!Array.isArray(records))records=[];
  const studentId=String(records.find(row=>row?.student_id)?.student_id||'').trim();
  const studentList=typeof getAllStudents==='function'?getAllStudents():[];
  const matches=studentId
    ?studentList.filter(s=>String(s.id||'').trim()===studentId)
    :studentList.filter(s=>String(s.name||'').trim()===String(studentName||'').trim());
  if(matches.length!==1||!matches[0].id){
    alert('학생을 정확히 식별할 수 없습니다. 학생 관리에서 등록된 학생 기록을 선택해 주세요.');
    return;
  }
  const student=matches[0], period=Number(months)||6;
  const ids=[...new Set(records.map(row=>Number(row?.id)).filter(id=>Number.isSafeInteger(id)&&id>0))];
  if(!ids.length){alert('서버에 저장된 기록을 먼저 선택해 주세요.');return;}
  if(!window.OlliConsultationServer||!window.OlliConsultationManualUI){
    alert('종합 피드백 공통 서버가 준비되지 않았습니다. 새로고침하여 다시 시도해 주세요.');
    return;
  }
  loading=true;
  if(typeof showFeedbackLoading==='function')showFeedbackLoading('summary');
  try{
    const result=await window.OlliConsultationServer.requestManualSummary(student.id,period,ids);
    if(result.status==='generating'){alert('서버에서 종합 피드백을 생성 중입니다. 잠시 후 다시 확인해 주세요.');return;}
    if(result.status!=='ready'||!result.content)throw new Error(result.reason||'서버 종합 피드백을 확인하지 못했습니다.');
    window.OlliConsultationManualUI.open({studentId:student.id,studentName:student.name,
      months:period,taskKey:result.taskKey,content:result.content});
  }catch(error){
    alert('종합 피드백 서버 처리 실패: '+(error?.message||error));
  }finally{
    if(typeof hideFeedbackLoading==='function')hideFeedbackLoading();
    loading=false;
  }
}
window.requestConsultationSummaryFeedback = requestConsultationSummaryFeedback;
window.requestSummaryFeedbackFromRecords = requestSummaryFeedbackFromRecords;

