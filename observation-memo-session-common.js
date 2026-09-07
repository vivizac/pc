/* PC/Phone common observation memo session loading.
   Platform-specific navigation stays outside this file; shared editor reconciliation lives here. */
(function initObservationMemoSessionCommon(global) {
  'use strict';

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

  function applyReconciledObservationMemoDraft(student, memoEditor, result) {
    if (!student || !memoEditor || !result || !result.adoptedRemote || !result.content) {
      return { applied: false, reason: 'no-remote-update' };
    }

    const isSameMemoPage =
      currentMemoStudent &&
      String(currentMemoStudent.id || '') === String(student.id || '') &&
      currentMemoType === 'elementary';

    if (!isSameMemoPage) {
      return { applied: false, reason: 'stale-session' };
    }

    const currentEditorText = memoEditor.value || '';
    if (currentEditorText.trim().length > 0) {
      return { applied: false, reason: 'visible-local-content' };
    }

    memoEditor.value = result.content;
    if (typeof updateMemoStudentMetaDisplay === 'function') {
      updateMemoStudentMetaDisplay(student, result.updatedAt || '');
    }

    return { applied: true, reason: 'remote-applied' };
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
        updatedAt: localEntry.updatedAt || ''
      };
    }

    const row = await loadStudentNoteDraftFromSupabase(student, resolvedType);
    if (!row || !row.content) {
      return {
        adoptedRemote: false,
        source: 'local',
        localEntry: getMemoEntryByStudent(student),
        remoteRow: row || null,
        content: localEntry.content || '',
        updatedAt: localEntry.updatedAt || ''
      };
    }

    const remoteText = row.content || '';
    const remoteUpdatedAt = row.updated_at || '';
    const latestLocalEntry = getMemoEntryByStudent(student);
    const shouldAdoptRemote = isRemoteMemoNewerThanLocal(remoteUpdatedAt, latestLocalEntry.updatedAt || '');

    if (!shouldAdoptRemote) {
      return {
        adoptedRemote: false,
        source: 'local',
        localEntry: latestLocalEntry,
        remoteRow: row,
        content: latestLocalEntry.content || '',
        updatedAt: latestLocalEntry.updatedAt || ''
      };
    }

    const syncedAt = remoteUpdatedAt || new Date().toISOString();
    setMemoByStudent(student, remoteText, {
      updatedAt: syncedAt,
      lastSyncedAt: syncedAt,
      syncStatus: 'synced'
    });

    return {
      adoptedRemote: true,
      source: 'remote',
      localEntry: getMemoEntryByStudent(student),
      remoteRow: row,
      content: remoteText,
      updatedAt: syncedAt
    };
  }

  global.getObservationMemoLocalSnapshot = getObservationMemoLocalSnapshot;
  global.beginObservationMemoSession = beginObservationMemoSession;
  global.applyReconciledObservationMemoDraft = applyReconciledObservationMemoDraft;
  global.reconcileObservationMemoDraft = reconcileObservationMemoDraft;
})(window);
