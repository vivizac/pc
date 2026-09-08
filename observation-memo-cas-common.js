/* PC/Phone common observation memo multi-device safety.
   - server revision is authoritative
   - stale writes are rejected by olli_note_draft_save_cas
   - rejected drafts stay local and are also preserved in the PC recovery center
   - network retries reuse the same expected revision + mutation id */
(function initObservationMemoCasCommon(global) {
  'use strict';

  if (global.__olliObservationMemoCasInstalled) return;
  global.__olliObservationMemoCasInstalled = true;

  const SESSION_KEY = 'olli_account_session_token_v1';
  const DEVICE_KEY = 'olli_account_device_id_v1';
  const META_PREFIX = 'olli_note_cas_meta_v1';

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function academyId() {
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
  function metaKey(student, noteType) {
    const aid = academyId();
    const sid = clean(student?.id);
    const type = clean(noteType);
    if (!aid || !sid || !type) return '';
    return `${META_PREFIX}:${aid}:${sid}:${type}`;
  }
  function readMeta(student, noteType) {
    const key = metaKey(student, noteType);
    const fallback = {
      revision: 0,
      status: 'unknown',
      hasPending: false,
      expectedRevision: 0,
      pendingMutationId: '',
      pendingContent: '',
      conflictServerRevision: 0,
      updatedAt: ''
    };
    if (!key) return fallback;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      if (!parsed || typeof parsed !== 'object') return fallback;
      return {
        ...fallback,
        ...parsed,
        revision: Number(parsed.revision || 0),
        expectedRevision: Number(parsed.expectedRevision || 0),
        conflictServerRevision: Number(parsed.conflictServerRevision || 0),
        hasPending: parsed.hasPending === true
      };
    } catch (_) {
      return fallback;
    }
  }
  function writeMeta(student, noteType, patch) {
    const key = metaKey(student, noteType);
    if (!key) return readMeta(student, noteType);
    const next = { ...readMeta(student, noteType), ...(patch || {}) };
    next.revision = Number(next.revision || 0);
    next.expectedRevision = Number(next.expectedRevision || 0);
    next.conflictServerRevision = Number(next.conflictServerRevision || 0);
    next.updatedAt = new Date().toISOString();
    localStorage.setItem(key, JSON.stringify(next));
    return next;
  }
  function mutationId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return `note_${global.crypto.randomUUID()}`;
    }
    return `note_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
  function sessionToken() { return clean(localStorage.getItem(SESSION_KEY)); }
  function deviceId() { return clean(localStorage.getItem(DEVICE_KEY)); }
  function isCurrentDirty(student) {
    try {
      const state = typeof global.getObservationMemoEditState === 'function' ? global.getObservationMemoEditState() : null;
      if (!state || !state.dirty) return false;
      return clean(state.studentId) === clean(student?.id);
    } catch (_) {
      return false;
    }
  }
  function isRetryableNetworkError(error) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    const message = clean(error?.message || error).toLowerCase();
    return /network|fetch|timeout|offline|failed to fetch|load failed/.test(message);
  }
  function setLocalEntry(student, content, options) {
    if (typeof global.setMemoByStudent !== 'function') return;
    const opts = options || {};
    global.setMemoByStudent(student, String(content == null ? '' : content), {
      updatedAt: opts.updatedAt || new Date().toISOString(),
      lastSyncedAt: opts.lastSyncedAt || '',
      syncStatus: opts.syncStatus || 'local'
    });
  }
  function setLocalSyncStatus(student, status) {
    if (typeof global.setMemoSyncStateByStudent === 'function') {
      global.setMemoSyncStateByStudent(student, { syncStatus: status });
    }
  }
  function notifyConflict(student) {
    const sid = clean(student?.id);
    if (global.__olliLastObservationConflictStudent === sid) return;
    global.__olliLastObservationConflictStudent = sid;
    const message = '다른 기기에서 더 최신 관찰노트가 저장되어 이 작성본은 덮어쓰지 않았어요. 작성본은 PC 복구센터에 안전하게 보관했습니다.';
    if (typeof global.showPushToast === 'function') global.showPushToast(message);
    else if (typeof global.alert === 'function') global.alert(message);
  }
  function notifyBlocked(message) {
    const text = clean(message) || '관찰노트를 서버에 저장하지 못했습니다.';
    if (typeof global.showPushToast === 'function') global.showPushToast(text);
  }

  async function casRpc(student, noteType, content, expectedRevision, mutation) {
    if (typeof global.supabase !== 'function') throw new Error('관찰노트 서버 연결을 찾지 못했습니다.');
    const aid = academyId();
    const token = sessionToken();
    const sid = clean(student?.id);
    if (!aid || !token || !sid || !noteType) throw new Error('관찰노트 저장에 필요한 로그인 또는 학생 정보가 없습니다.');

    const response = await global.supabase('POST', 'rpc/olli_note_draft_save_cas', {
      p_session_token: token,
      p_academy_id: aid,
      p_student_id: sid,
      p_note_type: noteType,
      p_content: String(content == null ? '' : content),
      p_expected_revision: Number(expectedRevision || 0),
      p_mutation_id: clean(mutation) || mutationId(),
      p_device_id: deviceId() || null
    });
    return Array.isArray(response) && response.length === 1 ? response[0] : response;
  }

  async function saveDraftCas(student, content, options) {
    if (!student) return { state: 'skipped', student: null, error: null };
    const opts = options || {};
    const noteType = noteTypeFor(student, opts.noteType);
    const text = String(content == null ? '' : content);
    if (!clean(student.id) || !noteType) return { state: 'skipped', student, error: null };

    let meta = readMeta(student, noteType);
    if (meta.status === 'conflict' && opts.resolveConflict !== true) {
      setLocalEntry(student, text, { syncStatus: 'conflict' });
      notifyConflict(student);
      return {
        state: 'conflict', student, error: null,
        expectedRevision: meta.expectedRevision,
        serverRevision: meta.conflictServerRevision || meta.revision
      };
    }

    const reusePending = meta.hasPending && meta.pendingContent === text && clean(meta.pendingMutationId);
    const expectedRevision = opts.expectedRevision != null
      ? Number(opts.expectedRevision || 0)
      : (reusePending ? Number(meta.expectedRevision || 0) : Number(meta.revision || 0));
    const clientMutationId = clean(opts.mutationId) || (reusePending ? clean(meta.pendingMutationId) : mutationId());

    setLocalEntry(student, text, { syncStatus: 'pending' });
    meta = writeMeta(student, noteType, {
      status: 'pending',
      hasPending: true,
      expectedRevision,
      pendingMutationId: clientMutationId,
      pendingContent: text
    });

    try {
      const data = await casRpc(student, noteType, text, expectedRevision, clientMutationId);
      if (data && data.ok === true) {
        const serverRevision = Number(data.revision || expectedRevision + 1 || 1);
        const serverUpdatedAt = clean(data.updated_at) || new Date().toISOString();
        writeMeta(student, noteType, {
          revision: serverRevision,
          status: 'synced',
          hasPending: false,
          expectedRevision: serverRevision,
          pendingMutationId: '',
          pendingContent: '',
          conflictServerRevision: 0
        });
        setLocalEntry(student, data.content == null ? text : data.content, {
          updatedAt: serverUpdatedAt,
          lastSyncedAt: serverUpdatedAt,
          syncStatus: 'synced'
        });
        const finalStudent = { ...student, memoUpdatedAt: text.trim() ? serverUpdatedAt : '' };
        try {
          if (typeof global.saveStudent === 'function') await global.saveStudent(finalStudent, { skipRemote: true });
        } catch (_) {}
        if (typeof global.markObservationMemoEditorClean === 'function') global.markObservationMemoEditorClean();
        global.__olliLastObservationConflictStudent = '';
        return {
          state: text.trim() ? 'synced' : 'cleared',
          student: finalStudent,
          error: null,
          syncedAt: serverUpdatedAt,
          revision: serverRevision,
          idempotent: data.idempotent === true
        };
      }

      if (data && data.code === 'REVISION_CONFLICT') {
        const serverRevision = Number(data.server_revision || 0);
        writeMeta(student, noteType, {
          revision: Number(meta.revision || 0),
          status: 'conflict',
          hasPending: false,
          expectedRevision,
          pendingMutationId: '',
          pendingContent: '',
          conflictServerRevision: serverRevision
        });
        setLocalEntry(student, text, { syncStatus: 'conflict' });
        notifyConflict(student);
        return {
          state: 'conflict', student, error: null,
          expectedRevision,
          serverRevision,
          serverContent: String(data.server_content == null ? '' : data.server_content),
          serverUpdatedAt: clean(data.server_updated_at)
        };
      }

      const error = new Error(clean(data?.message) || '관찰노트 서버 저장이 거절되었습니다.');
      error.code = clean(data?.code) || 'SERVER_WRITE_FAILED';
      const blocked = ['PERMISSION_DENIED', 'INVALID_INPUT', 'STUDENT_NOT_FOUND'].includes(error.code);
      writeMeta(student, noteType, { status: blocked ? 'blocked' : 'pending', hasPending: !blocked });
      setLocalSyncStatus(student, blocked ? 'blocked' : 'pending');
      notifyBlocked(error.message);
      return { state: blocked ? 'blocked' : 'pending', student, error };
    } catch (error) {
      writeMeta(student, noteType, {
        status: 'pending',
        hasPending: true,
        expectedRevision,
        pendingMutationId: clientMutationId,
        pendingContent: text
      });
      setLocalSyncStatus(student, 'pending');
      return { state: 'pending', student, error, retryable: isRetryableNetworkError(error) };
    }
  }

  async function reconcileDraftCas(student, explicitType) {
    const noteType = noteTypeFor(student, explicitType);
    const localEntry = typeof global.getMemoEntryByStudent === 'function'
      ? global.getMemoEntryByStudent(student)
      : { content: '', updatedAt: '', syncStatus: 'unknown' };
    if (!student?.id || !noteType || typeof global.loadStudentNoteDraftFromSupabase !== 'function') {
      return { adoptedRemote: false, source: 'local', localEntry, remoteRow: null, content: localEntry.content || '', updatedAt: localEntry.updatedAt || '' };
    }

    let row = null;
    try { row = await global.loadStudentNoteDraftFromSupabase(student, noteType); }
    catch (error) {
      return { adoptedRemote: false, source: 'local', localEntry, remoteRow: null, content: localEntry.content || '', updatedAt: localEntry.updatedAt || '', error };
    }

    let meta = readMeta(student, noteType);
    const serverRevision = Number(row?.revision || 0);

    // If an earlier request reached the server but its response was lost, confirm it by mutation id.
    if (meta.status === 'pending' && meta.hasPending && clean(meta.pendingMutationId)) {
      if (row && clean(row.last_mutation_id) === clean(meta.pendingMutationId)) {
        const serverUpdatedAt = clean(row.updated_at) || new Date().toISOString();
        writeMeta(student, noteType, {
          revision: serverRevision,
          status: 'synced', hasPending: false,
          expectedRevision: serverRevision,
          pendingMutationId: '', pendingContent: '', conflictServerRevision: 0
        });
        setLocalEntry(student, row.content || '', { updatedAt: serverUpdatedAt, lastSyncedAt: serverUpdatedAt, syncStatus: 'synced' });
        meta = readMeta(student, noteType);
      } else if (!isCurrentDirty(student) && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        // Re-send with the ORIGINAL expected revision. If another device already advanced the row,
        // the server stores this rejected payload in the recovery center instead of overwriting it.
        const retried = await saveDraftCas(student, meta.pendingContent, {
          noteType,
          expectedRevision: meta.expectedRevision,
          mutationId: meta.pendingMutationId
        });
        if (retried.state === 'conflict') {
          return {
            adoptedRemote: false, source: 'conflict', localEntry: global.getMemoEntryByStudent(student),
            remoteRow: row, content: meta.pendingContent || '', updatedAt: localEntry.updatedAt || '', conflict: retried
          };
        }
        if (retried.state === 'synced' || retried.state === 'cleared') {
          row = await global.loadStudentNoteDraftFromSupabase(student, noteType);
          meta = readMeta(student, noteType);
        }
      }
    }

    // The rejected local copy is already safe on the server. On the next clean open,
    // show the authoritative server version again; never replace text while the user is typing.
    if (meta.status === 'conflict') {
      if (!isCurrentDirty(student) && row) {
        const serverUpdatedAt = clean(row.updated_at) || new Date().toISOString();
        writeMeta(student, noteType, {
          revision: serverRevision,
          status: 'synced', hasPending: false,
          expectedRevision: serverRevision,
          pendingMutationId: '', pendingContent: '', conflictServerRevision: 0
        });
        setLocalEntry(student, row.content || '', { updatedAt: serverUpdatedAt, lastSyncedAt: serverUpdatedAt, syncStatus: 'synced' });
        global.__olliLastObservationConflictStudent = '';
        return {
          adoptedRemote: true, source: 'remote_after_conflict',
          localEntry: global.getMemoEntryByStudent(student), remoteRow: row,
          content: row.content || '', updatedAt: serverUpdatedAt, revision: serverRevision
        };
      }
      return { adoptedRemote: false, source: 'conflict', localEntry, remoteRow: row, content: localEntry.content || '', updatedAt: localEntry.updatedAt || '', revision: serverRevision };
    }

    if (!row) {
      if (meta.status !== 'pending') writeMeta(student, noteType, { revision: 0, expectedRevision: 0, status: 'synced' });
      return { adoptedRemote: false, source: 'local', localEntry: global.getMemoEntryByStudent(student), remoteRow: null, content: localEntry.content || '', updatedAt: localEntry.updatedAt || '', revision: 0 };
    }

    const latestLocal = global.getMemoEntryByStudent(student);
    const localRevision = Number(readMeta(student, noteType).revision || 0);
    const contentDiffers = String(latestLocal.content || '') !== String(row.content || '');
    const shouldAdopt = !isCurrentDirty(student) && (serverRevision > localRevision || (serverRevision === localRevision && contentDiffers && latestLocal.syncStatus !== 'pending'));
    const serverUpdatedAt = clean(row.updated_at) || new Date().toISOString();

    writeMeta(student, noteType, {
      revision: Math.max(localRevision, serverRevision),
      expectedRevision: Math.max(localRevision, serverRevision),
      status: latestLocal.syncStatus === 'pending' ? 'pending' : 'synced'
    });

    if (!shouldAdopt) {
      return { adoptedRemote: false, source: 'local', localEntry: latestLocal, remoteRow: row, content: latestLocal.content || '', updatedAt: latestLocal.updatedAt || '', revision: serverRevision };
    }

    setLocalEntry(student, row.content || '', { updatedAt: serverUpdatedAt, lastSyncedAt: serverUpdatedAt, syncStatus: 'synced' });
    return {
      adoptedRemote: true, source: 'remote',
      localEntry: global.getMemoEntryByStudent(student), remoteRow: row,
      content: row.content || '', updatedAt: serverUpdatedAt, revision: serverRevision
    };
  }

  function applyReconciledDraft(student, memoEditor, result) {
    if (!student || !memoEditor || !result || !result.adoptedRemote) {
      return { applied: false, reason: 'no-remote-update' };
    }
    const sameStudent = global.currentMemoStudent && clean(global.currentMemoStudent.id) === clean(student.id);
    const sameType = global.currentMemoType === 'elementary';
    if (!sameStudent || !sameType) return { applied: false, reason: 'stale-session' };
    if (isCurrentDirty(student)) return { applied: false, reason: 'user-edited-during-sync' };

    memoEditor.value = String(result.content == null ? '' : result.content);
    try {
      const state = typeof global.getObservationMemoEditState === 'function' ? global.getObservationMemoEditState() : null;
      if (state) {
        state.baselineText = memoEditor.value;
        state.dirty = false;
      }
    } catch (_) {}
    if (typeof global.updateMemoStudentMetaDisplay === 'function') {
      global.updateMemoStudentMetaDisplay(student, memoEditor.value.trim() ? (result.updatedAt || '') : '');
    }
    return { applied: true, reason: 'remote-applied' };
  }

  async function retryAllPending() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (global.__olliObservationPendingRetryRunning) return;
    if (typeof global.getAllStudents !== 'function') return;
    global.__olliObservationPendingRetryRunning = true;
    try {
      const students = global.getAllStudents();
      for (const student of Array.isArray(students) ? students : []) {
        const type = noteTypeFor(student, '');
        if (!type || isCurrentDirty(student)) continue;
        const meta = readMeta(student, type);
        if (meta.status !== 'pending' || !meta.hasPending || !clean(meta.pendingMutationId)) continue;
        await saveDraftCas(student, meta.pendingContent, {
          noteType: type,
          expectedRevision: meta.expectedRevision,
          mutationId: meta.pendingMutationId
        });
      }
    } finally {
      global.__olliObservationPendingRetryRunning = false;
    }
  }

  // Replace only the observation-note path. Other Olli storage features keep using the generic storage core.
  global.persistObservationMemoDraft = saveDraftCas;
  global.reconcileObservationMemoDraft = reconcileDraftCas;
  global.applyReconciledObservationMemoDraft = applyReconciledDraft;
  global.getObservationMemoCasMeta = function(student, noteType) { return readMeta(student, noteTypeFor(student, noteType)); };
  global.retryPendingObservationMemoDrafts = retryAllPending;

  // The legacy autosave marked the editor clean immediately after STARTING an async save.
  // With CAS, only a confirmed server save may mark it clean.
  global.scheduleMemoAutoSave = function scheduleMemoAutoSaveCas() {
    if (!global.currentMemoStudent) return;
    if (typeof global.isObservationMemoAutoSaveBlocked === 'function' && global.isObservationMemoAutoSaveBlocked()) return;
    if (typeof global.setMemoSaveStatus === 'function') global.setMemoSaveStatus('작성 중...');
    if (global.__olliObservationMemoAutoSaveTimer) clearTimeout(global.__olliObservationMemoAutoSaveTimer);
    const delay = typeof MEMO_AUTOSAVE_DELAY !== 'undefined' ? MEMO_AUTOSAVE_DELAY : 900;
    global.__olliObservationMemoAutoSaveTimer = setTimeout(() => {
      global.__olliObservationMemoAutoSaveTimer = null;
      try {
        const promise = typeof global.saveCurrentMemo === 'function' ? global.saveCurrentMemo({ silent: true, status: true }) : null;
        if (promise && typeof promise.catch === 'function') promise.catch(error => console.warn('관찰노트 자동저장 보류:', error?.message || error));
      } catch (error) {
        console.warn('관찰노트 자동저장 보류:', error?.message || error);
      }
    }, delay);
  };

  global.flushMemoAutoSave = function flushMemoAutoSaveCas() {
    if (!global.currentMemoStudent) return false;
    if (!global.__olliObservationMemoAutoSaveTimer) return false;
    clearTimeout(global.__olliObservationMemoAutoSaveTimer);
    global.__olliObservationMemoAutoSaveTimer = null;
    try {
      const promise = typeof global.saveCurrentMemo === 'function' ? global.saveCurrentMemo({ silent: true, status: true }) : null;
      if (promise && typeof promise.catch === 'function') promise.catch(error => console.warn('관찰노트 저장 보류:', error?.message || error));
    } catch (error) {
      console.warn('관찰노트 저장 보류:', error?.message || error);
    }
    return true;
  };

  global.prepareObservationMemoPageClose = function prepareObservationMemoPageCloseCas() {
    const flushed = global.flushMemoAutoSave();
    if (!flushed && typeof global.hasObservationMemoDirtyChanges === 'function' && global.hasObservationMemoDirtyChanges()) {
      try {
        const promise = typeof global.saveCurrentMemo === 'function' ? global.saveCurrentMemo({ silent: true }) : null;
        if (promise && typeof promise.catch === 'function') promise.catch(error => console.warn('관찰노트 닫기 저장 보류:', error?.message || error));
      } catch (error) {
        console.warn('관찰노트 닫기 저장 보류:', error?.message || error);
      }
    }
  };

  let retryTimer = null;
  function scheduleRetry() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      retryAllPending().catch(error => console.warn('관찰노트 재전송 보류:', error?.message || error));
    }, 250);
  }
  global.addEventListener('online', scheduleRetry);
  global.addEventListener('focus', scheduleRetry);
})(window);
