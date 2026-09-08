/* ─────────────────────────────────────────────────────────────
   P0 storage retry bridge
   - Feedback CREATE failures are mirrored into the common SyncQueue.
   - Manual resend always reuses the original client_mutation_id and
     calls the idempotent feedback RPC, never a plain table POST.
   - Other queue features keep the existing resend behavior.
───────────────────────────────────────────────────────────── */
(function installOlliStorageRetryBridge(global) {
  'use strict';

  if (global.__olliStorageRetryBridgeP0) return;

  const TARGETS = Object.freeze({
    general_feedback: {
      table: 'feedbacks',
      rpc: 'olli_feedback_insert_idempotent',
      label: '일반 피드백'
    },
    growth_feedback: {
      table: 'fail_feedbacks',
      rpc: 'olli_growth_feedback_insert_idempotent',
      label: '성장 피드백'
    },
    summary_feedback: {
      table: 'summary_feedbacks',
      rpc: 'olli_summary_feedback_insert_idempotent',
      label: '종합 피드백'
    }
  });
  const TABLE_TO_FEATURE = Object.freeze(Object.keys(TARGETS).reduce((map, feature) => {
    map[TARGETS[feature].table] = feature;
    return map;
  }, {}));
  const PENDING_KEY_PREFIX = 'olli_feedback_idempotency_pending_v1';

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function currentAcademyId(payload) {
    const fromPayload = clean(payload && payload.academy_id);
    if (fromPayload) return fromPayload;
    try {
      if (typeof global.getOlliCurrentAcademyId === 'function') {
        const id = clean(global.getOlliCurrentAcademyId());
        if (id) return id;
      }
    } catch (_) {}
    try { return clean(localStorage.getItem('olli_current_academy_id')); }
    catch (_) { return ''; }
  }

  function pendingKey(academyId) {
    return `${PENDING_KEY_PREFIX}_${clean(academyId) || 'unscoped'}`;
  }

  function readPending(academyId) {
    try {
      const raw = JSON.parse(localStorage.getItem(pendingKey(academyId)) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (_) {
      return [];
    }
  }

  function writePending(academyId, list) {
    try {
      localStorage.setItem(pendingKey(academyId), JSON.stringify(Array.isArray(list) ? list.slice(0, 80) : []));
    } catch (error) {
      console.warn('피드백 재전송 pending 정리 실패:', error?.message || error);
    }
  }

  function sameFeedbackPayload(entry, tableName, payload) {
    if (!entry || clean(entry.tableName) !== clean(tableName)) return false;
    const saved = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
    if (clean(saved.student_id) !== clean(payload && payload.student_id)) return false;
    if (String(saved.content == null ? '' : saved.content) !== String(payload && payload.content == null ? '' : payload.content)) return false;
    const savedType = tableName === 'fail_feedbacks' ? clean(saved.feedback_type || 'fail') : clean(saved.feedback_type);
    const payloadType = tableName === 'fail_feedbacks' ? clean(payload && payload.feedback_type || 'fail') : clean(payload && payload.feedback_type);
    return savedType === payloadType;
  }

  function findPendingForPayload(tableName, payload) {
    const academyId = currentAcademyId(payload);
    if (!academyId) return null;
    const list = readPending(academyId);
    return list.find(item => sameFeedbackPayload(item, tableName, payload)) || null;
  }

  function clearPendingMutation(academyId, mutationId) {
    const id = clean(mutationId);
    if (!academyId || !id) return;
    const list = readPending(academyId).filter(item => clean(item.mutationId) !== id);
    writePending(academyId, list);
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

  function errorCode(error) {
    const message = String(error && (error.message || error) || '');
    if (/FEEDBACK_IDEMPOTENCY_MISMATCH/.test(message)) return 'FEEDBACK_IDEMPOTENCY_MISMATCH';
    if (/FEEDBACK_IDEMPOTENCY_INPUT_MISSING/.test(message)) return 'FEEDBACK_IDEMPOTENCY_INPUT_MISSING';
    const status = statusFromError(error);
    if (status) return `HTTP_${status}`;
    return clean(error && error.code) || 'SERVER_WRITE_FAILED';
  }

  function coreQueue() {
    const core = global.OlliStorageCore;
    return core && core.SyncQueue ? core.SyncQueue : null;
  }

  function clearGenericQueueMutation(academyId, feature, mutationId) {
    const queue = coreQueue();
    if (!queue || !academyId || !mutationId) return;
    const matches = queue.read(academyId).filter(item =>
      clean(item.feature) === clean(feature)
      && clean(item.client_mutation_id) === clean(mutationId)
    );
    matches.forEach(item => queue.remove(academyId, item.queue_id));
  }

  function mirrorPendingToGenericQueue(tableName, payload, error) {
    const feature = TABLE_TO_FEATURE[clean(tableName)];
    const target = TARGETS[feature];
    const queue = coreQueue();
    if (!feature || !target || !queue) return null;

    const entry = findPendingForPayload(tableName, payload || {});
    if (!entry || !clean(entry.mutationId)) return null;

    const academyId = clean(entry.academyId) || currentAcademyId(payload);
    const mutationId = clean(entry.mutationId);
    const serverPayload = {
      ...(entry.payload && typeof entry.payload === 'object' ? entry.payload : {}),
      ...(payload && typeof payload === 'object' ? payload : {}),
      academy_id: academyId,
      client_mutation_id: mutationId
    };
    const status = isRetryableError(error) ? 'pending' : 'blocked';
    const existing = queue.read(academyId).find(item =>
      clean(item.feature) === feature && clean(item.client_mutation_id) === mutationId
    );
    const patch = {
      feature,
      operation: 'create',
      academy_id: academyId,
      student_id: serverPayload.student_id || null,
      record_id: mutationId,
      client_mutation_id: mutationId,
      payload: serverPayload,
      status,
      error_code: errorCode(error),
      error_message: String(error && (error.message || error) || ''),
      last_attempt_at: new Date().toISOString()
    };

    if (existing) return queue.update(academyId, existing.queue_id, patch);
    return queue.enqueue(patch, { coalesce: false });
  }

  function verifyReturnedRow(target, row, payload, mutationId) {
    if (!row || typeof row !== 'object') throw new Error(`${target.label} 서버 저장 행을 확인하지 못했습니다.`);
    if (clean(row.academy_id) !== clean(payload.academy_id)) throw new Error(`${target.label} 서버 검증 실패: academy_id가 일치하지 않습니다.`);
    if (clean(row.student_id) !== clean(payload.student_id)) throw new Error(`${target.label} 서버 검증 실패: student_id가 일치하지 않습니다.`);
    if (String(row.content == null ? '' : row.content) !== String(payload.content == null ? '' : payload.content)) {
      throw new Error(`${target.label} 서버 검증 실패: 피드백 내용이 일치하지 않습니다.`);
    }
    const expectedType = target.table === 'fail_feedbacks' ? clean(payload.feedback_type || 'fail') : clean(payload.feedback_type);
    if (expectedType && clean(row.feedback_type) !== expectedType) throw new Error(`${target.label} 서버 검증 실패: feedback_type이 일치하지 않습니다.`);
    if (clean(row.client_mutation_id) !== clean(mutationId)) throw new Error(`${target.label} 서버 검증 실패: mutation ID가 일치하지 않습니다.`);
    return row;
  }

  function writeSyncedLocal(feature, payload, mutationId, row) {
    try {
      if (typeof global.writeFeedbackCommonLocal !== 'function') return;
      const target = TARGETS[feature];
      if (!target) return;
      global.writeFeedbackCommonLocal(
        { feature, label: target.label, recordPrefix: feature },
        { ...payload, client_mutation_id: mutationId, client_record_id: mutationId },
        mutationId,
        'synced',
        row
      );
    } catch (error) {
      console.warn('피드백 재전송 로컬 동기화 기록 실패:', error?.message || error);
    }
  }

  async function retryFeedbackQueueItem(item) {
    const feature = clean(item && item.feature);
    const target = TARGETS[feature];
    if (!target) throw new Error('피드백 재전송 대상이 아닙니다.');
    if (typeof global.supabase !== 'function') throw new Error('피드백 서버 연결 함수가 준비되지 않았습니다.');

    const rawPayload = item && item.payload && typeof item.payload === 'object' ? item.payload : {};
    const academyId = clean(item && item.academy_id) || currentAcademyId(rawPayload);
    const studentId = clean(item && item.student_id) || clean(rawPayload.student_id);
    const mutationId = clean(item && item.client_mutation_id) || clean(rawPayload.client_mutation_id);
    if (!academyId || !studentId || !mutationId) throw new Error(`${target.label} 재전송 식별값이 없습니다.`);

    const payload = {
      ...rawPayload,
      academy_id: academyId,
      student_id: studentId,
      client_mutation_id: mutationId
    };
    if (!String(payload.content || '').trim()) throw new Error(`${target.label} 재전송 내용이 비어 있습니다.`);

    const rows = await global.supabase('POST', `rpc/${target.rpc}`, { p_payload: payload });
    const row = Array.isArray(rows) ? rows[0] : rows;
    const verified = verifyReturnedRow(target, row, payload, mutationId);
    clearPendingMutation(academyId, mutationId);
    clearGenericQueueMutation(academyId, feature, mutationId);
    writeSyncedLocal(feature, payload, mutationId, verified);
    return verified;
  }

  function installSaveFailureMirror() {
    const current = global.saveFeedbackRowVerified;
    if (typeof current !== 'function') return false;
    if (current.__olliStorageRetryBridgeP0) return true;

    const wrapped = async function saveFeedbackRowVerifiedWithRetryQueue(tableName, payload, label) {
      const table = clean(tableName);
      const feature = TABLE_TO_FEATURE[table];
      if (!feature) return current.apply(this, arguments);

      const before = findPendingForPayload(table, payload || {});
      try {
        const row = await current.apply(this, arguments);
        const mutationId = clean(row && row.client_mutation_id) || clean(before && before.mutationId);
        if (mutationId) clearGenericQueueMutation(currentAcademyId(payload), feature, mutationId);
        return row;
      } catch (error) {
        mirrorPendingToGenericQueue(table, payload || {}, error);
        throw error;
      }
    };
    wrapped.__olliStorageRetryBridgeP0 = true;
    wrapped.__originalFeedbackSave = current;
    global.saveFeedbackRowVerified = wrapped;
    return true;
  }

  function feedbackQueueItemIsPermanentlyBlocked(item) {
    const message = String(item && (item.error_message || item.error_code) || '');
    return /FEEDBACK_IDEMPOTENCY_(?:MISMATCH|INPUT_MISSING)/.test(message);
  }

  function installRetryOverride() {
    const current = global.retryOlliStorageQueue;
    if (typeof current !== 'function') return false;
    if (current.__olliStorageRetryBridgeP0) return true;

    const retryAll = async function retryOlliStorageQueueP0() {
      const core = global.OlliStorageCore;
      const academyId = (typeof global.settingsGetAcademyId === 'function' && global.settingsGetAcademyId())
        || localStorage.getItem('olli_current_academy_id')
        || '';
      if (!core || !core.SyncQueue || !core.FeatureRegistry) {
        alert('공통 저장 기반이 아직 준비되지 않았습니다. 앱을 새로고침한 뒤 다시 시도해 주세요.');
        return;
      }
      if (!academyId) {
        alert('현재 학원 ID를 확인할 수 없습니다. 학원을 다시 선택한 뒤 시도해 주세요.');
        return;
      }
      if (navigator && navigator.onLine === false) {
        alert('인터넷 연결 후 재전송을 실행해 주세요.');
        return;
      }

      const queue = core.SyncQueue.read(academyId).filter(item => {
        const status = clean(item.status || 'pending');
        if (status !== 'blocked') return true;
        const feature = clean(item.feature);
        if (feature === 'student_soft_delete') return true;
        if (TARGETS[feature]) return !feedbackQueueItemIsPermanentlyBlocked(item);
        return false;
      });
      if (!queue.length) {
        alert('재전송할 대기 항목이 없습니다.');
        if (typeof global.refreshOlliStorageDiagnostics === 'function') global.refreshOlliStorageDiagnostics();
        return;
      }

      let success = 0;
      let failed = 0;
      let skipped = 0;
      const max = Math.min(queue.length, 20);
      for (let i = 0; i < max; i += 1) {
        const item = queue[i];
        const queueId = item.queue_id;
        const feature = clean(item.feature);
        const operation = clean(item.operation).toLowerCase();

        if (!feature || !core.FeatureRegistry.has(feature)) {
          failed += 1;
          core.SyncQueue.update(academyId, queueId, {
            status: 'blocked',
            last_attempt_at: new Date().toISOString(),
            retry_count: Number(item.retry_count || 0) + 1,
            error_code: 'FEATURE_NOT_REGISTERED',
            error_message: '등록되지 않은 저장 기능입니다: ' + feature
          });
          continue;
        }
        if (operation === 'upload') {
          skipped += 1;
          core.SyncQueue.update(academyId, queueId, {
            status: 'blocked',
            last_attempt_at: new Date().toISOString(),
            retry_count: Number(item.retry_count || 0) + 1,
            error_code: 'FILE_RETRY_NEEDS_INDEXEDDB',
            error_message: '사진 파일 업로드 재전송은 IndexedDB 파일 보관 구조가 필요합니다.'
          });
          continue;
        }

        core.SyncQueue.update(academyId, queueId, {
          last_attempt_at: new Date().toISOString(),
          retry_count: Number(item.retry_count || 0) + 1,
          status: 'pending'
        });

        try {
          if (TARGETS[feature]) {
            await retryFeedbackQueueItem(item);
            core.SyncQueue.remove(academyId, queueId);
            success += 1;
            continue;
          }

          const request = {
            academyId: item.academy_id || academyId,
            studentId: item.student_id || undefined,
            memberId: item.member_id || undefined,
            recordId: item.record_id || undefined,
            fileId: item.file_id || undefined,
            noteType: item.note_type || undefined,
            localRecordId: item.local_record_id || undefined,
            data: item.payload || {},
            clientMutationId: item.client_mutation_id || undefined,
            forceCommon: true,
            suppressQueue: true
          };
          if (feature === 'student_soft_delete') {
            const p = item.payload && typeof item.payload === 'object' ? item.payload : {};
            const retryAt = new Date().toISOString();
            request.data = {
              is_deleted: true,
              deleted_at: p.deleted_at || retryAt,
              deleted_by: p.deleted_by || localStorage.getItem('olli_current_member_id') || localStorage.getItem('olli_current_user_id') || '',
              delete_reason: p.delete_reason || p.reason || 'student_deleted'
            };
          }

          let result;
          if (operation === 'delete' || operation === 'soft_delete') {
            result = await global.deleteOlliData(feature, Object.assign({}, request, {
              deleteMode: (item.payload && item.payload.deleteMode) || 'soft',
              reason: (item.payload && item.payload.reason) || 'retry'
            }));
          } else {
            result = await global.saveOlliData(feature, request);
          }

          if ((result && result.serverSaved) || (result && result.deleted)) {
            core.SyncQueue.remove(academyId, queueId);
            success += 1;
          } else if (result && result.ok && result.pending) {
            failed += 1;
            core.SyncQueue.update(academyId, queueId, {
              status: 'pending',
              error_code: result.errorCode || 'SERVER_WRITE_PENDING',
              error_message: String(result.error && (result.error.message || result.error) || '서버 저장이 아직 완료되지 않았습니다.')
            });
          } else {
            failed += 1;
            core.SyncQueue.update(academyId, queueId, {
              status: 'pending',
              error_code: (result && result.errorCode) || 'RETRY_FAILED',
              error_message: String(result && result.error && (result.error.message || result.error) || (result && result.reason) || '재전송에 실패했습니다.')
            });
          }
        } catch (error) {
          failed += 1;
          const isFeedback = !!TARGETS[feature];
          core.SyncQueue.update(academyId, queueId, {
            status: isFeedback && !isRetryableError(error) ? 'blocked' : 'pending',
            error_code: isFeedback ? errorCode(error) : (error && error.code) || 'RETRY_FAILED',
            error_message: String(error && (error.message || error) || '')
          });
          if (core.Diagnostics && typeof core.Diagnostics.record === 'function') {
            core.Diagnostics.record({
              feature,
              resource: '',
              operation: 'retry',
              academy_id: academyId,
              student_id: item.student_id || null,
              error_code: isFeedback ? errorCode(error) : (error && error.code) || 'RETRY_FAILED',
              error_message: String(error && (error.message || error) || '')
            });
          }
        }
      }

      if (typeof global.refreshOlliStorageDiagnostics === 'function') global.refreshOlliStorageDiagnostics();
      alert('재전송 처리 결과\n성공: ' + success + '건\n실패: ' + failed + '건' + (skipped ? '\n보류: ' + skipped + '건' : ''));
    };

    retryAll.__olliStorageRetryBridgeP0 = true;
    retryAll.__originalRetryQueue = current;
    global.retryOlliStorageQueue = retryAll;
    return true;
  }

  global.retryFeedbackIdempotentQueueItem = retryFeedbackQueueItem;

  let attempts = 0;
  const install = () => {
    attempts += 1;
    const saveReady = installSaveFailureMirror();
    const retryReady = installRetryOverride();
    if (saveReady && retryReady) {
      global.__olliStorageRetryBridgeP0 = true;
      return true;
    }
    return false;
  };

  if (!install()) {
    const timer = setInterval(() => {
      if (install() || attempts >= 120) clearInterval(timer);
    }, 50);
  }
})(window);
