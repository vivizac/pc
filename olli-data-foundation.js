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
    kinder_memo: KINDER_MEMO_PREFIX + id,
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


