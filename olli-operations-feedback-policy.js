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

/* ── P0: feedback creation idempotency ─────────────────────────
   A feedback save gets one mutation id and keeps it until the
   server confirms the row. Re-sending the same pending save uses
   the same RPC + mutation id, so response loss cannot create a
   duplicate feedback row. Existing feedback edits are untouched.
────────────────────────────────────────────────────────────── */
(function installFeedbackCreateIdempotency(global) {
  'use strict';

  if (global.__olliFeedbackCreateIdempotencyInstalled) return;

  const TARGETS = Object.freeze({
    feedbacks: {
      rpc: 'olli_feedback_insert_idempotent',
      feature: 'general_feedback',
      label: '일반 피드백'
    },
    fail_feedbacks: {
      rpc: 'olli_growth_feedback_insert_idempotent',
      feature: 'growth_feedback',
      label: '성장 피드백'
    },
    summary_feedbacks: {
      rpc: 'olli_summary_feedback_insert_idempotent',
      feature: 'summary_feedback',
      label: '종합 피드백'
    }
  });
  const PENDING_KEY_PREFIX = 'olli_feedback_idempotency_pending_v1';
  const PENDING_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  const MAX_PENDING_PER_ACADEMY = 80;
  const VOLATILE_FINGERPRINT_FIELDS = new Set([
    'client_mutation_id',
    'clientMutationId',
    'client_record_id',
    'record_id',
    'id',
    'created_at',
    'updated_at',
    'date',
    'year'
  ]);

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function currentAcademyId(payload) {
    const fromPayload = clean(payload && payload.academy_id);
    if (fromPayload) return fromPayload;
    try {
      if (typeof global.getOlliCurrentAcademyId === 'function') {
        const current = clean(global.getOlliCurrentAcademyId());
        if (current) return current;
      }
    } catch (_) {}
    try { return clean(localStorage.getItem('olli_current_academy_id')); }
    catch (_) { return ''; }
  }

  function pendingStorageKey(academyId) {
    return `${PENDING_KEY_PREFIX}_${clean(academyId) || 'unscoped'}`;
  }

  function normalizeFingerprintValue(value) {
    if (Array.isArray(value)) return value.map(normalizeFingerprintValue);
    if (value && typeof value === 'object') {
      return Object.keys(value)
        .filter(key => !VOLATILE_FINGERPRINT_FIELDS.has(key))
        .sort()
        .reduce((result, key) => {
          result[key] = normalizeFingerprintValue(value[key]);
          return result;
        }, {});
    }
    return value == null ? null : value;
  }

  function feedbackFingerprint(tableName, payload) {
    return JSON.stringify([
      clean(tableName),
      normalizeFingerprintValue(payload && typeof payload === 'object' ? payload : {})
    ]);
  }

  function createMutationId() {
    try {
      if (global.crypto && typeof global.crypto.randomUUID === 'function') {
        return `fbm_${global.crypto.randomUUID()}`;
      }
    } catch (_) {}
    return `fbm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  function readPending(academyId) {
    try {
      const raw = JSON.parse(localStorage.getItem(pendingStorageKey(academyId)) || '[]');
      const now = Date.now();
      return (Array.isArray(raw) ? raw : [])
        .filter(item => item && item.mutationId && item.fingerprint)
        .filter(item => {
          const created = new Date(item.createdAt || item.updatedAt || 0).getTime();
          return !created || Number.isNaN(created) || now - created <= PENDING_MAX_AGE_MS;
        })
        .slice(0, MAX_PENDING_PER_ACADEMY);
    } catch (_) {
      return [];
    }
  }

  function writePending(academyId, list) {
    try {
      localStorage.setItem(
        pendingStorageKey(academyId),
        JSON.stringify((Array.isArray(list) ? list : []).slice(0, MAX_PENDING_PER_ACADEMY))
      );
    } catch (error) {
      console.warn('피드백 중복방지 대기정보 저장 실패:', error?.message || error);
    }
  }

  function feedbackQueueCore() {
    const core = global.OlliStorageCore;
    return core && core.SyncQueue ? core : null;
  }

  function tableNameFromFeedbackItem(item) {
    const direct = clean(item && (item.feedback_table || item.tableName || item.table_name));
    if (TARGETS[direct]) return direct;
    const feature = clean(item && item.feature);
    return Object.keys(TARGETS).find(tableName => TARGETS[tableName].feature === feature) || '';
  }

  function feedbackQueueItem(academyId, mutationId) {
    const core = feedbackQueueCore();
    if (!core || !academyId || !mutationId) return null;
    try {
      return core.SyncQueue.read(academyId).find(item =>
        clean(item && item.client_mutation_id) === clean(mutationId)
        && !!tableNameFromFeedbackItem(item)
      ) || null;
    } catch (_) {
      return null;
    }
  }

  function mirrorPendingToSyncQueue(entry, payload, status, errorMessage) {
    if (!entry || !entry.academyId || !entry.mutationId || !entry.tableName) return;
    const core = feedbackQueueCore();
    if (!core) return;
    const spec = TARGETS[entry.tableName];
    if (!spec) return;
    const serverPayload = {
      ...(payload || entry.payload || {}),
      academy_id: entry.academyId,
      client_mutation_id: entry.mutationId
    };
    const patch = {
      feature: spec.feature,
      operation: 'create',
      academy_id: entry.academyId,
      student_id: clean(serverPayload.student_id) || null,
      client_mutation_id: entry.mutationId,
      feedback_table: entry.tableName,
      payload: serverPayload,
      status: status || entry.status || 'pending',
      error_code: null,
      error_message: clean(errorMessage || entry.lastError) || null
    };
    try {
      const existing = feedbackQueueItem(entry.academyId, entry.mutationId);
      if (existing) core.SyncQueue.update(entry.academyId, existing.queue_id, patch);
      else core.SyncQueue.enqueue(patch, { coalesce: false });
    } catch (error) {
      console.warn('피드백 공통 재전송 대기열 연결 실패:', error?.message || error);
    }
  }

  function removeFeedbackFromSyncQueue(entry) {
    if (!entry || !entry.academyId || !entry.mutationId) return;
    const core = feedbackQueueCore();
    if (!core) return;
    try {
      core.SyncQueue.read(entry.academyId)
        .filter(item => clean(item && item.client_mutation_id) === clean(entry.mutationId))
        .filter(item => !!tableNameFromFeedbackItem(item))
        .forEach(item => core.SyncQueue.remove(entry.academyId, item.queue_id));
    } catch (error) {
      console.warn('피드백 공통 재전송 대기열 정리 실패:', error?.message || error);
    }
  }

  function rememberPending(tableName, payload, label) {
    const academyId = currentAcademyId(payload);
    if (!academyId) throw new Error(`${label || '피드백'} 저장 학원 정보를 찾지 못했습니다.`);
    const fingerprint = feedbackFingerprint(tableName, payload);
    const list = readPending(academyId);
    const existing = list.find(item => item.fingerprint === fingerprint && item.tableName === tableName);
    if (existing) {
      existing.updatedAt = new Date().toISOString();
      existing.attempts = Number(existing.attempts || 0);
      writePending(academyId, list);
      mirrorPendingToSyncQueue(existing, { ...(existing.payload || payload || {}), client_mutation_id: existing.mutationId }, existing.status || 'pending', existing.lastError || '');
      return existing;
    }

    const now = new Date().toISOString();
    const entry = {
      tableName,
      academyId,
      mutationId: createMutationId(),
      fingerprint,
      payload: { ...(payload || {}) },
      label: String(label || TARGETS[tableName]?.label || '피드백 저장'),
      attempts: 0,
      status: 'pending',
      lastError: '',
      createdAt: now,
      updatedAt: now
    };
    list.unshift(entry);
    writePending(academyId, list);
    mirrorPendingToSyncQueue(entry, { ...entry.payload, client_mutation_id: entry.mutationId }, 'pending', '');
    return entry;
  }

  function updatePending(entry, patch) {
    if (!entry || !entry.academyId || !entry.mutationId) return;
    const list = readPending(entry.academyId);
    const index = list.findIndex(item => item.mutationId === entry.mutationId);
    let nextEntry = { ...entry, ...(patch || {}), updatedAt: new Date().toISOString() };
    if (index >= 0) {
      list[index] = { ...list[index], ...(patch || {}), updatedAt: nextEntry.updatedAt };
      nextEntry = list[index];
      writePending(entry.academyId, list);
    }
    mirrorPendingToSyncQueue(nextEntry, { ...(nextEntry.payload || {}), client_mutation_id: nextEntry.mutationId }, nextEntry.status || 'pending', nextEntry.lastError || '');
  }

  function clearPending(entry) {
    if (!entry || !entry.academyId || !entry.mutationId) return;
    const list = readPending(entry.academyId)
      .filter(item => item.mutationId !== entry.mutationId);
    writePending(entry.academyId, list);
    removeFeedbackFromSyncQueue(entry);
  }

  function verifyReturnedRow(tableName, row, payload, mutationId, label) {
    if (!row || typeof row !== 'object') {
      throw new Error(`${label} 서버 저장 행을 확인하지 못했습니다.`);
    }
    const expectedAcademy = clean(payload.academy_id);
    const expectedStudent = clean(payload.student_id);
    if (expectedAcademy && clean(row.academy_id) !== expectedAcademy) {
      throw new Error(`${label} 서버 검증 실패: academy_id가 일치하지 않습니다.`);
    }
    if (expectedStudent && clean(row.student_id) !== expectedStudent) {
      throw new Error(`${label} 서버 검증 실패: student_id가 일치하지 않습니다.`);
    }
    if (String(row.content == null ? '' : row.content) !== String(payload.content == null ? '' : payload.content)) {
      throw new Error(`${label} 서버 검증 실패: 피드백 내용이 일치하지 않습니다.`);
    }
    const expectedType = tableName === 'fail_feedbacks'
      ? clean(payload.feedback_type || 'fail')
      : clean(payload.feedback_type);
    if (expectedType && clean(row.feedback_type) !== expectedType) {
      throw new Error(`${label} 서버 검증 실패: feedback_type이 일치하지 않습니다.`);
    }
    if (clean(row.client_mutation_id) !== clean(mutationId)) {
      throw new Error(`${label} 서버 검증 실패: mutation ID가 일치하지 않습니다.`);
    }
    return row;
  }

  function statusFromError(error) {
    const message = String(error && (error.message || error) || '');
    const match = message.match(/Supabase 요청 실패\s*\((\d{3})\)/);
    return match ? Number(match[1]) : 0;
  }

  function isRetryableError(error) {
    const message = String(error && (error.message || error) || '');
    if (/FEEDBACK_IDEMPOTENCY_(?:MISMATCH|INPUT_MISSING)/.test(message)) return false;
    const status = statusFromError(error);
    if (!status) return true;
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function writeFeedbackLocal(tableName, payload, mutationId, syncStatus, row) {
    try {
      if (typeof global.getFeedbackCommonStorageFeature !== 'function' ||
          typeof global.writeFeedbackCommonLocal !== 'function') return;
      const commonFeature = global.getFeedbackCommonStorageFeature(tableName, payload);
      if (!commonFeature) return;
      global.writeFeedbackCommonLocal(
        commonFeature,
        { ...payload, client_mutation_id: mutationId, client_record_id: mutationId },
        mutationId,
        syncStatus,
        row || null
      );
    } catch (error) {
      console.warn('피드백 공통 로컬 기록 실패:', error?.message || error);
    }
  }

  function recordFeedbackIdempotencyIssue(tableName, payload, entry, error, phase) {
    try {
      if (typeof global.recordOlliStorageIssue !== 'function') return;
      global.recordOlliStorageIssue({
        feature: TARGETS[tableName]?.feature || 'feedback_idempotency',
        resource: tableName,
        operation: phase || 'save',
        student_id: payload?.student_id || '',
        message: `${String(error && (error.message || error) || '')} [mutation:${entry?.mutationId || ''}]`
      });
    } catch (_) {}
  }

  async function saveIdempotentFeedback(tableName, payload = {}, label = '') {
    const spec = TARGETS[tableName];
    if (!spec) return null;

    const safeLabel = String(label || spec.label || '피드백 저장');
    const academyId = currentAcademyId(payload);
    const studentId = clean(payload.student_id);
    const content = String(payload.content == null ? '' : payload.content);

    if (!academyId || !studentId) throw new Error(`${safeLabel} 저장 식별값이 없습니다.`);
    if (!content.trim()) throw new Error(`${safeLabel} 내용이 비어 있습니다.`);
    if (typeof global.supabase !== 'function') throw new Error(`${safeLabel} 서버 연결 함수가 준비되지 않았습니다.`);

    const normalizedPayload = { ...payload, academy_id: academyId };
    const entry = rememberPending(tableName, normalizedPayload, safeLabel);
    const serverPayload = {
      ...normalizedPayload,
      client_mutation_id: entry.mutationId
    };

    writeFeedbackLocal(tableName, serverPayload, entry.mutationId, 'pending', null);

    let lastError = null;
    const retryDelays = [0, 260, 720];

    for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
      if (retryDelays[attempt]) await delay(retryDelays[attempt]);
      updatePending(entry, { attempts: Number(entry.attempts || 0) + attempt + 1, status: 'pending' });

      try {
        const rows = await global.supabase('POST', `rpc/${spec.rpc}`, { p_payload: serverPayload });
        const row = Array.isArray(rows) ? rows[0] : rows;
        const verified = verifyReturnedRow(tableName, row, serverPayload, entry.mutationId, safeLabel);
        clearPending(entry);
        writeFeedbackLocal(tableName, serverPayload, entry.mutationId, 'synced', verified);
        return verified;
      } catch (error) {
        lastError = error;
        updatePending(entry, {
          status: isRetryableError(error) ? 'pending' : 'blocked',
          lastError: String(error && (error.message || error) || '')
        });
        if (!isRetryableError(error) || attempt === retryDelays.length - 1) break;
      }
    }

    recordFeedbackIdempotencyIssue(tableName, serverPayload, entry, lastError, 'idempotent_create');

    if (String(lastError && (lastError.message || lastError) || '').includes('FEEDBACK_IDEMPOTENCY_MISMATCH')) {
      clearPending(entry);
    }
    throw lastError || new Error(`${safeLabel} 서버 저장에 실패했습니다.`);
  }

  async function retryPendingFeedbackIdempotentWrite(item = {}) {
    const tableName = tableNameFromFeedbackItem(item);
    const spec = TARGETS[tableName];
    const academyId = clean(item.academy_id || item.academyId || (item.payload && item.payload.academy_id));
    const mutationId = clean(item.client_mutation_id || item.mutationId || (item.payload && item.payload.client_mutation_id));
    if (!spec || !academyId || !mutationId) {
      const error = new Error('피드백 재전송 식별값을 확인할 수 없습니다.');
      error.code = 'FEEDBACK_RETRY_IDENTITY_MISSING';
      throw error;
    }
    if (typeof global.supabase !== 'function') {
      const error = new Error('피드백 서버 연결 함수가 준비되지 않았습니다.');
      error.code = 'SERVER_UNAVAILABLE';
      throw error;
    }

    const payload = { ...((item && item.payload) || {}), academy_id: academyId, client_mutation_id: mutationId };
    const entry = {
      tableName,
      academyId,
      mutationId,
      payload,
      label: String(item.label || spec.label || '피드백 저장'),
      status: 'pending',
      lastError: ''
    };
    mirrorPendingToSyncQueue(entry, payload, 'pending', '');
    writeFeedbackLocal(tableName, payload, mutationId, 'pending', null);

    let lastError = null;
    const retryDelays = [0, 260, 720];
    for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
      if (retryDelays[attempt]) await delay(retryDelays[attempt]);
      try {
        const rows = await global.supabase('POST', `rpc/${spec.rpc}`, { p_payload: payload });
        const row = Array.isArray(rows) ? rows[0] : rows;
        const verified = verifyReturnedRow(tableName, row, payload, mutationId, entry.label);
        clearPending(entry);
        writeFeedbackLocal(tableName, payload, mutationId, 'synced', verified);
        return { ok: true, serverSaved: true, row: verified, clientMutationId: mutationId };
      } catch (error) {
        lastError = error;
        const retryable = isRetryableError(error);
        updatePending(entry, { status: retryable ? 'pending' : 'blocked', lastError: String(error && (error.message || error) || '') });
        if (!retryable || attempt == retryDelays.length - 1) break;
      }
    }
    throw lastError || new Error(`${entry.label} 재전송에 실패했습니다.`);
  }

  function install() {
    if (global.__olliFeedbackCreateIdempotencyInstalled) return true;
    if (typeof global.saveFeedbackRowVerified !== 'function' || typeof global.supabase !== 'function') return false;

    const legacySave = global.saveFeedbackRowVerified;
    global.saveFeedbackRowVerified = async function saveFeedbackRowVerifiedIdempotent(tableName, payload, label) {
      const table = clean(tableName);
      if (!TARGETS[table]) return legacySave.apply(this, arguments);
      return saveIdempotentFeedback(table, payload || {}, label || TARGETS[table].label);
    };
    global.saveFeedbackRowVerified.__olliFeedbackIdempotentCreate = true;
    global.saveFeedbackRowVerified.__originalFeedbackSave = legacySave;
    global.__olliFeedbackCreateIdempotencyInstalled = true;

    global.getPendingFeedbackIdempotentWrites = function getPendingFeedbackIdempotentWrites() {
      const academyId = currentAcademyId({});
      return academyId ? readPending(academyId).map(item => ({ ...item })) : [];
    };
    global.retryPendingFeedbackIdempotentWrite = retryPendingFeedbackIdempotentWrite;
    global.isFeedbackIdempotentQueueItem = function isFeedbackIdempotentQueueItem(item) {
      return !!tableNameFromFeedbackItem(item);
    };
    return true;
  }

  if (!install()) {
    let retries = 0;
    const timer = setInterval(() => {
      retries += 1;
      if (install() || retries >= 80) clearInterval(timer);
    }, 50);
  }
})(window);
