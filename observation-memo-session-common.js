/* PC/Phone common observation memo session loading.
   Platform-specific navigation and DOM rendering stay outside this file. */
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

  function prepareObservationMemoInitialView(session) {
    if (!session || session.type !== 'elementary' || !session.student) return null;

    const localEntry = session.localEntry || { content: '' };
    const analysisDisplay = session.analysisDisplay || { data: {}, createdAt: '' };

    return {
      student: session.student,
      noteType: session.noteType || 'elementary_observation',
      memoText: localEntry.content || '',
      analysis: {
        data: analysisDisplay.data || {},
        createdAt: analysisDisplay.createdAt || ''
      }
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
  global.prepareObservationMemoInitialView = prepareObservationMemoInitialView;
  global.reconcileObservationMemoDraft = reconcileObservationMemoDraft;
})(window);
