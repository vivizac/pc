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

    async function clearStudentNoteDraftFromSupabase(student, noteType = '') {
      if (!isSupabaseConfigured() || !student?.id) return;
      const academyId = requireOlliAcademyId('노트 삭제');
      const type = noteType || getSupabaseNoteDraftType(student);
      if (!type) return;

      const payload = {
        academy_id: academyId,
        student_id: student.id,
        student_name: student.name || '',
        note_type: type,
        content: '',
        updated_at: new Date().toISOString()
      };

      if (typeof saveOlliData !== 'function') {
        const error = new Error('관찰노트 초안 삭제 공통 저장 함수가 준비되지 않았습니다.');
        recordOlliStorageIssue({ feature: 'student_note_draft', resource: 'student_note_drafts', operation: 'clear', student_id: student.id, message: error.message });
        throw error;
      }

      const result = await saveOlliData('student_note_draft', {
        academyId,
        studentId: student.id,
        noteType: type,
        data: payload,
        forceCommon: true
      });

      if (result && result.serverSaved && result.verified) return result;
      if (isOlliPendingCommonSaveResult(result)) return result;
      const error = new Error('관찰노트 초안 삭제 상태를 서버에 확인하지 못했습니다.');
      recordOlliStorageIssue({ feature: 'student_note_draft', resource: 'student_note_drafts', operation: 'clear', student_id: student.id, message: result?.error?.message || result?.errorCode || error.message });
      throw error;
    }

    async function saveStudentNoteDraftToSupabase(student, content, noteType = '') {
      if (!isSupabaseConfigured()) return null;
      const academyId = requireOlliAcademyId('노트 저장');
      const type = noteType || getSupabaseNoteDraftType(student);
      const text = String(content || '');
      if (!student?.name && !student?.id) throw new Error('노트 저장에 필요한 학생 정보가 없습니다.');
      if (!type) return null;

      const savedStudent = await ensureStudentSavedToSupabase(student);
      const stableStudent = {
        ...student,
        ...savedStudent,
        id: savedStudent.id,
        name: savedStudent.name || student.name || '',
        academy_id: savedStudent.academy_id || academyId
      };

      if (!text.trim()) {
        await clearStudentNoteDraftFromSupabase(stableStudent, type);
        return null;
      }

      const payload = {
        academy_id: academyId,
        student_id: stableStudent.id,
        student_name: stableStudent.name || '',
        note_type: type,
        content: text,
        updated_at: new Date().toISOString()
      };

      if (typeof saveOlliData !== 'function') {
        const error = new Error('관찰노트 초안 공통 저장 함수가 준비되지 않았습니다.');
        recordOlliStorageIssue({ feature: 'student_note_draft', resource: 'student_note_drafts', operation: 'save', student_id: stableStudent.id, message: error.message });
        throw error;
      }

      const result = await saveOlliData('student_note_draft', {
        academyId,
        studentId: stableStudent.id,
        noteType: type,
        data: payload,
        forceCommon: true
      });
      if (result && result.serverSaved && result.verified) {
        if (Array.isArray(result.serverRows) && result.serverRows.length) return result.serverRows;
        if (result.serverRow) return [result.serverRow];
        return [payload];
      }
      if (isOlliPendingCommonSaveResult(result)) return [makeOlliPendingRow(payload, `${stableStudent.id}_${type}`)];
      const error = new Error('관찰노트 초안 서버 저장을 확인하지 못했습니다.');
      recordOlliStorageIssue({ feature: 'student_note_draft', resource: 'student_note_drafts', operation: 'save', student_id: stableStudent.id, message: result?.error?.message || result?.errorCode || error.message });
      throw error;
    }

    async function loadStudentNoteDraftFromSupabase(student, noteType = '') {
      if (!isSupabaseConfigured() || !student?.id) return null;
      const path = getStudentNoteDraftPath(student, noteType);
      if (!path) return null;
      const rows = await supabase('GET', `${path}&select=*&limit=1`);
      return Array.isArray(rows) && rows.length ? rows[0] : null;
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
      saveStudentNoteDraftToSupabase,
      loadStudentNoteDraftFromSupabase,
      clearStudentNoteDraftFromSupabase
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
