/* PC/Phone shared observation memo version history data contract.
   Owns RPC payloads and CAS-safe restore errors. Never touches platform DOM. */
(function initObservationMemoVersionHistoryCore(global) {
  'use strict';

  if (global.ObservationMemoVersionHistoryCore) return;

  const NOTE_TYPE = 'elementary_observation';

  function text(value) { return String(value == null ? '' : value); }
  function clean(value) { return text(value).trim(); }
  function revision(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  }
  function academyId() {
    try {
      if (typeof global.requireOlliAcademyId === 'function') {
        return clean(global.requireOlliAcademyId('관찰노트 이전 기록'));
      }
    } catch (_) {}
    try {
      if (typeof global.getOlliCurrentAcademyId === 'function') {
        return clean(global.getOlliCurrentAcademyId());
      }
    } catch (_) {}
    try {
      return clean(localStorage.getItem('olli_current_academy_id'));
    } catch (_) {
      return '';
    }
  }
  function sessionToken() {
    try {
      return clean(localStorage.getItem('olli_account_session_token_v1'));
    } catch (_) {
      return '';
    }
  }
  function deviceId() {
    try {
      if (typeof global.getOlliLoginDeviceId === 'function') {
        const value = clean(global.getOlliLoginDeviceId());
        if (value) return value;
      }
    } catch (_) {}
    try {
      return clean(localStorage.getItem('olli_device_id_v1'));
    } catch (_) {
      return '';
    }
  }
  function mutationId() {
    try {
      if (typeof global.createObservationMemoMutationId === 'function') {
        const value = clean(global.createObservationMemoMutationId());
        if (value) return value;
      }
      if (global.crypto && typeof global.crypto.randomUUID === 'function') {
        return `note_history_${global.crypto.randomUUID()}`;
      }
    } catch (_) {}
    return `note_history_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
  function rpc(name, body) {
    if (typeof global.supabase !== 'function') {
      const error = new Error('관찰노트 서버 연결이 준비되지 않았습니다.');
      error.code = 'SERVER_UNAVAILABLE';
      throw error;
    }
    return global.supabase('POST', `rpc/${name}`, body);
  }

  async function listVersionHistory({ studentId, noteType = NOTE_TYPE, limit = 30 } = {}) {
    const id = academyId();
    const token = sessionToken();
    const resolvedStudentId = clean(studentId);
    const resolvedNoteType = clean(noteType) || NOTE_TYPE;
    const resolvedLimit = Math.max(1, Math.min(100, Number(limit || 30)));

    if (!id || !token) {
      const error = new Error('로그인 정보를 확인해 주세요.');
      error.code = 'SESSION_REQUIRED';
      throw error;
    }
    if (!resolvedStudentId || !resolvedNoteType) {
      const error = new Error('이전 기록을 불러올 학생 정보를 확인해 주세요.');
      error.code = 'INVALID_INPUT';
      throw error;
    }

    const response = await rpc('olli_note_draft_version_list', {
      p_session_token: token,
      p_academy_id: id,
      p_student_id: resolvedStudentId,
      p_note_type: resolvedNoteType,
      p_limit: resolvedLimit
    });
    if (!response || response.ok === false) {
      const error = new Error(response?.message || '이전 기록을 불러오지 못했습니다.');
      error.code = response?.code || 'HISTORY_LIST_FAILED';
      throw error;
    }
    return response;
  }

  async function restoreVersionHistory({
    studentId,
    noteType = NOTE_TYPE,
    targetRevision,
    expectedRevision
  } = {}) {
    const id = academyId();
    const token = sessionToken();
    const resolvedStudentId = clean(studentId);
    const resolvedNoteType = clean(noteType) || NOTE_TYPE;
    const target = revision(targetRevision);
    const expected = revision(expectedRevision);

    if (!id || !token) {
      const error = new Error('로그인 정보를 확인해 주세요.');
      error.code = 'SESSION_REQUIRED';
      throw error;
    }
    if (!resolvedStudentId || !resolvedNoteType || target <= 0) {
      const error = new Error('복구할 이전 기록 정보를 확인해 주세요.');
      error.code = 'INVALID_INPUT';
      throw error;
    }

    const response = await rpc('olli_note_draft_version_restore', {
      p_session_token: token,
      p_academy_id: id,
      p_student_id: resolvedStudentId,
      p_note_type: resolvedNoteType,
      p_target_revision: target,
      p_expected_revision: expected,
      p_mutation_id: mutationId(),
      p_device_id: deviceId()
    });
    if (!response || response.ok === false) {
      const error = new Error(response?.message || '이전 기록 복구에 실패했습니다.');
      error.code = response?.code || 'RESTORE_FAILED';
      error.serverResult = response || null;
      throw error;
    }
    return response;
  }

  global.ObservationMemoVersionHistoryCore = Object.freeze({
    list: listVersionHistory,
    restore: restoreVersionHistory
  });
})(window);
