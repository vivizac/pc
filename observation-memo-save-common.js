/* PC/Phone common observation memo draft save execution.
   Platform-specific guards/UI feedback stay outside this file. */
(function initObservationMemoSaveCommon(global) {
  'use strict';

  async function persistObservationMemoDraft(student, content, options = {}) {
    if (!student) {
      return { state: 'skipped', student: null, error: null };
    }

    const noteType = options.noteType || getSupabaseNoteDraftType(student);
    const text = String(content || '');

    if (!text.trim()) {
      clearMemoByStudent(student);
      const clearedStudent = { ...student, memoUpdatedAt: '' };

      try {
        await clearStudentNoteDraftFromSupabase(clearedStudent, noteType);
      } catch (err) {
        console.warn('빈 관찰노트 초안 삭제 실패:', err.message || err);
      }

      await saveStudent(clearedStudent, { skipRemote: true });
      return { state: 'cleared', student: clearedStudent, error: null };
    }

    const updatedAt = options.updatedAt || new Date().toISOString();
    const studentToSave = { ...student, memoUpdatedAt: updatedAt };
    setMemoByStudent(studentToSave, text, { syncStatus: 'pending' });

    try {
      const savedStudent = await ensureStudentSavedToSupabase(studentToSave);
      const stableStudent = {
        ...studentToSave,
        id: savedStudent.id,
        academy_id: savedStudent.academy_id || studentToSave.academy_id
      };
      const draftRows = await saveStudentNoteDraftToSupabase(stableStudent, text, noteType);
      const finalStudent = Array.isArray(draftRows) && draftRows.length
        ? {
            ...stableStudent,
            id: draftRows[0].student_id || stableStudent.id,
            academy_id: draftRows[0].academy_id || stableStudent.academy_id
          }
        : stableStudent;

      await saveStudent(finalStudent, { skipRemote: true });
      const syncedAt = new Date().toISOString();
      setMemoByStudent(finalStudent, text, {
        updatedAt,
        lastSyncedAt: syncedAt,
        syncStatus: 'synced'
      });

      return { state: 'synced', student: finalStudent, error: null, syncedAt };
    } catch (err) {
      setMemoSyncStateByStudent(studentToSave, { syncStatus: 'pending' });
      return { state: 'pending', student: studentToSave, error: err };
    }
  }

  global.persistObservationMemoDraft = persistObservationMemoDraft;
})(window);
