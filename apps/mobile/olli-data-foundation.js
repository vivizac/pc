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
    return { feature: 'growth_feedback', label: '실패-성장 피드백', recordPrefix: 'growth_feedback' };
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
  writeFeedbackCommonLocal({ feature: 'growth_feedback', label: '실패-성장 피드백', recordPrefix: 'growth_feedback' }, payload, recordId, syncStatus, row);
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
  enqueueFeedbackCommonSave({ feature: 'growth_feedback', label: '실패-성장 피드백', recordPrefix: 'growth_feedback' }, payload, recordId, error);
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
  const data = { ...payload, client_record_id: commonRecordId, client_mutation_id: commonRecordId };
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
  const commonFeature = { feature: 'growth_feedback', label: '실패-성장 피드백', recordPrefix: 'growth_feedback' };
  const commonRecordId = createGrowthFeedbackRecordId(payload);
  const academyId = String(payload.academy_id || '').trim();
  const studentId = String(payload.student_id || '').trim();
  if (!academyId || !studentId) {
    const error = new Error(`${label} 저장 식별값이 없습니다.`);
    recordOlliStorageIssue({ feature: 'growth_feedback', resource: 'fail_feedbacks', operation: 'save', message: error.message, student_id: studentId });
    throw error;
  }
  const data = { ...payload, client_record_id: commonRecordId, client_mutation_id: commonRecordId };
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
  const data = { ...payload, client_record_id: commonRecordId, client_mutation_id: commonRecordId };
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
