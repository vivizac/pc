/* PC/Phone common observation memo draft storage core.
   Platform-specific archive/read-only/UI behavior intentionally excluded. */
(function initObservationMemoStorageCommon(global) {
  'use strict';

  function memoRevision(value) {
    const revision = Number(value || 0);
    return Number.isFinite(revision) && revision >= 0 ? Math.floor(revision) : 0;
  }

  function createObservationMemoStorage(config = {}) {
    const resolveMemoKey = typeof config.getMemoKey === 'function' ? config.getMemoKey : (() => '');
    const resolveDraftType = typeof config.getDraftType === 'function' ? config.getDraftType : (() => '');

    function getMemoKey(student, noteType = '') {
      return String(resolveMemoKey(student, noteType) || '');
    }

    function getMemoByStudent(student, noteType = '') {
      const key = getMemoKey(student, noteType);
      if (!key) return '';
      const raw = localStorage.getItem(key);
      if (!raw) return '';
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && 'content' in parsed) return parsed.content || '';
      } catch {}
      return raw;
    }

    function getMemoEntryByStudent(student, noteType = '') {
      const key = getMemoKey(student, noteType);
      const empty = status => ({
        content: '',
        updatedAt: '',
        lastSyncedAt: '',
        syncStatus: status,
        revision: 0,
        mutationId: '',
        conflict: null
      });
      if (!key) return empty('unknown');
      const raw = localStorage.getItem(key);
      if (!raw) return empty('empty');
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
      } catch {}
      return { ...empty('local'), content: raw || '' };
    }

    function setMemoByStudent(student, content, options = {}, noteType = '') {
      const key = getMemoKey(student, noteType);
      if (!key) return;
      const previous = getMemoEntryByStudent(student, noteType);
      const has = keyName => Object.prototype.hasOwnProperty.call(options, keyName);
      localStorage.setItem(key, JSON.stringify({
        content: content || '',
        updatedAt: has('updatedAt')
          ? (options.updatedAt || '')
          : (previous.updatedAt || new Date().toISOString()),
        lastSyncedAt: has('lastSyncedAt')
          ? (options.lastSyncedAt || '')
          : (previous.lastSyncedAt || ''),
        syncStatus: options.syncStatus || previous.syncStatus || 'local',
        revision: has('revision') ? memoRevision(options.revision) : memoRevision(previous.revision),
        mutationId: has('mutationId') ? String(options.mutationId || '') : String(previous.mutationId || ''),
        conflict: has('conflict') ? (options.conflict || null) : (previous.conflict || null)
      }));
    }

    function clearMemoByStudent(student, noteType = '') {
      const key = getMemoKey(student, noteType);
      if (!key) return;
      localStorage.removeItem(key);
    }

    function setMemoSyncStateByStudent(student, syncState = {}, noteType = '') {
      const entry = getMemoEntryByStudent(student, noteType);
      setMemoByStudent(student, entry.content || '', {
        updatedAt: Object.prototype.hasOwnProperty.call(syncState, 'updatedAt')
          ? syncState.updatedAt
          : entry.updatedAt,
        lastSyncedAt: Object.prototype.hasOwnProperty.call(syncState, 'lastSyncedAt')
          ? syncState.lastSyncedAt
          : entry.lastSyncedAt,
        syncStatus: syncState.syncStatus || entry.syncStatus || 'local',
        revision: Object.prototype.hasOwnProperty.call(syncState, 'revision')
          ? syncState.revision
          : entry.revision,
        mutationId: Object.prototype.hasOwnProperty.call(syncState, 'mutationId')
          ? syncState.mutationId
          : entry.mutationId,
        conflict: Object.prototype.hasOwnProperty.call(syncState, 'conflict')
          ? syncState.conflict
          : entry.conflict
      }, noteType);
    }

    function isRemoteMemoNewerThanLocal(remoteUpdatedAt, localUpdatedAt) {
      if (!remoteUpdatedAt) return false;
      if (!localUpdatedAt) return true;
      const remoteTime = new Date(remoteUpdatedAt).getTime();
      const localTime = new Date(localUpdatedAt).getTime();
      if (Number.isNaN(remoteTime) || Number.isNaN(localTime)) return false;
      return remoteTime > localTime;
    }

    function isRemoteMemoRevisionNewerThanLocal(remoteRevision, localRevision) {
      return memoRevision(remoteRevision) > memoRevision(localRevision);
    }

    function getSupabaseNoteDraftType(student) {
      return String(resolveDraftType(student) || '');
    }

    function getStudentNoteDraftPath(student, noteType = '') {
      const academyId = getOlliCurrentAcademyId();
      const studentId = student?.id || '';
      const type = noteType || getSupabaseNoteDraftType(student);
      if (!academyId || !studentId || !type) return '';
      return `student_note_drafts?academy_id=eq.${encodeURIComponent(academyId)}&student_id=eq.${encodeURIComponent(studentId)}&note_type=eq.${encodeURIComponent(type)}`;
    }

    async function loadStudentNoteDraftFromSupabase(student, noteType = '') {
      if (!isSupabaseConfigured() || !student?.id) return null;
      const academyId = String(getOlliCurrentAcademyId() || '').trim();
      const studentId = String(student.id || '').trim();
      const type = String(noteType || getSupabaseNoteDraftType(student) || '').trim();
      const sessionToken = String(localStorage.getItem('olli_account_session_token_v1') || '').trim();
      if (!academyId || !studentId || !type) return null;
      if (!sessionToken) {
        const error = new Error('계정 세션이 없어 관찰노트 서버 초안을 읽을 수 없습니다.');
        error.code = 'NO_ACCOUNT_SESSION';
        throw error;
      }

      const result = await supabase('POST', 'rpc/olli_note_draft_read', {
        p_session_token: sessionToken,
        p_academy_id: academyId,
        p_student_id: studentId,
        p_note_type: type
      });
      if (result && typeof result === 'object' && !Array.isArray(result) && result.ok === false) {
        const error = new Error(result.message || '관찰노트 서버 초안을 읽지 못했습니다.');
        error.code = String(result.code || 'NOTE_DRAFT_READ_FAILED');
        throw error;
      }
      const rows = Array.isArray(result)
        ? result
        : (Array.isArray(result?.rows) ? result.rows : []);
      return rows.length ? rows[0] : null;
    }

    return {
      getMemoKey,
      getMemoByStudent,
      getMemoEntryByStudent,
      setMemoByStudent,
      clearMemoByStudent,
      setMemoSyncStateByStudent,
      isRemoteMemoNewerThanLocal,
      isRemoteMemoRevisionNewerThanLocal,
      getSupabaseNoteDraftType,
      getStudentNoteDraftPath,
      loadStudentNoteDraftFromSupabase
    };
  }

  function installObservationMemoStorage(config = {}) {
    const api = createObservationMemoStorage(config);
    Object.assign(global, api);
    global.ObservationMemoStorage = api;
    return api;
  }

  global.createObservationMemoStorage = createObservationMemoStorage;
  global.installObservationMemoStorage = installObservationMemoStorage;
})(window);
