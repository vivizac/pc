let elementaryInfoDraft = { group: '', personality: '' };
let kinderInfoDraft = { personality: '' };

function openCurrentStudentInfoModal() {
  if (!currentMemoStudent) return;
  if (currentMemoType === 'kinder') openKinderInfoModal();
  else openElementaryInfoModal();
}

function renderElementaryGroupMonthButtons(containerId, group, setterName) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const groupKey = String(group || '').trim();
  if (!groupKey) {
    el.innerHTML = '<div class="infoMonthEmpty">그룹을 먼저 선택해 주세요.</div>';
    return;
  }
  const selected = new Set(getElementaryGroupFeedbackMonths(groupKey));
  el.innerHTML = ELEMENTARY_GROUP_MONTH_VALUES.map(month => `<button type="button" class="infoDayBtn ${selected.has(month) ? 'active' : ''}" onclick="${setterName}(${month})">${month}월</button>`).join('');
}

function syncElementaryInfoButtons() {
  document.querySelectorAll('#elementaryGroupToggleRow .infoToggleBtn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.group === elementaryInfoDraft.group);
  });
  document.querySelectorAll('#elementaryPersonalityToggleRow .infoToggleBtn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.personality === elementaryInfoDraft.personality);
  });
}

function selectElementaryGroup(group) {
  elementaryInfoDraft.group = elementaryInfoDraft.group === group ? '' : group;
  syncElementaryInfoButtons();
}

function toggleElementaryInfoGroupMonth(month) {
  if (!elementaryInfoDraft.group) {
    alert('먼저 그룹을 선택해 주세요.');
    return;
  }
  toggleElementaryGroupFeedbackMonth(elementaryInfoDraft.group, month);
  syncElementaryInfoButtons();
}

function selectElementaryPersonality(personality) {
  elementaryInfoDraft.personality = elementaryInfoDraft.personality === personality ? '' : personality;
  if (window.__olliPersonalityDropdownOpen) window.__olliPersonalityDropdownOpen.elementaryPersonalityToggleRow = false;
  syncElementaryInfoButtons();
  if (typeof window.refreshStudentModalPersonalityDropdowns === 'function') window.refreshStudentModalPersonalityDropdowns();
}

function openElementaryInfoModal() {
  const targetStudent = getStudentInfoModalTarget('elementary');
  if (!targetStudent) return;
  if (typeof window.olliPatchStudentModalMarkup === 'function') window.olliPatchStudentModalMarkup();
  elementaryInfoDraft = {
    group: targetStudent.group || '',
    personality: targetStudent.personality || ''
  };
  document.getElementById('elementaryInfoNameInput').value = targetStudent.name || '';
  setStudentInfoDateInput('elementaryInfoEnrolledAtInput', targetStudent);
  document.getElementById('elementarySchoolInput').value = targetStudent.school || '';
  document.getElementById('elementaryGradeInput').value = formatElementaryGradeInputValue(targetStudent.grade);
  const elementaryAgeInput = document.getElementById('elementaryAgeInput');
  if (elementaryAgeInput) elementaryAgeInput.value = formatElementaryAgeInputValue(getElementaryAgeFromGrade(targetStudent.grade) || targetStudent.age || '');
  syncElementaryInfoButtons();
  if (typeof updateElementaryInfoRiskPanel === 'function') updateElementaryInfoRiskPanel(targetStudent);
  document.getElementById('elementaryInfoModal').style.display = 'flex';
  if (typeof window.olliPrepareInfoExtra === 'function') window.olliPrepareInfoExtra('elementary', targetStudent);
}

function closeElementaryInfoModal() {
  hideModalOnly('elementaryInfoModal');
  studentInfoModalTarget = null;
}

async function saveElementaryInfo() {
  const targetStudent = getStudentInfoModalTarget('elementary');
  if (!targetStudent) return;
  const nextName = document.getElementById('elementaryInfoNameInput').value.trim();
  if (!nextName) {
    alert('학생 이름을 입력해 주세요.');
    return;
  }

  const originalName = String(targetStudent.name || '').trim();
  const duplicated = nextName !== originalName && getStudentsByType('elementary').some(student => String(student.id) !== String(targetStudent.id) && String(student.name || '').trim() === nextName);
  if (duplicated) {
    alert('이미 등록된 학생 이름입니다.');
    return;
  }

  const dateInfo = readStudentInfoDateInput('elementaryInfoEnrolledAtInput', targetStudent);
  if (!dateInfo) return;

  const extraInfo = typeof window.olliGetInfoExtra === 'function' ? window.olliGetInfoExtra('elementary') : {};
  const student = {
    ...targetStudent,
    ...dateInfo,
    name: nextName,
    group: elementaryInfoDraft.group,
    group_months: elementaryGroupMonthsToText(getElementaryGroupFeedbackMonths(elementaryInfoDraft.group, targetStudent)),
    feedback_months: elementaryGroupMonthsToText(getElementaryGroupFeedbackMonths(elementaryInfoDraft.group, targetStudent)),
    personality: elementaryInfoDraft.personality,
    lesson_day: Object.prototype.hasOwnProperty.call(extraInfo, 'lesson_day') ? extraInfo.lesson_day : (targetStudent.lesson_day || ''),
    lesson_time: Object.prototype.hasOwnProperty.call(extraInfo, 'lesson_time') ? normalizeLessonTimeDisplay(extraInfo.lesson_time || extraInfo.class_time || '') : normalizeLessonTimeDisplay(targetStudent.lesson_time || targetStudent.class_time || ''),
    class_time: Object.prototype.hasOwnProperty.call(extraInfo, 'lesson_time') ? normalizeLessonTimeDisplay(extraInfo.lesson_time || extraInfo.class_time || '') : normalizeLessonTimeDisplay(targetStudent.class_time || targetStudent.lesson_time || ''),
    teacher: Object.prototype.hasOwnProperty.call(extraInfo, 'teacher') ? extraInfo.teacher : (targetStudent.teacher || ''),
    homeroom_teacher: Object.prototype.hasOwnProperty.call(extraInfo, 'homeroom_teacher') ? extraInfo.homeroom_teacher : (targetStudent.homeroom_teacher || ''),
    school: document.getElementById('elementarySchoolInput').value.trim(),
    age: getElementaryAgeFromGrade(normalizeElementaryGradeValue(document.getElementById('elementaryGradeInput').value)),
    birth_year: '',
    grade: normalizeElementaryGradeValue(document.getElementById('elementaryGradeInput').value),
    school_entry_year: inferOlliSchoolEntryYearFromGrade(normalizeElementaryGradeValue(document.getElementById('elementaryGradeInput').value)),
    className: ''
  };
  try {
    const savedStudent = await ensureStudentSavedToSupabase(student);
    if (currentMemoStudent && String(currentMemoStudent.id) === String(savedStudent.id)) {
      currentMemoStudent = savedStudent;
      setMemoModePillLabel(savedStudent.name || '학생 이름');
      const memoSubLabel = document.getElementById('memoSubLabel');
      if (memoSubLabel) memoSubLabel.textContent = '학생분석 메모';
    }
    closeElementaryInfoModal();
    await loadRecords('');
  } catch (err) {
    alert(`학생 정보 저장에 실패했어요.\n\n${err.message || err}`);
  }
}

function openKinderInfoModal() {
  const targetStudent = getStudentInfoModalTarget('kinder');
  if (!targetStudent) return;
  if (typeof window.olliPatchStudentModalMarkup === 'function') window.olliPatchStudentModalMarkup();
  kinderInfoDraft = { personality: targetStudent.personality || '' };
  document.getElementById('kinderInfoModal').style.display = 'flex';
  document.getElementById('kinderInfoNameInput').value = targetStudent.name || '';
  setStudentInfoDateInput('kinderInfoEnrolledAtInput', targetStudent);
  document.getElementById('kinderKindergartenInput').value = targetStudent.kindergarten || '';
  document.getElementById('kinderAgeInput').value = targetStudent.age || '';
  const kinderLessonDayInput = document.getElementById('kinderLessonDayInput');
  if (kinderLessonDayInput) kinderLessonDayInput.value = targetStudent.lesson_day || '';
  updateKinderInfoRiskPanel(targetStudent);
  if (typeof window.olliPrepareInfoExtra === 'function') window.olliPrepareInfoExtra('kinder', targetStudent);
}
function closeKinderInfoModal() {
  hideModalOnly('kinderInfoModal');
  studentInfoModalTarget = null;
}
async function saveKinderInfo() {
  const targetStudent = getStudentInfoModalTarget('kinder');
  if (!targetStudent) return;
  const nextName = document.getElementById('kinderInfoNameInput').value.trim();
  if (!nextName) {
    alert('학생 이름을 입력해 주세요.');
    return;
  }

  const originalName = String(targetStudent.name || '').trim();
  const duplicated = nextName !== originalName && getStudentsByType('kinder').some(student => String(student.id) !== String(targetStudent.id) && String(student.name || '').trim() === nextName);
  if (duplicated) {
    alert('이미 등록된 학생 이름입니다.');
    return;
  }

  const dateInfo = readStudentInfoDateInput('kinderInfoEnrolledAtInput', targetStudent);
  if (!dateInfo) return;

  const kindergarten = document.getElementById('kinderKindergartenInput').value.trim();
  const age = document.getElementById('kinderAgeInput').value.trim();
  const lessonDayInput = document.getElementById('kinderLessonDayInput');
  const extraInfo = typeof window.olliGetInfoExtra === 'function' ? window.olliGetInfoExtra('kinder') : {};
  const lesson_day = Object.prototype.hasOwnProperty.call(extraInfo, 'lesson_day') ? extraInfo.lesson_day : (lessonDayInput ? lessonDayInput.value.trim() : (targetStudent.lesson_day || ''));
  const lesson_time = Object.prototype.hasOwnProperty.call(extraInfo, 'lesson_time') ? normalizeLessonTimeDisplay(extraInfo.lesson_time || extraInfo.class_time || '') : normalizeLessonTimeDisplay(targetStudent.lesson_time || targetStudent.class_time || '');
  const student = {
    ...targetStudent,
    ...dateInfo,
    name: nextName,
    kindergarten,
    age,
    birth_year: inferOlliBirthYearFromAge(age),
    lesson_day,
    lesson_time,
    class_time: lesson_time,
    personality: typeof extraInfo.personality === 'string' ? extraInfo.personality : (kinderInfoDraft.personality || ''),
    teacher: Object.prototype.hasOwnProperty.call(extraInfo, 'teacher') ? extraInfo.teacher : (targetStudent.teacher || ''),
    homeroom_teacher: Object.prototype.hasOwnProperty.call(extraInfo, 'homeroom_teacher') ? extraInfo.homeroom_teacher : (targetStudent.homeroom_teacher || '')
  };
  try {
    const savedStudent = await ensureStudentSavedToSupabase(student);
    if (currentMemoStudent && String(currentMemoStudent.id) === String(savedStudent.id)) {
      currentMemoStudent = savedStudent;
      const kinderNameEl = document.getElementById('kinderObservationNoteTitle');
      if (kinderNameEl) kinderNameEl.textContent = `${savedStudent.name || '유치부'}의 노트`;
      setMemoModePillLabel(savedStudent.name || '관찰 메모');
      const memoSubLabel = document.getElementById('memoSubLabel');
      if (memoSubLabel) memoSubLabel.textContent = '관찰노트 메모';
    }
    closeKinderInfoModal();
    await loadRecords('');
  } catch (err) {
    alert(`학생 정보 저장에 실패했어요.\n\n${err.message || err}`);
  }
}


