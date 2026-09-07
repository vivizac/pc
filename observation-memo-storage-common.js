/* PC/Phone common observation memo draft storage core.
   Platform-specific archive/read-only/UI behavior intentionally excluded. */
(function initObservationMemoStorageCommon(global) {
  'use strict';

  function createObservationMemoStorage(config = {}) {
    const resolveMemoKey = typeof config.getMemoKey === 'function' ? config.getMemoKey : (() => '');
    const resolveDraftType = typeof config.getDraftType === 'function' ? config.getDraftType : (() => '');

    function getMemoKey(student) {
      return String(resolveMemoKey(student) || '');
    }

    function getMemoByStudent(student) {
      const key = getMemoKey(student);
      if (!key) return '';
      const raw = localStorage.getItem(key);
      if (!raw) return '';
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && 'content' in parsed) return parsed.content || '';
      } catch {}
      return raw;
    }

    function getMemoEntryByStudent(student) {
      const key = getMemoKey(student);
      if (!key) return { content: '', updatedAt: '', lastSyncedAt: '', syncStatus: 'unknown' };
      const raw = localStorage.getItem(key);
      if (!raw) return { content: '', updatedAt: '', lastSyncedAt: '', syncStatus: 'empty' };
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return {
            content: parsed.content || '',
            updatedAt: parsed.updatedAt || '',
            lastSyncedAt: parsed.lastSyncedAt || '',
            syncStatus: parsed.syncStatus || 'local'
          };
        }
      } catch {}
      return { content: raw || '', updatedAt: '', lastSyncedAt: '', syncStatus: 'local' };
    }

    function setMemoByStudent(student, content, options = {}) {
      const key = getMemoKey(student);
      if (!key) return;
      const previous = getMemoEntryByStudent(student);
      const updatedAt = options.updatedAt || new Date().toISOString();
      localStorage.setItem(key, JSON.stringify({
        content: content || '',
        updatedAt,
        lastSyncedAt: options.lastSyncedAt || previous.lastSyncedAt || '',
        syncStatus: options.syncStatus || previous.syncStatus || 'local'
      }));
    }

    function clearMemoByStudent(student) {
      const key = getMemoKey(student);
      if (!key) return;
      localStorage.removeItem(key);
    }

    function setMemoSyncStateByStudent(student, syncState = {}) {
      const entry = getMemoEntryByStudent(student);
      setMemoByStudent(student, entry.content || '', {
        updatedAt: entry.updatedAt || new Date().toISOString(),
        lastSyncedAt: syncState.lastSyncedAt || entry.lastSyncedAt || '',
        syncStatus: syncState.syncStatus || entry.syncStatus || 'local'
      });
    }

    function isRemoteMemoNewerThanLocal(remoteUpdatedAt, localUpdatedAt) {
      if (!remoteUpdatedAt) return false;
      if (!localUpdatedAt) return true;
      const remoteTime = new Date(remoteUpdatedAt).getTime();
      const localTime = new Date(localUpdatedAt).getTime();
      if (Number.isNaN(remoteTime) || Number.isNaN(localTime)) return false;
      return remoteTime > localTime;
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
