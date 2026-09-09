/* PC/Phone common observation memo session loading.
   Platform-specific navigation and DOM rendering stay outside this file. */
(function initObservationMemoSessionCommon(global) {
  'use strict';

  function memoRevision(value) {
    const revision = Number(value || 0);
    return Number.isFinite(revision) && revision >= 0 ? Math.floor(revision) : 0;
  }

  function getObservationMemoLocalSnapshot(student) {
    return getMemoEntryByStudent(student);
  }

  function beginObservationMemoSession(studentId) {
    const student = findStudentById(studentId);
    if (!student) return null;

    const type = student.type === 'kinder' ? 'kinder' : 'elementary';
    currentMemoStudent = student;
    currentMemoType = type;

    if (type === 'elementary') {
      setLastElementaryMemoStudent(student);
      selectedElementaryAnalysisHistoryId = '';
    }

    return {
      student,
      type,
      noteType: type === 'elementary' ? 'elementary_observation' : getSupabaseNoteDraftType(student),
      localEntry: type === 'elementary' ? getObservationMemoLocalSnapshot(student) : null,
      analysisDisplay: type === 'elementary'
        ? getPrimaryElementaryAnalysisDisplay(student)
        : null
    };
  }

  function prepareObservationMemoInitialView(session) {
    if (!session || session.type !== 'elementary' || !session.student) return null;

    const localEntry = session.localEntry || { content: '' };
    const analysisDisplay = session.analysisDisplay || { data: {}, createdAt: '' };

    return {
      student: session.student,
      noteType: session.noteType || 'elementary_observation',
      memoText: localEntry.content || '',
      revision: memoRevision(localEntry.revision),
      analysis: {
        data: analysisDisplay.data || {},
        createdAt: analysisDisplay.createdAt || ''
      }
    };
  }

  function isCurrentObservationMemoDirty(student) {
    try {
      if (!currentMemoStudent || String(currentMemoStudent.id || '') !== String(student?.id || '')) return false;
      if (currentMemoType !== 'elementary') return false;
      if (typeof hasObservationMemoDirtyChanges === 'function') return !!hasObservationMemoDirtyChanges();
    } catch (_) {}
    return false;
  }

  function makeConflictFromRemote(row) {
    return {
      code: 'REVISION_CONFLICT',
      serverRevision: memoRevision(row?.revision),
      serverContent: String(row?.content || ''),
      serverUpdatedAt: String(row?.updated_at || ''),
      detectedAt: new Date().toISOString()
    };
  }

  function adoptRemoteSnapshot(student, row, source = 'remote') {
    const remoteText = String(row?.content || '');
    const remoteUpdatedAt = String(row?.updated_at || '');
    const remoteRevision = memoRevision(row?.revision);
    const syncedAt = remoteUpdatedAt || new Date().toISOString();

    setMemoByStudent(student, remoteText, {
      updatedAt: syncedAt,
      lastSyncedAt: syncedAt,
      syncStatus: 'synced',
      revision: remoteRevision,
      mutationId: '',
      conflict: null
    });

    return {
      adoptedRemote: true,
      source,
      localEntry: getMemoEntryByStudent(student),
      remoteRow: row,
      content: remoteText,
      updatedAt: syncedAt,
      revision: remoteRevision
    };
  }

  async function reconcileObservationMemoDraft(student, noteType = '') {
    const resolvedType = noteType || getSupabaseNoteDraftType(student);
    const localEntry = getMemoEntryByStudent(student);
    if (!student?.id || !resolvedType) {
      return {
        adoptedRemote: false,
        source: 'local',
        localEntry,
        remoteRow: null,
        content: localEntry.content || '',
        updatedAt: localEntry.updatedAt || '',
        revision: memoRevision(localEntry.revision)
      };
    }

    const row = await loadStudentNoteDraftFromSupabase(student, resolvedType);
    if (!row) {
      return {
        adoptedRemote: false,
        source: 'local',
        localEntry: getMemoEntryByStudent(student),
        remoteRow: null,
        content: localEntry.content || '',
        updatedAt: localEntry.updatedAt || '',
        revision: memoRevision(localEntry.revision)
      };
    }

    const remoteText = String(row.content || '');
    const remoteUpdatedAt = String(row.updated_at || '');
    const remoteRevision = memoRevision(row.revision);
    const remoteMutationId = String(row.last_mutation_id || '');
    const latestLocalEntry = getMemoEntryByStudent(student);
    const localText = String(latestLocalEntry.content || '');
    const localUpdatedAt = String(latestLocalEntry.updatedAt || '');
    const localRevision = memoRevision(latestLocalEntry.revision);
    const localMutationId = String(latestLocalEntry.mutationId || '');
    const localStatus = String(latestLocalEntry.syncStatus || 'local');
    const editorDirty = isCurrentObservationMemoDirty(student);
    const protectedLocal = editorDirty || ['pending', 'conflict', 'blocked'].includes(localStatus);

    // A pending/blocked copy that is byte-for-byte identical to the server is not a
    // conflict. Normalize it to the authoritative server revision/timestamp so a
    // previously interrupted save cannot keep this device permanently stale.
    if (protectedLocal && remoteText === localText) {
      const syncedAt = remoteUpdatedAt || new Date().toISOString();
      setMemoByStudent(student, remoteText, {
        updatedAt: syncedAt,
        lastSyncedAt: syncedAt,
        syncStatus: 'synced',
        revision: remoteRevision,
        mutationId: '',
        conflict: null
      });
      return {
        adoptedRemote: false,
        recoveredPending: true,
        source: remoteMutationId && localMutationId && remoteMutationId === localMutationId
          ? 'remote-confirmed-local'
          : 'remote-equivalent-local',
        localEntry: getMemoEntryByStudent(student),
        remoteRow: row,
        content: remoteText,
        updatedAt: syncedAt,
        revision: remoteRevision
      };
    }

    // When the user has no unsaved edit, Supabase is the source of truth. Do not
    // let an old local timestamp/revision or a historically corrupted local copy
    // hide a change made on another device. This also repairs same-revision text
    // mismatches left by older clients.
    if (!protectedLocal) {
      const differsFromServer =
        remoteText !== localText ||
        remoteRevision !== localRevision ||
        remoteUpdatedAt !== localUpdatedAt ||
        localStatus !== 'synced';

      if (differsFromServer) {
        return adoptRemoteSnapshot(student, row, 'remote-authoritative');
      }

      return {
        adoptedRemote: false,
        source: 'server-equal-local',
        localEntry: latestLocalEntry,
        remoteRow: row,
        content: localText,
        updatedAt: localUpdatedAt,
        revision: localRevision
      };
    }

    const revisionAdvanced = remoteRevision > localRevision;
    const legacyTimestampAdvanced = remoteRevision === localRevision &&
      isRemoteMemoNewerThanLocal(remoteUpdatedAt, localUpdatedAt);
    const serverChanged = revisionAdvanced || legacyTimestampAdvanced;

    if (serverChanged) {
      const conflict = makeConflictFromRemote(row);
      setMemoByStudent(student, localText, {
        updatedAt: latestLocalEntry.updatedAt,
        lastSyncedAt: latestLocalEntry.lastSyncedAt,
        syncStatus: 'conflict',
        revision: localRevision,
        mutationId: localMutationId,
        conflict
      });
      try {
        if (typeof setMemoSaveStatus === 'function') setMemoSaveStatus('다른 기기에서 수정됨');
      } catch (_) {}
      return {
        adoptedRemote: false,
        conflictDetected: true,
        source: 'conflict',
        localEntry: getMemoEntryByStudent(student),
        remoteRow: row,
        content: localText,
        updatedAt: latestLocalEntry.updatedAt || '',
        revision: localRevision,
        conflict
      };
    }

    return {
      adoptedRemote: false,
      source: 'protected-local',
      localEntry: latestLocalEntry,
      remoteRow: row,
      content: localText,
      updatedAt: latestLocalEntry.updatedAt || '',
      revision: localRevision
    };
  }

  global.getObservationMemoLocalSnapshot = getObservationMemoLocalSnapshot;
  global.beginObservationMemoSession = beginObservationMemoSession;
  global.prepareObservationMemoInitialView = prepareObservationMemoInitialView;
  global.reconcileObservationMemoDraft = reconcileObservationMemoDraft;
})(window);