/* PC/Phone common observation memo draft save execution.
   Adds revision/CAS protection so stale devices cannot overwrite newer server data. */
(function initObservationMemoSaveCommon(global) {
  'use strict';

  const CAS_QUEUE_PREFIX = 'olli_observation_memo_cas_queue_v1';
  const legacyGetMemoEntry = global.getMemoEntryByStudent;

  // Same-device request ordering state. CAS protects cross-device writes; these maps
  // additionally prevent an older in-flight request from reverting a newer local edit.
  const requestChains = new Map();
  const latestRequests = new Map();
  const knownServerRevisions = new Map();
  let requestSequence = 0;

  function memoRevision(value) {
    const revision = Number(value || 0);
    return Number.isFinite(revision) && revision >= 0 ? Math.floor(revision) : 0;
  }

  function emptyMemoEntry(status = 'empty') {
    return { content: '', updatedAt: '', lastSyncedAt: '', syncStatus: status, revision: 0, mutationId: '', conflict: null };
  }

  function getMemoEntrySafe(student) {
    const key = typeof global.getMemoKey === 'function' ? global.getMemoKey(student) : '';
    if (!key) return emptyMemoEntry('unknown');
    const raw = localStorage.getItem(key);
    if (!raw) return emptyMemoEntry('empty');
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          content: parsed.content || '',
          updatedAt: parsed.updatedAt || '',
          lastSyncedAt: parsed.lastSyncedAt || '',
          syncStatus: parsed.syncStatus || 'local',
          revision: memoRevision(parsed.revision),
          mutationId: String(parsed.mutationId || ''),
          conflict: parsed.conflict && typeof parsed.conflict === 'object' ? parsed.conflict : null
        };
      }
    } catch (_) {}
    if (typeof legacyGetMemoEntry === 'function') {
      const legacy = legacyGetMemoEntry(student) || {};
      return { ...emptyMemoEntry('local'), ...legacy, revision: 0, mutationId: '', conflict: null };
    }
    return { ...emptyMemoEntry('local'), content: raw || '' };
  }

  function setMemoSafe(student, content, options = {}) {
    const key = typeof global.getMemoKey === 'function' ? global.getMemoKey(student) : '';
    if (!key) return;
    const previous = getMemoEntrySafe(student);
    const has = keyName => Object.prototype.hasOwnProperty.call(options, keyName);
    localStorage.setItem(key, JSON.stringify({
      content: content || '',
      updatedAt: has('updatedAt') ? (options.updatedAt || '') : (previous.updatedAt || new Date().toISOString()),
      lastSyncedAt: has('lastSyncedAt') ? (options.lastSyncedAt || '') : (previous.lastSyncedAt || ''),
      syncStatus: options.syncStatus || previous.syncStatus || 'local',
      revision: has('revision') ? memoRevision(options.revision) : memoRevision(previous.revision),
      mutationId: has('mutationId') ? String(options.mutationId || '') : String(previous.mutationId || ''),
      conflict: has('conflict') ? (options.conflict || null) : (previous.conflict || null)
    }));
  }

  function setMemoSyncStateSafe(student, syncState = {}) {
    const entry = getMemoEntrySafe(student);
    setMemoSafe(student, entry.content || '', {
      updatedAt: Object.prototype.hasOwnProperty.call(syncState, 'updatedAt') ? syncState.updatedAt : entry.updatedAt,
      lastSyncedAt: Object.prototype.hasOwnProperty.call(syncState, 'lastSyncedAt') ? syncState.lastSyncedAt : entry.lastSyncedAt,
      syncStatus: syncState.syncStatus || entry.syncStatus || 'local',
      revision: Object.prototype.hasOwnProperty.call(syncState, 'revision') ? syncState.revision : entry.revision,
      mutationId: Object.prototype.hasOwnProperty.call(syncState, 'mutationId') ? syncState.mutationId : entry.mutationId,
      conflict: Object.prototype.hasOwnProperty.call(syncState, 'conflict') ? syncState.conflict : entry.conflict
    });
  }

  global.getMemoEntryByStudent = getMemoEntrySafe;
  global.setMemoByStudent = setMemoSafe;
  global.setMemoSyncStateByStudent = setMemoSyncStateSafe;
  global.isRemoteMemoRevisionNewerThanLocal = (remoteRevision, localRevision) => memoRevision(remoteRevision) > memoRevision(localRevision);

  function currentAcademyId() {
    try { return String(typeof global.getOlliCurrentAcademyId === 'function' ? global.getOlliCurrentAcademyId() : '').trim(); }
    catch (_) { return ''; }
  }

  function sessionToken() {
    return String(localStorage.getItem('olli_account_session_token_v1') || '').trim();
  }

  function deviceId() {
    try {
      if (typeof global.getOlliLoginDeviceId === 'function') return String(global.getOlliLoginDeviceId() || '').trim();
    } catch (_) {}
    const key = 'olli_device_id_v1';
    let id = String(localStorage.getItem(key) || '').trim();
    if (!id) {
      id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(key, id);
    }
    return id;
  }

  function createMutationId() {
    try {
      if (global.crypto && typeof global.crypto.randomUUID === 'function') return `note_${global.crypto.randomUUID()}`;
    } catch (_) {}
    return `note_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  }
  global.createObservationMemoMutationId = createMutationId;

  function queueKey(academyId = '') {
    const id = String(academyId || currentAcademyId() || '').trim();
    return id ? `${CAS_QUEUE_PREFIX}_${id}` : CAS_QUEUE_PREFIX;
  }

  function readQueue(academyId = '') {
    try {
      const rows = JSON.parse(localStorage.getItem(queueKey(academyId)) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (_) { return []; }
  }

  function writeQueue(academyId, rows) {
    localStorage.setItem(queueKey(academyId), JSON.stringify(Array.isArray(rows) ? rows.slice(0, 500) : []));
  }

  function upsertQueue(item = {}) {
    const academyId = String(item.academyId || currentAcademyId()).trim();
    const studentId = String(item.studentId || '').trim();
    const noteType = String(item.noteType || '').trim();
    if (!academyId || !studentId || !noteType) return null;
    const rows = readQueue(academyId);
    const index = rows.findIndex(row => String(row.studentId || '') === studentId && String(row.noteType || '') === noteType && String(row.status || 'pending') !== 'conflict');
    const previous = index >= 0 ? rows[index] : {};
    const next = {
      queueId: previous.queueId || `noteq_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      academyId, studentId, noteType,
      content: String(item.content ?? previous.content ?? ''),
      expectedRevision: Object.prototype.hasOwnProperty.call(item, 'expectedRevision') ? memoRevision(item.expectedRevision) : memoRevision(previous.expectedRevision),
      mutationId: String(item.mutationId || previous.mutationId || createMutationId()),
      deviceId: String(item.deviceId || previous.deviceId || deviceId()),
      status: String(item.status || previous.status || 'pending'),
      createdAt: previous.createdAt || new Date().toISOString(),
      lastAttemptAt: item.lastAttemptAt || previous.lastAttemptAt || '',
      retryCount: Number(item.retryCount != null ? item.retryCount : (previous.retryCount || 0)),
      serverRevision: memoRevision(item.serverRevision || previous.serverRevision),
      serverContent: Object.prototype.hasOwnProperty.call(item, 'serverContent') ? String(item.serverContent || '') : String(previous.serverContent || ''),
      serverUpdatedAt: String(item.serverUpdatedAt || previous.serverUpdatedAt || ''),
      errorCode: String(item.errorCode || previous.errorCode || ''),
      errorMessage: String(item.errorMessage || previous.errorMessage || '')
    };
    if (index >= 0) rows[index] = next; else rows.push(next);
    writeQueue(academyId, rows);
    return next;
  }

  function removeQueueForNote(academyId, studentId, noteType, includeConflict = false) {
    writeQueue(academyId, readQueue(academyId).filter(row => {
      const same = String(row.studentId || '') === String(studentId || '') && String(row.noteType || '') === String(noteType || '');
      if (!same) return true;
      if (!includeConflict && String(row.status || '') === 'conflict') return true;
      return false;
    }));
  }

  function conflictFromResult(result = {}) {
    return {
      code: 'REVISION_CONFLICT',
      serverRevision: memoRevision(result.server_revision),
      serverContent: String(result.server_content || ''),
      serverUpdatedAt: String(result.server_updated_at || ''),
      detectedAt: new Date().toISOString()
    };
  }

  function markConflict(student, result, mutationId = '') {
    const entry = getMemoEntrySafe(student);
    const conflict = conflictFromResult(result || {});
    setMemoSafe(student, entry.content || '', {
      updatedAt: entry.updatedAt,
      lastSyncedAt: entry.lastSyncedAt,
      syncStatus: 'conflict',
      revision: entry.revision,
      mutationId: mutationId || entry.mutationId,
      conflict
    });
    try { if (typeof global.setMemoSaveStatus === 'function') global.setMemoSaveStatus('다른 기기에서 수정됨'); } catch (_) {}
    try { global.dispatchEvent(new CustomEvent('olli:observation-memo-conflict', { detail: { studentId: String(student?.id || ''), ...conflict } })); } catch (_) {}
    return conflict;
  }

  async function casRpc({ academyId, studentId, noteType, content, expectedRevision, mutationId, device }) {
    if (typeof global.supabase !== 'function') {
      const error = new Error('관찰노트 서버 저장 함수가 준비되지 않았습니다.');
      error.code = 'SERVER_UNAVAILABLE';
      throw error;
    }
    const token = sessionToken();
    if (!token) {
      const error = new Error('관찰노트 저장 세션이 없습니다. 다시 로그인해 주세요.');
      error.code = 'SESSION_REQUIRED';
      throw error;
    }
    const response = await global.supabase('POST', 'rpc/olli_note_draft_save_cas', {
      p_session_token: token,
      p_academy_id: academyId,
      p_student_id: studentId,
      p_note_type: noteType,
      p_content: String(content || ''),
      p_expected_revision: memoRevision(expectedRevision),
      p_mutation_id: mutationId || createMutationId(),
      p_device_id: device || deviceId()
    });
    if (!response || typeof response !== 'object') {
      const error = new Error('관찰노트 서버 저장 응답을 확인하지 못했습니다.');
      error.code = 'SERVER_RESPONSE_INVALID';
      throw error;
    }
    if (response.ok === false) {
      const error = new Error(response.message || '관찰노트 저장에 실패했습니다.');
      error.code = response.code || 'SERVER_WRITE_FAILED';
      error.serverResult = response;
      throw error;
    }
    return response;
  }

  async function safeSaveNote(student, content, noteType = '', options = {}) {
    if (!global.isSupabaseConfigured?.()) return null;
    const academyId = global.requireOlliAcademyId('노트 저장');
    const type = noteType || global.getSupabaseNoteDraftType(student);
    const text = String(content || '');
    if (!student?.id && !student?.name) throw new Error('노트 저장에 필요한 학생 정보가 없습니다.');
    if (!type) return null;

    let stableStudent = { ...student, academy_id: student?.academy_id || academyId };
    if (!stableStudent.id) stableStudent = await global.ensureStudentSavedToSupabase(student);

    const entry = getMemoEntrySafe(stableStudent);
    const expectedRevision = Object.prototype.hasOwnProperty.call(options, 'expectedRevision') ? memoRevision(options.expectedRevision) : memoRevision(entry.revision);
    let mutationId = String(options.mutationId || entry.mutationId || createMutationId());
    const currentDevice = String(options.deviceId || deviceId());

    try {
      let response = await casRpc({ academyId, studentId: stableStudent.id, noteType: type, content: text, expectedRevision, mutationId, device: currentDevice });
      if (String(response.content || '') !== text) {
        mutationId = createMutationId();
        response = await casRpc({ academyId, studentId: stableStudent.id, noteType: type, content: text, expectedRevision: response.revision, mutationId, device: currentDevice });
      }
      removeQueueForNote(academyId, stableStudent.id, type, false);
      return [{
        academy_id: academyId,
        student_id: stableStudent.id,
        student_name: stableStudent.name || '',
        note_type: type,
        content: String(response.content ?? text),
        revision: memoRevision(response.revision),
        updated_at: String(response.updated_at || ''),
        mutation_id: mutationId,
        idempotent: response.idempotent === true
      }];
    } catch (err) {
      if (err?.code === 'REVISION_CONFLICT') {
        const server = err.serverResult || {};
        markConflict(stableStudent, server, mutationId);
        upsertQueue({ academyId, studentId: stableStudent.id, noteType: type, content: text, expectedRevision, mutationId, deviceId: currentDevice, status: 'conflict', serverRevision: server.server_revision, serverContent: server.server_content, serverUpdatedAt: server.server_updated_at, errorCode: err.code, errorMessage: err.message });
      } else if (['PERMISSION_DENIED','SESSION_REQUIRED','INVALID_INPUT','STUDENT_NOT_FOUND'].includes(String(err?.code || ''))) {
        setMemoSyncStateSafe(stableStudent, { syncStatus: 'blocked', mutationId });
      } else {
        upsertQueue({ academyId, studentId: stableStudent.id, noteType: type, content: text, expectedRevision, mutationId, deviceId: currentDevice, status: 'pending', errorCode: err?.code || 'SERVER_WRITE_FAILED', errorMessage: err?.message || String(err || '') });
      }
      throw err;
    }
  }

  global.saveStudentNoteDraftToSupabase = safeSaveNote;

  async function flushCasQueue() {
    if (!global.isSupabaseConfigured?.() || navigator?.onLine === false) return;
    const academyId = currentAcademyId();
    if (!academyId || !sessionToken()) return;
    for (const item of readQueue(academyId)) {
      if (String(item.status || 'pending') !== 'pending') continue;
      const student = typeof global.findStudentById === 'function' ? global.findStudentById(item.studentId) : { id: item.studentId, academy_id: academyId };
      if (!student?.id) continue;
      const attemptAt = new Date().toISOString();
      upsertQueue({ ...item, lastAttemptAt: attemptAt, retryCount: Number(item.retryCount || 0) + 1 });
      try {
        let response = await casRpc({ academyId, studentId: item.studentId, noteType: item.noteType, content: item.content, expectedRevision: item.expectedRevision, mutationId: item.mutationId, device: item.deviceId });
        if (String(response.content || '') !== String(item.content || '')) {
          response = await casRpc({ academyId, studentId: item.studentId, noteType: item.noteType, content: item.content, expectedRevision: response.revision, mutationId: createMutationId(), device: item.deviceId });
        }
        removeQueueForNote(academyId, item.studentId, item.noteType, false);
        const local = getMemoEntrySafe(student);
        if (String(local.content || '') === String(item.content || '')) {
          const syncedAt = String(response.updated_at || new Date().toISOString());
          setMemoSafe(student, item.content || '', { updatedAt: syncedAt, lastSyncedAt: syncedAt, syncStatus: 'synced', revision: response.revision, mutationId: '', conflict: null });
        }
      } catch (err) {
        if (err?.code === 'REVISION_CONFLICT') {
          const server = err.serverResult || {};
          markConflict(student, server, item.mutationId);
          upsertQueue({ ...item, status: 'conflict', lastAttemptAt: attemptAt, retryCount: Number(item.retryCount || 0) + 1, serverRevision: server.server_revision, serverContent: server.server_content, serverUpdatedAt: server.server_updated_at, errorCode: err.code, errorMessage: err.message });
        } else {
          upsertQueue({ ...item, status: ['PERMISSION_DENIED','SESSION_REQUIRED','INVALID_INPUT','STUDENT_NOT_FOUND'].includes(String(err?.code || '')) ? 'blocked' : 'pending', lastAttemptAt: attemptAt, retryCount: Number(item.retryCount || 0) + 1, errorCode: err?.code || 'RETRY_FAILED', errorMessage: err?.message || String(err || '') });
        }
      }
    }
  }
  global.flushObservationMemoCasQueue = flushCasQueue;
  global.readObservationMemoCasQueue = readQueue;

  function quarantineLegacyQueue() {
    try {
      const core = global.OlliStorageCore;
      const academyId = currentAcademyId();
      if (!core?.SyncQueue || !academyId) return;
      core.SyncQueue.read(academyId).forEach(item => {
        if (String(item.feature || '') !== 'student_note_draft') return;
        core.SyncQueue.update(academyId, item.queue_id, { status: 'blocked', error_code: 'LEGACY_NOTE_QUEUE_QUARANTINED', error_message: '다중기기 안전화 이전 관찰노트 재전송 항목이라 자동 덮어쓰기를 막기 위해 보류했습니다.' });
      });
    } catch (_) {}
  }

  if (!global.__olliObservationMemoCasRetryBound) {
    global.__olliObservationMemoCasRetryBound = true;
    const retry = () => setTimeout(() => { quarantineLegacyQueue(); flushCasQueue().catch(err => console.warn('관찰노트 안전 재전송 보류:', err?.message || err)); }, 0);
    global.addEventListener('online', retry);
    global.addEventListener('focus', retry);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) retry(); });
    setTimeout(retry, 800);
  }

  async function persistObservationMemoDraftBase(student, content, options = {}) {
    if (!student) return { state: 'skipped', student: null, error: null };
    const noteType = options.noteType || global.getSupabaseNoteDraftType(student);
    const text = String(content || '');
    const before = getMemoEntrySafe(student);

    if (before.syncStatus === 'conflict' && options.resolveConflict !== true) {
      const error = new Error('다른 기기에서 더 최신 관찰노트가 저장되어 자동 저장을 중단했습니다.');
      error.code = 'REVISION_CONFLICT';
      return { state: 'conflict', student, error, conflict: before.conflict || null };
    }

    const expectedRevision = Object.prototype.hasOwnProperty.call(options, 'expectedRevision') ? memoRevision(options.expectedRevision) : memoRevision(before.revision);
    const mutationId = String(options.mutationId || (((before.syncStatus === 'pending' || before.syncStatus === 'blocked') && before.mutationId) ? before.mutationId : '') || createMutationId());
    const localUpdatedAt = options.updatedAt || new Date().toISOString();
    const studentToSave = { ...student, memoUpdatedAt: text.trim() ? localUpdatedAt : '' };

    setMemoSafe(studentToSave, text, { updatedAt: localUpdatedAt, syncStatus: 'pending', revision: expectedRevision, mutationId, conflict: null });

    try {
      const rows = await safeSaveNote(studentToSave, text, noteType, { expectedRevision, mutationId });
      const row = Array.isArray(rows) && rows.length ? rows[0] : null;
      const serverUpdatedAt = String(row?.updated_at || new Date().toISOString());
      const finalStudent = { ...studentToSave, id: row?.student_id || studentToSave.id, academy_id: row?.academy_id || studentToSave.academy_id, memoUpdatedAt: text.trim() ? serverUpdatedAt : '' };
      await global.saveStudent(finalStudent, { skipRemote: true });
      setMemoSafe(finalStudent, text, { updatedAt: serverUpdatedAt, lastSyncedAt: serverUpdatedAt, syncStatus: 'synced', revision: row?.revision, mutationId: '', conflict: null });
      return { state: text.trim() ? 'synced' : 'cleared', student: finalStudent, error: null, syncedAt: serverUpdatedAt, revision: memoRevision(row?.revision) };
    } catch (err) {
      if (err?.code === 'REVISION_CONFLICT') return { state: 'conflict', student: studentToSave, error: err, conflict: getMemoEntrySafe(studentToSave).conflict || err.serverResult || null };
      const blocked = ['PERMISSION_DENIED','SESSION_REQUIRED','INVALID_INPUT','STUDENT_NOT_FOUND'].includes(String(err?.code || ''));
      setMemoSyncStateSafe(studentToSave, { syncStatus: blocked ? 'blocked' : 'pending', revision: expectedRevision, mutationId });
      return { state: blocked ? 'blocked' : 'pending', student: studentToSave, error: err };
    }
  }


  function requestClean(value) {
    return String(value == null ? '' : value).trim();
  }

  function requestNoteTypeFor(student, explicitType) {
    const explicit = requestClean(explicitType);
    if (explicit) return explicit;
    try {
      if (typeof global.getSupabaseNoteDraftType === 'function') {
        return requestClean(global.getSupabaseNoteDraftType(student));
      }
    } catch (_) {}
    return student?.type === 'kinder' ? 'kinder_risk' : 'elementary_observation';
  }

  function requestKey(student, noteType) {
    const academyId = currentAcademyId();
    const studentId = requestClean(student?.id);
    const type = requestClean(noteType);
    return academyId && studentId && type ? `${academyId}:${studentId}:${type}` : '';
  }

  function localEntry(student) {
    try { return getMemoEntrySafe(student) || {}; }
    catch (_) { return {}; }
  }

  function writePendingRequest(request, expectedRevision) {
    if (!request) return;
    const current = localEntry(request.student);
    setMemoSafe(request.student, request.content, {
      updatedAt: request.updatedAt,
      lastSyncedAt: current.lastSyncedAt || '',
      syncStatus: 'pending',
      revision: memoRevision(expectedRevision),
      mutationId: request.mutationId,
      conflict: null
    });
  }

  function isSuccessfulPersistResult(result) {
    return !!(
      result &&
      (result.state === 'synced' || result.state === 'cleared') &&
      Number.isFinite(Number(result.revision))
    );
  }

  function rememberServerRevision(key, result) {
    if (!key || !isSuccessfulPersistResult(result)) return;
    const value = memoRevision(result.revision);
    const previous = memoRevision(knownServerRevisions.get(key));
    if (value >= previous) knownServerRevisions.set(key, value);
  }

  function restoreNewestPendingRequest(key, completedSequence, completedResult) {
    rememberServerRevision(key, completedResult);
    const newest = latestRequests.get(key);
    if (!newest || newest.sequence === completedSequence) return false;

    const knownRevision = memoRevision(knownServerRevisions.get(key));
    if (isSuccessfulPersistResult(completedResult) && knownRevision > newest.expectedRevision) {
      newest.expectedRevision = knownRevision;
    }
    writePendingRequest(newest, newest.expectedRevision);
    try {
      if (typeof global.setMemoSaveStatus === 'function') global.setMemoSaveStatus('작성 중...');
    } catch (_) {}
    return true;
  }

  async function persistObservationMemoDraft(student, content, options = {}) {
    if (!student) return persistObservationMemoDraftBase(student, content, options);
    const noteType = requestNoteTypeFor(student, options.noteType);
    const key = requestKey(student, noteType);
    if (!key) return persistObservationMemoDraftBase(student, content, options);

    const before = localEntry(student);
    // Preserve the base CAS boundary: a known conflict is never converted back to
    // pending merely because another autosave callback fired.
    if (before.syncStatus === 'conflict' && options.resolveConflict !== true) {
      return persistObservationMemoDraftBase(student, content, options);
    }

    const explicitExpected = Object.prototype.hasOwnProperty.call(options, 'expectedRevision');
    const request = {
      sequence: ++requestSequence,
      student: { ...student },
      noteType,
      content: String(content == null ? '' : content),
      expectedRevision: explicitExpected ? memoRevision(options.expectedRevision) : memoRevision(before.revision),
      mutationId: requestClean(options.mutationId) || createMutationId(),
      updatedAt: options.updatedAt || new Date().toISOString(),
      options: { ...options }
    };

    latestRequests.set(key, request);
    // Keep the newest text durable locally immediately while network writes serialize.
    writePendingRequest(request, request.expectedRevision);

    const previous = requestChains.get(key) || Promise.resolve(null);
    let task;
    task = previous
      .catch(() => null)
      .then(async previousResult => {
        rememberServerRevision(key, previousResult);

        if (latestRequests.get(key)?.sequence !== request.sequence) {
          return {
            state: 'superseded',
            student: request.student,
            error: null,
            revision: memoRevision(knownServerRevisions.get(key) || request.expectedRevision),
            superseded: true
          };
        }

        const knownRevision = memoRevision(knownServerRevisions.get(key));
        if (knownRevision > request.expectedRevision) request.expectedRevision = knownRevision;
        writePendingRequest(request, request.expectedRevision);

        return persistObservationMemoDraftBase(request.student, request.content, {
          ...request.options,
          noteType: request.noteType,
          expectedRevision: request.expectedRevision,
          mutationId: request.mutationId,
          updatedAt: request.updatedAt
        });
      })
      .then(result => {
        const superseded = restoreNewestPendingRequest(key, request.sequence, result);
        if (superseded && result && typeof result === 'object') return { ...result, superseded: true };
        return result;
      })
      .finally(() => {
        if (requestChains.get(key) === task) requestChains.delete(key);
        if (latestRequests.get(key)?.sequence === request.sequence) latestRequests.delete(key);
      });

    requestChains.set(key, task);
    return task;
  }

  function protectObservationMemoLocalDraft(student, noteType = '', content = '', updatedAt = '') {
    if (!student) return false;
    const type = requestNoteTypeFor(student, noteType);
    const key = requestKey(student, type);
    if (!key) return false;
    const before = localEntry(student);
    const request = {
      sequence: ++requestSequence,
      student: { ...student },
      noteType: type,
      content: String(content == null ? '' : content),
      expectedRevision: memoRevision(before.revision),
      mutationId: createMutationId(),
      updatedAt: updatedAt || new Date().toISOString(),
      options: { localOnly: true }
    };
    latestRequests.set(key, request);
    writePendingRequest(request, request.expectedRevision);
    return true;
  }

  async function clearObservationMemoDraftWithGuard(student, noteType = '') {
    const result = await persistObservationMemoDraft(student, '', { noteType });
    if (result?.state === 'conflict') return result;
    if (result?.state === 'pending' || result?.state === 'blocked') {
      throw result.error || new Error('관찰노트 비우기 서버 저장이 완료되지 않았습니다.');
    }
    return result;
  }

  function getObservationMemoRequestGuardState(student, noteType = '') {
    const type = requestNoteTypeFor(student, noteType);
    const key = requestKey(student, type);
    if (!key) return null;
    const latest = latestRequests.get(key);
    return {
      inFlight: requestChains.has(key),
      latestSequence: latest?.sequence || 0,
      expectedRevision: latest?.expectedRevision ?? memoRevision(knownServerRevisions.get(key)),
      knownServerRevision: memoRevision(knownServerRevisions.get(key))
    };
  }

  global.protectObservationMemoLocalDraft = protectObservationMemoLocalDraft;
  global.persistObservationMemoDraft = persistObservationMemoDraft;
  global.clearStudentNoteDraftFromSupabase = clearObservationMemoDraftWithGuard;
  global.getObservationMemoRequestGuardState = getObservationMemoRequestGuardState;
})(window);
