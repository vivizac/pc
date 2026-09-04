const OLLI_PAGE_NAMES = Object.freeze({
  mainPage: '1분 피드백 페이지',
  failGrowthPage: '실패 성장 페이지',
  recordRoom: '출석부 페이지',
  elementaryMemo: '초등부 노트',
  kinderMemo: '유치부 메모장'
});
const SUPABASE_URL = 'https://fvkxipjwgeyosgnfhdnx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2a3hpcGp3Z2V5b3NnbmZoZG54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MzAxMDUsImV4cCI6MjA5MTEwNjEwNX0.dqP0V2RIKBLWqXWfwJgCgufpO6gQ_lAZDQ_prOhlNI8';

async function supabase(method, path, body) {
  const upperMethod = String(method || 'GET').toUpperCase();
  const prefer = upperMethod === 'POST'
    ? (String(path).includes('on_conflict') ? 'resolution=merge-duplicates,return=representation' : 'return=representation')
    : (upperMethod === 'PATCH' || upperMethod === 'DELETE' ? 'return=representation' : '');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: upperMethod,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${getOlliAuthAccessToken ? (getOlliAuthAccessToken() || SUPABASE_KEY) : SUPABASE_KEY}`,
      ...(prefer ? { 'Prefer': prefer } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const responseText = await res.text();
  let data = null;
  try { data = responseText ? JSON.parse(responseText) : null; } catch { data = responseText; }
  if (!res.ok) {
    console.error('Supabase error:', { status: res.status, statusText: res.statusText, path, data });
    const detail =
      (data && typeof data === 'object' && (data.message || data.details || data.hint || data.code))
        ? [data.message, data.details, data.hint, data.code].filter(Boolean).join(' / ')
        : (typeof data === 'string' ? data : '');
    throw new Error(`Supabase 요청 실패 (${res.status})${detail ? '\n' + detail : ''}`);
  }
  return data ?? [];
}

const OLLI_STORAGE_ISSUES_KEY = 'olli_storage_issues_v1';
function getOlliStorageIssuesKey() {
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || 'unscoped';
  return `${OLLI_STORAGE_ISSUES_KEY}_${academyId}`;
}
function recordOlliStorageIssue(issue = {}) {
  try {
    const key = getOlliStorageIssuesKey();
    const current = JSON.parse(localStorage.getItem(key) || '[]');
    const list = Array.isArray(current) ? current : [];
    list.unshift({
      id: `storage_issue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      feature: String(issue.feature || 'unknown'),
      resource: String(issue.resource || ''),
      operation: String(issue.operation || ''),
      message: String(issue.message || ''),
      severity: String(issue.severity || 'error'),
      academy_id: (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || '',
      student_id: String(issue.student_id || ''),
      created_at: new Date().toISOString()
    });
    localStorage.setItem(key, JSON.stringify(list.slice(0, 200)));
  } catch (err) {
    console.warn('저장 진단 기록 실패:', err);
  }
}
function requireSupabaseWriteRow(rows, label, expected = {}) {
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || typeof row !== 'object') {
    const error = new Error(`${label} 요청은 전송됐지만 서버에서 저장된 행을 확인하지 못했습니다.`);
    recordOlliStorageIssue({ feature: label, operation: 'verify', message: error.message });
    throw error;
  }
  for (const [key, value] of Object.entries(expected || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (String(row[key] ?? '') !== String(value)) {
      const error = new Error(`${label} 서버 검증 실패: ${key} 값이 일치하지 않습니다.`);
      recordOlliStorageIssue({ feature: label, operation: 'verify', message: error.message, student_id: expected.student_id || '' });
      throw error;
    }
  }
  return row;
}
function getFeedbackCommonStorageFeature(tableName, payload = {}) {
  const table = String(tableName || '').trim();
  const academyId = String(payload.academy_id || '').trim();
  const studentId = String(payload.student_id || '').trim();
  if (!academyId || !studentId) return null;
  if (table === 'feedbacks') {
    return { feature: 'general_feedback', label: '일반 피드백', recordPrefix: 'feedback' };
  }
  if (table === 'fail_feedbacks') {
    return { feature: 'growth_feedback', label: '성장 피드백', recordPrefix: 'growth_feedback' };
  }
  if (table === 'summary_feedbacks') {
    return { feature: 'summary_feedback', label: '종합 피드백', recordPrefix: 'summary_feedback' };
  }
  return null;
}
function shouldUseGeneralFeedbackCommonStorage(tableName, payload = {}) {
  return !!getFeedbackCommonStorageFeature(tableName, payload) && String(tableName || '').trim() === 'feedbacks';
}
function shouldUseGrowthFeedbackCommonStorage(tableName, payload = {}) {
  return !!getFeedbackCommonStorageFeature(tableName, payload) && String(tableName || '').trim() === 'fail_feedbacks';
}
function shouldUseSummaryFeedbackCommonStorage(tableName, payload = {}) {
  return !!getFeedbackCommonStorageFeature(tableName, payload) && String(tableName || '').trim() === 'summary_feedbacks';
}
function createFeedbackCommonRecordId(payload = {}, commonFeature = null) {
  const prefix = commonFeature?.recordPrefix || 'feedback';
  return String(payload.id || payload.record_id || payload.client_record_id || `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
}
function createGeneralFeedbackRecordId(payload = {}) {
  return createFeedbackCommonRecordId(payload, { recordPrefix: 'feedback' });
}
function createGrowthFeedbackRecordId(payload = {}) {
  return createFeedbackCommonRecordId(payload, { recordPrefix: 'growth_feedback' });
}
function createSummaryFeedbackRecordId(payload = {}) {
  return createFeedbackCommonRecordId(payload, { recordPrefix: 'summary_feedback' });
}
function writeFeedbackCommonLocal(commonFeature, payload = {}, recordId = '', syncStatus = 'pending', row = null) {
  try {
    if (!commonFeature?.feature || typeof writeOlliLocal !== 'function') return;
    const academyId = String(payload.academy_id || '').trim();
    const studentId = String(payload.student_id || '').trim();
    const safeRecordId = String(recordId || row?.id || payload.id || payload.record_id || '').trim();
    if (!academyId || !studentId || !safeRecordId) return;
    writeOlliLocal(commonFeature.feature, {
      academyId,
      studentId,
      recordId: safeRecordId
    }, {
      ...(payload || {}),
      ...(row && typeof row === 'object' ? row : {}),
      client_record_id: safeRecordId
    }, {
      syncStatus,
      lastSyncedAt: syncStatus === 'synced' ? new Date().toISOString() : null,
      retryCount: 0
    });
  } catch (err) {
    console.warn(`${commonFeature?.label || '피드백'} 공통 로컬 캐시 기록 건너뜀:`, err);
  }
}
function writeGeneralFeedbackCommonLocal(payload = {}, recordId = '', syncStatus = 'pending', row = null) {
  writeFeedbackCommonLocal({ feature: 'general_feedback', label: '일반 피드백', recordPrefix: 'feedback' }, payload, recordId, syncStatus, row);
}
function writeGrowthFeedbackCommonLocal(payload = {}, recordId = '', syncStatus = 'pending', row = null) {
  writeFeedbackCommonLocal({ feature: 'growth_feedback', label: '성장 피드백', recordPrefix: 'growth_feedback' }, payload, recordId, syncStatus, row);
}
function writeSummaryFeedbackCommonLocal(payload = {}, recordId = '', syncStatus = 'pending', row = null) {
  writeFeedbackCommonLocal({ feature: 'summary_feedback', label: '종합 피드백', recordPrefix: 'summary_feedback' }, payload, recordId, syncStatus, row);
}
function enqueueFeedbackCommonSave(commonFeature, payload = {}, recordId = '', error = null) {
  try {
    const core = window.OlliStorageCore;
    if (!commonFeature?.feature || !core?.SyncQueue?.enqueue) return;
    const academyId = String(payload.academy_id || '').trim();
    if (!academyId) return;
    core.SyncQueue.enqueue({
      feature: commonFeature.feature,
      operation: 'create',
      academy_id: academyId,
      student_id: payload.student_id || null,
      record_id: recordId || payload.id || payload.record_id || null,
      client_mutation_id: recordId || undefined,
      payload,
      error_code: error && (error.code || 'SERVER_WRITE_FAILED') || 'SERVER_WRITE_FAILED',
      error_message: String(error && (error.message || error) || '')
    }, { coalesce: false });
  } catch (err) {
    console.warn(`${commonFeature?.label || '피드백'} 재전송 대기열 기록 건너뜀:`, err);
  }
}
function enqueueGeneralFeedbackCommonSave(payload = {}, recordId = '', error = null) {
  enqueueFeedbackCommonSave({ feature: 'general_feedback', label: '일반 피드백', recordPrefix: 'feedback' }, payload, recordId, error);
}
function enqueueGrowthFeedbackCommonSave(payload = {}, recordId = '', error = null) {
  enqueueFeedbackCommonSave({ feature: 'growth_feedback', label: '성장 피드백', recordPrefix: 'growth_feedback' }, payload, recordId, error);
}
function enqueueSummaryFeedbackCommonSave(payload = {}, recordId = '', error = null) {
  enqueueFeedbackCommonSave({ feature: 'summary_feedback', label: '종합 피드백', recordPrefix: 'summary_feedback' }, payload, recordId, error);
}

function isOlliPendingCommonSaveResult(result) {
  return !!(result && result.pending && result.localSaved && !result.serverSaved);
}
function makeOlliPendingRow(payload = {}, recordId = '') {
  const row = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? { ...payload } : {};
  const safeId = String(recordId || row.id || row.client_record_id || row.record_id || '').trim();
  if (safeId && !row.id) row.id = safeId;
  if (safeId && !row.client_record_id) row.client_record_id = safeId;
  row.__pending_sync = true;
  row.__pending_saved_at = new Date().toISOString();
  return row;
}
function getOlliCommonSaveErrorMessage(label, result, fallbackMessage) {
  if (isOlliPendingCommonSaveResult(result)) {
    return `${label || '저장'} 서버 저장은 대기열에 기록되었습니다.`;
  }
  if (result && result.error) return String(result.error.message || result.error || '');
  if (result && result.errorCode) return String(result.errorCode);
  return fallbackMessage || `${label || '저장'} 서버 저장이 완료되지 않았습니다.`;
}
async function saveGeneralFeedbackViaCommonStorage(tableName, payload = {}, label = '일반 피드백 저장') {
  if (!shouldUseGeneralFeedbackCommonStorage(tableName, payload)) return null;
  if (typeof saveOlliData !== 'function') {
    const error = new Error('일반 피드백 공통 저장 함수가 준비되지 않았습니다.');
    recordOlliStorageIssue({ feature: 'general_feedback', resource: 'feedbacks', operation: 'save', message: error.message, student_id: payload.student_id || '' });
    throw error;
  }
  const commonFeature = { feature: 'general_feedback', label: '일반 피드백', recordPrefix: 'feedback' };
  const commonRecordId = createGeneralFeedbackRecordId(payload);
  const academyId = String(payload.academy_id || '').trim();
  const studentId = String(payload.student_id || '').trim();
  if (!academyId || !studentId) {
    const error = new Error(`${label} 저장 식별값이 없습니다.`);
    recordOlliStorageIssue({ feature: 'general_feedback', resource: 'feedbacks', operation: 'save', message: error.message, student_id: studentId });
    throw error;
  }
  const data = { ...payload, client_record_id: commonRecordId };
  const result = await saveOlliData('general_feedback', {
    academyId,
    studentId,
    recordId: commonRecordId,
    forceCommon: true,
    data
  });
  if (isOlliPendingCommonSaveResult(result)) {
    const pendingRow = makeOlliPendingRow(data, commonRecordId);
    writeFeedbackCommonLocal(commonFeature, data, commonRecordId, 'pending', pendingRow);
    return pendingRow;
  }
  if (!result || !result.serverSaved || !result.verified) {
    const error = result && result.error
      ? result.error
      : new Error(`${label} 서버 저장이 완료되지 않았습니다.${result && result.pending ? ' 재전송 대기열에 기록되었습니다.' : ''}`);
    recordOlliStorageIssue({ feature: 'general_feedback', resource: 'feedbacks', operation: 'save', message: String(error && (error.message || error) || ''), student_id: studentId });
    throw error;
  }
  const row = result.serverRow || (Array.isArray(result.serverRows) ? result.serverRows[0] : result.serverRows) || null;
  if (!row || typeof row !== 'object') {
    const error = new Error(`${label} 서버 저장 행을 확인하지 못했습니다.`);
    recordOlliStorageIssue({ feature: 'general_feedback', resource: 'feedbacks', operation: 'verify', message: error.message, student_id: studentId });
    throw error;
  }
  if (String(row.content || '') !== String(payload.content || '')) {
    const error = new Error(`${label} 서버 검증 실패: 피드백 내용이 일치하지 않습니다.`);
    recordOlliStorageIssue({ feature: 'general_feedback', resource: 'feedbacks', operation: 'verify', message: error.message, student_id: studentId });
    throw error;
  }
  writeFeedbackCommonLocal(commonFeature, data, commonRecordId, 'synced', row);
  return row;
}
async function saveGrowthFeedbackViaCommonStorage(tableName, payload = {}, label = '성장 피드백 저장') {
  if (!shouldUseGrowthFeedbackCommonStorage(tableName, payload)) return null;
  if (typeof saveOlliData !== 'function') {
    const error = new Error('성장 피드백 공통 저장 함수가 준비되지 않았습니다.');
    recordOlliStorageIssue({ feature: 'growth_feedback', resource: 'fail_feedbacks', operation: 'save', message: error.message, student_id: payload.student_id || '' });
    throw error;
  }
  const commonFeature = { feature: 'growth_feedback', label: '성장 피드백', recordPrefix: 'growth_feedback' };
  const commonRecordId = createGrowthFeedbackRecordId(payload);
  const academyId = String(payload.academy_id || '').trim();
  const studentId = String(payload.student_id || '').trim();
  if (!academyId || !studentId) {
    const error = new Error(`${label} 저장 식별값이 없습니다.`);
    recordOlliStorageIssue({ feature: 'growth_feedback', resource: 'fail_feedbacks', operation: 'save', message: error.message, student_id: studentId });
    throw error;
  }
  const data = { ...payload, client_record_id: commonRecordId };
  const result = await saveOlliData('growth_feedback', {
    academyId,
    studentId,
    recordId: commonRecordId,
    forceCommon: true,
    data
  });
  if (isOlliPendingCommonSaveResult(result)) {
    const pendingRow = makeOlliPendingRow(data, commonRecordId);
    writeFeedbackCommonLocal(commonFeature, data, commonRecordId, 'pending', pendingRow);
    return pendingRow;
  }
  if (!result || !result.serverSaved || !result.verified) {
    const error = result && result.error
      ? result.error
      : new Error(`${label} 서버 저장이 완료되지 않았습니다.${result && result.pending ? ' 재전송 대기열에 기록되었습니다.' : ''}`);
    recordOlliStorageIssue({ feature: 'growth_feedback', resource: 'fail_feedbacks', operation: 'save', message: String(error && (error.message || error) || ''), student_id: studentId });
    throw error;
  }
  const row = result.serverRow || (Array.isArray(result.serverRows) ? result.serverRows[0] : result.serverRows) || null;
  if (!row || typeof row !== 'object') {
    const error = new Error(`${label} 서버 저장 행을 확인하지 못했습니다.`);
    recordOlliStorageIssue({ feature: 'growth_feedback', resource: 'fail_feedbacks', operation: 'verify', message: error.message, student_id: studentId });
    throw error;
  }
  if (String(row.content || '') !== String(payload.content || '')) {
    const error = new Error(`${label} 서버 검증 실패: 피드백 내용이 일치하지 않습니다.`);
    recordOlliStorageIssue({ feature: 'growth_feedback', resource: 'fail_feedbacks', operation: 'verify', message: error.message, student_id: studentId });
    throw error;
  }
  writeFeedbackCommonLocal(commonFeature, data, commonRecordId, 'synced', row);
  return row;
}

async function saveSummaryFeedbackViaCommonStorage(tableName, payload = {}, label = '종합 피드백 저장') {
  if (!shouldUseSummaryFeedbackCommonStorage(tableName, payload)) return null;
  if (typeof saveOlliData !== 'function') {
    const error = new Error('종합 피드백 공통 저장 함수가 준비되지 않았습니다.');
    recordOlliStorageIssue({ feature: 'summary_feedback', resource: 'summary_feedbacks', operation: 'save', message: error.message, student_id: payload.student_id || '' });
    throw error;
  }
  const commonFeature = { feature: 'summary_feedback', label: '종합 피드백', recordPrefix: 'summary_feedback' };
  const commonRecordId = createSummaryFeedbackRecordId(payload);
  const academyId = String(payload.academy_id || '').trim();
  const studentId = String(payload.student_id || '').trim();
  if (!academyId || !studentId) {
    const error = new Error(`${label} 저장 식별값이 없습니다.`);
    recordOlliStorageIssue({ feature: 'summary_feedback', resource: 'summary_feedbacks', operation: 'save', message: error.message, student_id: studentId });
    throw error;
  }
  const data = { ...payload, client_record_id: commonRecordId };
  const result = await saveOlliData('summary_feedback', {
    academyId,
    studentId,
    recordId: commonRecordId,
    forceCommon: true,
    data
  });
  if (isOlliPendingCommonSaveResult(result)) {
    const pendingRow = makeOlliPendingRow(data, commonRecordId);
    writeFeedbackCommonLocal(commonFeature, data, commonRecordId, 'pending', pendingRow);
    return pendingRow;
  }
  if (!result || !result.serverSaved || !result.verified) {
    const error = result && result.error
      ? result.error
      : new Error(`${label} 서버 저장이 완료되지 않았습니다.${result && result.pending ? ' 재전송 대기열에 기록되었습니다.' : ''}`);
    recordOlliStorageIssue({ feature: 'summary_feedback', resource: 'summary_feedbacks', operation: 'save', message: String(error && (error.message || error) || ''), student_id: studentId });
    throw error;
  }
  const row = result.serverRow || (Array.isArray(result.serverRows) ? result.serverRows[0] : result.serverRows) || null;
  if (!row || typeof row !== 'object') {
    const error = new Error(`${label} 서버 저장 행을 확인하지 못했습니다.`);
    recordOlliStorageIssue({ feature: 'summary_feedback', resource: 'summary_feedbacks', operation: 'verify', message: error.message, student_id: studentId });
    throw error;
  }
  if (String(row.content || '') !== String(payload.content || '')) {
    const error = new Error(`${label} 서버 검증 실패: 피드백 내용이 일치하지 않습니다.`);
    recordOlliStorageIssue({ feature: 'summary_feedback', resource: 'summary_feedbacks', operation: 'verify', message: error.message, student_id: studentId });
    throw error;
  }
  writeFeedbackCommonLocal(commonFeature, data, commonRecordId, 'synced', row);
  return row;
}

async function saveFeedbackRowVerified(tableName, payload, label) {
  if (shouldUseGeneralFeedbackCommonStorage(tableName, payload)) {
    return await saveGeneralFeedbackViaCommonStorage(tableName, payload, label || '일반 피드백 저장');
  }
  if (shouldUseGrowthFeedbackCommonStorage(tableName, payload)) {
    return await saveGrowthFeedbackViaCommonStorage(tableName, payload, label || '성장 피드백 저장');
  }
  if (shouldUseSummaryFeedbackCommonStorage(tableName, payload)) {
    return await saveSummaryFeedbackViaCommonStorage(tableName, payload, label || '종합 피드백 저장');
  }

  const table = String(tableName || '').trim();
  const protectedFeedbackTables = new Set(['feedbacks', 'fail_feedbacks', 'summary_feedbacks']);
  if (protectedFeedbackTables.has(table)) {
    const error = new Error(`${label || table} 공통 저장 식별값이 부족하거나 공통 저장 경로가 준비되지 않았습니다.`);
    recordOlliStorageIssue({
      feature: 'feedback_common_only',
      resource: table,
      operation: 'save',
      message: error.message,
      student_id: payload?.student_id || ''
    });
    throw error;
  }

  const error = new Error(`등록되지 않은 피드백 테이블 직접 저장은 허용되지 않습니다: ${table || 'unknown'}`);
  recordOlliStorageIssue({
    feature: 'feedback_unknown_table',
    resource: table || 'unknown',
    operation: 'save',
    message: error.message,
    student_id: payload?.student_id || ''
  });
  throw error;
}

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
const KINDER_MEMO_PREFIX = 'olli_kinder_memo_';
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
    kinder_memo: KINDER_MEMO_PREFIX + id,
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

const RISK_NOTIFICATIONS_KEY = 'olli_risk_notifications_v1';
const LOCAL_MEMO_RETENTION_DAYS = 30;
const MEMO_AUTOSAVE_DELAY = 1000;


const ELEMENTARY_FEEDBACK_SYSTEM_PROMPT = `당신은 비비작아이성향미술학원의 초등 수업 기록을 바탕으로 학부모에게 전달할 초등 수업 피드백을 작성하는 AI입니다.

[역할]
- 초등부 분석 설문지에 저장된 선택 데이터와 선생님 직접 메모를 함께 읽고, 학부모가 이해하기 쉬운 따뜻한 피드백으로 정리합니다.
- 선생님이 선택한 키워드를 그대로 나열하지 말고, 아이의 수업 장면과 성장 흐름이 느껴지도록 자연스러운 문장으로 바꿉니다.
- 아이를 평가하거나 단정하지 말고, 어느 수업 단계에서 막혔고 선생님이 어떻게 도왔으며 다음에는 어떤 방향으로 이어갈지 설명합니다.

[반드시 반영할 내용]
1. 오늘 아이의 강점
2. 오늘 가장 지도가 필요했던 부분
3. 막힘이 생긴 수업 단계
4. 아이를 망설이게 한 성향 단서
5. 핵심 지도 영역
6. 선생님이 적용한 지도 방식
7. 앞으로의 지도 방향
8. 선생님 직접 메모: 아이가 한 말, 실제 개입 순간, 작품 특징, 최근 성장, 학부모에게 전할 성장 포인트

[출력 규칙]
- 답변 맨 앞에 반드시 [TYPE:CLASS] 붙입니다.
- 문단은 학부모가 읽기 좋게 짧게 나눕니다.
- 전문성은 드러내되, 어렵고 차가운 진단어는 피합니다.
- 마지막에는 다음 수업에서 이어갈 방향을 1~2문장으로 자연스럽게 정리합니다.
- "이렇게 작성했습니다" 같은 AI의 설명은 넣지 않습니다.`;

const KINDER_ONE_MONTH_PROMPT_TYPE = 'kinder_one_month';
const KINDER_ONE_MONTH_CONSULTATION_PROMPT = `당신은 비비작아이성향미술학원의 유치부 1개월 상담 피드백을 작성하는 AI입니다.

이 피드백은 6개월·12개월 종합 성장 피드백이 아닙니다.\
한 달이라는 짧은 기간 동안 아이가 크게 성장했다고 단정하거나, 장기적인 변화를 분석하는 글을 쓰면 안 됩니다.

유치부 1개월 상담의 목적은 다음과 같습니다.

1. 아이가 처음 한 달 동안 수업 환경에 어떻게 적응하고 있는지 학부모에게 알려준다.
2. 선생님이 관찰한 아이의 성향 단서를 따뜻하게 정리한다.
3. 아이가 미술 활동을 받아들이는 방식, 재료를 탐색하는 방식, 표현을 시작하는 방식을 설명한다.
4. 아직 도움이 필요한 부분이 있다면 문제처럼 표현하지 말고, 앞으로 도와갈 방향으로 부드럽게 전달한다.
5. 학부모가 “우리 아이를 잘 보고 있구나”, “앞으로 믿고 맡겨도 되겠다”고 느낄 수 있게 작성한다.

작성할 때 가장 중요한 관점은 “성장 결과”가 아니라 “초기 적응 관찰”입니다.

다음 표현은 되도록 사용하지 마세요.

- 크게 성장했습니다
- 눈에 띄게 발전했습니다
- 변화가 뚜렷합니다
- 이전보다 훨씬 좋아졌습니다
- 확실히 달라졌습니다
- 실력이 향상되었습니다

대신 다음과 같은 표현을 사용하세요.

- 조금씩 익숙해지고 있습니다
- 수업 흐름을 받아들이는 모습이 보입니다
- 새로운 환경을 살피며 적응해가는 과정입니다
- 이런 성향 단서가 관찰됩니다
- 편안해졌을 때 표현이 자연스럽게 나오는 모습이 있습니다
- 앞으로는 이런 방향으로 도와가겠습니다

피드백은 아래 흐름으로 작성합니다.

1. 첫 한 달 동안의 수업 적응 모습\
   아이의 수업 입장, 교실 분위기 적응, 선생님과의 관계, 재료를 접하는 태도, 활동을 시작하는 모습을 중심으로 설명합니다.\
   아이를 평가하지 말고, “어떻게 수업을 받아들이고 있는지”를 관찰문처럼 적습니다.

2. 아이에게서 보인 성향 단서\
   신중함, 호기심, 낯가림, 표현 욕구, 관찰 후 시도, 칭찬에 대한 반응, 선택 상황에서의 모습, 친구를 의식하는 정도 등 수업 중 관찰된 성향을 정리합니다.\
   단정하지 말고 “현재는 ~한 모습이 관찰됩니다”, “~한 경향이 보입니다”처럼 부드럽게 표현합니다.

3. 미술 활동을 대하는 방식\
   색을 고르는 방식, 선을 긋는 방식, 재료를 만지는 태도, 공간을 채우는 방식, 자기 생각을 그림으로 옮기는 방식 등을 설명합니다.\
   기술 평가처럼 쓰지 말고, 아이가 표현을 시작하는 방식을 설명합니다.

4. 수업 중 도움이 필요했던 부분\
   망설임, 선택의 어려움, 낯선 재료에 대한 조심스러움, 도움 요청의 어려움, 마무리 집중, 친구와 비교하는 모습 등이 있다면 부정적으로 쓰지 않습니다.\
   “아직 부족합니다”가 아니라 “이 부분은 앞으로 수업에서 천천히 도와가고 있습니다”라고 표현합니다.

5. 앞으로의 지도 방향\
   앞으로 선생님이 어떤 방식으로 도와줄지 구체적으로 씁니다.\
   예를 들어 선택지를 줄여주기, 작은 시도부터 인정해주기, 편안한 분위기 만들기, 재료 탐색 시간을 충분히 주기, 표현을 말로 설명할 수 있게 돕기, 자신감을 쌓게 하기 등의 방향을 제시합니다.

문체 규칙은 다음과 같습니다.

- 학부모에게 보내는 상담 피드백처럼 따뜻하고 신뢰감 있게 작성합니다.
- 너무 짧게 쓰지 말고, 충분히 구체적으로 작성합니다.
- 문장은 부드럽고 자연스럽게 씁니다.
- 전문성은 느껴지게 하되, 어려운 발달 용어나 진단처럼 보이는 말은 피합니다.
- 아이의 성향을 단정하지 않습니다.
- “문제”, “부족”, “느림”, “소극적”, “산만” 같은 표현은 직접적으로 쓰지 않습니다.
- 필요하면 “조심스럽게 탐색하는 모습”, “천천히 익숙해지는 과정”, “도움이 주어졌을 때 안정적으로 시도하는 모습”처럼 바꿔 표현합니다.
- 학부모가 불안해하지 않도록, 관찰 내용 뒤에는 반드시 지도 방향을 함께 제시합니다.
- 결과물의 완성도보다 수업 과정, 적응, 시도, 표현 태도를 중심으로 작성합니다.

글의 구조는 다음처럼 작성합니다.

제목은 쓰지 않습니다.\
단락은 4~5개로 나눕니다.

1문단: 첫 한 달 동안의 수업 적응 모습\
2문단: 아이의 성향 단서와 수업 태도\
3문단: 미술 표현 방식과 재료 탐색 모습\
4문단: 도움이 필요한 부분과 선생님의 지도 방식\
5문단: 앞으로의 지도 방향과 학부모에게 전하는 안정감 있는 마무리

마지막 문단은 반드시 앞으로의 지도 방향으로 마무리합니다.

좋은 마무리 예시는 다음과 같습니다.

- 앞으로도 ○○이가 수업 안에서 편안하게 선택하고 표현할 수 있도록, 작은 시도부터 충분히 인정받는 경험을 쌓아가겠습니다.
- 다음 수업에서도 ○○이가 낯선 재료와 활동을 조금씩 편안하게 받아들이며 자기 표현을 넓혀갈 수 있도록 세심하게 도와가겠습니다.
- ○○이가 자신만의 속도로 수업에 적응하고 표현을 시도할 수 있도록, 안정적인 분위기 안에서 꾸준히 관찰하며 지도하겠습니다.

출력 규칙:

- 답변 앞에 [TYPE]를 붙입니다.
- AI가 작성했다는 설명은 하지 않습니다.
- “아래는 피드백입니다” 같은 문장은 쓰지 않습니다.
- 피드백 본문만 작성합니다.
- 아이 이름이 주어졌다면 이름을 자연스럽게 사용합니다.
- 자료가 부족하더라도 억지로 성장했다고 쓰지 말고, 관찰 가능한 범위 안에서 적응과 지도 방향 중심으로 작성합니다.`;


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
let studentLongPressTimer = null;
let studentPressAnimTimer = null;
let studentPressAnimReleaseTimer = null;
let studentActionPopupTimer = null;
let studentLongPressStart = { x: 0, y: 0 };
let selectedStudentActionId = '';
let suppressNextStudentClick = false;
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
      date
    }, tableName === 'fail_feedbacks' ? '실패·성장 피드백 저장' : '피드백 저장');
    const savedRow = await saveFeedbackRowVerified(tableName, feedbackPayload, tableName === 'fail_feedbacks' ? '실패·성장 피드백 저장' : '피드백 저장');

    await refreshRecordsAfterFeedbackSave();
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
  const promptType = getConsultationFeedbackPromptType(student, months);
  if (promptType === KINDER_ONE_MONTH_PROMPT_TYPE) {
    return [
      { role: 'system', content: KINDER_ONE_MONTH_CONSULTATION_PROMPT },
      { role: 'user', content: userText }
    ];
  }
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
  let { res, data } = await fetchConsultationFeedbackByPromptType(promptType, messages);

  if (!res.ok && promptType === KINDER_ONE_MONTH_PROMPT_TYPE && res.status === 400) {
    ({ res, data } = await fetchConsultationFeedbackByPromptType('summary', messages));
  }

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

function setupNotificationOnboardingOnce() {
  if (!('Notification' in window)) return;
  if (localStorage.getItem('olli_notification_onboarding_done') === '1') return;
  if (Notification.permission !== 'default') {
    localStorage.setItem('olli_notification_onboarding_done', '1');
    return;
  }

  const requestOnFirstGesture = async () => {
    document.removeEventListener('click', requestOnFirstGesture, true);
    document.removeEventListener('touchend', requestOnFirstGesture, true);

    try {
      const permission = await Notification.requestPermission();
      localStorage.setItem('olli_notification_onboarding_done', '1');
      if (permission === 'granted') {
        new Notification('올리', { body: '알림 설정이 완료되었습니다.', tag: 'olli-notification-ready' });
      }
    } catch (err) {
      console.warn('notification onboarding skipped:', err);
    }
  };

  document.addEventListener('click', requestOnFirstGesture, true);
  document.addEventListener('touchend', requestOnFirstGesture, true);
}

document.addEventListener('DOMContentLoaded', setupNotificationOnboardingOnce);

function uid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function getCurrentYear() {
  return new Date().getFullYear();
}


const ELEMENTARY_GROUP_FEEDBACK_MONTHS_KEY = 'olli_elementary_group_feedback_months_v1';
const ELEMENTARY_GROUP_MONTH_VALUES = [1,2,3,4,5,6,7,8,9,10,11,12];

function normalizeElementaryGroupMonths(value) {
  let raw = value;
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return [...new Set(raw.map(v => Number(v)).filter(n => Number.isFinite(n) && n >= 1 && n <= 12))].sort((a,b) => a - b);
  if (typeof raw === 'number') return raw >= 1 && raw <= 12 ? [raw] : [];
  raw = String(raw || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return normalizeElementaryGroupMonths(parsed);
  } catch(e) {}
  return [...new Set(raw.split(/[^0-9]+/).map(v => Number(v)).filter(n => Number.isFinite(n) && n >= 1 && n <= 12))].sort((a,b) => a - b);
}

function elementaryGroupMonthsToText(months) {
  const normalized = normalizeElementaryGroupMonths(months);
  return normalized.length ? normalized.join(',') : '';
}

function getElementaryGroupFeedbackMonthsStorageKey() {
  const academyId = (typeof getOlliCurrentAcademyId === 'function') ? getOlliCurrentAcademyId() : '';
  return academyId ? `${ELEMENTARY_GROUP_FEEDBACK_MONTHS_KEY}_${academyId}` : ELEMENTARY_GROUP_FEEDBACK_MONTHS_KEY;
}

function normalizeElementaryGroupFeedbackMonthsMap(value) {
  let raw = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch(e) { raw = {}; }
  }
  const map = {};
  Object.keys(raw || {}).forEach(group => {
    const months = normalizeElementaryGroupMonths(raw[group]);
    if (months.length) map[String(group)] = months;
  });
  return map;
}

function readElementaryGroupFeedbackMonthsMap() {
  try {
    const academyId = (typeof getOlliCurrentAcademyId === 'function') ? getOlliCurrentAcademyId() : '';
    if (academyId && typeof readOlliLocal === 'function') {
      const common = readOlliLocal('elementary_group_feedback_months', { academyId }, { fallback: {} });
      const commonMap = normalizeElementaryGroupFeedbackMonthsMap(common);
      if (Object.keys(commonMap).length) return commonMap;
    }

    const shared = readOlliSharedSettingLocal(OLLI_SHARED_SETTINGS_KEY_GROUP_MONTHS, null);
    const sharedMap = normalizeElementaryGroupFeedbackMonthsMap(shared);
    if (Object.keys(sharedMap).length) return sharedMap;
    const parsed = JSON.parse(localStorage.getItem(getElementaryGroupFeedbackMonthsStorageKey()) || '{}');
    return normalizeElementaryGroupFeedbackMonthsMap(parsed);
  } catch(e) {
    return {};
  }
}

function writeElementaryGroupFeedbackMonthsMap(map, options = {}) {
  const next = normalizeElementaryGroupFeedbackMonthsMap(map);
  localStorage.setItem(getElementaryGroupFeedbackMonthsStorageKey(), JSON.stringify(next));
  writeOlliSharedSettingLocal(OLLI_SHARED_SETTINGS_KEY_GROUP_MONTHS, next);
  if (!options.skipServerSync) scheduleOlliSharedSettingSave(OLLI_SHARED_SETTINGS_KEY_GROUP_MONTHS, next);
}

function getElementaryGroupFeedbackMonths(group, student = null) {
  const groupKey = String(group || student?.group || '').trim();
  const saved = readElementaryGroupFeedbackMonthsMap();
  if (groupKey && Array.isArray(saved[groupKey]) && saved[groupKey].length) return saved[groupKey];
  return normalizeElementaryGroupMonths(student?.group_months || student?.feedback_months || student?.feedbackMonths || student?.groupFeedbackMonths || '');
}

function setElementaryGroupFeedbackMonths(group, months) {
  const groupKey = String(group || '').trim();
  if (!groupKey) return [];
  const map = readElementaryGroupFeedbackMonthsMap();
  const normalized = normalizeElementaryGroupMonths(months);
  if (normalized.length) map[groupKey] = normalized;
  else delete map[groupKey];
  writeElementaryGroupFeedbackMonthsMap(map);
  try {
    const all = getAllStudents().map(student => {
      if (student.type === 'elementary' && String(student.group || '').trim() === groupKey) {
        return { ...student, group_months: elementaryGroupMonthsToText(normalized), feedback_months: elementaryGroupMonthsToText(normalized) };
      }
      return student;
    });
    setAllStudents(all);
  } catch(e) {}
  return normalized;
}

function toggleElementaryGroupFeedbackMonth(group, month) {
  const groupKey = String(group || '').trim();
  if (!groupKey) return [];
  const current = getElementaryGroupFeedbackMonths(groupKey);
  const n = Number(month);
  const next = current.includes(n) ? current.filter(v => v !== n) : [...current, n];
  return setElementaryGroupFeedbackMonths(groupKey, next);
}

function getElementaryGroupFeedbackMonthDisplay(group, student = null) {
  const months = getElementaryGroupFeedbackMonths(group, student);
  if (!months.length) return '';
  const currentMonth = new Date().getMonth() + 1;
  const closestMonth = months
    .map(month => ({ month, distance: (month - currentMonth + 12) % 12 }))
    .sort((a, b) => a.distance - b.distance || a.month - b.month)[0]?.month;
  return closestMonth ? `발송월 ${closestMonth}월` : '';
}

function getElementaryCurrentFeedbackGroupRank(student) {
  const months = getElementaryGroupFeedbackMonths(student?.group, student);
  if (!months.length) return 2;
  const currentMonth = new Date().getMonth() + 1;
  return months.includes(currentMonth) ? 0 : 1;
}

function getElementaryNextFeedbackMonthDistance(student) {
  const months = getElementaryGroupFeedbackMonths(student?.group, student);
  if (!months.length) return 999;
  const currentMonth = new Date().getMonth() + 1;
  return Math.min(...months.map(month => (month - currentMonth + 12) % 12));
}

function compareElementaryGroupFeedbackOrder(a, b) {
  let result = getElementaryCurrentFeedbackGroupRank(a) - getElementaryCurrentFeedbackGroupRank(b);
  if (result !== 0) return result;
  result = getElementaryNextFeedbackMonthDistance(a) - getElementaryNextFeedbackMonthDistance(b);
  if (result !== 0) return result;
  result = safeRecordSortNumber(a?.group) - safeRecordSortNumber(b?.group);
  if (result !== 0) return result;
  return 0;
}

function migrateStudentStorageIfNeeded() {
  try {
    const raw = localStorage.getItem(STUDENTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(item => item && item.id)) return;
    }

    const legacyElementaryRaw = localStorage.getItem('olli_elementary_students_v2');
    const legacyKinderRaw = localStorage.getItem('olli_kinder_students_v2');
    const legacyElementary = legacyElementaryRaw ? JSON.parse(legacyElementaryRaw) : [];
    const legacyKinder = legacyKinderRaw ? JSON.parse(legacyKinderRaw) : [];

    const next = [];
    if (Array.isArray(legacyElementary)) {
      legacyElementary.forEach(item => {
        const normalized = normalizeStudentObject(item, 'elementary');
        normalized.id = normalized.id || uid();
        next.push(normalized);
      });
    }
    if (Array.isArray(legacyKinder)) {
      legacyKinder.forEach(item => {
        const normalized = normalizeStudentObject(item, 'kinder');
        normalized.id = normalized.id || uid();
        next.push(normalized);
      });
    }

    if (next.length) {
      localStorage.setItem(STUDENTS_KEY, JSON.stringify(next));
    }
  } catch (e) {
    console.error('student storage migration error:', e);
  }
}

function normalizeStudentObject(item, fallbackType = 'elementary') {
  if (typeof item === 'string') {
    return {
      id: uid(), type: fallbackType, name: item, year: getCurrentYear(), month: '', day: '',
      enrolled_at: '', kindergarten: '', age: '', birth_year: '', school_entry_year: '', previous_division: '', division_changed_at: '', lesson_day: '', lesson_time: '', class_time: '', teacher: '', homeroom_teacher: '', group: '', group_months: '', feedback_months: '', personality: '', school: '', grade: '', className: '', memoUpdatedAt: '', status: 'active'
    };
  }
  return {
    id: item?.id || uid(),
    type: item?.type || item?.division || fallbackType,
    name: item?.name || item?.student_name || '',
    year: Number(item?.year || getCurrentYear()),
    month: String(item?.month ?? '').trim(),
    day: String(item?.day ?? '').trim(),
    enrolled_at: item?.enrolled_at || '',
    kindergarten: item?.kindergarten || '',
    age: item?.age || '',
    birth_year: item?.birth_year || item?.birthYear || '',
    school_entry_year: item?.school_entry_year || item?.schoolEntryYear || '',
    previous_division: item?.previous_division || item?.previousDivision || '',
    division_changed_at: item?.division_changed_at || item?.divisionChangedAt || '',
    lesson_day: item?.lesson_day || item?.lessonDay || item?.class_day || '',
    lesson_time: item?.lesson_time || item?.lessonTime || item?.class_time || item?.classTime || '',
    class_time: item?.class_time || item?.classTime || item?.lesson_time || item?.lessonTime || '',
    teacher: item?.teacher || item?.homeroom_teacher || item?.teacher_name || '',
    homeroom_teacher: item?.homeroom_teacher || item?.teacher || item?.teacher_name || '',
    group: item?.group || item?.group_no || '',
    group_months: elementaryGroupMonthsToText(item?.group_months || item?.feedback_months || item?.feedbackMonths || item?.groupFeedbackMonths || ''),
    feedback_months: elementaryGroupMonthsToText(item?.feedback_months || item?.group_months || item?.feedbackMonths || item?.groupFeedbackMonths || ''),
    personality: item?.personality || '',
    school: item?.school || '',
    grade: item?.grade || '',
    className: item?.className || item?.class_no || '',
    memoUpdatedAt: item?.memoUpdatedAt || '',
    status: item?.status || 'active',
    is_deleted: item?.is_deleted === true || String(item?.is_deleted || '').toLowerCase() === 'true',
    deleted_at: item?.deleted_at || '',
    deleted_by: item?.deleted_by || '',
    delete_reason: item?.delete_reason || item?.reason || '',
    withdrawn_at: item?.withdrawn_at || item?.withdrawal_at || item?.quit_at || '',
    paused_at: item?.paused_at || item?.pause_at || '',
    status_changed_at: item?.status_changed_at || '',
    updated_at: item?.updated_at || '',
    academy_id: item?.academy_id || (getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : '')
  };
}

function getStudentsStorageKey() {
  const academyId = getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : '';
  return academyId ? `${STUDENTS_KEY}_${academyId}` : STUDENTS_KEY;
}

function getAllStudents() {
  try {
    const storageKey = getStudentsStorageKey();
    let raw = localStorage.getItem(storageKey);

    // 기존 단일 학원용 로컬 학생 데이터가 남아 있는 경우, 현재 학원 저장소로 1회 이동합니다.
    if (!raw && storageKey !== STUDENTS_KEY) {
      const legacyRaw = localStorage.getItem(STUDENTS_KEY);
      if (legacyRaw) {
        localStorage.setItem(storageKey, legacyRaw);
        raw = legacyRaw;
      }
    }

    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];

    const academyId = getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : '';
    return list
      .map(item => normalizeStudentObject({ ...item, academy_id: item?.academy_id || academyId }, item?.type || 'elementary'))
      .filter(student => !academyId || !student.academy_id || student.academy_id === academyId)
      .filter(student => !isOlliSoftDeletedRow(student));
  } catch {
    return [];
  }
}

function setAllStudents(list) {
  const academyId = getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : '';
  const safeList = Array.isArray(list)
    ? list
        .map(item => normalizeStudentObject({ ...item, academy_id: item?.academy_id || academyId }, item?.type || 'elementary'))
        .filter(student => !isOlliSoftDeletedRow(student))
    : [];
  localStorage.setItem(getStudentsStorageKey(), JSON.stringify(safeList));
}

function getStudentsByType(type) {
  return getAllStudents().filter(student => student.type === type);
}

function saveStudent(student, options = {}) {
  const academyId = getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : '';
  const safeStudent = normalizeStudentObject({ ...student, academy_id: student?.academy_id || academyId }, student?.type || 'elementary');
  unmarkDeletedStudentId(safeStudent.id);
  const list = getAllStudents();
  const idx = list.findIndex(item => item.id === safeStudent.id);
  if (idx === -1) list.push(safeStudent);
  else list[idx] = safeStudent;
  setAllStudents(list);
  if (options.skipRemote) return Promise.resolve(safeStudent);
  return saveStudentToSupabase(safeStudent);
}

function findStudentById(id) {
  return getAllStudents().find(student => student.id === id) || null;
}

function getStudentStatus(student) {
  const raw = String(student?.status || '').trim().toLowerCase();
  if (['paused', 'pause', 'rest', '휴원', '휴원생'].includes(raw)) return 'paused';
  if (['withdrawn', 'withdraw', 'quit', '퇴원', '퇴원생'].includes(raw)) return 'withdrawn';
  if (['inactive', 'deleted', 'removed', '삭제'].includes(raw)) return 'inactive';
  return 'active';
}

function getStudentStatusLabel(student) {
  const status = getStudentStatus(student);
  if (status === 'paused') return '휴원';
  if (status === 'withdrawn') return '퇴원';
  return '';
}

function getStudentStatusRank(student) {
  const status = getStudentStatus(student);
  if (status === 'paused') return 1;
  if (status === 'withdrawn') return 2;
  return 0;
}

function getCurrentMonthNumber() {
  return new Date().getMonth() + 1;
}

function getOlliAcademicYear(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  return (d.getMonth() + 1) >= 3 ? year : year - 1;
}

function inferOlliBirthYearFromAge(age, date = new Date()) {
  const n = Number(String(age || '').replace(/[^0-9]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  return date.getFullYear() - n + 1;
}

function inferOlliSchoolEntryYearFromGrade(grade, date = new Date()) {
  const n = Number(String(grade || '').replace(/[^0-9]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  return getOlliAcademicYear(date) - n + 1;
}

function getElementaryAgeFromGrade(grade) {
  const n = Number(String(grade || '').replace(/[^0-9]/g, ''));
  if (!Number.isFinite(n) || n < 1 || n > 6) return '';
  return String(n + 7);
}

function normalizeElementaryGradeValue(value) {
  const n = Number(String(value || '').replace(/[^0-9]/g, ''));
  if (!Number.isFinite(n) || n < 1 || n > 6) return '';
  return String(n);
}

function formatElementaryGradeInputValue(value) {
  const grade = normalizeElementaryGradeValue(value);
  return grade ? `${grade}학년` : '';
}

function formatElementaryAgeInputValue(value) {
  const n = Number(String(value || '').replace(/[^0-9]/g, ''));
  return Number.isFinite(n) && n > 0 ? `${n}살` : '';
}

function focusElementaryGradeInput(input) {
  if (!input) return;
  input.value = normalizeElementaryGradeValue(input.value);
  requestAnimationFrame(() => {
    try { input.select(); } catch(e) {}
  });
}

function blurStudentElementaryGradeInput() {
  const gradeInput = document.getElementById('studentGradeInput');
  const grade = normalizeElementaryGradeValue(gradeInput?.value || '');
  if (gradeInput) gradeInput.value = formatElementaryGradeInputValue(grade);
  const ageInput = document.getElementById('studentElementaryAgeInput');
  if (ageInput) ageInput.value = formatElementaryAgeInputValue(getElementaryAgeFromGrade(grade));
}

function blurElementaryInfoGradeInput() {
  const gradeInput = document.getElementById('elementaryGradeInput');
  const grade = normalizeElementaryGradeValue(gradeInput?.value || '');
  if (gradeInput) gradeInput.value = formatElementaryGradeInputValue(grade);
  const ageInput = document.getElementById('elementaryAgeInput');
  if (ageInput) ageInput.value = formatElementaryAgeInputValue(getElementaryAgeFromGrade(grade));
}

function syncStudentElementaryAgeFromGrade() {
  const gradeInput = document.getElementById('studentGradeInput');
  const ageInput = document.getElementById('studentElementaryAgeInput');
  const grade = normalizeElementaryGradeValue(gradeInput?.value || '');
  if (ageInput) ageInput.value = formatElementaryAgeInputValue(getElementaryAgeFromGrade(grade));
}

function syncElementaryInfoAgeFromGrade() {
  const gradeInput = document.getElementById('elementaryGradeInput');
  const ageInput = document.getElementById('elementaryAgeInput');
  const grade = normalizeElementaryGradeValue(gradeInput?.value || '');
  if (ageInput) ageInput.value = formatElementaryAgeInputValue(getElementaryAgeFromGrade(grade));
}

function applyOlliStudentLifecycle(student, date = new Date()) {
  if (!student) return { student, changed: false };
  const next = { ...student };
  let changed = false;

  let age = Number(String(next.age || '').replace(/[^0-9]/g, ''));
  let grade = Number(String(next.grade || '').replace(/[^0-9]/g, ''));

  // 나이 자동 갱신은 유치부에만 적용합니다.
  if (next.type === 'kinder') {
    let birthYear = Number(next.birth_year);
    if ((!birthYear || !Number.isFinite(birthYear)) && age > 0) {
      birthYear = inferOlliBirthYearFromAge(age, date);
      next.birth_year = String(birthYear);
      changed = true;
    }

    if (birthYear && Number.isFinite(birthYear)) {
      const expectedAge = date.getFullYear() - birthYear + 1;
      if (expectedAge > 0 && expectedAge < 30 && String(next.age || '') !== String(expectedAge)) {
        next.age = String(expectedAge);
        changed = true;
      }
    }
  }

  if (next.type === 'elementary') {
    let entryYear = Number(next.school_entry_year);
    if ((!entryYear || !Number.isFinite(entryYear)) && grade >= 1 && grade <= 6) {
      entryYear = inferOlliSchoolEntryYearFromGrade(grade, date);
      next.school_entry_year = String(entryYear);
      changed = true;
    }
    if (entryYear && Number.isFinite(entryYear)) {
      const expectedGrade = getOlliAcademicYear(date) - entryYear + 1;
      if (expectedGrade >= 1 && expectedGrade <= 6 && String(next.grade || '') !== String(expectedGrade)) {
        next.grade = String(expectedGrade);
        changed = true;
      }
    }

    const expectedAge = getElementaryAgeFromGrade(next.grade);
    if (expectedAge && String(next.age || '') !== expectedAge) {
      next.age = expectedAge;
      changed = true;
    }

    // 초등부의 기존 '반' 정보는 더 이상 사용하지 않습니다.
    if (next.className) {
      next.className = '';
      changed = true;
    }
  }

  return { student: next, changed };
}

function getKinderElementaryTransferCandidates(date = new Date()) {
  if ((date.getMonth() + 1) < 3) return [];
  return getStudentsByType('kinder').filter(student => {
    if (getStudentStatus(student) !== 'active') return false;
    const adjusted = applyOlliStudentLifecycle(student, date).student;
    return Number(adjusted?.age) >= 8;
  });
}

let olliStudentLifecycleSyncInFlight = false;
async function syncOlliStudentLifecycleAfterLoad() {
  if (olliStudentLifecycleSyncInFlight) return;
  olliStudentLifecycleSyncInFlight = true;
  try {
    const now = new Date();
    const current = getAllStudents();
    const changed = [];
    const next = current.map(student => {
      const result = applyOlliStudentLifecycle(student, now);
      if (result.changed) changed.push(result.student);
      return result.student;
    });
    if (!changed.length) return;
    setAllStudents(next);

    // 기준값과 갱신된 나이/학년을 서버에도 저장해 다른 기기에서도 동일하게 보이도록 합니다.
    if (isSupabaseConfigured()) {
      for (const student of changed) {
        try {
          await ensureStudentSavedToSupabase(student);
        } catch (err) {
          console.warn('학생 연도 자동 갱신 서버 저장 보류:', student?.name || student?.id || '', err?.message || err);
        }
      }
    }
  } finally {
    olliStudentLifecycleSyncInFlight = false;
  }
}

function getElementaryCycleGroups(students = getStudentsByType('elementary')) {
  const groups = [...new Set(
    students
      .filter(student => getStudentStatus(student) === 'active')
      .map(student => Number(student.group))
      .filter(group => Number.isFinite(group) && group > 0)
  )];
  return groups.sort((a, b) => a - b);
}

function getRotatingElementaryGroupRank(student, groups = null) {
  const groupNumber = Number(student?.group);
  const activeGroups = groups || getElementaryCycleGroups();

  if (!Number.isFinite(groupNumber) || !activeGroups.includes(groupNumber)) return 999;
  if (!activeGroups.length) return 999;

  // 3월을 첫 번째 그룹(A/1그룹)의 기준월로 잡습니다.
  // 예: A,B,C 3개 그룹이면 3월 A → 4월 B → 5월 C → 6월 A 순서입니다.
  const baseMonth = 3;
  const currentMonth = getCurrentMonthNumber();
  const topIndex = ((currentMonth - baseMonth) % activeGroups.length + activeGroups.length) % activeGroups.length;
  const groupIndex = activeGroups.indexOf(groupNumber);

  return (groupIndex - topIndex + activeGroups.length) % activeGroups.length;
}

function getKinderAgeRank(student) {
  const age = Number(student?.age);
  return Number.isFinite(age) && age > 0 ? age : 999;
}

const RECORD_SORT_BY_VIEW_KEY = 'olli_record_sort_settings_by_view_v3';
const RECORD_SORT_DAYS = ['월','화','수','목','금','토','일'];
const RECORD_SORT_DAY_NAMES = {0:'일',1:'월',2:'화',3:'수',4:'목',5:'금',6:'토'};

function readRecordSortState() {
  const fallback = { elementary: { criteria: 'initial' }, kinder: { criteria: 'initial' } };
  try {
    const parsed = JSON.parse(localStorage.getItem(RECORD_SORT_BY_VIEW_KEY) || '{}');
    return {
      elementary: Object.assign({}, fallback.elementary, parsed.elementary || {}),
      kinder: Object.assign({}, fallback.kinder, parsed.kinder || {})
    };
  } catch {
    return fallback;
  }
}
function getRecordSortCriteria(view) {
  const state = readRecordSortState();
  const criteria = (state[view] && state[view].criteria) || 'initial';
  if (criteria === 'lessonDayTeacher') return 'lessonDay';
  return criteria;
}
function cleanRecordSortText(value) {
  return String(value || '').trim();
}
function safeRecordSortNumber(value) {
  const match = cleanRecordSortText(value).match(/\d+/);
  const n = match ? Number(match[0]) : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 999;
}
function normalizeRecordSortTeacher(value) {
  return cleanRecordSortText(value).replace(/T$/i, '').trim();
}
function getRecordSortTeacherValue(student) {
  return normalizeRecordSortTeacher(student?.homeroom_teacher || student?.teacher || student?.teacher_name || student?.teacherName || '');
}
function getRecordSortTendencyValue(student) {
  return cleanRecordSortText(student?.tendency || student?.personality || student?.personalityType || student?.personality_type || student?.tendencyType || student?.tendency_type || student?.group_tendency || student?.type_label || student?.character || '');
}
function getRecordSortSchoolValue(student) {
  return cleanRecordSortText(student?.school || student?.elementary_school || student?.schoolName || '');
}
function getRecordSortGradeValue(student) {
  return cleanRecordSortText(student?.grade || student?.school_grade || student?.class_grade || '');
}
function getRecordSortKindergartenValue(student) {
  return cleanRecordSortText(student?.kindergarten || student?.school || '');
}
function normalizeRecordSortDayText(value) {
  return cleanRecordSortText(value).replace(/요일/g, '').replace(/[·,\/]/g, ' ');
}
function parseRecordSortDays(student) {
  const raw = normalizeRecordSortDayText(student?.lesson_day || student?.lessonDay || student?.days || student?.day || '');
  return RECORD_SORT_DAYS.filter(day => raw.includes(day));
}
function todayRecordSortDay() {
  return RECORD_SORT_DAY_NAMES[(new Date()).getDay()] || '월';
}
function todayRecordSortDayIndex() {
  const idx = RECORD_SORT_DAYS.indexOf(todayRecordSortDay());
  return idx < 0 ? 0 : idx;
}
function recordSortDayDistance(day) {
  const idx = RECORD_SORT_DAYS.indexOf(day);
  if (idx < 0) return 999;
  return (idx - todayRecordSortDayIndex() + RECORD_SORT_DAYS.length) % RECORD_SORT_DAYS.length;
}
function getRecordSortDayRank(student) {
  const selected = parseRecordSortDays(student);
  if (!selected.length) return 999;
  return Math.min(...selected.map(recordSortDayDistance));
}
function getPrimaryRecordSortDayLabel(student) {
  const selected = parseRecordSortDays(student);
  if (!selected.length) return '요일없음';
  return selected.slice().sort((a,b) => recordSortDayDistance(a) - recordSortDayDistance(b))[0] || selected[0];
}
function getRecordSortInitial(value) {
  const text = cleanRecordSortText(value);
  if (!text) return '힣';
  const code = text.charCodeAt(0);
  if (code >= 0xAC00 && code <= 0xD7A3) {
    const choseong = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
    return choseong[Math.floor((code - 0xAC00) / 588)] || text[0];
  }
  return text[0] || '힣';
}
function compareRecordSortName(a,b) {
  return cleanRecordSortText(a?.name).localeCompare(cleanRecordSortText(b?.name), 'ko');
}
function compareRecordSortString(a,b) {
  const av = cleanRecordSortText(a);
  const bv = cleanRecordSortText(b);
  if (!av && bv) return 1;
  if (av && !bv) return -1;
  return av.localeCompare(bv, 'ko');
}
function compareElementaryByRecordSort(a,b) {
  const criterion = getRecordSortCriteria('elementary');
  let result = 0;
  if (criterion === 'tendency') {
    result = (getRecordSortTendencyValue(a) ? 0 : 1) - (getRecordSortTendencyValue(b) ? 0 : 1);
    if (result !== 0) return result;
    result = compareRecordSortString(getRecordSortTendencyValue(a), getRecordSortTendencyValue(b));
  } else if (criterion === 'group') result = compareElementaryGroupFeedbackOrder(a,b);
  else if (criterion === 'grade') result = safeRecordSortNumber(getRecordSortGradeValue(a)) - safeRecordSortNumber(getRecordSortGradeValue(b));
  else if (criterion === 'school') result = compareRecordSortString(getRecordSortSchoolValue(a), getRecordSortSchoolValue(b));
  else if (criterion === 'lessonDay') result = getRecordSortDayRank(a) - getRecordSortDayRank(b);
  else if (criterion === 'teacher') result = compareRecordSortString(getRecordSortTeacherValue(a), getRecordSortTeacherValue(b));
  else result = getRecordSortInitial(a?.name).localeCompare(getRecordSortInitial(b?.name), 'ko');

  if (result !== 0) return result;
  if (criterion !== 'teacher') {
    const teacherResult = compareRecordSortString(getRecordSortTeacherValue(a), getRecordSortTeacherValue(b));
    if (teacherResult !== 0) return teacherResult;
  }
  if (criterion !== 'group') {
    const groupResult = compareElementaryGroupFeedbackOrder(a,b);
    if (groupResult !== 0) return groupResult;
  }
  if (criterion !== 'grade') {
    const gradeResult = safeRecordSortNumber(getRecordSortGradeValue(a)) - safeRecordSortNumber(getRecordSortGradeValue(b));
    if (gradeResult !== 0) return gradeResult;
  }
  return compareRecordSortName(a,b);
}
function compareKinderByRecordSort(a,b) {
  const criterion = getRecordSortCriteria('kinder');
  let result = 0;
  if (criterion === 'age') result = safeRecordSortNumber(a?.age) - safeRecordSortNumber(b?.age);
  else if (criterion === 'lessonDay') result = getRecordSortDayRank(a) - getRecordSortDayRank(b);
  else if (criterion === 'kindergarten') result = compareRecordSortString(getRecordSortKindergartenValue(a), getRecordSortKindergartenValue(b));
  else if (criterion === 'teacher') result = compareRecordSortString(getRecordSortTeacherValue(a), getRecordSortTeacherValue(b));
  else if (criterion === 'tendency') result = compareRecordSortString(getRecordSortTendencyValue(a), getRecordSortTendencyValue(b));
  else result = getRecordSortInitial(a?.name).localeCompare(getRecordSortInitial(b?.name), 'ko');

  if (result !== 0) return result;
  if (criterion !== 'teacher') {
    const teacherResult = compareRecordSortString(getRecordSortTeacherValue(a), getRecordSortTeacherValue(b));
    if (teacherResult !== 0) return teacherResult;
  }
  return compareRecordSortName(a,b);
}
function getRecordSortSectionKey(student, view) {
  try {
    if (typeof getStudentStatus === 'function' && getStudentStatus(student) !== 'active') return 'status:' + getStudentStatus(student);
  } catch {}
  if (view === 'elementary') {
    const criterion = getRecordSortCriteria('elementary');
    if (criterion === 'group') return 'group:' + (getElementaryCurrentFeedbackGroupRank(student) === 0 ? '이번달' : '일반') + ':' + (cleanRecordSortText(student?.group) || '그룹없음');
    if (criterion === 'lessonDay') return 'day:' + getPrimaryRecordSortDayLabel(student);
    if (criterion === 'teacher') return 'teacher:' + (getRecordSortTeacherValue(student) || '담임없음');
    if (criterion === 'tendency') return 'tendency:' + (getRecordSortTendencyValue(student) || '성향없음');
    if (criterion === 'grade') return 'grade:' + (getRecordSortGradeValue(student) || '학년없음');
    if (criterion === 'school') return 'school:' + (getRecordSortSchoolValue(student) || '학교없음');
    return 'initial:' + getRecordSortInitial(student?.name);
  }
  if (view === 'kinder') {
    const criterion = getRecordSortCriteria('kinder');
    if (criterion === 'lessonDay') return 'day:' + getPrimaryRecordSortDayLabel(student);
    if (criterion === 'teacher') return 'teacher:' + (getRecordSortTeacherValue(student) || '담임없음');
    if (criterion === 'tendency') return 'tendency:' + (getRecordSortTendencyValue(student) || '성향없음');
    if (criterion === 'age') return 'age:' + (cleanRecordSortText(student?.age) || '나이없음');
    if (criterion === 'kindergarten') return 'kindergarten:' + (getRecordSortKindergartenValue(student) || '유치원없음');
    return 'initial:' + getRecordSortInitial(student?.name);
  }
  return 'initial:' + getRecordSortInitial(student?.name);
}
function sortElementaryStudents(students) {
  return [...(students || [])].sort((a,b) => {
    const statusRank = getStudentStatusRank(a) - getStudentStatusRank(b);
    if (statusRank !== 0) return statusRank;
    return compareElementaryByRecordSort(a,b);
  });
}




function getElementaryGroupSectionKey(student, cycleGroups = null) {
  return getRecordSortSectionKey(student, 'elementary');
}

function sortKinderStudents(students) {
  return [...(students || [])].sort((a,b) => {
    const statusRank = getStudentStatusRank(a) - getStudentStatusRank(b);
    if (statusRank !== 0) return statusRank;
    return compareKinderByRecordSort(a,b);
  });
}

function sortStudentsForRecord(students) {
  const list = [...(students || [])];
  const hasElementary = list.some(student => student.type === 'elementary');
  const hasKinder = list.some(student => student.type === 'kinder');

  if (hasElementary && !hasKinder) return sortElementaryStudents(list);
  if (hasKinder && !hasElementary) return sortKinderStudents(list);

  const elementary = sortElementaryStudents(list.filter(student => student.type === 'elementary'));
  const kinder = sortKinderStudents(list.filter(student => student.type === 'kinder'));
  return [...elementary, ...kinder];
}

function getElementaryGroupLetter(group) {
  const map = { '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E', '6': 'F' };
  return map[String(group || '').trim()] || '';
}

/* elementary group icons: uploaded SVG set v6 */
const GROUP_ICON_IMAGES = {
  '1': `data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22108%22%20height%3D%22108%22%20viewBox%3D%220%200%20108%20108%22%20fill%3D%22none%22%3E%0A%20%20%3Cpolygon%20points%3D%2254.00%2C20.00%2083.44%2C37.00%2083.44%2C71.00%2054.00%2C88.00%2024.56%2C71.00%2024.56%2C37.00%22%20fill%3D%22none%22%20stroke%3D%22%23CFCFD4%22%20stroke-width%3D%224%22%20stroke-linejoin%3D%22round%22%2F%3E%0A%20%20%3Cpolygon%20points%3D%2254.00%2C39.00%2058.40%2C43.38%2064.61%2C43.39%2064.62%2C49.60%2069.00%2C54.00%2064.62%2C58.40%2064.61%2C64.61%2058.40%2C64.62%2054.00%2C69.00%2049.60%2C64.62%2043.39%2C64.61%2043.38%2C58.40%2039.00%2C54.00%2043.38%2C49.60%2043.39%2C43.39%2049.60%2C43.38%22%20fill%3D%22black%22%20stroke%3D%22black%22%20stroke-width%3D%228%22%20stroke-linejoin%3D%22round%22%2F%3E%0A%20%20%3Cpolygon%20points%3D%2254.00%2C46.00%2056.34%2C49.01%2060.00%2C48.00%2058.99%2C51.66%2062.00%2C54.00%2058.99%2C56.34%2060.00%2C60.00%2056.34%2C58.99%2054.00%2C62.00%2051.66%2C58.99%2048.00%2C60.00%2049.01%2C56.34%2046.00%2C54.00%2049.01%2C51.66%2048.00%2C48.00%2051.66%2C49.01%22%20fill%3D%22white%22%20stroke%3D%22white%22%20stroke-width%3D%223%22%20stroke-linejoin%3D%22round%22%2F%3E%0A%3C%2Fsvg%3E`,
  '2': `data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22108%22%20height%3D%22108%22%20viewBox%3D%220%200%20108%20108%22%20fill%3D%22none%22%3E%3Cpolygon%20points%3D%2254.00,20.00%2083.44,37.00%2083.44,71.00%2054.00,88.00%2024.56,71.00%2024.56,37.00%22%20fill%3D%22none%22%20stroke%3D%22%23CFCFD4%22%20stroke-width%3D%224%22%20stroke-linejoin%3D%22round%22%2F%3E%3Crect%20x%3D%2238%22%20y%3D%2234%22%20width%3D%228%22%20height%3D%2240%22%20rx%3D%224%22%20fill%3D%22black%22%2F%3E%3Crect%20x%3D%2250%22%20y%3D%2234%22%20width%3D%228%22%20height%3D%2240%22%20rx%3D%224%22%20fill%3D%22black%22%2F%3E%3Crect%20x%3D%2262%22%20y%3D%2234%22%20width%3D%228%22%20height%3D%2240%22%20rx%3D%224%22%20fill%3D%22black%22%2F%3E%3C%2Fsvg%3E`,
  '3': `data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22108%22%20height%3D%22108%22%20viewBox%3D%220%200%20108%20108%22%20fill%3D%22none%22%3E%3Cpolygon%20points%3D%2254.00,20.00%2083.44,37.00%2083.44,71.00%2054.00,88.00%2024.56,71.00%2024.56,37.00%22%20fill%3D%22none%22%20stroke%3D%22%23CFCFD4%22%20stroke-width%3D%224%22%20stroke-linejoin%3D%22round%22%2F%3E%3Ccircle%20cx%3D%2245%22%20cy%3D%2245%22%20r%3D%229%22%20fill%3D%22black%22%2F%3E%3Ccircle%20cx%3D%2263%22%20cy%3D%2245%22%20r%3D%229%22%20fill%3D%22black%22%2F%3E%3Ccircle%20cx%3D%2245%22%20cy%3D%2263%22%20r%3D%229%22%20fill%3D%22black%22%2F%3E%3Ccircle%20cx%3D%2263%22%20cy%3D%2263%22%20r%3D%229%22%20fill%3D%22black%22%2F%3E%3Crect%20x%3D%2245%22%20y%3D%2236%22%20width%3D%2218%22%20height%3D%2236%22%20rx%3D%229%22%20transform%3D%22rotate(45%2054%2054)%22%20fill%3D%22black%22%2F%3E%3Crect%20x%3D%2245%22%20y%3D%2236%22%20width%3D%2218%22%20height%3D%2236%22%20rx%3D%229%22%20transform%3D%22rotate(-45%2054%2054)%22%20fill%3D%22black%22%2F%3E%3C%2Fsvg%3E`,
  '4': `data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22108%22%20height%3D%22108%22%20viewBox%3D%220%200%20108%20108%22%20fill%3D%22none%22%3E%3Cpolygon%20points%3D%2254.00,20.00%2083.44,37.00%2083.44,71.00%2054.00,88.00%2024.56,71.00%2024.56,37.00%22%20fill%3D%22none%22%20stroke%3D%22%23CFCFD4%22%20stroke-width%3D%224%22%20stroke-linejoin%3D%22round%22%2F%3E%3Crect%20x%3D%2238%22%20y%3D%2238%22%20width%3D%2232%22%20height%3D%2232%22%20rx%3D%224%22%20fill%3D%22black%22%2F%3E%3Crect%20x%3D%2246%22%20y%3D%2246%22%20width%3D%2216%22%20height%3D%2216%22%20rx%3D%222%22%20fill%3D%22white%22%2F%3E%3C%2Fsvg%3E`,
  '5': `data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22108%22%20height%3D%22108%22%20viewBox%3D%220%200%20108%20108%22%20fill%3D%22none%22%3E%3Cpolygon%20points%3D%2254.00,20.00%2083.44,37.00%2083.44,71.00%2054.00,88.00%2024.56,71.00%2024.56,37.00%22%20fill%3D%22none%22%20stroke%3D%22%23CFCFD4%22%20stroke-width%3D%224%22%20stroke-linejoin%3D%22round%22%2F%3E%3Ccircle%20cx%3D%2244%22%20cy%3D%2244%22%20r%3D%228.5%22%20fill%3D%22black%22%2F%3E%3Ccircle%20cx%3D%2264%22%20cy%3D%2244%22%20r%3D%228.5%22%20fill%3D%22black%22%2F%3E%3Ccircle%20cx%3D%2244%22%20cy%3D%2264%22%20r%3D%228.5%22%20fill%3D%22black%22%2F%3E%3Ccircle%20cx%3D%2264%22%20cy%3D%2264%22%20r%3D%228.5%22%20fill%3D%22black%22%2F%3E%3C%2Fsvg%3E`,
  '6': `data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22108%22%20height%3D%22108%22%20viewBox%3D%220%200%20108%20108%22%20fill%3D%22none%22%3E%3Cpolygon%20points%3D%2254.00,20.00%2083.44,37.00%2083.44,71.00%2054.00,88.00%2024.56,71.00%2024.56,37.00%22%20fill%3D%22none%22%20stroke%3D%22%23CFCFD4%22%20stroke-width%3D%224%22%20stroke-linejoin%3D%22round%22%2F%3E%3Crect%20x%3D%2238%22%20y%3D%2238%22%20width%3D%2232%22%20height%3D%2232%22%20rx%3D%224%22%20fill%3D%22black%22%20transform%3D%22rotate(45%2054%2054)%22%2F%3E%3C%2Fsvg%3E`
};

const KINDER_LEAD_HEXAGON_ICON = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' fill='none'%3E%3Cpath d='M32 4 56 18v28L32 60 8 46V18L32 4Z' stroke='%23C5C5CB' stroke-width='3' stroke-linejoin='round'/%3E%3Cpath d='M18 46l14-9 14 9' stroke='%23C5C5CB' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E`;

function getElementaryGroupImageSrc(group) {
  return GROUP_ICON_IMAGES[String(group || '').trim()] || '';
}

function renderKinderLeadIcon(student) {
  if (studentSelectionMode) {
    return `<span class="${getSelectionCircleClass(student, 'kinderSignalCircle')}"></span>`;
  }
  return renderRecordAttendanceLeadIcon(student);
}

function renderRecordBoardLeadIcon() {
  return `<span class="recordBoardLeadIcon" aria-hidden="true">
    <svg class="recordBoardLeadIconSvg" xmlns="http://www.w3.org/2000/svg" width="36" height="35" viewBox="0 0 36 35" role="img" aria-label="record board toggle icon">
      <polygon points="20.5,5.5 31,11.7 31,23.8 20.5,30.5 10,23.8 10,11.7" fill="#efefef" stroke="#efefef" stroke-width="2" stroke-linejoin="round"/>
      <g class="recordBoardIconPlus">
        <path d="M20.5 12.8 L20.5 22.8" fill="none" stroke="#111111" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M15.5 17.8 L25.5 17.8" fill="none" stroke="#111111" stroke-width="1.6" stroke-linecap="round"/>
      </g>
      <g class="recordBoardIconMinus">
        <path d="M15.5 17.8 L25.5 17.8" fill="none" stroke="#111111" stroke-width="1.6" stroke-linecap="round"/>
      </g>
    </svg>
  </span>`;
}

function renderElementaryDefaultNoGroupIcon() {
  return `<span class="elementaryDefaultNoGroupIcon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="36" height="35" viewBox="0 0 36 35" role="img" aria-label="hexagon with center dot">
  <polygon points="20.5,5.5 31,11.7 31,23.8 20.5,30.5 10,23.8 10,11.7" fill="#ffffff" stroke="#d9d9d9" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="20.5" cy="17.8" r="6" fill="#000000"/>
</svg></span>`;
}

function renderGroupIconImage(group, className = 'elementaryGroupIcon') {
  const groupKey = String(group || '').trim();
  const src = getElementaryGroupImageSrc(groupKey);
  if (!src) return '';
  return `<span class="${className} group-${escapeHtml(groupKey)}" title="${escapeHtml(groupKey)}그룹"><img src="${src}" alt="그룹 아이콘"></span>`;
}

function initGroupChoiceIcons() {
  document.querySelectorAll('#elementaryGroupToggleRow .groupIconChoiceBtn').forEach(btn => {
    const group = btn.dataset.group;
    btn.textContent = getElementaryGroupLetter(group) || String(group || '').trim();
  });
}

function renderElementaryLeadIcon(student) {
  if (studentSelectionMode) {
    return `<span class="${getSelectionCircleClass(student, 'elementaryEmptyCircle')}"></span>`;
  }
  return renderKinderLeadIcon(student);
}

function getSelectionCircleClass(student, baseClass) {
  const classes = [baseClass];
  if (studentSelectionMode) classes.push('selectionCircle');
  if (selectedStudentIds.has(student.id)) classes.push('selected');
  return classes.join(' ');
}

function clearSelectedStudentIds() {
  selectedStudentIds.clear();
  updateRecordHeaderUI();
}

function toggleStudentSelection(studentId) {
  if (selectedStudentIds.has(studentId)) selectedStudentIds.delete(studentId);
  else selectedStudentIds.add(studentId);
  updateRecordHeaderUI();
  const searchValue = document.getElementById('searchName')?.value.trim() || '';
  loadRecords(searchValue);
}

function exitStudentSelectionMode() {
  studentSelectionMode = false;
  clearSelectedStudentIds();
  const searchValue = document.getElementById('searchName')?.value.trim() || '';
  loadRecords(searchValue);
}


function clearStudentRowSelection() {
  document.querySelectorAll('.studentRowSelected').forEach(el => el.classList.remove('studentRowSelected'));
}


function triggerLightHaptic() {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  } catch (e) {}
}

function cancelStudentLongPress() {
  if (studentLongPressTimer) {
    clearTimeout(studentLongPressTimer);
    studentLongPressTimer = null;
  }
  if (studentPressAnimTimer) {
    clearTimeout(studentPressAnimTimer);
    studentPressAnimTimer = null;
  }
  if (studentPressAnimReleaseTimer) {
    clearTimeout(studentPressAnimReleaseTimer);
    studentPressAnimReleaseTimer = null;
  }
  if (studentActionPopupTimer) {
    clearTimeout(studentActionPopupTimer);
    studentActionPopupTimer = null;
  }
  clearStudentRowSelection();
}

function getPointerPoint(e) {
  const p = e.touches && e.touches[0] ? e.touches[0] : e;
  return { x: p.clientX || 0, y: p.clientY || 0 };
}

function startStudentLongPress(e, studentId) {
  if (studentSelectionMode) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  cancelStudentLongPress();
  const row = e.currentTarget;
  const point = getPointerPoint(e);
  studentLongPressStart = point;

  // 버튼 반응은 롱프레스 확정보다 먼저 짧게만 보여준다.
  // 100ms에 살짝 올라가고, 280ms에 바로 내려오게 해서
  // 팝업은 버튼이 완전히 내려간 뒤 500ms에 열리게 한다.
  studentPressAnimTimer = setTimeout(() => {
    studentPressAnimTimer = null;
    clearStudentRowSelection();
    if (row) row.classList.add('studentRowSelected');

    studentPressAnimReleaseTimer = setTimeout(() => {
      studentPressAnimReleaseTimer = null;
      if (row) row.classList.remove('studentRowSelected');
    }, 180);
  }, 100);

  studentLongPressTimer = setTimeout(() => {
    studentLongPressTimer = null;
    suppressNextStudentClick = true;

    // 팝업은 버튼이 완전히 내려간 뒤에만 연다.
    if (studentPressAnimTimer) {
      clearTimeout(studentPressAnimTimer);
      studentPressAnimTimer = null;
    }
    if (studentPressAnimReleaseTimer) {
      clearTimeout(studentPressAnimReleaseTimer);
      studentPressAnimReleaseTimer = null;
    }
    if (row) row.classList.remove('studentRowSelected');

    triggerLightHaptic();
    studentActionPopupTimer = setTimeout(() => {
      studentActionPopupTimer = null;
      openStudentActionMenu(studentId, row);
    }, 20);
  }, 480);
}

function moveStudentLongPress(e) {
  if (!studentLongPressTimer) return;
  const point = getPointerPoint(e);
  const dx = Math.abs(point.x - studentLongPressStart.x);
  const dy = Math.abs(point.y - studentLongPressStart.y);
  if (dx > 10 || dy > 10) cancelStudentLongPress();
}

function handleStudentRowClick(e, studentId) {
  if (studentSelectionMode) {
    e.preventDefault();
    e.stopPropagation();
    suppressNextStudentClick = false;
    toggleStudentSelection(studentId);
    return;
  }

  if (suppressNextStudentClick) {
    e.preventDefault();
    e.stopPropagation();
    suppressNextStudentClick = false;
    return;
  }

  const student = findStudentById(studentId);
  if (!student) return;
  openAttendanceStudentFeedbackSheet(student);
}


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

function removeAttendanceFeedbackItemFromLocalArchive(student, item) {
  if (!student?.id || !item) return;
  try {
    const items = getMemoFeedbackArchiveItems(student);
    const rowId = String(item?.row?.id || item?.rowId || '').trim();
    const itemId = String(item?.id || '').trim();
    const next = items.filter(localItem => {
      const localRowId = String(localItem?.row?.id || '').trim();
      const localId = String(localItem?.id || '').trim();
      if (rowId && localRowId && rowId === localRowId) return false;
      if (itemId && localId && itemId === localId) return false;
      return true;
    });
    if (next.length !== items.length) setMemoFeedbackArchiveItems(student, next);
  } catch (err) {
    console.warn('로컬 기록 삭제 동기화 실패:', err);
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
    if (kind !== 'summary') removeAttendanceFeedbackItemFromLocalArchive(student, item);

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






function openKinderTransferModal() {
  const modal = document.getElementById('kinderTransferModal');
  const list = document.getElementById('kinderTransferList');
  if (!modal || !list) return;
  const candidates = getKinderElementaryTransferCandidates();
  list.innerHTML = candidates.length
    ? candidates.map(student => {
        const meta = [student.kindergarten || '', student.age ? `${student.age}세` : '', getStudentTeacherDisplay(student)].filter(Boolean).join(' / ');
        return `<div class="kinderTransferRow">
          <div><div class="kinderTransferName">${escapeHtml(student.name || '')}</div><div class="kinderTransferMeta">${escapeHtml(meta)}</div></div>
          <button type="button" class="kinderTransferMoveBtn" onclick="transferKinderToElementary('${escapeTemplateLiteral(student.id)}')">초등부로 이동</button>
        </div>`;
      }).join('')
    : '<div class="recordEmpty">현재 이관 대상 학생이 없습니다.</div>';
  modal.style.display = 'flex';
}

function closeKinderTransferModal() {
  hideModalOnly('kinderTransferModal');
}

async function transferKinderToElementary(studentId) {
  const student = findStudentById(studentId);
  if (!student || student.type !== 'kinder') return;
  if (!confirm(`${student.name} 학생을 초등부로 이관할까요?\n\n기존 관찰·피드백 기록은 그대로 유지됩니다.`)) return;

  const now = new Date();
  const moved = {
    ...student,
    type: 'elementary',
    previous_division: 'kinder',
    division_changed_at: now.toISOString(),
    grade: '1',
    school_entry_year: String(getOlliAcademicYear(now)),
    age: getElementaryAgeFromGrade('1'),
    birth_year: '',
    school: '',
    className: '',
    group: '',
    group_months: '',
    feedback_months: ''
  };

  try {
    const savedStudent = await ensureStudentSavedToSupabase(moved);
    closeKinderTransferModal();
    showPushToast(`${savedStudent.name} 학생을 초등부로 이관했어요.`);

    currentRecordView = 'elementary';
    currentObservationView = 'elementary';
    updateRecordHeaderUI();
    await loadRecords('');

    // 이관 직후 초등부에서 새로 필요한 학교/반/그룹 정보를 바로 확인합니다.
    studentInfoModalTarget = savedStudent;
    openElementaryInfoModal();
  } catch (err) {
    alert(`초등부 이관에 실패했어요.\n\n${err?.message || err}`);
  }
}

function openStudentActionMenu(studentId, rowEl) {
  const student = findStudentById(studentId);
  if (!student) return;
  selectedStudentActionId = studentId;
  // 팝업이 뜰 때 학생 버튼이 다시 올라오지 않도록 선택 클래스를 유지하지 않는다.
  clearStudentRowSelection();
  const title = document.getElementById('studentActionTitle');
  if (title) title.textContent = `${student.name} 선택`;
  const overlay = document.getElementById('studentActionOverlay');
  if (overlay) overlay.classList.add('show');
}

function closeStudentActionMenu() {
  selectedStudentActionId = '';
  clearStudentRowSelection();
  const overlay = document.getElementById('studentActionOverlay');
  if (overlay) overlay.classList.remove('show');
}

function openSelectedStudentInfoFromActionMenu() {
  const student = findStudentById(selectedStudentActionId);
  if (!student) return;
  closeStudentActionMenu();
  studentInfoModalTarget = student;
  if (student.type === 'kinder') openKinderInfoModal();
  else openElementaryInfoModal();
}

function enterStudentSelectionMode() {
  if (!selectedStudentActionId) return;
  studentSelectionMode = true;
  selectedStudentIds.clear();
  selectedStudentIds.add(selectedStudentActionId);
  closeStudentActionMenu();
  suppressNextStudentClick = false;
  updateRecordHeaderUI();
  const searchValue = document.getElementById('searchName')?.value.trim() || '';
  loadRecords(searchValue);
}

async function setSelectedStudentStatus(status) {
  if (!selectedStudentActionId) return;
  const targetId = selectedStudentActionId;
  const student = findStudentById(targetId);
  if (!student) return;

  const nextStatus = status === 'active' ? 'active' : status;
  const changedAt = new Date().toISOString();
  const statusDates = nextStatus === 'withdrawn'
    ? { withdrawn_at: changedAt, paused_at: '' }
    : (nextStatus === 'paused'
      ? { paused_at: changedAt, withdrawn_at: '' }
      : { withdrawn_at: '', paused_at: '' });

  const nextStudent = normalizeStudentObject({
    ...student,
    status: nextStatus,
    ...statusDates,
    status_changed_at: changedAt,
    updated_at: changedAt
  }, student.type || 'elementary');

  setPendingStudentStatus(nextStudent);
  await saveStudent(nextStudent, { skipRemote: true });

  if (nextStudent.type === 'elementary' || nextStudent.type === 'kinder') {
    const sectionState = recordStatusSectionOpenState[nextStudent.type];
    if (sectionState && (nextStatus === 'paused' || nextStatus === 'withdrawn')) {
      sectionState[nextStatus] = true;
    }
  }

  if (currentMemoStudent && String(currentMemoStudent.id) === String(nextStudent.id)) {
    currentMemoStudent = nextStudent;
  }

  closeStudentActionMenu();
  const searchValue = document.getElementById('searchName')?.value.trim() || '';

  // 서버를 다시 읽기 전에 로컬 상태를 즉시 반영합니다.
  if (currentRecordView === 'elementary' || currentRecordView === 'kinder') renderCurrentStudentRecords(searchValue);
  else if (currentRecordView === 'academy') renderRecordAcademyManagementDashboard();

  try {
    await updateStudentStatusInSupabase(nextStudent);
  } catch (err) {
    // 실패해도 로컬 상태와 재동기화 대기값은 유지합니다.
    console.warn('student status remote sync pending:', err.message || err);
  }

  await loadRecords(searchValue);
  if (currentRecordView === 'academy') renderRecordAcademyManagementDashboard();
}

async function deleteSelectedStudents() {
  const ids = Array.from(selectedStudentIds);
  if (!ids.length) return;
  const ok = confirm('삭제 시 통계에서 제외됩니다.\n실제 수업한 학생은 퇴원으로 처리해 주세요.');
  if (!ok) return;
  const studentSnapshotMap = new Map(getAllStudents().map(student => [String(student.id || ''), student]));
  const successIds = [];
  const failed = [];
  for (const id of ids) {
    try {
      await deactivateStudentInSupabase(id);
      successIds.push(String(id));
    } catch (err) {
      failed.push({ id: String(id), message: String(err && (err.message || err) || '알 수 없는 오류') });
    }
  }
  if (successIds.length) {
    const successSet = new Set(successIds);
    successIds.forEach(id => backupAndRemoveStudentLocalData(id, studentSnapshotMap.get(String(id)) || null));
    setAllStudents(getAllStudents().filter(item => !successSet.has(String(item.id))));
    successIds.forEach(id => unmarkDeletedStudentId(id));
  }
  if (failed.length) {
    alert(`학생 삭제 서버 저장에 실패했습니다. (${failed.length}명)\n저장 진단의 student_soft_delete 오류를 확인해 주세요.\n${failed[0].message}`);
  }
  studentSelectionMode = false;
  selectedStudentIds.clear();
  updateRecordHeaderUI();
  await loadRecords(document.getElementById('searchName')?.value.trim() || '');
}

async function deactivateStudentInSupabase(studentId) {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 없어 학생 삭제를 서버에 저장할 수 없습니다.');
  const id = String(studentId || '').trim();
  if (!id) throw new Error('학생 삭제 식별값이 없습니다.');
  const academyId = getOlliCurrentAcademyId();
  const deletedAt = new Date().toISOString();
  const deletedBy = String(localStorage.getItem('olli_current_member_id') || localStorage.getItem('olli_current_user_id') || localStorage.getItem('olli_current_member_name') || '').trim();
  try {
    if (typeof saveOlliData === 'function') {
      const result = await saveOlliData('student_soft_delete', {
        academyId,
        studentId: id,
        data: {
          is_deleted: true,
          deleted_at: deletedAt,
          deleted_by: deletedBy || null,
          delete_reason: 'student_deleted'
        },
        forceCommon: true
      });
      if (result && result.serverSaved && result.verified) return result;
      if (result && result.pending) throw new Error('학생 삭제가 서버에 반영되지 않아 재전송 대기열에 남았습니다.');
    }
    throw new Error('student_soft_delete 공통 저장 응답을 확인하지 못했습니다. 직접 Supabase PATCH fallback은 사용하지 않습니다.');
  } catch (err) {
    if (typeof recordOlliStorageIssue === 'function') {
      recordOlliStorageIssue({
        feature: 'student_soft_delete',
        resource: 'students',
        operation: 'soft_delete',
        academy_id: academyId || null,
        student_id: id,
        message: err.message || err
      });
    }
    console.warn('student soft delete failed:', err.message || err);
    throw err;
  }
}

async function deleteStudentById(studentId) {
  const student = findStudentById(studentId);
  if (!student) return;
  try {
    await deactivateStudentInSupabase(studentId);
  } catch (err) {
    alert(`학생 삭제 서버 저장에 실패했습니다.\n명단에서 숨기지 않고 그대로 유지합니다.\n저장 진단의 student_soft_delete 오류를 확인해 주세요.\n${String(err && (err.message || err) || '')}`);
    closeStudentActionMenu();
    return;
  }
  setAllStudents(getAllStudents().filter(item => String(item.id) !== String(studentId)));
  unmarkDeletedStudentId(studentId);
  backupAndRemoveStudentLocalData(studentId, student);
  if (currentMemoStudent && currentMemoStudent.id === studentId) {
    currentMemoStudent = null;
    document.getElementById('studentMemoScreen').style.display = 'none';
    document.getElementById('recordRoomScreen').style.display = 'flex';
  }
  closeStudentActionMenu();
  selectedStudentIds.delete(studentId);
  updateRecordHeaderUI();
  await loadRecords(document.getElementById('searchName')?.value.trim() || '');
}

async function confirmDeleteSelectedStudent() {
  if (!selectedStudentActionId) return;
  const student = findStudentById(selectedStudentActionId);
  if (!student) return;
  const ok = confirm('삭제 시 통계에서 제외됩니다.\n실제 수업한 학생은 퇴원으로 처리해 주세요.');
  if (!ok) return;
  await deleteStudentById(selectedStudentActionId);
}

function isSupabaseConfigured() {
  return /^https?:\/\//.test(String(SUPABASE_URL || '')) && !String(SUPABASE_KEY || '').includes('요기');
}

function getOlliCurrentAcademyId() {
  return localStorage.getItem('olli_current_academy_id') || '';
}

function getOlliCurrentAcademyCode() {
  return localStorage.getItem('olli_current_academy_code') || '';
}

function getOlliCurrentAcademyName() {
  return localStorage.getItem('olli_current_academy_name') || '';
}

function getOlliCurrentAcademyRegion() {
  return localStorage.getItem('olli_current_academy_region') || '';
}

function appendOlliAcademyFilter(path) {
  const academyId = requireOlliAcademyId('학원 데이터 조회');
  return path + (String(path).includes('?') ? '&' : '?') + `academy_id=eq.${encodeURIComponent(academyId)}`;
}

function requireOlliAcademyId(actionLabel = '작업') {
  const academyId = getOlliCurrentAcademyId();
  if (!academyId) {
    throw new Error(`${actionLabel}을 할 수 없습니다. 현재 학원 ID가 없습니다. 다시 로그인해 주세요.`);
  }
  return academyId;
}

function addOlliAcademyToPayload(payload, actionLabel = '저장') {
  const academyId = requireOlliAcademyId(actionLabel);
  return { ...payload, academy_id: academyId };
}

function getOlliScopedAcademyId(actionLabel = '작업') {
  const academyId = (typeof settingsGetAcademyId === 'function' ? settingsGetAcademyId() : '') || getOlliCurrentAcademyId();
  if (!academyId) {
    throw new Error(`${actionLabel}을 할 수 없습니다. 현재 학원 ID가 없습니다. 다시 로그인해 주세요.`);
  }
  return academyId;
}

function buildOlliAcademyMemberPathById(memberId, actionLabel = '선생님 설정') {
  const id = String(memberId || '').trim();
  if (!id) throw new Error(`${actionLabel}을 할 수 없습니다. 선생님 ID가 없습니다.`);
  const academyId = getOlliScopedAcademyId(actionLabel);
  return `academy_members?id=eq.${encodeURIComponent(id)}&academy_id=eq.${encodeURIComponent(academyId)}`;
}

function getOlliSettingsRequestById(requestId) {
  const id = String(requestId || '').trim();
  if (!id) return null;
  return (olliSettingsState?.approvalRequests || []).find(request => String(request?.id || '') === id) || null;
}

async function ensureSettingsRequestBelongsToCurrentAcademy(requestId) {
  const id = String(requestId || '').trim();
  if (!id) throw new Error('승인 요청 ID가 없습니다.');
  const academyId = getOlliScopedAcademyId('선생님 승인 요청 확인');
  const academyCode = (typeof getOlliCurrentAcademyCode === 'function' ? getOlliCurrentAcademyCode() : '') || localStorage.getItem('olli_current_academy_code') || olliSettingsState?.academy?.academy_code || '';
  const cached = getOlliSettingsRequestById(id);

  if (cached) {
    const cachedAcademyId = String(cached.academy_id || '').trim();
    const cachedAcademyCode = String(cached.academy_code || cached.requested_academy_code || '').trim();
    if (cachedAcademyId && cachedAcademyId !== academyId) {
      throw new Error('현재 학원의 승인 요청이 아닙니다. 새로고침 후 다시 확인해 주세요.');
    }
    if (!cachedAcademyId && cachedAcademyCode && academyCode && cachedAcademyCode !== academyCode) {
      throw new Error('현재 학원의 승인 요청이 아닙니다. 새로고침 후 다시 확인해 주세요.');
    }
  }

  if (!isSupabaseConfigured()) return true;

  try {
    const rows = await supabase('GET', `teacher_approval_requests?select=id&academy_id=eq.${encodeURIComponent(academyId)}&id=eq.${encodeURIComponent(id)}&limit=1`);
    if (Array.isArray(rows) && rows.length) return true;
    if (cached && !String(cached.academy_id || '').trim()) return true;
    throw new Error('현재 학원의 승인 요청을 찾지 못했습니다.');
  } catch (err) {
    if (cached) return true;
    throw err;
  }
}


function getEnrolledAtFromStudent(student) {
  if (student?.enrolled_at) return student.enrolled_at;
  const y = Number(student?.year || getCurrentYear());
  const m = Number(student?.month || 0);
  const d = Number(student?.day || 0);
  if (!m || !d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function normalizeStudentDateInputValue(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const testDate = new Date(year, month - 1, day);
  if (testDate.getFullYear() !== year || testDate.getMonth() !== month - 1 || testDate.getDate() !== day) return null;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return { year, month: mm, day: dd, enrolled_at: `${year}-${mm}-${dd}` };
}

function getStudentInfoDateValue(student) {
  const parsed = normalizeStudentDateInputValue(getEnrolledAtFromStudent(student));
  return parsed ? parsed.enrolled_at : '';
}

function getStudentInfoDatePartInputs(inputId) {
  const map = {
    elementaryInfoEnrolledAtInput: ['elementaryInfoYearInput', 'elementaryInfoMonthInput', 'elementaryInfoDayInput'],
    kinderInfoEnrolledAtInput: ['kinderInfoYearInput', 'kinderInfoMonthInput', 'kinderInfoDayInput']
  };
  const ids = map[inputId];
  if (!ids) return null;
  const [yearInput, monthInput, dayInput] = ids.map(id => document.getElementById(id));
  if (!yearInput || !monthInput || !dayInput) return null;
  return { yearInput, monthInput, dayInput };
}

function setStudentInfoDateInput(inputId, student) {
  const parts = getStudentInfoDatePartInputs(inputId);
  const parsed = normalizeStudentDateInputValue(getEnrolledAtFromStudent(student));
  if (parts) {
    parts.yearInput.value = parsed ? String(parsed.year) : '';
    parts.monthInput.value = parsed ? String(Number(parsed.month)) : '';
    parts.dayInput.value = parsed ? String(Number(parsed.day)) : '';
    return;
  }
  const input = document.getElementById(inputId);
  if (!input) return;
  input.value = parsed ? parsed.enrolled_at : '';
}

function readStudentInfoDateInput(inputId, fallbackStudent) {
  const parts = getStudentInfoDatePartInputs(inputId);
  let raw = '';
  if (parts) {
    const year = parts.yearInput.value.trim();
    const month = parts.monthInput.value.trim();
    const day = parts.dayInput.value.trim();
    raw = year && month && day ? `${year}-${month}-${day}` : '';
  } else {
    const input = document.getElementById(inputId);
    raw = input ? input.value : getEnrolledAtFromStudent(fallbackStudent);
  }
  if (!raw) {
    alert('등록 날짜를 입력해 주세요.');
    return null;
  }
  const parsed = normalizeStudentDateInputValue(raw);
  if (!parsed) {
    alert('등록 날짜를 올바르게 입력해 주세요.');
    return null;
  }
  return parsed;
}


function formatTeacherNameWithT(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/\s+/g, ' ');
  return /T$/i.test(normalized) ? normalized : `${normalized}T`;
}

function getStudentTeacherDisplay(student) {
  return formatTeacherNameWithT(student?.teacher || student?.homeroom_teacher || student?.teacher_name || '');
}

function normalizeLessonDayDisplay(value) {
  return String(value || '')
    .trim()
    .replace(/\s*,\s*/g, '·')
    .replace(/\s*·\s*/g, '·')
    .replace(/\s+/g, '');
}


function normalizeLessonTimeDisplay(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const matches = [];
  raw.replace(/(?:오후\s*)?([1-7])\s*(?:시|:00)?/g, (_, hour) => {
    const label = `${Number(hour)}시`;
    if (!matches.includes(label)) matches.push(label);
    return '';
  });
  if (matches.length) return matches.join('·');
  return raw.replace(/\s+/g, '').replace(/,/g, '·').replace(/·+/g, '·').replace(/^·|·$/g, '');
}

function normalizeRecordInfoValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      const joined = value.map(v => String(v || '').trim()).filter(Boolean).join('·');
      if (joined) return joined;
      continue;
    }
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function formatElementaryPersonalityDisplay(student) {
  let raw = normalizeRecordInfoValue(
    student?.personality,
    student?.personalityType,
    student?.personality_type,
    student?.tendency,
    student?.tendencyType,
    student?.tendency_type
  );
  // 성향은 실제 성향 입력값이 있을 때만 표시합니다.
  // 그룹값을 성향으로 대체하면 성향 미선택 학생에게 성향1/성향2처럼 잘못 표시됩니다.
  raw = String(raw || '').trim();
  if (!raw) return '';
  raw = raw.replace(/^성향\s*/g, '').replace(/반$/g, '').trim();
  return raw ? `성향${raw}` : '';
}

function formatElementaryGradeClassDisplay(student) {
  const grade = normalizeRecordInfoValue(student?.grade, student?.school_grade, student?.schoolGrade);
  return grade || '';
}

function formatElementaryLessonDayDisplay(student) {
  const raw = normalizeRecordInfoValue(
    student?.lesson_day,
    student?.lessonDay,
    student?.class_day,
    student?.classDay,
    student?.weekdays,
    student?.days
  );
  return normalizeLessonDayDisplay(raw) || '';
}

function formatElementarySchoolGuideDisplay(student) {
  const raw = normalizeRecordInfoValue(student?.school, student?.school_name, student?.schoolName);
  if (!raw) return '';
  return raw
    .replace(/\s*초등학교\s*$/g, '초')
    .replace(/\s*초등\s*$/g, '초')
    .replace(/\s*초교\s*$/g, '초')
    .trim();
}

function getElementaryMetaText(student) {
  const personality = formatElementaryPersonalityDisplay(student);
  const school = formatElementarySchoolGuideDisplay(student);
  const age = normalizeRecordInfoValue(student?.age) || getElementaryAgeFromGrade(student?.grade);
  const gradeClass = formatElementaryGradeClassDisplay(student);
  const teacherName = getStudentTeacherDisplay(student);
  const lessonDay = formatElementaryLessonDayDisplay(student);
  const lessonTime = normalizeLessonTimeDisplay(student?.lesson_time || student?.class_time || student?.lessonTime || student?.classTime || '');
  const feedbackMonth = getElementaryGroupFeedbackMonthDisplay(student?.group, student);
  return [personality, school, age ? `${age}살` : '', gradeClass ? `${gradeClass}학년` : '', teacherName, lessonDay, lessonTime, feedbackMonth].filter(Boolean).join(' / ');
}

function studentToSupabasePayload(student) {
  const academyId = requireOlliAcademyId('학생 저장');
  const academyName = getOlliCurrentAcademyName();
  const academyRegion = getOlliCurrentAcademyRegion();
  return {
    id: student.id,
    academy_id: academyId,
    academy_name: academyName || null,
    academy_region: academyRegion || null,
    name: student.name,
    division: student.type === 'kinder' ? 'kinder' : 'elementary',
    enrolled_at: getEnrolledAtFromStudent(student),
    kindergarten: student.kindergarten || null,
    age: student.age ? Number(student.age) : null,
    birth_year: student.birth_year ? Number(student.birth_year) : null,
    school_entry_year: student.school_entry_year ? Number(student.school_entry_year) : null,
    previous_division: student.previous_division || null,
    division_changed_at: student.division_changed_at || null,
    lesson_day: student.lesson_day || student.lessonDay || null,
    lesson_time: normalizeLessonTimeDisplay(student.lesson_time || student.lessonTime || student.class_time || student.classTime || '') || null,
    group_no: student.group ? Number(student.group) : null,
    group_months: elementaryGroupMonthsToText(student.group_months || student.feedback_months || getElementaryGroupFeedbackMonths(student.group, student)) || null,
    feedback_months: elementaryGroupMonthsToText(student.feedback_months || student.group_months || getElementaryGroupFeedbackMonths(student.group, student)) || null,
    personality: student.personality || null,
    school: student.school || null,
    grade: student.grade ? Number(student.grade) : null,
    class_no: student.className ? Number(student.className) : null,
    teacher: formatTeacherNameWithT(student.teacher || student.homeroom_teacher || '' ) || null,
    homeroom_teacher: formatTeacherNameWithT(student.homeroom_teacher || student.teacher || '') || null,
    status: student.status || 'active',
    withdrawn_at: student.withdrawn_at || null,
    paused_at: student.paused_at || null,
    status_changed_at: student.status_changed_at || null,
  };
}

function supabaseRowToStudent(row) {
  const enrolled = row.enrolled_at ? String(row.enrolled_at).split('-') : [];
  return normalizeStudentObject({
    id: row.id,
    academy_id: row.academy_id || getOlliCurrentAcademyId(),
    academy_name: row.academy_name || getOlliCurrentAcademyName(),
    academy_region: row.academy_region || getOlliCurrentAcademyRegion(),
    type: row.division || row.type || 'elementary',
    name: row.name,
    year: enrolled[0] || getCurrentYear(),
    month: enrolled[1] || '',
    day: enrolled[2] || '',
    enrolled_at: row.enrolled_at || '',
    kindergarten: row.kindergarten || '',
    age: row.age || '',
    birth_year: row.birth_year || '',
    school_entry_year: row.school_entry_year || '',
    previous_division: row.previous_division || '',
    division_changed_at: row.division_changed_at || '',
    lesson_day: row.lesson_day || row.lessonDay || row.class_day || '',
    lesson_time: row.lesson_time || row.lessonTime || row.class_time || row.classTime || '',
    class_time: row.class_time || row.classTime || row.lesson_time || row.lessonTime || '',
    group: row.group_no || '',
    group_months: row.group_months || row.feedback_months || '',
    feedback_months: row.feedback_months || row.group_months || '',
    personality: row.personality || '',
    school: row.school || '',
    grade: row.grade || '',
    className: row.class_no || row.className || '',
    teacher: row.teacher || row.homeroom_teacher || row.teacher_name || '',
    homeroom_teacher: row.homeroom_teacher || row.teacher || row.teacher_name || '',
    status: row.status || 'active',
    is_deleted: row.is_deleted === true || String(row.is_deleted || '').toLowerCase() === 'true',
    deleted_at: row.deleted_at || '',
    deleted_by: row.deleted_by || '',
    delete_reason: row.delete_reason || '',
    withdrawn_at: row.withdrawn_at || row.withdrawal_at || row.quit_at || '',
    paused_at: row.paused_at || row.pause_at || '',
    status_changed_at: row.status_changed_at || '',
    updated_at: row.updated_at || ''
  }, row.division || 'elementary');
}

function getSupabaseMissingColumnName(err) {
  const message = String(err?.message || err || '');
  const match = message.match(/Could not find the ['\"]([^'\"]+)['\"] column/i);
  return match ? match[1] : '';
}

const STUDENT_LEGACY_OPTIONAL_COLUMNS = new Set([
  'academy_name', 'academy_region', 'group_months', 'feedback_months',
  'homeroom_teacher'
]);

async function postStudentWithColumnFallback(student) {
  const payload = studentToSupabasePayload(student);
  const academyId = String(payload.academy_id || '').trim();
  const studentId = String(payload.id || '').trim();
  if (!academyId || !studentId) throw new Error('학생 저장 식별값이 없습니다.');
  if (typeof saveOlliData !== 'function') {
    const error = new Error('학생정보 공통 저장 함수가 준비되지 않았습니다.');
    recordOlliStorageIssue({ feature: 'student_profile', resource: 'students', operation: 'upsert', student_id: studentId, message: error.message });
    throw error;
  }

  const result = await saveOlliData('student_profile', {
    academyId,
    studentId,
    forceCommon: true,
    data: payload,
    serverOptions: { operation: 'upsert' }
  });

  if (isOlliPendingCommonSaveResult(result)) {
    return [makeOlliPendingRow(payload, studentId)];
  }
  if (!result || !result.serverSaved || !result.verified) {
    const error = result && result.error
      ? result.error
      : new Error(`학생정보 서버 저장이 완료되지 않았습니다.${result && result.pending ? ' 재전송 대기열에 기록되었습니다.' : ''}`);
    recordOlliStorageIssue({
      feature: 'student_profile', resource: 'students', operation: 'upsert',
      student_id: studentId, message: String(error && (error.message || error) || '')
    });
    throw error;
  }

  const row = result.serverRow || (Array.isArray(result.serverRows) ? result.serverRows[0] : result.serverRows) || null;
  if (!row || typeof row !== 'object') {
    const error = new Error('학생정보 서버 저장 행을 확인하지 못했습니다.');
    recordOlliStorageIssue({ feature: 'student_profile', resource: 'students', operation: 'verify', student_id: studentId, message: error.message });
    throw error;
  }
  return [row];
}

async function saveStudentToSupabase(student) {
  if (!isSupabaseConfigured()) return null;
  try {
    const academyId = requireOlliAcademyId('학생 저장');
    const rows = await postStudentWithColumnFallback(student);
    return requireSupabaseWriteRow(rows, '학생정보 저장', {
      id: student?.id || '', academy_id: academyId
    });
  } catch (err) {
    recordOlliStorageIssue({ feature: '학생정보', resource: 'students', operation: 'upsert', student_id: student?.id || '', message: err.message || err });
    console.warn('students table sync skipped:', err.message || err);
    return null;
  }
}


const PENDING_STUDENT_STATUS_KEY = 'olli_pending_student_status_v1';

function getPendingStudentStatusStorageKey() {
  const academyId = getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : '';
  return academyId ? `${PENDING_STUDENT_STATUS_KEY}_${academyId}` : PENDING_STUDENT_STATUS_KEY;
}

function getPendingStudentStatusMap() {
  try {
    const raw = localStorage.getItem(getPendingStudentStatusStorageKey());
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function setPendingStudentStatus(student) {
  if (!student?.id) return;
  const map = getPendingStudentStatusMap();
  map[String(student.id)] = {
    status: getStudentStatus(student),
    withdrawn_at: student.withdrawn_at || '',
    paused_at: student.paused_at || '',
    status_changed_at: student.status_changed_at || new Date().toISOString()
  };
  localStorage.setItem(getPendingStudentStatusStorageKey(), JSON.stringify(map));
}

function clearPendingStudentStatus(studentId) {
  const map = getPendingStudentStatusMap();
  delete map[String(studentId || '')];
  localStorage.setItem(getPendingStudentStatusStorageKey(), JSON.stringify(map));
}

async function patchStudentStatusReturning(path, payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${getOlliAuthAccessToken ? (getOlliAuthAccessToken() || SUPABASE_KEY) : SUPABASE_KEY}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const detail =
      (data && typeof data === 'object' && (data.message || data.details || data.hint || data.code))
        ? [data.message, data.details, data.hint, data.code].filter(Boolean).join(' / ')
        : (typeof data === 'string' ? data : '');
    throw new Error(`Supabase 요청 실패 (${res.status})${detail ? '\n' + detail : ''}`);
  }
  return Array.isArray(data) ? data : [];
}

async function updateStudentStatusInSupabase(student) {
  if (!isSupabaseConfigured()) return false;
  const academyId = requireOlliAcademyId('학생 상태 저장');
  const studentId = String(student?.id || '').trim();
  if (!studentId) throw new Error('학생 ID가 없습니다.');
  if (typeof saveOlliData !== 'function') {
    const error = new Error('학생 상태 공통 저장 함수가 준비되지 않았습니다.');
    recordOlliStorageIssue({ feature: 'student_status', resource: 'students', operation: 'patch', student_id: studentId, message: error.message });
    throw error;
  }

  const payload = {
    academy_id: academyId,
    status: getStudentStatus(student),
    withdrawn_at: student.withdrawn_at || null,
    paused_at: student.paused_at || null,
    status_changed_at: student.status_changed_at || new Date().toISOString()
  };

  const result = await saveOlliData('student_status', {
    academyId,
    studentId,
    forceCommon: true,
    data: payload,
    serverOptions: { operation: 'patch' }
  });

  if (isOlliPendingCommonSaveResult(result)) {
    setPendingStudentStatus({ ...student, ...payload, id: studentId });
    return true;
  }
  if (!result || !result.serverSaved || !result.verified) {
    const error = result && result.error
      ? result.error
      : new Error(`학생 상태 서버 저장이 완료되지 않았습니다.${result && result.pending ? ' 재전송 대기열에 기록되었습니다.' : ''}`);
    recordOlliStorageIssue({
      feature: 'student_status', resource: 'students', operation: 'patch',
      student_id: studentId, message: String(error && (error.message || error) || '')
    });
    throw error;
  }

  const row = result.serverRow || (Array.isArray(result.serverRows) ? result.serverRows[0] : result.serverRows) || null;
  if (!row || String(row.id || '') !== studentId || getStudentStatus(row) !== payload.status) {
    const error = new Error('학생 상태 서버 검증에 실패했습니다.');
    recordOlliStorageIssue({ feature: 'student_status', resource: 'students', operation: 'verify', student_id: studentId, message: error.message });
    throw error;
  }
  clearPendingStudentStatus(studentId);
  return true;
}

async function flushPendingStudentStatuses() {
  if (!isSupabaseConfigured()) return;
  const pending = getPendingStudentStatusMap();
  const students = getAllStudents();
  for (const [studentId, state] of Object.entries(pending)) {
    const student = students.find(item => String(item.id) === String(studentId));
    if (!student) continue;
    try {
      await updateStudentStatusInSupabase({ ...student, ...state });
    } catch (err) {
      console.warn('학생 상태 재동기화 대기:', err.message || err);
    }
  }
}

function mergeStudentInfoPreservingLocal(localStudent, remoteStudent) {
  const local = normalizeStudentObject(localStudent || {}, localStudent?.type || remoteStudent?.type || 'elementary');
  const remote = remoteStudent ? normalizeStudentObject(remoteStudent, remoteStudent?.type || local.type || 'elementary') : {};
  const merged = normalizeStudentObject({
    ...local,
    ...remote,
    id: remote.id || local.id,
    academy_id: remote.academy_id || local.academy_id || (getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : ''),
    type: remote.type || local.type,
    name: remote.name || local.name,
    year: remote.year || local.year,
    month: remote.month || local.month,
    day: remote.day || local.day,
    enrolled_at: remote.enrolled_at || local.enrolled_at,
    kindergarten: remote.kindergarten || local.kindergarten,
    age: remote.age || local.age,
    birth_year: remote.birth_year || local.birth_year,
    school_entry_year: remote.school_entry_year || local.school_entry_year,
    previous_division: remote.previous_division || local.previous_division,
    division_changed_at: remote.division_changed_at || local.division_changed_at,
    lesson_day: remote.lesson_day ?? local.lesson_day ?? remote.lessonDay ?? local.lessonDay ?? '',
    lesson_time: remote.lesson_time ?? local.lesson_time ?? remote.lessonTime ?? local.lessonTime ?? remote.class_time ?? local.class_time ?? '',
    class_time: remote.class_time ?? local.class_time ?? remote.lesson_time ?? local.lesson_time ?? '',
    teacher: remote.teacher ?? local.teacher ?? remote.homeroom_teacher ?? local.homeroom_teacher ?? '',
    homeroom_teacher: remote.homeroom_teacher ?? local.homeroom_teacher ?? remote.teacher ?? local.teacher ?? '',
    group: remote.group || local.group,
    group_months: remote.group_months || local.group_months || remote.feedback_months || local.feedback_months,
    feedback_months: remote.feedback_months || local.feedback_months || remote.group_months || local.group_months,
    personality: remote.personality || local.personality,
    school: remote.school || local.school,
    grade: remote.grade || local.grade,
    className: remote.className || local.className,
    memoUpdatedAt: remote.memoUpdatedAt || local.memoUpdatedAt,
    status: local.status || remote.status || 'active',
    withdrawn_at: remote.withdrawn_at || local.withdrawn_at || '',
    paused_at: remote.paused_at || local.paused_at || '',
    status_changed_at: remote.status_changed_at || local.status_changed_at || '',
    updated_at: remote.updated_at || local.updated_at || ''
  }, remote.type || local.type || 'elementary');
  return merged;
}

async function ensureStudentSavedToSupabase(student) {
  if (!student?.name) throw new Error('학생 이름이 없습니다.');
  const academyId = requireOlliAcademyId('학생 저장');
  const safeStudent = normalizeStudentObject({
    ...student,
    id: student.id || uid(),
    academy_id: student.academy_id || academyId
  }, student.type || 'elementary');

  const rows = await postStudentWithColumnFallback(safeStudent);
  const savedRow = Array.isArray(rows) && rows.length ? rows[0] : null;
  const remoteStudent = savedRow ? supabaseRowToStudent(savedRow) : null;
  const savedStudent = mergeStudentInfoPreservingLocal(safeStudent, remoteStudent);
  savedStudent.id = savedStudent.id || safeStudent.id;
  savedStudent.academy_id = academyId;
  await saveStudent(savedStudent, { skipRemote: true });
  return savedStudent;
}

async function loadStudentsFromSupabase() {
  if (!isSupabaseConfigured()) return { changed: false, skipped: true };
  const academyId = getOlliCurrentAcademyId();
  if (!academyId) return { changed: false, skipped: true };
  const beforeSnapshot = JSON.stringify(getAllStudents());
  const academyContext = window.OlliStorageCore?.AcademyContext;
  const requestToken = academyContext?.captureToken ? academyContext.captureToken() : null;
  const requestIsCurrent = () => academyContext?.isTokenCurrent
    ? academyContext.isTokenCurrent(requestToken)
    : getOlliCurrentAcademyId() === academyId;
  try {
    await flushPendingStudentStatuses();
    if (!requestIsCurrent()) return { changed: false, stale: true };
    const rows = await supabase('GET', `students?select=*&academy_id=eq.${encodeURIComponent(academyId)}&order=name.asc`);
    const pendingStatusMap = getPendingStudentStatusMap();
    const localById = new Map(getAllStudents().map(s => [String(s.id || ''), s]));
    const byId = new Map();
    if (Array.isArray(rows) && rows.length) {
      rows
        .filter(row => !isOlliSoftDeletedRow(row))
        .map(supabaseRowToStudent)
        .filter(remote => remote.id && !isOlliSoftDeletedRow(remote) && getStudentStatus(remote) !== 'inactive')
        .forEach(remote => {
          unmarkDeletedStudentId(remote.id);
          const old = localById.get(String(remote.id || '')) || {};
          const merged = mergeStudentInfoPreservingLocal({ ...old, academy_id: academyId }, { ...remote, academy_id: academyId });
          // 서버 저장이 잠시 실패한 학생 상태는 로컬 재동기화 대기값을 우선합니다.
          const pendingState = pendingStatusMap[String(remote.id || '')] || null;
          if (pendingState) {
            // 이 기기에서 아직 서버 저장이 확인되지 않은 변경만 로컬 값을 우선합니다.
            merged.status = pendingState.status || remote.status || 'active';
            merged.withdrawn_at = pendingState.withdrawn_at || '';
            merged.paused_at = pendingState.paused_at || '';
            merged.status_changed_at = pendingState.status_changed_at || '';
          } else {
            // 동기화 대기값이 없으면 서버를 최종 기준으로 사용합니다.
            // 다른 기기의 오래된 휴원 상태와 날짜가 남아 퇴원 상태를 덮지 않게 합니다.
            merged.status = remote.status || 'active';
            merged.withdrawn_at = remote.withdrawn_at || '';
            merged.paused_at = remote.paused_at || '';
            merged.status_changed_at = remote.status_changed_at || remote.updated_at || '';
          }
          merged.academy_id = academyId;
          byId.set(String(merged.id || remote.id), merged);
        });
    }
    // 상태 저장이 아직 서버에서 확인되지 않은 학생은 로컬 목록에서 지우지 않습니다.
    // 학생 ID가 서버와 정확히 일치해 동기화가 완료되면 pending 값은 자동으로 제거됩니다.
    Object.keys(pendingStatusMap).forEach(studentId => {
      if (byId.has(String(studentId))) return;
      const local = localById.get(String(studentId));
      const pendingState = pendingStatusMap[String(studentId)];
      if (!local || !pendingState) return;
      const preserved = normalizeStudentObject({
        ...local,
        ...pendingState,
        academy_id: academyId
      }, local.type || 'elementary');
      byId.set(String(studentId), preserved);
    });

    if (!requestIsCurrent()) return { changed: false, stale: true };
    const nextStudents = Array.from(byId.values()).filter(s => s.academy_id === academyId).sort((a,b) => a.name.localeCompare(b.name, 'ko'));
    if (JSON.stringify(nextStudents) !== JSON.stringify(getAllStudents())) setAllStudents(nextStudents);
    await syncOlliStudentLifecycleAfterLoad();
    return { changed: beforeSnapshot !== JSON.stringify(getAllStudents()) };
  } catch (err) {
    if (!requestIsCurrent()) return { changed: false, stale: true };
    console.warn('students table load skipped:', err.message || err);
    return { changed: false, error: err };
  }
}


let olliStudentSyncInFlight = false;
let olliStudentSyncTimer = null;

function isOlliRecordRoomVisible() {
  const screen = document.getElementById('recordRoomScreen');
  if (!screen) return false;
  const style = window.getComputedStyle ? window.getComputedStyle(screen) : null;
  return screen.style.display !== 'none' && (!style || style.display !== 'none');
}

async function syncVisibleStudentListSilently() {
  if (olliStudentSyncInFlight || document.hidden || !isOlliRecordRoomVisible()) return;
  if (!['elementary', 'kinder', 'academy'].includes(currentRecordView)) return;
  olliStudentSyncInFlight = true;
  try {
    const result = await loadStudentsFromSupabase();
    if (result && result.changed === false) return;
    const searchValue = document.getElementById('searchName')?.value.trim() || '';
    if (currentRecordView === 'elementary' || currentRecordView === 'kinder') renderCurrentStudentRecords(searchValue);
    else if (currentRecordView === 'academy') renderRecordAcademyManagementDashboard();
    } catch (err) {
    console.warn('학생 목록 백그라운드 동기화 보류:', err?.message || err);
  } finally {
    olliStudentSyncInFlight = false;
  }
}

function startOlliStudentBackgroundSync() {
  if (olliStudentSyncTimer) return;
  olliStudentSyncTimer = window.setInterval(syncVisibleStudentListSilently, 30000);
}

window.addEventListener('focus', () => {
  setTimeout(syncVisibleStudentListSilently, 0);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) setTimeout(syncVisibleStudentListSilently, 0);
});

function formatRegDate(student) {
  if (!student) return '';
  if (student.enrolled_at) {
    const parts = String(student.enrolled_at).split('-');
    if (parts.length >= 3) return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }
  const year = student.year || getCurrentYear();
  const month = student.month || '';
  const day = student.day || '';
  if (!month || !day) return '';
  return `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
}

function getElementaryMetaBits(student) {
  const metaText = getElementaryMetaText(student);
  return metaText ? [metaText] : [];
}

function getKinderMetaText(student) {
  const personality = formatElementaryPersonalityDisplay(student);
  const kindergarten = normalizeRecordInfoValue(student?.kindergarten, student?.kindergarten_name, student?.kindergartenName);
  const age = normalizeRecordInfoValue(student?.age, student?.student_age, student?.studentAge);
  const teacherName = getStudentTeacherDisplay(student);
  const lessonDay = normalizeLessonDayDisplay(normalizeRecordInfoValue(student?.lesson_day, student?.lessonDay, student?.class_day, student?.classDay));
  return [personality, kindergarten, age ? `${age}세` : '', teacherName, lessonDay].filter(Boolean).join(' / ');
}

function getKinderMetaBits(student) {
  const metaText = getKinderMetaText(student);
  return metaText ? [metaText] : [];
}

function getRecordModeLabel(mode) {
  if (currentRecordView === 'academy') return '학원 관리';
  if (currentRecordView === 'elementary') return '초등부';
  if (currentRecordView === 'kinder') return '유치부';
  if (mode === 'fail') return '성장 피드백';
  if (mode === 'summary') return '종합 피드백';
  return '수업 피드백';
}
function getChatModeLabel(mode) { return '설문지'; }

function fmt(t) {
  return String(t).split('\n').map(l => `<p>${l.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') || '&nbsp;'}</p>`).join('');
}
function escapeTemplateLiteral(str) { return String(str).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${'); }
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function copyIconSvg() { return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.8" y="8.2" width="11.8" height="11.8" rx="2.4"></rect><rect x="8.4" y="3.6" width="11.8" height="11.8" rx="2.4"></rect></svg>`; }
function shareIconSvg() { return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.8V4.2"></path><path d="M8.2 8l3.8-3.8L15.8 8"></path><path d="M5.4 14.8v2.3c0 1.5 1.2 2.7 2.7 2.7h7.8c1.5 0 2.7-1.2 2.7-2.7v-2.3"></path></svg>`; }
function checkIconSvg() { return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>`; }

function showOlliCopySuccess(btn, options = {}) {
  if (!btn) return;
  const restoreHtml = Object.prototype.hasOwnProperty.call(options, 'restoreHtml')
    ? String(options.restoreHtml ?? '')
    : btn.innerHTML;
  const restoreDisabled = Object.prototype.hasOwnProperty.call(options, 'restoreDisabled')
    ? !!options.restoreDisabled
    : !!btn.disabled;

  if (btn._olliCopySuccessTimer) clearTimeout(btn._olliCopySuccessTimer);

  btn.innerHTML = '✓';
  btn.disabled = true;
  btn.classList.add('copied');

  btn._olliCopySuccessTimer = setTimeout(() => {
    if (!btn || !btn.isConnected) return;
    btn.innerHTML = restoreHtml;
    btn.disabled = restoreDisabled;
    btn.classList.remove('copied');
    btn._olliCopySuccessTimer = null;
  }, 1200);
}

async function cp(btn, text) {
  let copied = false;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch (err) {
    copied = false;
  }

  if (!copied) {
    try {
      const temp = document.createElement('textarea');
      temp.value = text;
      temp.setAttribute('readonly', '');
      temp.style.position = 'fixed';
      temp.style.left = '-9999px';
      temp.style.top = '0';
      document.body.appendChild(temp);
      temp.focus();
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
      copied = true;
    } catch (err) {
      copied = false;
    }
  }

  if (copied && btn) showOlliCopySuccess(btn);
}
function openSaveModal(text) {
  currentFeedbackToSave = text;
  document.getElementById('saveModal').style.display = 'flex';
  document.getElementById('studentName').value = '';
  document.getElementById('studentName').focus();
}
function closeSaveModal() { hideModalOnly('saveModal'); currentFeedbackToSave = ''; }
async function confirmSave() {
  const name = document.getElementById('studentName').value.trim();
  if (!name) { alert('아이 이름을 입력해 주세요!'); return; }

  const year = new Date().getFullYear();
  const date = new Date().toLocaleDateString('ko-KR');
  const isSummary = currentSaveType === 'summary';
  const tableName = isSummary ? 'summary_feedbacks' : getFeedbackTableNameByType(currentSaveType);
  const studentDivision = getPreferredStudentTypeForSave();
  const normalizedFeedbackType = tableName === 'fail_feedbacks' ? 'fail' : currentSaveType;
  let payload;

  try {
    const savedStudent = await getOrCreateStudentForSupabaseSave(name, studentDivision);

    payload = isSummary
      ? addOlliAcademyToPayload({
          student_id: savedStudent.id,
          student_name: savedStudent.name || name,
          content: currentFeedbackToSave,
          year,
          date
        }, '종합 피드백 저장')
      : addOlliAcademyToPayload({
          student_id: savedStudent.id,
          student_name: savedStudent.name || name,
          content: currentFeedbackToSave,
          feedback_type: normalizedFeedbackType,
          year,
          date
        }, tableName === 'fail_feedbacks' ? '실패·성장 피드백 저장' : '피드백 저장');

    await saveFeedbackRowVerified(tableName, payload, isSummary ? '종합 피드백 저장' : (tableName === 'fail_feedbacks' ? '실패·성장 피드백 저장' : '피드백 저장'));

    closeSaveModal();

    const recordRoomScreen = document.getElementById('recordRoomScreen');
    const recordVisible = recordRoomScreen && recordRoomScreen.style.display !== 'none';
    if (recordVisible && typeof loadRecords === 'function') {
      await loadRecords('');
    }

    const mainPage = document.getElementById('mainPageScreen');
    const isOneMinuteVisible = mainPage && mainPage.style.display !== 'none';
    if (isOneMinuteVisible && typeof resetOneMinuteFeedback === 'function') {
      resetOneMinuteFeedback();
    }
  } catch (err) {
    console.error('피드백 저장 오류:', err);
    alert(`저장 중 오류가 발생했어요.\n\n${err.message || '알 수 없는 오류입니다.'}`);
  }
}

async function shareText(text) {
  if (navigator.share) {
    try { await navigator.share({ text }); return true; } catch (err) { if (err && err.name === 'AbortError') return false; }
  }
  await navigator.clipboard.writeText(text);
  alert('공유 기능을 사용할 수 없어 복사로 대신 저장했어요.');
  return true;
}
function parseReplyType(rawText) {
  const text = String(rawText || '').trim();
  if (text.startsWith('[TYPE:FAIL]')) return { type: 'fail', cleanText: text.replace(/^\[TYPE:FAIL\]\s*/i, '') };
  if (text.startsWith('[TYPE:CLASS]')) return { type: 'class', cleanText: text.replace(/^\[TYPE:CLASS\]\s*/i, '') };
  if (text.startsWith('[TYPE:SUMMARY]')) return { type: 'summary', cleanText: text.replace(/^\[TYPE:SUMMARY\]\s*/i, '') };
  if (text.startsWith('[TYPE:KINDER_ONE_MONTH]')) return { type: 'kinder_one_month', cleanText: text.replace(/^\[TYPE:KINDER_ONE_MONTH\]\s*/i, '') };
  if (text.startsWith('[TYPE]')) return { type: 'kinder_one_month', cleanText: text.replace(/^\[TYPE\]\s*/i, '') };
  return { type: 'class', cleanText: text };
}
function getApiErrorMessage(status, data) {
  const msg = data?.error || data?.message || data?.detail?.error?.message || '알 수 없는 오류가 발생했습니다.';
  if (status === 400) return `요청 형식 오류(400)\n${msg}`;
  if (status === 401) return `인증 오류(401)\n${msg}`;
  if (status === 403) return `권한 오류(403)\n${msg}`;
  if (status === 404) return `API 경로 오류(404)\n${msg}`;
  if (status === 429) return `한도 초과(429)\n${msg}`;
  if (status >= 500) return `서버 오류(${status})\n${msg}`;
  return `요청 실패(${status})\n${msg}`;
}
const FAIL_SURVEY_OPTIONS = {
  A2: [['1','가위'],['2','풀'],['3','색칠/물감'],['4','연필/선따라/그리기'],['5','스티커/오려붙이기'],['6','조형'],['7','관계/차례'],['8','기타']],
  A2_1: { '1': [['1','선이어긋남'],['2','모서리찢어짐'],['3','종이접혀잘림'],['4','작은부분어려움'],['5','손이멈춤']], '2': [['1','양조절어려움'],['2','종이들뜸'],['3','손에풀묻어불편'],['4','붙인위치틀어짐'],['5','마르는시간답답']], '3': [['1','색번짐'],['2','선밖으로나감'],['3','진하기조절어려움'],['4','크레파스/붓뭉침'],['5','색이생각과다름']], '4': [['1','선흔들림'],['2','진하게눌러지워지지않음'],['3','크기커짐/작아짐'],['4','비례마음에안듦'],['5','반복수정']], '5': [['1','위치마음에안듦'],['2','떼다찢어짐'],['3','손에달라붙음'],['4','순서꼬임'],['5','정렬어려움']], '6': [['1','붙인부분떨어짐'],['2','형태무너짐'],['3','힘조절어려움'],['4','세부표현어려움'],['5','손에달라붙음']], '7': [['1','기다리기어려움'],['2','내차례늦다고느낌'],['3','친구먼저해서속상'],['4','공유어려움'],['5','규칙헷갈림']], '8': [['1','기타상황']] },
  A3: [['1','기술'],['2','표현'],['3','계획'],['4','규칙'],['5','사회성'],['6','집중'],['7','기타']],
  A4: [['1','멈춤'],['2','도구내림'],['3','작품가림'],['4','구김'],['5','찢음'],['6','던짐'],['7','자리이탈'],['8','울음'],['9','위축'],['10','포기'],['11','다시잡음'],['12','소리지름'],['13','기타']],
  A5: [['1','안돼'],['2','망했어'],['3','못해'],['4','해줘'],['5','어떻게해?'],['6','다시할래'],['7','도와주세요'],['8','말없음'],['9','싫어요'],['10','기타']],
  A6: [['1','작품응시'],['2','선생님확인'],['3','주변눈치'],['4','무시/회피'],['5','기타']],
  A7: [['1','소근육/도구미숙'],['2','방법/순서혼란'],['3','난이도과부하'],['4','시간압박'],['5','규칙이해부족'],['6','감정흔들림'],['7','또래/환경영향'],['8','컨디션'],['9','자신감부족'],['10','기타']],
  A8: [['1','관찰후질문'],['2','시범'],['3','단계쪼개기'],['4','대안제시'],['5','휴식후재시작'],['6','규칙다시안내'],['7','신뢰언어'],['8','친구와연결'],['9','감정공유'],['10','개입거의없음'],['11','기타']],
  A9: [['1','스스로도구잡음'],['2','속도줄여재시도'],['3','다른방식재시도'],['4','작은부분시작'],['5','어떻게해? 질문'],['6','자리돌아와마무리'],['7','친구에게양보'],['8','친구와협력'],['9','놀이로전환'],['10','규칙지키기'],['11','전환없음'],['12','기타']],
  A10: [['1','끝까지완성'],['2','부분완성'],['3','실패했지만재도전'],['4','도움받아완성'],['5','중단'],['6','다른활동전환'],['7','기타']],
  A11: [['1','자신감상승'],['2','기술보완'],['3','표현확장'],['4','계획세우기'],['5','규칙/차례적응'],['6','집중력루틴'],['7','아이마음공감'],['8','기타']],
  A12: [['1','안전'],['2','강한감정폭발'],['3','자해/타해시도'],['4','심한위축/공포'],['5','또래괴롭힘'],['6','반복회피/거부'],['7','특이행동'],['8','해당없음'],['9','기타']],
  A13: [['1','기분많이좋아짐'],['2','평소와동일'],['3','속상한마음조금남음'],['4','많이속상한상태'],['5','잘모르겠음']]
};
const FAIL_SURVEY_MULTI_MAX = { A3:3, A4:3, A5:3, A6:3, A7:3, A8:3, A9:2, A11:3 };
