/* PC/Phone shared service for intentionally clearing an elementary observation memo
   after a feedback row has been saved. This module does not wrap or replace runtime functions. */
(function initObservationMemoFeedbackClearService(global) {
  'use strict';

  if (global.__olliObservationFeedbackClearServiceLoaded) return;
  global.__olliObservationFeedbackClearServiceLoaded = true;

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
})(window);
