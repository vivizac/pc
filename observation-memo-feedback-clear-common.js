/* PC/Phone shared observation memo feedback-clear data contract.
   Confirms the revision-protected server clear. Platform code owns local/UI reset. */
(function initObservationMemoFeedbackClearCore(global) {
  'use strict';

  if (global.ObservationMemoFeedbackClearCore) return;

  const clearInFlight = new Map();

  function memoRevision(value) {
    const revision = Number(value || 0);
    return Number.isFinite(revision) && revision >= 0 ? Math.floor(revision) : 0;
  }

  function currentAcademyId() {
    try {
      if (typeof global.getOlliCurrentAcademyId === 'function') {
        return String(global.getOlliCurrentAcademyId() || '').trim();
      }
    } catch (_) {}
    try {
      return String(localStorage.getItem('olli_current_academy_id') || '').trim();
    } catch (_) {
      return '';
    }
  }

  function sessionToken() {
    try {
      return String(localStorage.getItem('olli_account_session_token_v1') || '').trim();
    } catch (_) {
      return '';
    }
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

  function createMutationId() {
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

  async function clearAfterFeedback(student, noteType = 'elementary_observation') {
    const resolvedType = String(noteType || 'elementary_observation').trim();
    const academyId = currentAcademyId();
    const studentId = String(student?.id || '').trim();
    const clearKey = academyId && studentId && resolvedType
      ? `${academyId}:${studentId}:${resolvedType}`
      : '';

    if (clearKey && clearInFlight.has(clearKey)) return clearInFlight.get(clearKey);

    const task = (async () => {
      if (!student?.id) {
            const error = new Error('관찰노트를 초기화할 학생 정보를 찾지 못했습니다.');
            error.code = 'INVALID_INPUT';
            throw error;
          }
          if (typeof global.supabase !== 'function') {
            const error = new Error('관찰노트 서버 연결이 준비되지 않았습니다.');
            error.code = 'SERVER_UNAVAILABLE';
            throw error;
          }
      
          const academyId = currentAcademyId();
          const token = sessionToken();
          const resolvedType = String(noteType || 'elementary_observation').trim();
          if (!academyId || !token || !resolvedType) {
            const error = new Error('관찰노트 초기화에 필요한 로그인 정보를 확인하지 못했습니다.');
            error.code = 'SESSION_REQUIRED';
            throw error;
          }
      
          const entry = typeof global.getMemoEntryByStudent === 'function'
            ? (global.getMemoEntryByStudent(student, resolvedType) || {})
            : {};
          const expectedRevision = memoRevision(entry.revision);
          const mutationId = createMutationId();
      
          const response = await global.supabase('POST', 'rpc/olli_note_draft_clear_after_feedback', {
            p_session_token: token,
            p_academy_id: academyId,
            p_student_id: student.id,
            p_note_type: resolvedType,
            p_expected_revision: expectedRevision,
            p_mutation_id: mutationId,
            p_device_id: deviceId() || null
          });
      
          if (!response || typeof response !== 'object') {
            const error = new Error('관찰노트 초기화 결과를 확인하지 못했습니다.');
            error.code = 'SERVER_RESPONSE_INVALID';
            throw error;
          }
          if (response.ok === false) throw makeError(response);
          if (String(response.content || '') !== '') {
            const error = new Error('서버 관찰노트가 비워지지 않아 로컬 메모를 유지했습니다.');
            error.code = 'SERVER_CLEAR_NOT_CONFIRMED';
            error.serverResult = response;
            throw error;
          }
      
          return {
            ...response,
            mutation_id: String(response.mutation_id || mutationId),
            revision: memoRevision(response.revision)
          };
    })();

    if (!clearKey) return task;
    clearInFlight.set(clearKey, task);
    try {
      return await task;
    } finally {
      if (clearInFlight.get(clearKey) === task) clearInFlight.delete(clearKey);
    }
  }

  const api = Object.freeze({
    clearAfterFeedback
  });
  global.ObservationMemoFeedbackClearCore = api;
  global.clearObservationMemoAfterFeedbackOnServer = clearAfterFeedback;
})(window);
