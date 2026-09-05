function parseDateSafe(dateStr) {
  if (!dateStr) return null;
  const cleaned = String(dateStr).replace(/\./g, '-').replace(/\s/g, '');
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}
function getCutoffDate(months) { const d = new Date(); d.setMonth(d.getMonth() - months); return d; }

function purgeOldLocalMemos() {
  const cutoff = Date.now() - (LOCAL_MEMO_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    Object.keys(localStorage).forEach(key => {
      if (!(key.startsWith(ELEMENTARY_MEMO_PREFIX) || key.startsWith(KINDER_MEMO_PREFIX))) return;
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

function getMemoKey(student) {
  if (!student?.id) return '';
  return (student.type === 'kinder' ? KINDER_MEMO_PREFIX : ELEMENTARY_MEMO_PREFIX) + student.id;
}

function getMemoByStudent(student) {
  const key = getMemoKey(student);
  if (!key) return '';
  const raw = localStorage.getItem(key);
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'content' in parsed) {
      return parsed.content || '';
    }
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
  return student?.type === 'kinder' ? 'kinder_risk' : 'elementary_observation';
}

function getStudentNoteDraftPath(student, noteType = '') {
  const academyId = getOlliCurrentAcademyId();
  const studentId = student?.id || '';
  const type = noteType || getSupabaseNoteDraftType(student);
  if (!academyId || !studentId || !type) return '';
  return `student_note_drafts?academy_id=eq.${encodeURIComponent(academyId)}&student_id=eq.${encodeURIComponent(studentId)}&note_type=eq.${encodeURIComponent(type)}`;
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
  if (isOlliPendingCommonSaveResult(result)) {
    return [makeOlliPendingRow(payload, `${stableStudent.id}_${type}`)];
  }
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

function openStudentModal() {
  const targetView = (currentRecordView === 'elementary' || currentRecordView === 'kinder')
    ? currentRecordView
    : ((currentObservationView === 'elementary' || currentObservationView === 'kinder') ? currentObservationView : 'elementary');
  currentRecordView = targetView;
  currentObservationView = targetView;

  if (typeof window.olliPatchStudentModalMarkup === 'function') window.olliPatchStudentModalMarkup();

  document.getElementById('studentModal').style.display = 'flex';
  document.getElementById('studentModalTitle').textContent = targetView === 'elementary' ? '초등 학생 등록' : '유치부 학생 등록';
  const yearInput = document.getElementById('studentYearBadge');
  if (yearInput) {
    const currentYear = String(getCurrentYear());
    yearInput.value = currentYear;
    yearInput.defaultValue = currentYear;
  }

  const nameInput = document.getElementById('studentNameInput');
  const monthInput = document.getElementById('studentMonthInput');
  const dayInput = document.getElementById('studentDayInput');
  const kindergartenInput = document.getElementById('studentKindergartenInput');
  const ageInput = document.getElementById('studentAgeInput');
  const lessonDayInput = document.getElementById('studentLessonDayInput');
  const kinderExtraFields = document.getElementById('kinderExtraFields');

  const todayForStudentModal = new Date();
  nameInput.value = '';
  monthInput.value = String(todayForStudentModal.getMonth() + 1);
  dayInput.value = String(todayForStudentModal.getDate());
  if (kindergartenInput) kindergartenInput.value = '';
  if (ageInput) ageInput.value = '';
  if (lessonDayInput) lessonDayInput.value = '';
  if (kinderExtraFields) kinderExtraFields.style.display = targetView === 'kinder' ? 'block' : 'none';
  if (typeof window.olliPrepareStudentAddExtra === 'function') window.olliPrepareStudentAddExtra(targetView);

  setTimeout(() => nameInput.focus(), 50);
}
function closeStudentModal() {
  hideModalOnly('studentModal');
}
async function confirmStudent() {
  const name = document.getElementById('studentNameInput').value.trim();
  const year = Number(document.getElementById('studentYearBadge')?.value || getCurrentYear());
  const month = Number(document.getElementById('studentMonthInput').value);
  const day = Number(document.getElementById('studentDayInput').value);
  const kindergarten = document.getElementById('studentKindergartenInput')?.value.trim() || '';
  const age = document.getElementById('studentAgeInput')?.value.trim() || '';
  const lessonDayInput = document.getElementById('studentLessonDayInput')?.value.trim() || '';

  if (!name) {
    alert('학생 이름을 입력해 주세요.');
    return;
  }
  if (!year || year < 1900 || year > 2100) {
    alert('등록 연도를 올바르게 입력해 주세요.');
    return;
  }
  if (!month || month < 1 || month > 12) {
    alert('등록 월을 올바르게 입력해 주세요.');
    return;
  }
  if (!day || day < 1 || day > 31) {
    alert('등록 일을 올바르게 입력해 주세요.');
    return;
  }

  const type = currentRecordView === 'kinder' ? 'kinder' : 'elementary';
  const list = getStudentsByType(type);
  const duplicate = list.some(student => student.name === name && String(student.year) === String(year) && String(student.month) === String(month) && String(student.day) === String(day));
  if (duplicate) {
    alert('같은 이름과 등록일의 학생이 이미 등록되어 있습니다.');
    return;
  }

  const extraInfo = typeof window.olliGetStudentAddExtra === 'function' ? window.olliGetStudentAddExtra(type) : {};
  const selectedTeacher = extraInfo.teacher || '';
  const selectedLessonDay = extraInfo.lesson_day || lessonDayInput || '';
  const selectedLessonTime = normalizeLessonTimeDisplay(extraInfo.lesson_time || extraInfo.class_time || '');
  const selectedGroup = type === 'elementary' ? (extraInfo.group || '') : '';
  const selectedGroupMonths = type === 'elementary' ? elementaryGroupMonthsToText(extraInfo.group_months || extraInfo.feedback_months || getElementaryGroupFeedbackMonths(selectedGroup)) : '';

  const newStudent = {
    id: uid(),
    type,
    name,
    year,
    month: String(month),
    day: String(day),
    enrolled_at: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    kindergarten: type === 'kinder' ? kindergarten : '',
    age: type === 'kinder' ? age : (type === 'elementary' ? getElementaryAgeFromGrade(extraInfo.grade || '') : ''),
    birth_year: type === 'kinder' ? inferOlliBirthYearFromAge(age) : '',
    school_entry_year: type === 'elementary' ? inferOlliSchoolEntryYearFromGrade(extraInfo.grade || '') : '',
    previous_division: '',
    division_changed_at: '',
    lesson_day: selectedLessonDay,
    lesson_time: selectedLessonTime,
    class_time: selectedLessonTime,
    teacher: selectedTeacher,
    homeroom_teacher: extraInfo.homeroom_teacher || selectedTeacher,
    group: selectedGroup, group_months: selectedGroupMonths, feedback_months: selectedGroupMonths, personality: extraInfo.personality || '', school: type === 'elementary' ? (extraInfo.school || '') : '', grade: type === 'elementary' ? (extraInfo.grade || '') : '', className: '',
    memoUpdatedAt: '',
    status: 'active'
  };

  try {
    const savedStudent = await ensureStudentSavedToSupabase(newStudent);
    closeStudentModal();
    await loadRecords('');
    showPushToast(`${savedStudent.name} 학생이 저장되었습니다.`);
  } catch (err) {
    alert(`학생 저장에 실패했어요.\n\n${err.message || err}`);
  }
}
