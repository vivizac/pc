const STUDENTS_KEY = 'olli_students_v3';
const DELETED_STUDENTS_KEY = 'olli_deleted_student_ids_v1';

function getDeletedStudentsStorageKey() {
  const academyId = (typeof getOlliCurrentAcademyId === 'function') ? getOlliCurrentAcademyId() : '';
  return academyId ? `${DELETED_STUDENTS_KEY}_${academyId}` : DELETED_STUDENTS_KEY;
}
function getDeletedStudentIds() {
  try {
    const raw = localStorage.getItem(getDeletedStudentsStorageKey());
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.map(String).filter(Boolean) : []);
  } catch (e) {
    return new Set();
  }
}
function setDeletedStudentIds(idSet) {
  try {
    localStorage.setItem(getDeletedStudentsStorageKey(), JSON.stringify(Array.from(idSet || []).map(String).filter(Boolean)));
  } catch (e) {
    console.warn('deleted student cache save skipped:', e);
  }
}
function markDeletedStudentIds(ids) {
  const idSet = getDeletedStudentIds();
  (Array.isArray(ids) ? ids : [ids]).forEach(id => {
    const value = String(id || '').trim();
    if (value) idSet.add(value);
  });
  setDeletedStudentIds(idSet);
}
function unmarkDeletedStudentId(id) {
  const value = String(id || '').trim();
  if (!value) return;
  const idSet = getDeletedStudentIds();
  if (idSet.delete(value)) setDeletedStudentIds(idSet);
}
function isStudentLocallyDeleted(id) {
  const value = String(id || '').trim();
  return !!value && getDeletedStudentIds().has(value);
}
function filterLocallyDeletedStudents(list) {
  return (Array.isArray(list) ? list : []).filter(student => !isStudentLocallyDeleted(student?.id));
}
const ELEMENTARY_MEMO_PREFIX = 'olli_elementary_memo_';
const ELEMENTARY_ANALYSIS_PREFIX = 'olli_elementary_analysis_';
const ELEMENTARY_RECORDS_PREFIX = 'olli_elementary_records_';
const MEMO_FEEDBACK_ARCHIVE_PREFIX = 'olli_memo_feedback_archive_';
const DELETED_STUDENT_BACKUP_PREFIX = 'olli_deleted_student_backup_v1';

function isOlliSoftDeletedRow(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.is_deleted === true) return true;
  if (String(row.is_deleted || '').toLowerCase() === 'true') return true;
  const deleteReason = String(row.delete_reason || row.reason || '').trim();
  if (deleteReason === 'student_deleted' || deleteReason === 'test_reset') return true;
  return false;
}

function filterOlliActiveRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(row => !isOlliSoftDeletedRow(row));
}

function getDeletedStudentBackupKey(studentId) {
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || 'unscoped';
  const id = String(studentId || '').trim() || 'unknown';
  return `${DELETED_STUDENT_BACKUP_PREFIX}:${academyId}:${id}`;
}

function readRawLocalValue(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

function backupAndRemoveStudentLocalData(studentId, studentSnapshot = null) {
  const id = String(studentId || '').trim();
  if (!id) return null;
  const now = new Date().toISOString();
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || '';
  const keys = {
    elementary_memo: ELEMENTARY_MEMO_PREFIX + id,
    elementary_analysis: ELEMENTARY_ANALYSIS_PREFIX + id,
    elementary_records: ELEMENTARY_RECORDS_PREFIX + id,
    memo_feedback_archive: MEMO_FEEDBACK_ARCHIVE_PREFIX + id
  };
  const backup = {
    schema_version: 1,
    academy_id: academyId,
    student_id: id,
    student: studentSnapshot ? { ...studentSnapshot } : null,
    backup_created_at: now,
    source_keys: keys,
    values: {}
  };
  Object.entries(keys).forEach(([label, key]) => {
    const value = readRawLocalValue(key);
    if (value != null) backup.values[label] = value;
  });
  try {
    localStorage.setItem(getDeletedStudentBackupKey(id), JSON.stringify(backup));
  } catch (err) {
    console.warn('deleted student local backup save skipped:', err);
  }
  Object.values(keys).forEach(key => {
    try { localStorage.removeItem(key); } catch (_) {}
  });
  return backup;
}

const LOCAL_MEMO_RETENTION_DAYS = 30;
const MEMO_AUTOSAVE_DELAY = 1000;
const KINDER_ONE_MONTH_PROMPT_TYPE = 'kinder_one_month';
let loading = false;
let currentFeedbackToSave = '';
let currentSaveType = 'class';
let currentRecordMode = 'class';
let recordModeRotation = 0;
let recordStorageRotation = 0;
let currentRecordView = 'elementary';
let currentObservationView = 'elementary';
let currentMemoStudent = null;
let currentMemoType = 'elementary';
let studentInfoModalTarget = null;
const LAST_ELEMENTARY_MEMO_STUDENT_KEY = 'olli_last_elementary_memo_student_id';
function getLastElementaryMemoStudentStorageKey() {
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || 'unscoped';
  return `${LAST_ELEMENTARY_MEMO_STUDENT_KEY}_${academyId}`;
}
let viewingArchivedElementaryRecord = false;
let elementaryAnalysisDraft = null;
let selectedElementaryAnalysisHistoryId = '';
const RECORD_MODE_ORDER = ['class', 'fail', 'summary'];
let studentSelectionMode = false;
const selectedStudentIds = new Set();
function getStudentInfoModalTarget(type = '') {
  const target = studentInfoModalTarget || currentMemoStudent;
  if (!target) return null;
  if (type && target.type !== type) return null;
  return target;
}
function setLastElementaryMemoStudent(student) {
  if (student && student.type === 'elementary' && student.id) {
    localStorage.setItem(getLastElementaryMemoStudentStorageKey(), String(student.id));
  }
}
function getLastElementaryMemoStudent() {
  const id = localStorage.getItem(getLastElementaryMemoStudentStorageKey()) || '';
  const student = id ? findStudentById(id) : null;
  return student && student.type === 'elementary' ? student : null;
}

let recordBoardLongPressTimer = null;
let recordBoardLongPressStart = { x: 0, y: 0 };
let selectedRecordBoardStudentName = '';
let suppressNextRecordBoardClick = false;
window.__olliRecordBoardGroups = window.__olliRecordBoardGroups || {};


function ensureStudentFromSavedFeedback(studentName, preferredType = 'elementary') {
  const name = String(studentName || '').trim();
  if (!name) return null;
  const type = preferredType === 'kinder' ? 'kinder' : 'elementary';
  const matches = getAllStudents().filter(student =>
    String(student.name || '').trim() === name &&
    (student.type || 'elementary') === type
  );
  return matches.length === 1 ? matches[0] : null;
}

function getPreferredStudentTypeForSave() {
  if (currentMemoStudent?.type === 'kinder' || currentMemoType === 'kinder') return 'kinder';
  return 'elementary';
}

function getStudentNameForAutoFeedbackSave(studentDivision = '') {
  const division = studentDivision === 'kinder' ? 'kinder' : 'elementary';
  if (currentMemoStudent?.name) return currentMemoStudent.name;
  if (division === 'kinder') {
    const kinderName = document.querySelector('.kinderStudentRow.studentRowSelected .studentTextWrap span:first-child, .kinderStudentRow .studentTextWrap span:first-child')?.textContent?.trim() || '';
    if (kinderName) return kinderName;
  }
  const memoName = document.getElementById('memoStudentName')?.textContent?.replace(/\s*노트\s*$/, '').trim() || '';
  if (memoName && !['학생', '학생 이름', '학생 노트'].includes(memoName)) return memoName;
  return '';
}


async function getOrCreateStudentForSupabaseSave(studentName, preferredType = 'elementary', preferredStudentId = '') {
  const name = String(studentName || '').trim();
  if (!name) throw new Error('학생 이름이 없습니다.');

  const type = preferredType === 'kinder' ? 'kinder' : 'elementary';
  const targetId = String(preferredStudentId || '').trim();
  let student = null;

  if (targetId) {
    student = getAllStudents().find(item => String(item.id || '') === targetId) || null;
    if (!student) {
      throw new Error('학생코드와 일치하는 학생 정보를 찾지 못했습니다. 학생 목록을 새로고침한 뒤 다시 시도해 주세요.');
    }
  }

  if (!student && currentMemoStudent && String(currentMemoStudent.id || '').trim() && String(currentMemoStudent.name || '').trim() === name && (currentMemoStudent.type || 'elementary') === type) {
    student = currentMemoStudent;
  }

  if (!student) {
    const matches = getAllStudents().filter(item =>
      String(item.name || '').trim() === name &&
      (item.type || 'elementary') === type
    );
    if (matches.length === 1) {
      student = matches[0];
    } else if (matches.length > 1) {
      throw new Error(`${name} 이름의 학생이 ${matches.length}명 있습니다. 학생코드가 있는 학생 선택 화면에서 다시 저장해 주세요.`);
    }
  }

  if (!student) {
    throw new Error(`${name} 학생의 학생코드를 확인하지 못했습니다. 출석부에서 학생을 선택한 뒤 다시 저장해 주세요.`);
  }
  if (!String(student.id || '').trim()) {
    throw new Error('학생코드가 없는 학생은 피드백을 저장할 수 없습니다. 학생정보를 먼저 확인해 주세요.');
  }

  const savedStudent = await ensureStudentSavedToSupabase({
    ...student,
    id: student.id || uid(),
    name: student.name || name,
    type,
    status: 'active'
  });

  if (currentMemoStudent && currentMemoStudent.id === student.id) {
    currentMemoStudent = { ...currentMemoStudent, ...savedStudent };
  }

  return savedStudent;
}

function closeFeedbackResultCardFromButton(btn) {
  const card = btn?.closest?.('.feedbackResultCard');
  if (card) card.remove();
  closeMemoFeedbackPopup();
}

function bindGeneratedFeedbackSaveButton(card, options = {}) {
  const saveBtn = card?.querySelector?.('[data-feedback-save-button="true"]');
  if (!saveBtn || saveBtn.dataset.bound === '1') return;
  saveBtn.dataset.bound = '1';
  saveBtn.addEventListener('click', function(event) {
    event.preventDefault();
    event.stopPropagation();
    const hostCard = this.closest('.feedbackResultCard, .memoFeedbackPopupCard');
    const feedbackText = hostCard?._feedbackText || '';
    autoSaveGeneratedFeedback(feedbackText, options, this);
  });
}

async function refreshRecordsAfterFeedbackSave() {
  const recordRoomScreen = document.getElementById('recordRoomScreen');
  const recordVisible = recordRoomScreen && recordRoomScreen.style.display !== 'none';
  if (recordVisible && typeof loadRecords === 'function') {
    await loadRecords('');
  }
}

function getFeedbackTableNameByType(feedbackType) {
  const type = String(feedbackType || '').toLowerCase();
  if (['fail', 'growth', 'fail_growth', 'failgrowth', 'elementary_fail', 'kinder_fail'].includes(type)) return 'fail_feedbacks';
  return 'feedbacks';
}


function resetGrowthFeedbackAfterSuccessfulSave(studentDivision) {
  try {
    if (studentDivision === 'kinder' && typeof resetKinderChatFeedbackGrowthSheet === 'function') {
      resetKinderChatFeedbackGrowthSheet();
    }
  } catch (err) {
    console.warn('growth feedback reset skipped:', err);
  }
}

async function autoSaveGeneratedFeedback(text, options = {}, btn = null) {
  const content = String(text || '').trim();
  const rawType = options.feedbackType || currentSaveType || 'class';
  const tableName = getFeedbackTableNameByType(rawType);
  const feedbackType = tableName === 'fail_feedbacks' ? 'fail' : String(rawType || 'class').toLowerCase();
  const studentDivision = options.studentDivision === 'kinder' ? 'kinder' : 'elementary';
  const name = (options.studentName || getStudentNameForAutoFeedbackSave(studentDivision)).trim();
  const selectedStudentId = options.studentId || options.student_id || '';

  if (!name) { alert('아이 이름을 찾지 못했어요. 설문지의 아이 이름을 입력해 주세요.'); return; }
  if (!content) { alert('저장할 피드백 내용이 비어 있어요.'); return; }

  const year = new Date().getFullYear();
  const date = new Date().toLocaleDateString('ko-KR');

  try {
    if (btn) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent || '저장';
      btn.textContent = '저장 중...';
    }

    const savedStudent = await getOrCreateStudentForSupabaseSave(name, studentDivision, selectedStudentId);

    const feedbackPayload = addOlliAcademyToPayload({
      student_id: savedStudent.id,
      student_name: savedStudent.name || name,
      content,
      feedback_type: feedbackType,
      year,
      date,
      ...(options.clientRecordId ? { client_record_id: String(options.clientRecordId) } : {})
    }, tableName === 'fail_feedbacks' ? '실패·성장 피드백 저장' : '피드백 저장');
    const savedRow = await saveFeedbackRowVerified(tableName, feedbackPayload, tableName === 'fail_feedbacks' ? '실패·성장 피드백 저장' : '피드백 저장');

    // Do not turn a confirmed Supabase save into a failed save/retry simply
    // because refreshing the visible attendance list failed afterward.
    try { await refreshRecordsAfterFeedbackSave(); }
    catch (refreshError) { console.warn('저장된 피드백 목록 새로고침 실패:', refreshError); }
    closeFeedbackResultCardFromButton(btn);
    if (tableName === 'fail_feedbacks' && typeof resetGrowthFeedbackAfterSuccessfulSave === 'function') {
      resetGrowthFeedbackAfterSuccessfulSave(studentDivision);
    }
    return savedRow || true;
  } catch (err) {
    console.error('피드백 저장 오류:', err);
    alert(`저장 중 오류가 발생했어요.\n\n${err.message || '알 수 없는 오류입니다.'}`);
    return false;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || '저장';
      delete btn.dataset.originalText;
    }
  }
}
window.autoSaveGeneratedFeedback = autoSaveGeneratedFeedback;


function addRecordSummaryPopup(text, label = '종합 피드백', options = {}) {
  closeMemoFeedbackPopup();
  const safeText = escapeHtml(text);
  const overlay = document.createElement('div');
  overlay.id = 'memoFeedbackPopupOverlay';
  overlay.className = 'memoFeedbackPopupOverlay recordSummaryPopupOverlay';
  overlay.innerHTML = `<div class="memoFeedbackPopupCard recordSummaryPopupCard">
    <div class="memoFeedbackPopupLabel">${escapeHtml(label)}</div>
    <div class="memoFeedbackPopupText">${safeText}</div>
    <div class="memoFeedbackPopupActions">
      <div class="memoFeedbackLeftActions">
        <button class="memoFeedbackIconBtn" onclick="enterMemoFeedbackEdit(this)" title="수정" aria-label="수정">
          <svg viewBox="0 0 24 24"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>
        </button>
        <button class="memoFeedbackIconBtn memoFeedbackEditSaveBtn" onclick="finishMemoFeedbackEdit(this)" title="수정 저장" aria-label="수정 저장">
          <svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"></path></svg>
        </button>
      </div>
      <div class="memoFeedbackRightActions">
        <button class="memoFeedbackActionBtn" onclick="closeMemoFeedbackPopup()">닫기</button>
        <button class="memoFeedbackActionBtn primary" onclick="saveRecordSummaryFromPopup(this)">저장</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const card = overlay.querySelector('.memoFeedbackPopupCard');
  if (card) {
    card._feedbackText = text;
    card._studentId = options.studentId || options.student_id || '';
    card._studentName = options.studentName || '';
    card._studentDivision = options.studentDivision || 'elementary';
    card._summaryMonths = options.months || '';
  }
}

async function saveRecordSummaryFromPopup(btn) {
  const card = btn?.closest?.('.memoFeedbackPopupCard');
  const content = String(card?._feedbackText || '').trim();
  const studentId = String(card?._studentId || '').trim();
  const studentName = String(card?._studentName || '').trim();
  const studentDivision = card?._studentDivision === 'kinder' ? 'kinder' : 'elementary';
  const months = card?._summaryMonths || '';

  if (!content) { alert('저장할 종합 피드백 내용이 비어 있어요.'); return; }
  if (!studentName) { currentSaveType = 'summary'; openSaveModal(content); return; }

  const year = new Date().getFullYear();
  const date = new Date().toLocaleDateString('ko-KR');

  try {
    if (btn) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent || '저장';
      btn.textContent = '저장 중...';
    }

    const savedStudent = await getOrCreateStudentForSupabaseSave(studentName, studentDivision, studentId);
    const summaryPayload = addOlliAcademyToPayload({
      student_id: savedStudent.id,
      student_name: savedStudent.name || studentName,
      content,
      summary_months: months ? Number(months) : null,
      year,
      date
    }, '종합 피드백 저장');
    await saveFeedbackRowVerified('summary_feedbacks', summaryPayload, '종합 피드백 저장');

    await refreshRecordsAfterFeedbackSave();
    closeMemoFeedbackPopup();
  } catch (err) {
    console.error('종합 피드백 저장 오류:', err);
    alert(`종합 피드백 저장 중 오류가 발생했어요.\n\n${err.message || '알 수 없는 오류입니다.'}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || '저장';
      delete btn.dataset.originalText;
    }
  }
}

window.saveRecordSummaryFromPopup = saveRecordSummaryFromPopup;

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
  if (!studentId && !studentName) throw new Error('상담 학생의 식별 정보가 없습니다.');
  const requestedTables = Array.isArray(options.sourceTables) && options.sourceTables.length
    ? options.sourceTables : ['feedbacks', 'fail_feedbacks'];
  const core = window.OlliStorageCore;
  if (!core?.FeatureRegistry || !core?.ServerAdapter) throw new Error('상담용 피드백 보호 조회 모듈이 준비되지 않았습니다.');
  const identity = { academyId };
  if (studentId) identity.studentId = studentId;
  else identity.student_name = studentName;
  const settled = await Promise.all(requestedTables.map(async table => {
    const spec = core.FeatureRegistry.require(getConsultationSecureFeedbackReadFeature(table));
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

const OLLI_CONSULTATION_SUMMARY_SNAPSHOT_FEATURE = 'consultation_summary_snapshot';
const academyConsultationSummaryState = {
  running: false,
  transientItems: {},
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

function normalizeAcademyConsultationSummarySignatureValue(value) {
  if (Array.isArray(value)) return value.map(normalizeAcademyConsultationSummarySignatureValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = normalizeAcademyConsultationSummarySignatureValue(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function getAcademyConsultationSummaryInputsSignature() {
  const rules = typeof getOlliConsultationRulesMap === 'function'
    ? getOlliConsultationRulesMap()
    : {};
  const groupFeedbackMonths = typeof readElementaryGroupFeedbackMonthsMap === 'function'
    ? readElementaryGroupFeedbackMonthsMap()
    : {};
  try {
    return JSON.stringify(normalizeAcademyConsultationSummarySignatureValue({
      rules,
      groupFeedbackMonths,
      // 상담 자료 준비 조건이 바뀌면 종전의 "자료부족" 판단을 재사용하지 않습니다.
      consultationMaterialsRevision: '20261023-secure-final-month-status-v2'
    }));
  } catch (_) {
    return '';
  }
}

function createEmptyAcademyConsultationSummarySnapshot() {
  return {
    version: 1,
    month_key: getAcademyConsultationMonthKey(),
    inputs_signature: getAcademyConsultationSummaryInputsSignature(),
    items: {}
  };
}

function readAcademyConsultationSummarySnapshot() {
  const academyId = (typeof getOlliCurrentAcademyId === 'function') ? String(getOlliCurrentAcademyId() || '').trim() : '';
  const empty = createEmptyAcademyConsultationSummarySnapshot();
  if (!academyId || typeof readOlliLocal !== 'function') return empty;

  try {
    const raw = readOlliLocal(
      OLLI_CONSULTATION_SUMMARY_SNAPSHOT_FEATURE,
      { academyId },
      { fallback: empty }
    );
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
    if (String(raw.month_key || '') !== empty.month_key) return empty;
    if (String(raw.inputs_signature || '') !== empty.inputs_signature) return empty;
    return {
      version: 1,
      month_key: empty.month_key,
      inputs_signature: empty.inputs_signature,
      items: raw.items && typeof raw.items === 'object' && !Array.isArray(raw.items) ? raw.items : {}
    };
  } catch (error) {
    console.warn('상담 준비상태 로컬 스냅샷 읽기 실패:', error?.message || error);
    return empty;
  }
}

function writeAcademyConsultationSummarySnapshot(snapshot) {
  const academyId = (typeof getOlliCurrentAcademyId === 'function') ? String(getOlliCurrentAcademyId() || '').trim() : '';
  if (!academyId || typeof writeOlliLocal !== 'function') return false;
  try {
    writeOlliLocal(
      OLLI_CONSULTATION_SUMMARY_SNAPSHOT_FEATURE,
      { academyId },
      snapshot,
      { syncStatus: 'synced', lastSyncedAt: new Date().toISOString(), retryCount: 0 }
    );
    return true;
  } catch (error) {
    console.warn('상담 준비상태 로컬 스냅샷 저장 실패:', error?.message || error);
    return false;
  }
}

function normalizeAcademyConsultationSummaryStableItem(item) {
  if (!item || typeof item !== 'object') return null;
  const status = String(item.status || '').trim();
  if (status !== 'ready' && status !== 'insufficient' && status !== 'error') return null;
  return {
    status,
    mode: String(item.mode || ''),
    content: String(item.content || ''),
    reason: String(item.reason || ((status === 'insufficient' || status === 'error') ? (item.error || '') : '') || ''),
    studentName: String(item.studentName || ''),
    studentDivision: item.studentDivision === 'kinder' ? 'kinder' : 'elementary',
    months: Number(item.months) || 1,
    updatedAt: String(item.updatedAt || '')
  };
}

function areAcademyConsultationSummaryStableItemsEqual(left, right) {
  const a = normalizeAcademyConsultationSummaryStableItem(left);
  const b = normalizeAcademyConsultationSummaryStableItem(right);
  if (!a || !b) return a === b;
  return a.status === b.status
    && a.mode === b.mode
    && a.content === b.content
    && a.reason === b.reason
    && a.studentName === b.studentName
    && a.studentDivision === b.studentDivision
    && a.months === b.months;
}

function getAcademyConsultationSummaryItemByKey(key) {
  const safeKey = String(key || '');
  const transient = academyConsultationSummaryState.transientItems[safeKey];
  if (transient) return transient;
  const snapshot = readAcademyConsultationSummarySnapshot();
  // 확인하지 않은 학생을 '자료부족'으로 표시하지 않습니다.
  return normalizeAcademyConsultationSummaryStableItem(snapshot.items[safeKey]) || { status: 'checking' };
}

function getAcademyConsultationSummaryItem(student, months) {
  return getAcademyConsultationSummaryItemByKey(getAcademyConsultationSummaryKey(student, months));
}

function setAcademyConsultationSummaryItem(key, patch) {
  const safeKey = String(key || '');
  if (!safeKey) return { item: { status: 'checking' }, changed: false, persisted: false };

  const previous = getAcademyConsultationSummaryItemByKey(safeKey);
  const next = {
    ...(previous || {}),
    ...(patch || {})
  };
  const stable = normalizeAcademyConsultationSummaryStableItem(next);

  if (!stable) {
    const previousTransient = academyConsultationSummaryState.transientItems[safeKey] || null;
    academyConsultationSummaryState.transientItems[safeKey] = next;
    const changed = JSON.stringify(previousTransient || {}) !== JSON.stringify(next);
    return { item: next, changed, persisted: false };
  }

  const snapshot = readAcademyConsultationSummarySnapshot();
  const previousStable = normalizeAcademyConsultationSummaryStableItem(snapshot.items[safeKey]);
  delete academyConsultationSummaryState.transientItems[safeKey];

  if (previousStable && areAcademyConsultationSummaryStableItemsEqual(previousStable, stable)) {
    return { item: previousStable, changed: false, persisted: true };
  }

  const stored = {
    ...stable,
    updatedAt: new Date().toISOString()
  };
  const nextSnapshot = {
    ...snapshot,
    version: 1,
    month_key: getAcademyConsultationMonthKey(),
    inputs_signature: getAcademyConsultationSummaryInputsSignature(),
    items: {
      ...(snapshot.items || {}),
      [safeKey]: stored
    }
  };
  const persisted = writeAcademyConsultationSummarySnapshot(nextSnapshot);
  return { item: stored, changed: true, persisted };
}

function pruneAcademyConsultationSummarySnapshot(validKeys) {
  const keep = new Set(Array.isArray(validKeys) ? validKeys.map(String) : []);
  const snapshot = readAcademyConsultationSummarySnapshot();
  const items = snapshot.items || {};
  const nextItems = {};
  let changed = false;

  Object.keys(items).forEach(key => {
    if (keep.has(key)) nextItems[key] = items[key];
    else changed = true;
  });
  Object.keys(academyConsultationSummaryState.transientItems).forEach(key => {
    if (!keep.has(key)) delete academyConsultationSummaryState.transientItems[key];
  });

  if (!changed) return false;
  return writeAcademyConsultationSummarySnapshot({
    ...snapshot,
    items: nextItems
  });
}

function getAcademyConsultationSummaryStatusLabel(status) {
  if (status === 'ready') return '준비완료';
  if (status === 'error') return '확인오류';
  if (status === 'checking') return '확인중';
  if (status === 'generating') return '생성중';
  return '자료부족';
}

function getAcademyConsultationSummaryDisplayStatus(status) {
  if (status === 'ready' || status === 'error' || status === 'checking' || status === 'generating') return status;
  return 'insufficient';
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
  if (!core?.FeatureRegistry || !core?.ServerAdapter) throw new Error('상담용 종합 피드백 보호 조회 모듈이 준비되지 않았습니다.');
  return core.ServerAdapter.read(core.FeatureRegistry.require('summary_feedback_records_read'),
    { academyId, studentId, student_name: studentName }, { limit });
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
  const item = getAcademyConsultationSummaryItemByKey(key) || {};
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
    content = item.reason || item.error || '상담용 종합 피드백 생성 중 오류가 발생했습니다.';
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
  if (typeof getConsultationDueTasksForStudent !== 'function') return null;
  const tasks = getConsultationDueTasksForStudent(student)
    .filter(task => task?.key && ['after_1','after_3','every_6','every_12'].includes(task.ruleKey))
    .sort((a,b) => Number(b.occurrenceMonths||0) - Number(a.occurrenceMonths||0));
  const months = Number(requestedMonths) || 0;
  return tasks.find(task => {
    const optionMonths = task.ruleKey === 'every_12' ? 12
      : task.ruleKey === 'every_6' ? 6 : task.ruleKey === 'after_3' ? 3 : 1;
    return !months || months === optionMonths;
  }) || tasks[0] || null;
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
  const students=getThisMonthConsultationDueStudents(getAcademyManagementStudentsForStats());
  const validKeys=students.map(student=>{
    const task=getConsultationSummaryServerTask(student);
    if(!task)return '';
    const months=task.ruleKey==='every_12'?12:task.ruleKey==='every_6'?6:task.ruleKey==='after_3'?3:1;
    return getAcademyConsultationSummaryKey(student,months);
  }).filter(Boolean);
  pruneAcademyConsultationSummarySnapshot(validKeys);
  academyConsultationSummaryState.running=true;
  let changed=false;
  try {
    for(const student of students) {
      if(currentRecordView!=='academy')break;
      const task=getConsultationSummaryServerTask(student);if(!task)continue;
      const months=task.ruleKey==='every_12'?12:task.ruleKey==='every_6'?6:task.ruleKey==='after_3'?3:1;
      const key=getAcademyConsultationSummaryKey(student,months);
      const basic={studentName:student.name,studentDivision:student.type,months};
      setAcademyConsultationSummaryItem(key,{...basic,status:'checking'});
      try {
        const value=await fetchConsultationSummaryFromServer(student,task);
        const status=value.status==='ready'?'ready':value.status==='insufficient'?'insufficient':'generating';
        const r=setAcademyConsultationSummaryItem(key,{
          ...basic,status,mode:value.mode||'',content:status==='ready'?String(value.content||''):'',
          reason:value.reason||''
        });
        changed=changed||r.changed;
      }catch(error){
        const r=setAcademyConsultationSummaryItem(key,{...basic,status:'error',reason:error.message||'서버 오류'});
        changed=changed||r.changed;
      }
    }
  }finally {
    academyConsultationSummaryState.running=false;
    if(changed) scheduleRecordAcademyManagementDashboardRender(120);
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
      status:'ready',mode:result.mode||'',content:String(result.content||''),
      studentName:student.name,studentDivision:student.type,months:summaryMonths
    });
    academyConsultationSummaryState.expandedKey=key;
    if(typeof renderRecordAcademyManagementDashboard==='function')renderRecordAcademyManagementDashboard();
  }catch(error){alert('종합 피드백 서버 확인 실패: '+(error.message||error));}
  finally{if(btn){btn.disabled=false;btn.textContent=btn.dataset.originalText||'상담 피드백';}}
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

