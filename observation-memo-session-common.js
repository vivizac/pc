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

  function makeConflictFromRemote(row, reason = 'REVISION_CONFLICT', extra = {}) {
    return {
      code: 'REVISION_CONFLICT',
      reason,
      origin: 'reconcile-lineage',
      serverRevision: memoRevision(row?.revision),
      serverContent: String(row?.content || ''),
      serverUpdatedAt: String(row?.updated_at || ''),
      detectedAt: new Date().toISOString(),
      ...extra
    };
  }

  function markLocalProtectedConflict(student, row, latestLocalEntry, reason, lineage = null) {
    const localText = String(latestLocalEntry?.content || '');
    const localRevision = memoRevision(latestLocalEntry?.revision);
    const localMutationId = String(latestLocalEntry?.mutationId || '');
    const conflict = makeConflictFromRemote(row, reason, lineage ? { lineage } : {});

    setMemoByStudent(student, localText, {
      updatedAt: latestLocalEntry?.updatedAt || '',
      lastSyncedAt: latestLocalEntry?.lastSyncedAt || '',
      syncStatus: 'conflict',
      revision: localRevision,
      mutationId: localMutationId,
      conflict
    });

    try {
      if (typeof setMemoSaveStatus === 'function') setMemoSaveStatus('다른 기기 기록 확인 필요');
    } catch (_) {}

    try {
      global.dispatchEvent(new CustomEvent('olli:observation-memo-conflict', {
        detail: {
          studentId: String(student?.id || ''),
          ...conflict
        }
      }));
    } catch (_) {}

    return {
      adoptedRemote: false,
      conflictDetected: true,
      source: reason,
      localEntry: getMemoEntryByStudent(student),
      remoteRow: row,
      content: localText,
      updatedAt: latestLocalEntry?.updatedAt || '',
      revision: localRevision,
      conflict
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

  function currentAcademyId() {
    try {
      if (typeof global.getOlliCurrentAcademyId === 'function') {
        return String(global.getOlliCurrentAcademyId() || '').trim();
      }
    } catch (_) {}
    return '';
  }

  function currentSessionToken() {
    try {
      return String(localStorage.getItem('olli_account_session_token_v1') || '').trim();
    } catch (_) {
      return '';
    }
  }

  async function loadObservationMemoVersionLineage(student, noteType) {
    if (typeof global.supabase !== 'function') return null;
    const academyId = currentAcademyId();
    const token = currentSessionToken();
    const studentId = String(student?.id || '').trim();
    const type = String(noteType || '').trim();
    if (!academyId || !token || !studentId || !type) return null;

    const response = await global.supabase('POST', 'rpc/olli_note_draft_version_list', {
      p_session_token: token,
      p_academy_id: academyId,
      p_student_id: studentId,
      p_note_type: type,
      p_limit: 50
    });

    if (!response || response.ok === false || !Array.isArray(response.items)) return null;
    return response.items;
  }

  function analyzeObservationMemoLineage(items, localText, remoteText, localRevision, remoteRevision) {
    const versions = Array.isArray(items) ? items : [];
    let localSeenRevision = 0;
    let remotePriorRevision = 0;
    let localExactRevision = false;

    versions.forEach(item => {
      const revision = memoRevision(item?.revision);
      const content = String(item?.content || '');
      if (content === localText) {
        localSeenRevision = Math.max(localSeenRevision, revision);
        if (revision === localRevision) localExactRevision = true;
      }
      if (revision < remoteRevision && content === remoteText) {
        remotePriorRevision = Math.max(remotePriorRevision, revision);
      }
    });

    const localKnown = localExactRevision || localSeenRevision > 0;
    const remoteIsHistoricalReversion =
      remotePriorRevision > 0 &&
      localSeenRevision > remotePriorRevision;

    return {
      localKnown,
      localExactRevision,
      localSeenRevision,
      remotePriorRevision,
      remoteIsHistoricalReversion
    };
  }

  function localHasMeaningfulSnapshot(entry) {
    const status = String(entry?.syncStatus || '');
    return !!(
      String(entry?.content || '').length ||
      memoRevision(entry?.revision) > 0 ||
      String(entry?.updatedAt || '').trim() ||
      ['synced', 'pending', 'blocked', 'conflict'].includes(status)
    );
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
    const localConflict = latestLocalEntry.conflict && typeof latestLocalEntry.conflict === 'object'
      ? latestLocalEntry.conflict
      : null;
    const editorDirty = isCurrentObservationMemoDirty(student);
    const isReconcileConflict = localStatus === 'conflict' && localConflict?.origin === 'reconcile-lineage';
    const protectedLocal =
      editorDirty ||
      ['pending', 'blocked'].includes(localStatus) ||
      (localStatus === 'conflict' && !isReconcileConflict);

    // Identical content is always safe to normalize to the server metadata. This
    // never changes the visible text and clears stale pending/conflict metadata.
    if (remoteText === localText) {
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
        recoveredPending: protectedLocal || isReconcileConflict,
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

    // If the user is actively editing or a write is pending/blocked, never replace
    // local text. A content mismatch itself is enough to enter conflict protection,
    // even when revision numbers happen to match.
    if (protectedLocal) {
      return markLocalProtectedConflict(
        student,
        row,
        latestLocalEntry,
        'active-local-conflict'
      );
    }

    // A truly empty device with no meaningful local snapshot can safely accept the
    // server copy. This is the new-device / cleared-browser case.
    if (!localHasMeaningfulSnapshot(latestLocalEntry)) {
      return adoptRemoteSnapshot(student, row, 'remote-new-device');
    }

    // Revision numbers created before the no-op fix cannot be trusted by themselves.
    // Before replacing divergent local text, inspect immutable version history.
    let lineageItems = null;
    try {
      lineageItems = await loadObservationMemoVersionLineage(student, resolvedType);
    } catch (error) {
      console.warn('관찰노트 버전 계보 확인 실패:', error?.message || error);
    }

    if (!lineageItems) {
      return markLocalProtectedConflict(
        student,
        row,
        latestLocalEntry,
        'lineage-unavailable'
      );
    }

    const lineage = analyzeObservationMemoLineage(
      lineageItems,
      localText,
      remoteText,
      localRevision,
      remoteRevision
    );

    // Critical safety rule: if today's server text already existed at an older
    // revision and this device's text existed at a later revision, the numeric
    // current revision is a historical reversion. Never auto-overwrite the later
    // local text with that older content.
    if (lineage.remoteIsHistoricalReversion) {
      return markLocalProtectedConflict(
        student,
        row,
        latestLocalEntry,
        'historical-reversion-conflict',
        lineage
      );
    }

    // If the local text cannot be proven to have been a server-confirmed version,
    // it may be an unsynced A-device edit. Preserve it instead of trusting a newer
    // timestamp/revision from another device.
    if (!lineage.localKnown) {
      return markLocalProtectedConflict(
        student,
        row,
        latestLocalEntry,
        'unverified-local-conflict',
        lineage
      );
    }

    // Safe automatic adoption is allowed only when lineage proves the local text was
    // an older server-confirmed state AND the remote text is genuinely newer, not an
    // older text reintroduced after it.
    if (remoteRevision > lineage.localSeenRevision) {
      if (lineage.remotePriorRevision === 0 || lineage.remotePriorRevision >= lineage.localSeenRevision) {
        return adoptRemoteSnapshot(student, row, 'remote-lineage-verified');
      }
    }

    // Any remaining ambiguity is intentionally conservative: keep the local text and
    // require resolution rather than risk destroying a real classroom record.
    return markLocalProtectedConflict(
      student,
      row,
      latestLocalEntry,
      'ambiguous-lineage-conflict',
      lineage
    );
  }

  global.getObservationMemoLocalSnapshot = getObservationMemoLocalSnapshot;
  global.beginObservationMemoSession = beginObservationMemoSession;
  global.prepareObservationMemoInitialView = prepareObservationMemoInitialView;
  global.reconcileObservationMemoDraft = reconcileObservationMemoDraft;
})(window);