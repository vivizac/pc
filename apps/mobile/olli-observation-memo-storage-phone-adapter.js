/* Phone observation memo storage adapter.
   Draft policy + archived observation server storage live here.
   Local archive/read-only analysis UI extensions stay in elementary-analysis-phone-adapter.js. */

function purgeOldLocalMemos() {
  const cutoff = Date.now() - (LOCAL_MEMO_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    Object.keys(localStorage).forEach(key => {
      if (!key.startsWith(ELEMENTARY_MEMO_PREFIX)) return;
      try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : null;
        const updatedAt = parsed?.updatedAt ? new Date(parsed.updatedAt).getTime() : Date.now();
        const hasContent = String(parsed?.content || raw || '').trim().length > 0;
        if (!hasContent && updatedAt < cutoff) localStorage.removeItem(key);
      } catch {}
    });
  } catch (err) {
    console.warn('local memo purge skipped:', err);
  }
}

async function saveStudentNoteArchiveToSupabase(student, record, feedbackId = '') {
  if (!isSupabaseConfigured() || !student?.id || !record?.content) return null;
  const academyId = requireOlliAcademyId('노트기록 저장');
  const savedStudent = await ensureStudentSavedToSupabase(student);
  const localRecordId = String(record.id || `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const payload = {
    academy_id: academyId,
    student_id: savedStudent.id,
    student_name: savedStudent.name || student.name || '',
    note_type: 'elementary_observation',
    content: String(record.content || ''),
    analysis: record.analysis || null,
    record_label: record.label || '',
    local_record_id: localRecordId,
    feedback_id: feedbackId || null,
    year: record.year || null,
    month: record.month || null,
    day: record.day || null,
    created_at: record.createdAt || new Date().toISOString()
  };

  if (typeof saveOlliData !== 'function') {
    const error = new Error('관찰노트 기록 보관 공통 저장 함수가 준비되지 않았습니다.');
    recordOlliStorageIssue({ feature: 'student_note_archive', resource: 'student_note_archives', operation: 'save', student_id: savedStudent.id, message: error.message });
    throw error;
  }

  const result = await saveOlliData('student_note_archive', {
    academyId,
    studentId: savedStudent.id,
    localRecordId,
    data: payload,
    forceCommon: true
  });
  if (result && result.serverSaved && result.verified) {
    if (Array.isArray(result.serverRows) && result.serverRows.length) return result.serverRows;
    if (result.serverRow) return [result.serverRow];
    return [payload];
  }
  if (isOlliPendingCommonSaveResult(result)) {
    return [makeOlliPendingRow(payload, localRecordId)];
  }
  const error = new Error('관찰노트 기록 서버 저장을 확인하지 못했습니다.');
  recordOlliStorageIssue({ feature: 'student_note_archive', resource: 'student_note_archives', operation: 'save', student_id: savedStudent.id, message: result?.error?.message || result?.errorCode || error.message });
  throw error;
}

installObservationMemoStorage({
  getMemoKey(student, noteType = '') {
    if (!student?.id) return '';
    if (String(noteType || '') === 'elementary_observation') return ELEMENTARY_MEMO_PREFIX + student.id;
    if (student.type === 'kinder') return '';
    return ELEMENTARY_MEMO_PREFIX + student.id;
  },
  getDraftType(student) {
    return student?.type === 'kinder' ? '' : 'elementary_observation';
  }
});
