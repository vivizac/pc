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
    const localRevision = memoRevision(latestLocalEntry.revision);
    const localMutationId = String(latestLocalEntry.mutationId || '');
    const localStatus = String(latestLocalEntry.syncStatus || 'local');
    const editorDirty = isCurrentObservationMemoDirty(student);
    const protectedLocal = editorDirty || ['pending', 'conflict', 'blocked'].includes(localStatus);

    if (
      protectedLocal &&
      localMutationId &&
      remoteMutationId === localMutationId &&
      remoteText === String(latestLocalEntry.content || '')
    ) {
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
        source: 'remote-confirmed-local',
        localEntry: getMemoEntryByStudent(student),
        remoteRow: row,
        content: remoteText,
        updatedAt: syncedAt,
        revision: remoteRevision
      };
    }

    const revisionAdvanced = remoteRevision > localRevision;
    const legacyTimestampAdvanced = remoteRevision === localRevision &&
      isRemoteMemoNewerThanLocal(remoteUpdatedAt, latestLocalEntry.updatedAt || '');
    const serverChanged = revisionAdvanced || legacyTimestampAdvanced;

    if (serverChanged && protectedLocal) {
      const conflict = makeConflictFromRemote(row);
      setMemoByStudent(student, latestLocalEntry.content || '', {
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
        content: latestLocalEntry.content || '',
        updatedAt: latestLocalEntry.updatedAt || '',
        revision: localRevision,
        conflict
      };
    }

    if (!serverChanged) {
      if (!protectedLocal && remoteRevision !== localRevision) {
        setMemoByStudent(student, latestLocalEntry.content || '', {
          updatedAt: latestLocalEntry.updatedAt || remoteUpdatedAt,
          lastSyncedAt: latestLocalEntry.lastSyncedAt || remoteUpdatedAt,
          syncStatus: 'synced',
          revision: remoteRevision,
          mutationId: '',
          conflict: null
        });
      }
      return {
        adoptedRemote: false,
        source: 'local',
        localEntry: getMemoEntryByStudent(student),
        remoteRow: row,
        content: latestLocalEntry.content || '',
        updatedAt: latestLocalEntry.updatedAt || '',
        revision: memoRevision(getMemoEntryByStudent(student).revision)
      };
    }

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
      source: 'remote',
      localEntry: getMemoEntryByStudent(student),
      remoteRow: row,
      content: remoteText,
      updatedAt: syncedAt,
      revision: remoteRevision
    };
  }

  global.getObservationMemoLocalSnapshot = getObservationMemoLocalSnapshot;
  global.beginObservationMemoSession = beginObservationMemoSession;
  global.prepareObservationMemoInitialView = prepareObservationMemoInitialView;
  global.reconcileObservationMemoDraft = reconcileObservationMemoDraft;
})(window);
