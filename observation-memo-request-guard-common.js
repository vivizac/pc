/* PC/Phone common observation memo request ordering guard.
   Server revision CAS protects cross-device writes; this layer additionally prevents
   an older in-flight request from the SAME device from reverting a newer local edit. */
(function initObservationMemoRequestGuard(global) {
  'use strict';

  if (global.__olliObservationMemoRequestGuardInstalled) return;
  if (typeof global.persistObservationMemoDraft !== 'function') {
    console.warn('관찰노트 요청 순서 보호를 설치하지 못했습니다: 저장 함수가 준비되지 않았습니다.');
    return;
  }
  global.__olliObservationMemoRequestGuardInstalled = true;

  const basePersist = global.persistObservationMemoDraft;
  const chains = new Map();
  const latestRequests = new Map();
  const knownServerRevisions = new Map();
  let sequence = 0;

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function revision(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  }
  function currentAcademyId() {
    try {
      if (typeof global.getOlliCurrentAcademyId === 'function') return clean(global.getOlliCurrentAcademyId());
    } catch (_) {}
    return clean(localStorage.getItem('olli_current_academy_id'));
  }
  function noteTypeFor(student, explicitType) {
    const explicit = clean(explicitType);
    if (explicit) return explicit;
    try {
      if (typeof global.getSupabaseNoteDraftType === 'function') return clean(global.getSupabaseNoteDraftType(student));
    } catch (_) {}
    return student?.type === 'kinder' ? 'kinder_risk' : 'elementary_observation';
  }
  function requestKey(student, noteType) {
    const academyId = currentAcademyId();
    const studentId = clean(student?.id);
    const type = clean(noteType);
    return academyId && studentId && type ? `${academyId}:${studentId}:${type}` : '';
  }
  function newMutationId() {
    try {
      if (typeof global.createObservationMemoMutationId === 'function') {
        const value = clean(global.createObservationMemoMutationId());
        if (value) return value;
      }
      if (global.crypto && typeof global.crypto.randomUUID === 'function') return `note_${global.crypto.randomUUID()}`;
    } catch (_) {}
    return `note_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
  function localEntry(student) {
    try {
      if (typeof global.getMemoEntryByStudent === 'function') return global.getMemoEntryByStudent(student) || {};
    } catch (_) {}
    return {};
  }
  function writePending(request, expectedRevision) {
    if (!request || typeof global.setMemoByStudent !== 'function') return;
    const current = localEntry(request.student);
    global.setMemoByStudent(request.student, request.content, {
      updatedAt: request.updatedAt,
      lastSyncedAt: current.lastSyncedAt || '',
      syncStatus: 'pending',
      revision: revision(expectedRevision),
      mutationId: request.mutationId,
      conflict: null
    });
  }
  function isSuccessfulResult(result) {
    return result && (result.state === 'synced' || result.state === 'cleared') && Number.isFinite(Number(result.revision));
  }
  function rememberServerRevision(key, result) {
    if (!key || !isSuccessfulResult(result)) return;
    const value = revision(result.revision);
    const previous = revision(knownServerRevisions.get(key));
    if (value >= previous) knownServerRevisions.set(key, value);
  }
  function restoreNewestPending(key, completedSequence, completedResult) {
    rememberServerRevision(key, completedResult);
    const newest = latestRequests.get(key);
    if (!newest || newest.sequence === completedSequence) return false;

    const knownRevision = revision(knownServerRevisions.get(key));
    if (isSuccessfulResult(completedResult) && knownRevision > newest.expectedRevision) {
      newest.expectedRevision = knownRevision;
    }
    writePending(newest, newest.expectedRevision);
    try {
      if (typeof global.setMemoSaveStatus === 'function') global.setMemoSaveStatus('작성 중...');
    } catch (_) {}
    return true;
  }

  async function guardedPersistObservationMemoDraft(student, content, options = {}) {
    if (!student) return basePersist(student, content, options);
    const noteType = noteTypeFor(student, options.noteType);
    const key = requestKey(student, noteType);
    if (!key) return basePersist(student, content, options);

    const before = localEntry(student);
    const explicitExpected = Object.prototype.hasOwnProperty.call(options, 'expectedRevision');
    const request = {
      sequence: ++sequence,
      student: { ...student },
      noteType,
      content: String(content == null ? '' : content),
      expectedRevision: explicitExpected ? revision(options.expectedRevision) : revision(before.revision),
      mutationId: clean(options.mutationId) || newMutationId(),
      updatedAt: options.updatedAt || new Date().toISOString(),
      options: { ...options }
    };

    latestRequests.set(key, request);
    // Persist the newest text locally immediately. Network writes are serialized below,
    // but a slow previous request must never prevent the latest typing from surviving locally.
    writePending(request, request.expectedRevision);

    const previous = chains.get(key) || Promise.resolve(null);
    let task;
    task = previous
      .catch(() => null)
      .then(async previousResult => {
        rememberServerRevision(key, previousResult);

        // If an even newer request arrived before this one reached the network,
        // skip this obsolete request entirely.
        if (latestRequests.get(key)?.sequence !== request.sequence) {
          return {
            state: 'superseded',
            student: request.student,
            error: null,
            revision: revision(knownServerRevisions.get(key) || request.expectedRevision),
            superseded: true
          };
        }

        const knownRevision = revision(knownServerRevisions.get(key));
        if (knownRevision > request.expectedRevision) request.expectedRevision = knownRevision;
        writePending(request, request.expectedRevision);

        return basePersist(request.student, request.content, {
          ...request.options,
          noteType: request.noteType,
          expectedRevision: request.expectedRevision,
          mutationId: request.mutationId,
          updatedAt: request.updatedAt
        });
      })
      .then(result => {
        const superseded = restoreNewestPending(key, request.sequence, result);
        if (superseded && result && typeof result === 'object') return { ...result, superseded: true };
        return result;
      })
      .finally(() => {
        if (chains.get(key) === task) chains.delete(key);
        if (latestRequests.get(key)?.sequence === request.sequence) latestRequests.delete(key);
      });

    chains.set(key, task);
    return task;
  }

  global.persistObservationMemoDraft = guardedPersistObservationMemoDraft;

  // Clearing a draft is a normal revisioned write too. Route direct clear callers through
  // the same request-order guard so feedback completion cannot race an autosave.
  global.clearStudentNoteDraftFromSupabase = async function clearObservationMemoDraftWithGuard(student, noteType = '') {
    const result = await guardedPersistObservationMemoDraft(student, '', { noteType });
    if (result?.state === 'conflict') return result;
    if (result?.state === 'pending' || result?.state === 'blocked') {
      throw result.error || new Error('관찰노트 비우기 서버 저장이 완료되지 않았습니다.');
    }
    return result;
  };

  global.getObservationMemoRequestGuardState = function getObservationMemoRequestGuardState(student, noteType = '') {
    const type = noteTypeFor(student, noteType);
    const key = requestKey(student, type);
    if (!key) return null;
    const latest = latestRequests.get(key);
    return {
      inFlight: chains.has(key),
      latestSequence: latest?.sequence || 0,
      expectedRevision: latest?.expectedRevision ?? revision(knownServerRevisions.get(key)),
      knownServerRevision: revision(knownServerRevisions.get(key))
    };
  };
})(window);
