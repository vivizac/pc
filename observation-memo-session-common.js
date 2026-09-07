/* PC/Phone common observation memo session loading.
   UI rendering and platform-specific navigation intentionally stay outside this file. */
(function initObservationMemoSessionCommon(global) {
  'use strict';

  function getObservationMemoLocalSnapshot(student) {
    return getMemoEntryByStudent(student);
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
  global.reconcileObservationMemoDraft = reconcileObservationMemoDraft;
})(window);
