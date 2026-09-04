function openKinderTransferModal() {
  const modal = document.getElementById('kinderTransferModal');
  const list = document.getElementById('kinderTransferList');
  if (!modal || !list) return;
  const candidates = getKinderElementaryTransferCandidates();
  list.innerHTML = candidates.length
    ? candidates.map(student => {
        const meta = [student.kindergarten || '', student.age ? `${student.age}세` : '', getStudentTeacherDisplay(student)].filter(Boolean).join(' / ');
        return `<div class="kinderTransferRow">
          <div><div class="kinderTransferName">${escapeHtml(student.name || '')}</div><div class="kinderTransferMeta">${escapeHtml(meta)}</div></div>
          <button type="button" class="kinderTransferMoveBtn" onclick="transferKinderToElementary('${escapeTemplateLiteral(student.id)}')">초등부로 이동</button>
        </div>`;
      }).join('')
    : '<div class="recordEmpty">현재 이관 대상 학생이 없습니다.</div>';
  modal.style.display = 'flex';
}

function closeKinderTransferModal() {
  hideModalOnly('kinderTransferModal');
}

async function transferKinderToElementary(studentId) {
  const student = findStudentById(studentId);
  if (!student || student.type !== 'kinder') return;
  if (!confirm(`${student.name} 학생을 초등부로 이관할까요?\n\n기존 관찰·피드백 기록은 그대로 유지됩니다.`)) return;

  const now = new Date();
  const moved = {
    ...student,
    type: 'elementary',
    previous_division: 'kinder',
    division_changed_at: now.toISOString(),
    grade: '1',
    school_entry_year: String(getOlliAcademicYear(now)),
    age: getElementaryAgeFromGrade('1'),
    birth_year: '',
    school: '',
    className: '',
    group: '',
    group_months: '',
    feedback_months: ''
  };

  try {
    const savedStudent = await ensureStudentSavedToSupabase(moved);
    closeKinderTransferModal();
    showPushToast(`${savedStudent.name} 학생을 초등부로 이관했어요.`);

    currentRecordView = 'elementary';
    currentObservationView = 'elementary';
    updateRecordHeaderUI();
    await loadRecords('');

    // 이관 직후 초등부에서 새로 필요한 학교/반/그룹 정보를 바로 확인합니다.
    studentInfoModalTarget = savedStudent;
    openElementaryInfoModal();
  } catch (err) {
    alert(`초등부 이관에 실패했어요.\n\n${err?.message || err}`);
  }
}

function openStudentActionMenu(studentId, rowEl) {
  const student = findStudentById(studentId);
  if (!student) return;
  selectedStudentActionId = studentId;
  // 팝업이 뜰 때 학생 버튼이 다시 올라오지 않도록 선택 클래스를 유지하지 않는다.
  clearStudentRowSelection();
  const title = document.getElementById('studentActionTitle');
  if (title) title.textContent = `${student.name} 선택`;
  const overlay = document.getElementById('studentActionOverlay');
  if (overlay) overlay.classList.add('show');
}

function closeStudentActionMenu() {
  selectedStudentActionId = '';
  clearStudentRowSelection();
  const overlay = document.getElementById('studentActionOverlay');
  if (overlay) overlay.classList.remove('show');
}

function openSelectedStudentInfoFromActionMenu() {
  const student = findStudentById(selectedStudentActionId);
  if (!student) return;
  closeStudentActionMenu();
  studentInfoModalTarget = student;
  if (student.type === 'kinder') openKinderInfoModal();
  else openElementaryInfoModal();
}

function enterStudentSelectionMode() {
  if (!selectedStudentActionId) return;
  studentSelectionMode = true;
  selectedStudentIds.clear();
  selectedStudentIds.add(selectedStudentActionId);
  closeStudentActionMenu();
  suppressNextStudentClick = false;
  updateRecordHeaderUI();
  const searchValue = document.getElementById('searchName')?.value.trim() || '';
  loadRecords(searchValue);
}

async function setSelectedStudentStatus(status) {
  if (!selectedStudentActionId) return;
  const targetId = selectedStudentActionId;
  const student = findStudentById(targetId);
  if (!student) return;

  const nextStatus = status === 'active' ? 'active' : status;
  const changedAt = new Date().toISOString();
  const statusDates = nextStatus === 'withdrawn'
    ? { withdrawn_at: changedAt, paused_at: '' }
    : (nextStatus === 'paused'
      ? { paused_at: changedAt, withdrawn_at: '' }
      : { withdrawn_at: '', paused_at: '' });

  const nextStudent = normalizeStudentObject({
    ...student,
    status: nextStatus,
    ...statusDates,
    status_changed_at: changedAt,
    updated_at: changedAt
  }, student.type || 'elementary');

  setPendingStudentStatus(nextStudent);
  await saveStudent(nextStudent, { skipRemote: true });

  if (nextStudent.type === 'elementary' || nextStudent.type === 'kinder') {
    const sectionState = recordStatusSectionOpenState[nextStudent.type];
    if (sectionState && (nextStatus === 'paused' || nextStatus === 'withdrawn')) {
      sectionState[nextStatus] = true;
    }
  }

  if (currentMemoStudent && String(currentMemoStudent.id) === String(nextStudent.id)) {
    currentMemoStudent = nextStudent;
  }

  closeStudentActionMenu();
  const searchValue = document.getElementById('searchName')?.value.trim() || '';

  // 서버를 다시 읽기 전에 로컬 상태를 즉시 반영합니다.
  if (currentRecordView === 'elementary' || currentRecordView === 'kinder') renderCurrentStudentRecords(searchValue);
  else if (currentRecordView === 'academy') renderRecordAcademyManagementDashboard();

  try {
    await updateStudentStatusInSupabase(nextStudent);
  } catch (err) {
    // 실패해도 로컬 상태와 재동기화 대기값은 유지합니다.
    console.warn('student status remote sync pending:', err.message || err);
  }

  await loadRecords(searchValue);
  if (currentRecordView === 'academy') renderRecordAcademyManagementDashboard();
}

async function deleteSelectedStudents() {
  const ids = Array.from(selectedStudentIds);
  if (!ids.length) return;
  const ok = confirm('삭제 시 통계에서 제외됩니다.\n실제 수업한 학생은 퇴원으로 처리해 주세요.');
  if (!ok) return;
  const studentSnapshotMap = new Map(getAllStudents().map(student => [String(student.id || ''), student]));
  const successIds = [];
  const failed = [];
  for (const id of ids) {
    try {
      await deactivateStudentInSupabase(id);
      successIds.push(String(id));
    } catch (err) {
      failed.push({ id: String(id), message: String(err && (err.message || err) || '알 수 없는 오류') });
    }
  }
  if (successIds.length) {
    const successSet = new Set(successIds);
    successIds.forEach(id => backupAndRemoveStudentLocalData(id, studentSnapshotMap.get(String(id)) || null));
    setAllStudents(getAllStudents().filter(item => !successSet.has(String(item.id))));
    successIds.forEach(id => unmarkDeletedStudentId(id));
  }
  if (failed.length) {
    alert(`학생 삭제 서버 저장에 실패했습니다. (${failed.length}명)\n저장 진단의 student_soft_delete 오류를 확인해 주세요.\n${failed[0].message}`);
  }
  studentSelectionMode = false;
  selectedStudentIds.clear();
  updateRecordHeaderUI();
  await loadRecords(document.getElementById('searchName')?.value.trim() || '');
}

async function deactivateStudentInSupabase(studentId) {
  if (!isSupabaseConfigured()) throw new Error('Supabase 설정이 없어 학생 삭제를 서버에 저장할 수 없습니다.');
  const id = String(studentId || '').trim();
  if (!id) throw new Error('학생 삭제 식별값이 없습니다.');
  const academyId = getOlliCurrentAcademyId();
  const deletedAt = new Date().toISOString();
  const deletedBy = String(localStorage.getItem('olli_current_member_id') || localStorage.getItem('olli_current_user_id') || localStorage.getItem('olli_current_member_name') || '').trim();
  try {
    if (typeof saveOlliData === 'function') {
      const result = await saveOlliData('student_soft_delete', {
        academyId,
        studentId: id,
        data: {
          is_deleted: true,
          deleted_at: deletedAt,
          deleted_by: deletedBy || null,
          delete_reason: 'student_deleted'
        },
        forceCommon: true
      });
      if (result && result.serverSaved && result.verified) return result;
      if (result && result.pending) throw new Error('학생 삭제가 서버에 반영되지 않아 재전송 대기열에 남았습니다.');
    }
    throw new Error('student_soft_delete 공통 저장 응답을 확인하지 못했습니다. 직접 Supabase PATCH fallback은 사용하지 않습니다.');
  } catch (err) {
    if (typeof recordOlliStorageIssue === 'function') {
      recordOlliStorageIssue({
        feature: 'student_soft_delete',
        resource: 'students',
        operation: 'soft_delete',
        academy_id: academyId || null,
        student_id: id,
        message: err.message || err
      });
    }
    console.warn('student soft delete failed:', err.message || err);
    throw err;
  }
}

async function deleteStudentById(studentId) {
  const student = findStudentById(studentId);
  if (!student) return;
  try {
    await deactivateStudentInSupabase(studentId);
  } catch (err) {
    alert(`학생 삭제 서버 저장에 실패했습니다.\n명단에서 숨기지 않고 그대로 유지합니다.\n저장 진단의 student_soft_delete 오류를 확인해 주세요.\n${String(err && (err.message || err) || '')}`);
    closeStudentActionMenu();
    return;
  }
  setAllStudents(getAllStudents().filter(item => String(item.id) !== String(studentId)));
  unmarkDeletedStudentId(studentId);
  backupAndRemoveStudentLocalData(studentId, student);
  if (currentMemoStudent && currentMemoStudent.id === studentId) {
    currentMemoStudent = null;
    document.getElementById('studentMemoScreen').style.display = 'none';
    document.getElementById('recordRoomScreen').style.display = 'flex';
  }
  closeStudentActionMenu();
  selectedStudentIds.delete(studentId);
  updateRecordHeaderUI();
  await loadRecords(document.getElementById('searchName')?.value.trim() || '');
}

async function confirmDeleteSelectedStudent() {
  if (!selectedStudentActionId) return;
  const student = findStudentById(selectedStudentActionId);
  if (!student) return;
  const ok = confirm('삭제 시 통계에서 제외됩니다.\n실제 수업한 학생은 퇴원으로 처리해 주세요.');
  if (!ok) return;
  await deleteStudentById(selectedStudentActionId);
}

function isSupabaseConfigured() {
  return /^https?:\/\//.test(String(SUPABASE_URL || '')) && !String(SUPABASE_KEY || '').includes('요기');
}

function getOlliCurrentAcademyId() {
  return localStorage.getItem('olli_current_academy_id') || '';
}

function getOlliCurrentAcademyCode() {
  return localStorage.getItem('olli_current_academy_code') || '';
}

function getOlliCurrentAcademyName() {
  return localStorage.getItem('olli_current_academy_name') || '';
}

function getOlliCurrentAcademyRegion() {
  return localStorage.getItem('olli_current_academy_region') || '';
}

function appendOlliAcademyFilter(path) {
  const academyId = requireOlliAcademyId('학원 데이터 조회');
  return path + (String(path).includes('?') ? '&' : '?') + `academy_id=eq.${encodeURIComponent(academyId)}`;
}

function requireOlliAcademyId(actionLabel = '작업') {
  const academyId = getOlliCurrentAcademyId();
  if (!academyId) {
    throw new Error(`${actionLabel}을 할 수 없습니다. 현재 학원 ID가 없습니다. 다시 로그인해 주세요.`);
  }
  return academyId;
}

function addOlliAcademyToPayload(payload, actionLabel = '저장') {
  const academyId = requireOlliAcademyId(actionLabel);
  return { ...payload, academy_id: academyId };
}

function getOlliScopedAcademyId(actionLabel = '작업') {
  const academyId = (typeof settingsGetAcademyId === 'function' ? settingsGetAcademyId() : '') || getOlliCurrentAcademyId();
  if (!academyId) {
    throw new Error(`${actionLabel}을 할 수 없습니다. 현재 학원 ID가 없습니다. 다시 로그인해 주세요.`);
  }
  return academyId;
}

function buildOlliAcademyMemberPathById(memberId, actionLabel = '선생님 설정') {
  const id = String(memberId || '').trim();
  if (!id) throw new Error(`${actionLabel}을 할 수 없습니다. 선생님 ID가 없습니다.`);
  const academyId = getOlliScopedAcademyId(actionLabel);
  return `academy_members?id=eq.${encodeURIComponent(id)}&academy_id=eq.${encodeURIComponent(academyId)}`;
}

function getOlliSettingsRequestById(requestId) {
  const id = String(requestId || '').trim();
  if (!id) return null;
  return (olliSettingsState?.approvalRequests || []).find(request => String(request?.id || '') === id) || null;
}

async function ensureSettingsRequestBelongsToCurrentAcademy(requestId) {
  const id = String(requestId || '').trim();
  if (!id) throw new Error('승인 요청 ID가 없습니다.');
  const academyId = getOlliScopedAcademyId('선생님 승인 요청 확인');
  const academyCode = (typeof getOlliCurrentAcademyCode === 'function' ? getOlliCurrentAcademyCode() : '') || localStorage.getItem('olli_current_academy_code') || olliSettingsState?.academy?.academy_code || '';
  const cached = getOlliSettingsRequestById(id);

  if (cached) {
    const cachedAcademyId = String(cached.academy_id || '').trim();
    const cachedAcademyCode = String(cached.academy_code || cached.requested_academy_code || '').trim();
    if (cachedAcademyId && cachedAcademyId !== academyId) {
      throw new Error('현재 학원의 승인 요청이 아닙니다. 새로고침 후 다시 확인해 주세요.');
    }
    if (!cachedAcademyId && cachedAcademyCode && academyCode && cachedAcademyCode !== academyCode) {
      throw new Error('현재 학원의 승인 요청이 아닙니다. 새로고침 후 다시 확인해 주세요.');
    }
  }

  if (!isSupabaseConfigured()) return true;

  try {
    const rows = await supabase('GET', `teacher_approval_requests?select=id&academy_id=eq.${encodeURIComponent(academyId)}&id=eq.${encodeURIComponent(id)}&limit=1`);
    if (Array.isArray(rows) && rows.length) return true;
    if (cached && !String(cached.academy_id || '').trim()) return true;
    throw new Error('현재 학원의 승인 요청을 찾지 못했습니다.');
  } catch (err) {
    if (cached) return true;
    throw err;
  }
}


function getEnrolledAtFromStudent(student) {
  if (student?.enrolled_at) return student.enrolled_at;
  const y = Number(student?.year || getCurrentYear());
  const m = Number(student?.month || 0);
  const d = Number(student?.day || 0);
  if (!m || !d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function normalizeStudentDateInputValue(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const testDate = new Date(year, month - 1, day);
  if (testDate.getFullYear() !== year || testDate.getMonth() !== month - 1 || testDate.getDate() !== day) return null;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return { year, month: mm, day: dd, enrolled_at: `${year}-${mm}-${dd}` };
}

function getStudentInfoDateValue(student) {
  const parsed = normalizeStudentDateInputValue(getEnrolledAtFromStudent(student));
  return parsed ? parsed.enrolled_at : '';
}

function getStudentInfoDatePartInputs(inputId) {
  const map = {
    elementaryInfoEnrolledAtInput: ['elementaryInfoYearInput', 'elementaryInfoMonthInput', 'elementaryInfoDayInput'],
    kinderInfoEnrolledAtInput: ['kinderInfoYearInput', 'kinderInfoMonthInput', 'kinderInfoDayInput']
  };
  const ids = map[inputId];
  if (!ids) return null;
  const [yearInput, monthInput, dayInput] = ids.map(id => document.getElementById(id));
  if (!yearInput || !monthInput || !dayInput) return null;
  return { yearInput, monthInput, dayInput };
}

function setStudentInfoDateInput(inputId, student) {
  const parts = getStudentInfoDatePartInputs(inputId);
  const parsed = normalizeStudentDateInputValue(getEnrolledAtFromStudent(student));
  if (parts) {
    parts.yearInput.value = parsed ? String(parsed.year) : '';
    parts.monthInput.value = parsed ? String(Number(parsed.month)) : '';
    parts.dayInput.value = parsed ? String(Number(parsed.day)) : '';
    return;
  }
  const input = document.getElementById(inputId);
  if (!input) return;
  input.value = parsed ? parsed.enrolled_at : '';
}

function readStudentInfoDateInput(inputId, fallbackStudent) {
  const parts = getStudentInfoDatePartInputs(inputId);
  let raw = '';
  if (parts) {
    const year = parts.yearInput.value.trim();
    const month = parts.monthInput.value.trim();
    const day = parts.dayInput.value.trim();
    raw = year && month && day ? `${year}-${month}-${day}` : '';
  } else {
    const input = document.getElementById(inputId);
    raw = input ? input.value : getEnrolledAtFromStudent(fallbackStudent);
  }
  if (!raw) {
    alert('등록 날짜를 입력해 주세요.');
    return null;
  }
  const parsed = normalizeStudentDateInputValue(raw);
  if (!parsed) {
    alert('등록 날짜를 올바르게 입력해 주세요.');
    return null;
  }
  return parsed;
}


function formatTeacherNameWithT(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/\s+/g, ' ');
  return /T$/i.test(normalized) ? normalized : `${normalized}T`;
}

function getStudentTeacherDisplay(student) {
  return formatTeacherNameWithT(student?.teacher || student?.homeroom_teacher || student?.teacher_name || '');
}

function normalizeLessonDayDisplay(value) {
  return String(value || '')
    .trim()
    .replace(/\s*,\s*/g, '·')
    .replace(/\s*·\s*/g, '·')
    .replace(/\s+/g, '');
}


function normalizeLessonTimeDisplay(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const matches = [];
  raw.replace(/(?:오후\s*)?([1-7])\s*(?:시|:00)?/g, (_, hour) => {
    const label = `${Number(hour)}시`;
    if (!matches.includes(label)) matches.push(label);
    return '';
  });
  if (matches.length) return matches.join('·');
  return raw.replace(/\s+/g, '').replace(/,/g, '·').replace(/·+/g, '·').replace(/^·|·$/g, '');
}

function normalizeRecordInfoValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      const joined = value.map(v => String(v || '').trim()).filter(Boolean).join('·');
      if (joined) return joined;
      continue;
    }
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function formatElementaryPersonalityDisplay(student) {
  let raw = normalizeRecordInfoValue(
    student?.personality,
    student?.personalityType,
    student?.personality_type,
    student?.tendency,
    student?.tendencyType,
    student?.tendency_type
  );
  // 성향은 실제 성향 입력값이 있을 때만 표시합니다.
  // 그룹값을 성향으로 대체하면 성향 미선택 학생에게 성향1/성향2처럼 잘못 표시됩니다.
  raw = String(raw || '').trim();
  if (!raw) return '';
  raw = raw.replace(/^성향\s*/g, '').replace(/반$/g, '').trim();
  return raw ? `성향${raw}` : '';
}

function formatElementaryGradeClassDisplay(student) {
  const grade = normalizeRecordInfoValue(student?.grade, student?.school_grade, student?.schoolGrade);
  return grade || '';
}

function formatElementaryLessonDayDisplay(student) {
  const raw = normalizeRecordInfoValue(
    student?.lesson_day,
    student?.lessonDay,
    student?.class_day,
    student?.classDay,
    student?.weekdays,
    student?.days
  );
  return normalizeLessonDayDisplay(raw) || '';
}

function formatElementarySchoolGuideDisplay(student) {
  const raw = normalizeRecordInfoValue(student?.school, student?.school_name, student?.schoolName);
  if (!raw) return '';
  return raw
    .replace(/\s*초등학교\s*$/g, '초')
    .replace(/\s*초등\s*$/g, '초')
    .replace(/\s*초교\s*$/g, '초')
    .trim();
}

function getElementaryMetaText(student) {
  const personality = formatElementaryPersonalityDisplay(student);
  const school = formatElementarySchoolGuideDisplay(student);
  const age = normalizeRecordInfoValue(student?.age) || getElementaryAgeFromGrade(student?.grade);
  const gradeClass = formatElementaryGradeClassDisplay(student);
  const teacherName = getStudentTeacherDisplay(student);
  const lessonDay = formatElementaryLessonDayDisplay(student);
  const lessonTime = normalizeLessonTimeDisplay(student?.lesson_time || student?.class_time || student?.lessonTime || student?.classTime || '');
  const feedbackMonth = getElementaryGroupFeedbackMonthDisplay(student?.group, student);
  return [personality, school, age ? `${age}살` : '', gradeClass ? `${gradeClass}학년` : '', teacherName, lessonDay, lessonTime, feedbackMonth].filter(Boolean).join(' / ');
}

function studentToSupabasePayload(student) {
  const academyId = requireOlliAcademyId('학생 저장');
  const academyName = getOlliCurrentAcademyName();
  const academyRegion = getOlliCurrentAcademyRegion();
  return {
    id: student.id,
    academy_id: academyId,
    academy_name: academyName || null,
    academy_region: academyRegion || null,
    name: student.name,
    division: student.type === 'kinder' ? 'kinder' : 'elementary',
    enrolled_at: getEnrolledAtFromStudent(student),
    kindergarten: student.kindergarten || null,
    age: student.age ? Number(student.age) : null,
    birth_year: student.birth_year ? Number(student.birth_year) : null,
    school_entry_year: student.school_entry_year ? Number(student.school_entry_year) : null,
    previous_division: student.previous_division || null,
    division_changed_at: student.division_changed_at || null,
    lesson_day: student.lesson_day || student.lessonDay || null,
    lesson_time: normalizeLessonTimeDisplay(student.lesson_time || student.lessonTime || student.class_time || student.classTime || '') || null,
    group_no: student.group ? Number(student.group) : null,
    group_months: elementaryGroupMonthsToText(student.group_months || student.feedback_months || getElementaryGroupFeedbackMonths(student.group, student)) || null,
    feedback_months: elementaryGroupMonthsToText(student.feedback_months || student.group_months || getElementaryGroupFeedbackMonths(student.group, student)) || null,
    personality: student.personality || null,
    school: student.school || null,
    grade: student.grade ? Number(student.grade) : null,
    class_no: student.className ? Number(student.className) : null,
    teacher: formatTeacherNameWithT(student.teacher || student.homeroom_teacher || '' ) || null,
    homeroom_teacher: formatTeacherNameWithT(student.homeroom_teacher || student.teacher || '') || null,
    status: student.status || 'active',
    withdrawn_at: student.withdrawn_at || null,
    paused_at: student.paused_at || null,
    status_changed_at: student.status_changed_at || null,
  };
}

function supabaseRowToStudent(row) {
  const enrolled = row.enrolled_at ? String(row.enrolled_at).split('-') : [];
  return normalizeStudentObject({
    id: row.id,
    academy_id: row.academy_id || getOlliCurrentAcademyId(),
    academy_name: row.academy_name || getOlliCurrentAcademyName(),
    academy_region: row.academy_region || getOlliCurrentAcademyRegion(),
    type: row.division || row.type || 'elementary',
    name: row.name,
    year: enrolled[0] || getCurrentYear(),
    month: enrolled[1] || '',
    day: enrolled[2] || '',
    enrolled_at: row.enrolled_at || '',
    kindergarten: row.kindergarten || '',
    age: row.age || '',
    birth_year: row.birth_year || '',
    school_entry_year: row.school_entry_year || '',
    previous_division: row.previous_division || '',
    division_changed_at: row.division_changed_at || '',
    lesson_day: row.lesson_day || row.lessonDay || row.class_day || '',
    lesson_time: row.lesson_time || row.lessonTime || row.class_time || row.classTime || '',
    class_time: row.class_time || row.classTime || row.lesson_time || row.lessonTime || '',
    group: row.group_no || '',
    group_months: row.group_months || row.feedback_months || '',
    feedback_months: row.feedback_months || row.group_months || '',
    personality: row.personality || '',
    school: row.school || '',
    grade: row.grade || '',
    className: row.class_no || row.className || '',
    teacher: row.teacher || row.homeroom_teacher || row.teacher_name || '',
    homeroom_teacher: row.homeroom_teacher || row.teacher || row.teacher_name || '',
    status: row.status || 'active',
    is_deleted: row.is_deleted === true || String(row.is_deleted || '').toLowerCase() === 'true',
    deleted_at: row.deleted_at || '',
    deleted_by: row.deleted_by || '',
    delete_reason: row.delete_reason || '',
    withdrawn_at: row.withdrawn_at || row.withdrawal_at || row.quit_at || '',
    paused_at: row.paused_at || row.pause_at || '',
    status_changed_at: row.status_changed_at || '',
    updated_at: row.updated_at || ''
  }, row.division || 'elementary');
}

function getSupabaseMissingColumnName(err) {
  const message = String(err?.message || err || '');
  const match = message.match(/Could not find the ['\"]([^'\"]+)['\"] column/i);
  return match ? match[1] : '';
}

const STUDENT_LEGACY_OPTIONAL_COLUMNS = new Set([
  'academy_name', 'academy_region', 'group_months', 'feedback_months',
  'homeroom_teacher'
]);

async function postStudentWithColumnFallback(student) {
  const payload = studentToSupabasePayload(student);
  const academyId = String(payload.academy_id || '').trim();
  const studentId = String(payload.id || '').trim();
  if (!academyId || !studentId) throw new Error('학생 저장 식별값이 없습니다.');
  if (typeof saveOlliData !== 'function') {
    const error = new Error('학생정보 공통 저장 함수가 준비되지 않았습니다.');
    recordOlliStorageIssue({ feature: 'student_profile', resource: 'students', operation: 'upsert', student_id: studentId, message: error.message });
    throw error;
  }

  const result = await saveOlliData('student_profile', {
    academyId,
    studentId,
    forceCommon: true,
    data: payload,
    serverOptions: { operation: 'upsert' }
  });

  if (isOlliPendingCommonSaveResult(result)) {
    return [makeOlliPendingRow(payload, studentId)];
  }
  if (!result || !result.serverSaved || !result.verified) {
    const error = result && result.error
      ? result.error
      : new Error(`학생정보 서버 저장이 완료되지 않았습니다.${result && result.pending ? ' 재전송 대기열에 기록되었습니다.' : ''}`);
    recordOlliStorageIssue({
      feature: 'student_profile', resource: 'students', operation: 'upsert',
      student_id: studentId, message: String(error && (error.message || error) || '')
    });
    throw error;
  }

  const row = result.serverRow || (Array.isArray(result.serverRows) ? result.serverRows[0] : result.serverRows) || null;
  if (!row || typeof row !== 'object') {
    const error = new Error('학생정보 서버 저장 행을 확인하지 못했습니다.');
    recordOlliStorageIssue({ feature: 'student_profile', resource: 'students', operation: 'verify', student_id: studentId, message: error.message });
    throw error;
  }
  return [row];
}

async function saveStudentToSupabase(student) {
  if (!isSupabaseConfigured()) return null;
  try {
    const academyId = requireOlliAcademyId('학생 저장');
    const rows = await postStudentWithColumnFallback(student);
    return requireSupabaseWriteRow(rows, '학생정보 저장', {
      id: student?.id || '', academy_id: academyId
    });
  } catch (err) {
    recordOlliStorageIssue({ feature: '학생정보', resource: 'students', operation: 'upsert', student_id: student?.id || '', message: err.message || err });
    console.warn('students table sync skipped:', err.message || err);
    return null;
  }
}


const PENDING_STUDENT_STATUS_KEY = 'olli_pending_student_status_v1';

function getPendingStudentStatusStorageKey() {
  const academyId = getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : '';
  return academyId ? `${PENDING_STUDENT_STATUS_KEY}_${academyId}` : PENDING_STUDENT_STATUS_KEY;
}

function getPendingStudentStatusMap() {
  try {
    const raw = localStorage.getItem(getPendingStudentStatusStorageKey());
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function setPendingStudentStatus(student) {
  if (!student?.id) return;
  const map = getPendingStudentStatusMap();
  map[String(student.id)] = {
    status: getStudentStatus(student),
    withdrawn_at: student.withdrawn_at || '',
    paused_at: student.paused_at || '',
    status_changed_at: student.status_changed_at || new Date().toISOString()
  };
  localStorage.setItem(getPendingStudentStatusStorageKey(), JSON.stringify(map));
}

function clearPendingStudentStatus(studentId) {
  const map = getPendingStudentStatusMap();
  delete map[String(studentId || '')];
  localStorage.setItem(getPendingStudentStatusStorageKey(), JSON.stringify(map));
}

async function patchStudentStatusReturning(path, payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${getOlliAuthAccessToken ? (getOlliAuthAccessToken() || SUPABASE_KEY) : SUPABASE_KEY}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const detail =
      (data && typeof data === 'object' && (data.message || data.details || data.hint || data.code))
        ? [data.message, data.details, data.hint, data.code].filter(Boolean).join(' / ')
        : (typeof data === 'string' ? data : '');
    throw new Error(`Supabase 요청 실패 (${res.status})${detail ? '\n' + detail : ''}`);
  }
  return Array.isArray(data) ? data : [];
}

async function updateStudentStatusInSupabase(student) {
  if (!isSupabaseConfigured()) return false;
  const academyId = requireOlliAcademyId('학생 상태 저장');
  const studentId = String(student?.id || '').trim();
  if (!studentId) throw new Error('학생 ID가 없습니다.');
  if (typeof saveOlliData !== 'function') {
    const error = new Error('학생 상태 공통 저장 함수가 준비되지 않았습니다.');
    recordOlliStorageIssue({ feature: 'student_status', resource: 'students', operation: 'patch', student_id: studentId, message: error.message });
    throw error;
  }

  const payload = {
    academy_id: academyId,
    status: getStudentStatus(student),
    withdrawn_at: student.withdrawn_at || null,
    paused_at: student.paused_at || null,
    status_changed_at: student.status_changed_at || new Date().toISOString()
  };

  const result = await saveOlliData('student_status', {
    academyId,
    studentId,
    forceCommon: true,
    data: payload,
    serverOptions: { operation: 'patch' }
  });

  if (isOlliPendingCommonSaveResult(result)) {
    setPendingStudentStatus({ ...student, ...payload, id: studentId });
    return true;
  }
  if (!result || !result.serverSaved || !result.verified) {
    const error = result && result.error
      ? result.error
      : new Error(`학생 상태 서버 저장이 완료되지 않았습니다.${result && result.pending ? ' 재전송 대기열에 기록되었습니다.' : ''}`);
    recordOlliStorageIssue({
      feature: 'student_status', resource: 'students', operation: 'patch',
      student_id: studentId, message: String(error && (error.message || error) || '')
    });
    throw error;
  }

  const row = result.serverRow || (Array.isArray(result.serverRows) ? result.serverRows[0] : result.serverRows) || null;
  if (!row || String(row.id || '') !== studentId || getStudentStatus(row) !== payload.status) {
    const error = new Error('학생 상태 서버 검증에 실패했습니다.');
    recordOlliStorageIssue({ feature: 'student_status', resource: 'students', operation: 'verify', student_id: studentId, message: error.message });
    throw error;
  }
  clearPendingStudentStatus(studentId);
  return true;
}

async function flushPendingStudentStatuses() {
  if (!isSupabaseConfigured()) return;
  const pending = getPendingStudentStatusMap();
  const students = getAllStudents();
  for (const [studentId, state] of Object.entries(pending)) {
    const student = students.find(item => String(item.id) === String(studentId));
    if (!student) continue;
    try {
      await updateStudentStatusInSupabase({ ...student, ...state });
    } catch (err) {
      console.warn('학생 상태 재동기화 대기:', err.message || err);
    }
  }
}

function mergeStudentInfoPreservingLocal(localStudent, remoteStudent) {
  const local = normalizeStudentObject(localStudent || {}, localStudent?.type || remoteStudent?.type || 'elementary');
  const remote = remoteStudent ? normalizeStudentObject(remoteStudent, remoteStudent?.type || local.type || 'elementary') : {};
  const merged = normalizeStudentObject({
    ...local,
    ...remote,
    id: remote.id || local.id,
    academy_id: remote.academy_id || local.academy_id || (getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : ''),
    type: remote.type || local.type,
    name: remote.name || local.name,
    year: remote.year || local.year,
    month: remote.month || local.month,
    day: remote.day || local.day,
    enrolled_at: remote.enrolled_at || local.enrolled_at,
    kindergarten: remote.kindergarten || local.kindergarten,
    age: remote.age || local.age,
    birth_year: remote.birth_year || local.birth_year,
    school_entry_year: remote.school_entry_year || local.school_entry_year,
    previous_division: remote.previous_division || local.previous_division,
    division_changed_at: remote.division_changed_at || local.division_changed_at,
    lesson_day: remote.lesson_day ?? local.lesson_day ?? remote.lessonDay ?? local.lessonDay ?? '',
    lesson_time: remote.lesson_time ?? local.lesson_time ?? remote.lessonTime ?? local.lessonTime ?? remote.class_time ?? local.class_time ?? '',
    class_time: remote.class_time ?? local.class_time ?? remote.lesson_time ?? local.lesson_time ?? '',
    teacher: remote.teacher ?? local.teacher ?? remote.homeroom_teacher ?? local.homeroom_teacher ?? '',
    homeroom_teacher: remote.homeroom_teacher ?? local.homeroom_teacher ?? remote.teacher ?? local.teacher ?? '',
    group: remote.group || local.group,
    group_months: remote.group_months || local.group_months || remote.feedback_months || local.feedback_months,
    feedback_months: remote.feedback_months || local.feedback_months || remote.group_months || local.group_months,
    personality: remote.personality || local.personality,
    school: remote.school || local.school,
    grade: remote.grade || local.grade,
    className: remote.className || local.className,
    memoUpdatedAt: remote.memoUpdatedAt || local.memoUpdatedAt,
    status: local.status || remote.status || 'active',
    withdrawn_at: remote.withdrawn_at || local.withdrawn_at || '',
    paused_at: remote.paused_at || local.paused_at || '',
    status_changed_at: remote.status_changed_at || local.status_changed_at || '',
    updated_at: remote.updated_at || local.updated_at || ''
  }, remote.type || local.type || 'elementary');
  return merged;
}

async function ensureStudentSavedToSupabase(student) {
  if (!student?.name) throw new Error('학생 이름이 없습니다.');
  const academyId = requireOlliAcademyId('학생 저장');
  const safeStudent = normalizeStudentObject({
    ...student,
    id: student.id || uid(),
    academy_id: student.academy_id || academyId
  }, student.type || 'elementary');

  const rows = await postStudentWithColumnFallback(safeStudent);
  const savedRow = Array.isArray(rows) && rows.length ? rows[0] : null;
  const remoteStudent = savedRow ? supabaseRowToStudent(savedRow) : null;
  const savedStudent = mergeStudentInfoPreservingLocal(safeStudent, remoteStudent);
  savedStudent.id = savedStudent.id || safeStudent.id;
  savedStudent.academy_id = academyId;
  await saveStudent(savedStudent, { skipRemote: true });
  return savedStudent;
}

async function loadStudentsFromSupabase() {
  if (!isSupabaseConfigured()) return { changed: false, skipped: true };
  const academyId = getOlliCurrentAcademyId();
  if (!academyId) return { changed: false, skipped: true };
  const beforeSnapshot = JSON.stringify(getAllStudents());
  const academyContext = window.OlliStorageCore?.AcademyContext;
  const requestToken = academyContext?.captureToken ? academyContext.captureToken() : null;
  const requestIsCurrent = () => academyContext?.isTokenCurrent
    ? academyContext.isTokenCurrent(requestToken)
    : getOlliCurrentAcademyId() === academyId;
  try {
    await flushPendingStudentStatuses();
    if (!requestIsCurrent()) return { changed: false, stale: true };
    const rows = await supabase('GET', `students?select=*&academy_id=eq.${encodeURIComponent(academyId)}&order=name.asc`);
    const pendingStatusMap = getPendingStudentStatusMap();
    const localById = new Map(getAllStudents().map(s => [String(s.id || ''), s]));
    const byId = new Map();
    if (Array.isArray(rows) && rows.length) {
      rows
        .filter(row => !isOlliSoftDeletedRow(row))
        .map(supabaseRowToStudent)
        .filter(remote => remote.id && !isOlliSoftDeletedRow(remote) && getStudentStatus(remote) !== 'inactive')
        .forEach(remote => {
          unmarkDeletedStudentId(remote.id);
          const old = localById.get(String(remote.id || '')) || {};
          const merged = mergeStudentInfoPreservingLocal({ ...old, academy_id: academyId }, { ...remote, academy_id: academyId });
          // 서버 저장이 잠시 실패한 학생 상태는 로컬 재동기화 대기값을 우선합니다.
          const pendingState = pendingStatusMap[String(remote.id || '')] || null;
          if (pendingState) {
            // 이 기기에서 아직 서버 저장이 확인되지 않은 변경만 로컬 값을 우선합니다.
            merged.status = pendingState.status || remote.status || 'active';
            merged.withdrawn_at = pendingState.withdrawn_at || '';
            merged.paused_at = pendingState.paused_at || '';
            merged.status_changed_at = pendingState.status_changed_at || '';
          } else {
            // 동기화 대기값이 없으면 서버를 최종 기준으로 사용합니다.
            // 다른 기기의 오래된 휴원 상태와 날짜가 남아 퇴원 상태를 덮지 않게 합니다.
            merged.status = remote.status || 'active';
            merged.withdrawn_at = remote.withdrawn_at || '';
            merged.paused_at = remote.paused_at || '';
            merged.status_changed_at = remote.status_changed_at || remote.updated_at || '';
          }
          merged.academy_id = academyId;
          byId.set(String(merged.id || remote.id), merged);
        });
    }
    // 상태 저장이 아직 서버에서 확인되지 않은 학생은 로컬 목록에서 지우지 않습니다.
    // 학생 ID가 서버와 정확히 일치해 동기화가 완료되면 pending 값은 자동으로 제거됩니다.
    Object.keys(pendingStatusMap).forEach(studentId => {
      if (byId.has(String(studentId))) return;
      const local = localById.get(String(studentId));
      const pendingState = pendingStatusMap[String(studentId)];
      if (!local || !pendingState) return;
      const preserved = normalizeStudentObject({
        ...local,
        ...pendingState,
        academy_id: academyId
      }, local.type || 'elementary');
      byId.set(String(studentId), preserved);
    });

    if (!requestIsCurrent()) return { changed: false, stale: true };
    const nextStudents = Array.from(byId.values()).filter(s => s.academy_id === academyId).sort((a,b) => a.name.localeCompare(b.name, 'ko'));
    if (JSON.stringify(nextStudents) !== JSON.stringify(getAllStudents())) setAllStudents(nextStudents);
    await syncOlliStudentLifecycleAfterLoad();
    return { changed: beforeSnapshot !== JSON.stringify(getAllStudents()) };
  } catch (err) {
    if (!requestIsCurrent()) return { changed: false, stale: true };
    console.warn('students table load skipped:', err.message || err);
    return { changed: false, error: err };
  }
}


let olliStudentSyncInFlight = false;
let olliStudentSyncTimer = null;

function isOlliRecordRoomVisible() {
  const screen = document.getElementById('recordRoomScreen');
  if (!screen) return false;
  const style = window.getComputedStyle ? window.getComputedStyle(screen) : null;
  return screen.style.display !== 'none' && (!style || style.display !== 'none');
}

async function syncVisibleStudentListSilently() {
  if (olliStudentSyncInFlight || document.hidden || !isOlliRecordRoomVisible()) return;
  if (!['elementary', 'kinder', 'academy'].includes(currentRecordView)) return;
  olliStudentSyncInFlight = true;
  try {
    const result = await loadStudentsFromSupabase();
    if (result && result.changed === false) return;
    const searchValue = document.getElementById('searchName')?.value.trim() || '';
    if (currentRecordView === 'elementary' || currentRecordView === 'kinder') renderCurrentStudentRecords(searchValue);
    else if (currentRecordView === 'academy') renderRecordAcademyManagementDashboard();
    } catch (err) {
    console.warn('학생 목록 백그라운드 동기화 보류:', err?.message || err);
  } finally {
    olliStudentSyncInFlight = false;
  }
}

function startOlliStudentBackgroundSync() {
  if (olliStudentSyncTimer) return;
  olliStudentSyncTimer = window.setInterval(syncVisibleStudentListSilently, 30000);
}

window.addEventListener('focus', () => {
  setTimeout(syncVisibleStudentListSilently, 0);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) setTimeout(syncVisibleStudentListSilently, 0);
});

