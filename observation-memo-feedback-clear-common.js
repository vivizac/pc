/* PC/Phone shared safety for clearing an elementary observation memo after feedback save.
   Server clear is confirmed first; local content is cleared only after success. */
(function initObservationMemoFeedbackClearSafety(global) {
  'use strict';

  if (global.__olliObservationFeedbackClearSafetyLoaded) return;
  global.__olliObservationFeedbackClearSafetyLoaded = true;

  const clearInFlight = new Map();
  let installTimer = null;
  let installAttempts = 0;

  function memoRevision(value) {
    const revision = Number(value || 0);
    return Number.isFinite(revision) && revision >= 0 ? Math.floor(revision) : 0;
  }

  function currentMemoStudentSafe() {
    try {
      if (typeof currentMemoStudent !== 'undefined' && currentMemoStudent) return currentMemoStudent;
    } catch (_) {}
    return global.currentMemoStudent || null;
  }

  function currentMemoTypeSafe() {
    try {
      if (typeof currentMemoType !== 'undefined') return String(currentMemoType || '');
    } catch (_) {}
    return String(global.currentMemoType || '');
  }

  function currentAcademyId() {
    try {
      if (typeof global.getOlliCurrentAcademyId === 'function') {
        return String(global.getOlliCurrentAcademyId() || '').trim();
      }
    } catch (_) {}
    try { return String(localStorage.getItem('olli_current_academy_id') || '').trim(); }
    catch (_) { return ''; }
  }

  function sessionToken() {
    try { return String(localStorage.getItem('olli_account_session_token_v1') || '').trim(); }
    catch (_) { return ''; }
  }

  function deviceId() {
    try {
      if (typeof global.getOlliLoginDeviceId === 'function') {
        const value = String(global.getOlliLoginDeviceId() || '').trim();
        if (value) return value;
      }
    } catch (_) {}
    try {
      return String(
        localStorage.getItem('olli_account_device_id_v1') ||
        localStorage.getItem('olli_device_id_v1') ||
        ''
      ).trim();
    } catch (_) {
      return '';
    }
  }

  function createFeedbackClearMutationId() {
    try {
      if (global.crypto && typeof global.crypto.randomUUID === 'function') {
        return `feedback_clear_${global.crypto.randomUUID()}`;
      }
    } catch (_) {}
    return `feedback_clear_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  function makeError(response, fallback) {
    const error = new Error(response?.message || fallback || '관찰노트 초기화에 실패했습니다.');
    error.code = response?.code || 'FEEDBACK_CLEAR_FAILED';
    error.serverResult = response || null;
    return error;
  }

  async function clearObservationMemoAfterFeedbackOnServer(student) {
    if (!student?.id) throw new Error('관찰노트를 초기화할 학생 정보를 찾지 못했습니다.');
    if (typeof global.supabase !== 'function') throw new Error('관찰노트 서버 연결이 준비되지 않았습니다.');

    const academyId = currentAcademyId();
    const token = sessionToken();
    if (!academyId || !token) throw new Error('관찰노트 초기화에 필요한 로그인 정보를 확인하지 못했습니다.');

    const entry = typeof global.getMemoEntryByStudent === 'function'
      ? (global.getMemoEntryByStudent(student) || {})
      : {};
    const expectedRevision = memoRevision(entry.revision);
    const mutationId = createFeedbackClearMutationId();
    const response = await global.supabase('POST', 'rpc/olli_note_draft_clear_after_feedback', {
      p_session_token: token,
      p_academy_id: academyId,
      p_student_id: student.id,
      p_note_type: 'elementary_observation',
      p_expected_revision: expectedRevision,
      p_mutation_id: mutationId,
      p_device_id: deviceId() || null
    });

    if (!response || typeof response !== 'object') {
      throw new Error('관찰노트 초기화 결과를 확인하지 못했습니다.');
    }
    if (response.ok === false) throw makeError(response);
    if (String(response.content || '') !== '') {
      throw new Error('서버 관찰노트가 비워지지 않아 로컬 메모를 유지했습니다.');
    }

    return {
      ...response,
      mutation_id: String(response.mutation_id || mutationId),
      revision: memoRevision(response.revision)
    };
  }

  global.clearObservationMemoAfterFeedbackOnServer = clearObservationMemoAfterFeedbackOnServer;

  function notifyClearFailure(error) {
    console.error('피드백 저장 후 관찰노트 초기화 실패:', error?.message || error);
    try {
      if (typeof global.setMemoSaveStatus === 'function') {
        global.setMemoSaveStatus('메모 유지 · 동기화 확인 필요');
      }
    } catch (_) {}
    const message = error?.code === 'REVISION_CONFLICT'
      ? '피드백은 저장됐지만 다른 기기에서 관찰노트가 변경되어 메모를 지우지 않았어요. 최신 내용을 확인해 주세요.'
      : '피드백은 저장됐지만 관찰노트 초기화를 완료하지 못했어요. 수업 메모는 그대로 보존했습니다.';
    try {
      if (typeof global.showPushToast === 'function') global.showPushToast(message);
      else global.alert?.(message);
    } catch (_) {}
  }

  function runOriginalResetWithoutSecondServerClear(originalReset, thisArg, args, serverRow) {
    const originalClear = global.clearStudentNoteDraftFromSupabase;
    if (typeof originalClear !== 'function') return originalReset.apply(thisArg, args);

    global.clearStudentNoteDraftFromSupabase = function suppressedFeedbackClear(target, noteType = '', options = {}) {
      const active = currentMemoStudentSafe();
      const targetId = String(target?.id || '');
      const activeId = String(active?.id || '');
      const resolvedType = String(noteType || 'elementary_observation');
      if (targetId && targetId === activeId && resolvedType === 'elementary_observation') {
        return Promise.resolve([{
          student_id: targetId,
          note_type: resolvedType,
          content: '',
          revision: memoRevision(serverRow?.revision),
          updated_at: String(serverRow?.updated_at || ''),
          mutation_id: String(serverRow?.mutation_id || '')
        }]);
      }
      return originalClear.call(this, target, noteType, options);
    };

    try {
      return originalReset.apply(thisArg, args);
    } finally {
      global.clearStudentNoteDraftFromSupabase = originalClear;
    }
  }

  function clearNonCurrentLocalStudent(student, resetArgs) {
    const feedbackText = resetArgs?.[0] || '';
    const options = resetArgs?.[2] || {};
    let previousMemo = '';
    try {
      if (typeof global.getMemoByStudent === 'function') previousMemo = global.getMemoByStudent(student) || '';
    } catch (_) {}

    try {
      if (String(previousMemo || '').trim() && typeof global.archiveCurrentElementaryMemoRecord === 'function') {
        const analysis = typeof global.getElementaryAnalysisByStudent === 'function'
          ? global.getElementaryAnalysisByStudent(student)
          : null;
        global.archiveCurrentElementaryMemoRecord(student, previousMemo, analysis);
      }
    } catch (_) {}
    try {
      if (!options.skipArchive && typeof global.addMemoFeedbackArchiveItem === 'function') {
        global.addMemoFeedbackArchiveItem(student, feedbackText);
      }
    } catch (_) {}
    try { if (typeof global.clearMemoByStudent === 'function') global.clearMemoByStudent(student); } catch (_) {}
    try { if (typeof global.clearElementaryAnalysisByStudent === 'function') global.clearElementaryAnalysisByStudent(student); } catch (_) {}
  }

  function installResetSafety() {
    const originalReset = global.resetElementaryMemoAfterFeedbackSave;
    if (typeof originalReset !== 'function') return false;
    if (originalReset.__olliServerFirstFeedbackClear === true) return true;

    async function safeResetElementaryMemoAfterFeedbackSave(...args) {
      const student = currentMemoStudentSafe();
      const memoType = currentMemoTypeSafe();
      if (!student?.id || memoType !== 'elementary') {
        return originalReset.apply(this, args);
      }

      const studentSnapshot = { ...student };
      const studentId = String(studentSnapshot.id || '');
      if (clearInFlight.has(studentId)) return clearInFlight.get(studentId);

      const task = (async () => {
        try {
          const serverRow = await clearObservationMemoAfterFeedbackOnServer(studentSnapshot);
          const active = currentMemoStudentSafe();
          const stillCurrent = active && String(active.id || '') === studentId && currentMemoTypeSafe() === 'elementary';

          if (stillCurrent) {
            runOriginalResetWithoutSecondServerClear(originalReset, this, args, serverRow);
            try {
              if (typeof global.markObservationMemoEditorClean === 'function') global.markObservationMemoEditorClean();
            } catch (_) {}
          } else {
            clearNonCurrentLocalStudent(studentSnapshot, args);
          }

          return {
            state: 'cleared',
            student: studentSnapshot,
            revision: memoRevision(serverRow.revision),
            syncedAt: String(serverRow.updated_at || ''),
            intentionalClear: true
          };
        } catch (error) {
          notifyClearFailure(error);
          return { state: 'clear_failed', student: studentSnapshot, error };
        } finally {
          clearInFlight.delete(studentId);
        }
      })();

      clearInFlight.set(studentId, task);
      return task;
    }

    safeResetElementaryMemoAfterFeedbackSave.__olliServerFirstFeedbackClear = true;
    safeResetElementaryMemoAfterFeedbackSave.__olliOriginalReset = originalReset;
    global.resetElementaryMemoAfterFeedbackSave = safeResetElementaryMemoAfterFeedbackSave;
    return true;
  }

  function installAutoSaveFailureGuard() {
    const originalAutoSave = global.autoSaveMemoFeedback;
    if (typeof originalAutoSave !== 'function') return false;
    if (originalAutoSave.__olliFeedbackSaveFailureGuard === true) return true;

    async function guardedAutoSaveMemoFeedback(...args) {
      const originalVerified = global.saveFeedbackRowVerified;
      const safeReset = global.resetElementaryMemoAfterFeedbackSave;
      if (typeof originalVerified !== 'function' || typeof safeReset !== 'function') {
        return originalAutoSave.apply(this, args);
      }

      let serverFeedbackSaved = false;
      let serverFeedbackFailed = false;
      const verifiedWrapper = async function(...verifiedArgs) {
        try {
          const result = await originalVerified.apply(this, verifiedArgs);
          serverFeedbackSaved = true;
          return result;
        } catch (error) {
          serverFeedbackFailed = true;
          throw error;
        }
      };
      const resetGuard = function(...resetArgs) {
        if (serverFeedbackFailed && !serverFeedbackSaved) {
          return Promise.resolve({ state: 'memo_kept_feedback_save_failed' });
        }
        return safeReset.apply(this, resetArgs);
      };

      global.saveFeedbackRowVerified = verifiedWrapper;
      global.resetElementaryMemoAfterFeedbackSave = resetGuard;
      try {
        return await originalAutoSave.apply(this, args);
      } finally {
        if (global.saveFeedbackRowVerified === verifiedWrapper) global.saveFeedbackRowVerified = originalVerified;
        if (global.resetElementaryMemoAfterFeedbackSave === resetGuard) global.resetElementaryMemoAfterFeedbackSave = safeReset;
      }
    }

    guardedAutoSaveMemoFeedback.__olliFeedbackSaveFailureGuard = true;
    guardedAutoSaveMemoFeedback.__olliOriginalAutoSave = originalAutoSave;
    global.autoSaveMemoFeedback = guardedAutoSaveMemoFeedback;
    return true;
  }

  function installFeedbackClearReconcile() {
    const originalReconcile = global.reconcileObservationMemoDraft;
    if (typeof originalReconcile !== 'function') return false;
    if (originalReconcile.__olliFeedbackClearReconcile === true) return true;

    async function reconcileWithFeedbackClear(student, noteType = '') {
      const before = typeof global.getMemoEntryByStudent === 'function'
        ? (global.getMemoEntryByStudent(student) || {})
        : {};
      const beforeStatus = String(before.syncStatus || 'local');
      const beforeConflict = before.conflict && typeof before.conflict === 'object' ? before.conflict : null;
      let dirty = false;
      try {
        if (typeof global.hasObservationMemoDirtyChanges === 'function') dirty = !!global.hasObservationMemoDirtyChanges();
      } catch (_) {}
      const protectedBefore =
        dirty ||
        ['pending', 'blocked'].includes(beforeStatus) ||
        (beforeStatus === 'conflict' && beforeConflict?.origin !== 'reconcile-lineage');
      const beforeRevision = memoRevision(before.revision);

      const result = await originalReconcile.call(this, student, noteType);
      const row = result?.remoteRow;
      const remoteMutationId = String(row?.last_mutation_id || '');
      const remoteRevision = memoRevision(row?.revision);
      const intentionalFeedbackClear =
        String(row?.content || '') === '' &&
        remoteMutationId.startsWith('feedback_clear_');

      if (intentionalFeedbackClear && !protectedBefore && remoteRevision > beforeRevision) {
        const syncedAt = String(row?.updated_at || new Date().toISOString());
        if (typeof global.setMemoByStudent === 'function') {
          global.setMemoByStudent(student, '', {
            updatedAt: syncedAt,
            lastSyncedAt: syncedAt,
            syncStatus: 'synced',
            revision: remoteRevision,
            mutationId: '',
            conflict: null
          });
        }
        return {
          ...result,
          adoptedRemote: true,
          conflictDetected: false,
          source: 'remote-feedback-clear',
          localEntry: typeof global.getMemoEntryByStudent === 'function' ? global.getMemoEntryByStudent(student) : null,
          content: '',
          updatedAt: syncedAt,
          revision: remoteRevision
        };
      }
      return result;
    }

    reconcileWithFeedbackClear.__olliFeedbackClearReconcile = true;
    reconcileWithFeedbackClear.__olliOriginalReconcile = originalReconcile;
    global.reconcileObservationMemoDraft = reconcileWithFeedbackClear;
    return true;
  }

  function installAll() {
    const resetReady = installResetSafety();
    const reconcileReady = installFeedbackClearReconcile();
    installAutoSaveFailureGuard();
    installAttempts += 1;
    if ((!resetReady || !reconcileReady || typeof global.autoSaveMemoFeedback !== 'function') && installAttempts < 60) {
      installTimer = setTimeout(installAll, 500);
    } else if (installTimer) {
      clearTimeout(installTimer);
      installTimer = null;
    }
  }

  installAll();
})(window);
