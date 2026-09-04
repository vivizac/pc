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


