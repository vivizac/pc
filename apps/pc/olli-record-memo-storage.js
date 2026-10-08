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

/* PC observation memo storage adapter.
   PC keeps elementary observation + kinder risk draft behavior. */
installObservationMemoStorage({
  getMemoKey(student, noteType = '') {
    if (!student?.id) return '';
    if (String(noteType || '') === 'elementary_observation') return ELEMENTARY_MEMO_PREFIX + student.id;
    return (student.type === 'kinder' ? KINDER_MEMO_PREFIX : ELEMENTARY_MEMO_PREFIX) + student.id;
  },
  getDraftType(student) {
    return student?.type === 'kinder' ? 'kinder_risk' : 'elementary_observation';
  }
});

function openStudentModal() {
  window.__olliPendingTrialRegistration = null;
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
  if (typeof window.pcSyncStudentAddDivisionTabs === 'function') {
    setTimeout(() => window.pcSyncStudentAddDivisionTabs(targetView), 0);
  }
  if (typeof window.olliTuneStudentModalGuideText === 'function') {
    setTimeout(window.olliTuneStudentModalGuideText, 0);
  }

  setTimeout(() => nameInput.focus(), 50);
}

function olliTrialFeedbackPreviewActive(context) {
  const modal = document.getElementById('studentModal');
  return window.__olliPendingTrialRegistration === context
    && !!modal && modal.style.display !== 'none';
}

async function olliTrialFeedbackLoadPreview(context) {
  const section = document.getElementById('olliTrialFeedbackPreview');
  const status = section?.querySelector('[data-trial-preview-status]');
  const list = section?.querySelector('[data-trial-preview-list]');
  const skip = section?.querySelector('[data-trial-preview-skip]');
  if (!status || !list || !skip) return;
  context.previewStatus = 'loading';
  skip.hidden = true;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (!olliTrialFeedbackPreviewActive(context)) return;
    status.textContent = attempt === 1
      ? '체험 피드백을 불러오는 중입니다. (1/3)'
      : '체험 피드백 불러오기에 실패했어요. 다시 시도합니다. (' + attempt + '/3)';
    try {
      if (typeof window.OlliTimetableService?.previewTrialFeedback !== 'function') {
        throw new Error('체험 피드백 조회 모듈이 없습니다.');
      }
      const result = await window.OlliTimetableService.previewTrialFeedback(context.trialSessionId);
      if (!Array.isArray(result?.feedbacks)) throw new Error('피드백 조회 응답이 올바르지 않습니다.');
      if (!olliTrialFeedbackPreviewActive(context)) return;
      context.feedbacks = result.feedbacks;
      context.previewStatus = 'ready';
      list.textContent = '';
      context.feedbacks.forEach((feedback) => {
        const entry = document.createElement('div');
        entry.className = 'olliTrialFeedbackRecord';
        entry.textContent = String(feedback?.content || '');
        list.appendChild(entry);
      });
      list.hidden = !context.feedbacks.length;
      status.textContent = context.feedbacks.length
        ? '체험 피드백 ' + context.feedbacks.length + '건을 불러왔어요. 학생 추가 시 해당 학생의 피드백으로 연결됩니다.'
        : '저장된 체험 피드백이 없어요. 학생 추가를 계속 진행할 수 있습니다.';
      return;
    } catch (_) {
      if (!olliTrialFeedbackPreviewActive(context)) return;
      if (attempt === 3) {
        context.previewStatus = 'failed';
        status.textContent = '체험 피드백 불러오기를 3번 시도했지만 실패했어요. 다음에 다시 시도해 주세요. 피드백 없이 등록하려면 아래의 ‘피드백 없이 계속 진행’을 눌러 주세요. 기존 체험 피드백은 그대로 보존됩니다.';
        skip.hidden = false;
        return;
      }
      status.textContent = '체험 피드백 불러오기 실패 (' + attempt + '/3). 다시 시도합니다.';
      await new Promise(resolve => setTimeout(resolve, 450));
    }
  }
}

function olliBeginTrialRegistration(details) {
  const row = document.querySelector('#studentModal .studentPopupNameTeacherRow');
  if (!row || !details?.trialSessionId) return false;
  document.getElementById('olliTrialFeedbackPreview')?.remove();
  const context = {
    trialSessionId: String(details.trialSessionId),
    name: String(details.name || '').trim(),
    division: String(details.division || ''),
    previewStatus: 'loading',
    feedbacks: []
  };
  window.__olliPendingTrialRegistration = context;
  const section = document.createElement('section');
  section.id = 'olliTrialFeedbackPreview';
  section.innerHTML = '<div class="olliTrialFeedbackTitle">체험수업 피드백</div>'
    + '<div class="olliTrialFeedbackStatus" role="status" aria-live="polite" data-trial-preview-status></div>'
    + '<div class="olliTrialFeedbackList" data-trial-preview-list hidden></div>'
    + '<button type="button" class="olliTrialFeedbackSkip" data-trial-preview-skip hidden>피드백 없이 계속 진행</button>';
  row.insertAdjacentElement('afterend', section);
  section.querySelector('[data-trial-preview-skip]').addEventListener('click', () => {
    if (!olliTrialFeedbackPreviewActive(context) || context.previewStatus !== 'failed') return;
    context.previewStatus = 'skipped';
    section.querySelector('[data-trial-preview-skip]').hidden = true;
    section.querySelector('[data-trial-preview-status]').textContent =
      '피드백 없이 학생 추가를 진행합니다. 체험 피드백 원본은 보존되며, 나중에 별도 연결이 필요합니다.';
  });
  void olliTrialFeedbackLoadPreview(context);
  return true;
}
window.olliBeginTrialRegistration = olliBeginTrialRegistration;

function closeStudentModal() {
  window.__olliPendingTrialRegistration = null;
  document.getElementById('olliTrialFeedbackPreview')?.remove();
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

  const trialRegistration = window.__olliPendingTrialRegistration;
  if (trialRegistration && trialRegistration.previewStatus === 'loading') {
    alert('체험 피드백을 불러오는 중이에요. 잠시 기다려 주세요.');
    return;
  }
  if (trialRegistration && trialRegistration.previewStatus === 'failed') {
    alert('체험 피드백 불러오기가 3번 실패했어요. 나중에 다시 시도하거나 ‘피드백 없이 계속 진행’을 선택해 주세요.');
    return;
  }
  if (trialRegistration && (trialRegistration.name !== name || trialRegistration.division !== type)) {
    alert('체험수업과 동일한 학생 이름과 학부로 등록해 주세요.'); return;
  }

  let registrationRouting = null;
  if (typeof window.olliPrepareStudentRegistrationRouting === 'function') {
    try {
      registrationRouting = await window.olliPrepareStudentRegistrationRouting(type);
    } catch (error) {
      alert(error?.message || error || '선택한 수업 클래스를 확인하지 못했습니다.');
      return;
    }
  }

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
    if (trialRegistration && trialRegistration.previewStatus === 'ready') {
      try {
        if (!window.OlliTimetableService?.linkTrialFeedback) throw new Error('체험 피드백 연결 모듈을 찾지 못했습니다.');
        await window.OlliTimetableService.linkTrialFeedback(trialRegistration.trialSessionId, savedStudent.id);
      } catch (error) {
        alert('학생 등록은 완료되었지만 체험 피드백 연결에 실패했습니다. 체험 피드백 원본은 보존됩니다.\\n\\n' + (error?.message || error));
      }
    } else if (trialRegistration?.previewStatus === 'skipped') {
      showPushToast('체험 피드백 없이 학생을 추가했습니다. 체험 피드백 원본은 그대로 보존됩니다.');
    }
    closeStudentModal();
    await loadRecords('');
    showPushToast(`${savedStudent.name} 학생이 저장되었습니다.`);

    // PC 클래스 라우팅이 활성화되어 있으면 그 경로가 시간표의 단일 원본입니다.
    // 그렇지 않은 화면에서는 기존 요일/시간 기반 저장을 하위 호환 경로로 유지합니다.
    if (registrationRouting?.handled === true && typeof window.olliCommitStudentRegistrationRouting === 'function') {
      try {
        await window.olliCommitStudentRegistrationRouting(savedStudent, registrationRouting);
      } catch (error) {
        alert(`학생은 등록되었지만 수업 클래스 저장에 실패했어요.\n\n${error.message || error}\n\n시간표에서 해당 학생의 수업을 확인해 주세요.`);
      }
    } else if (typeof window.saveOlliStudentScheduleFromInfo === 'function') {
      try {
        const schedulePairs = typeof window.olliGetStudentAddSchedulePairs === 'function'
          ? window.olliGetStudentAddSchedulePairs()
          : null;
        await window.saveOlliStudentScheduleFromInfo(
          savedStudent.id,
          selectedLessonDay,
          selectedLessonTime,
          Array.isArray(schedulePairs) ? { pairs: schedulePairs } : undefined
        );
        if (typeof window.loadStudentsFromSupabase === 'function') {
          await window.loadStudentsFromSupabase({ skipLifecycleSync: true });
        }
        if (window.OlliPcAttendance && typeof window.OlliPcAttendance.renderList === 'function') {
          window.OlliPcAttendance.renderList();
        }
        if (typeof window.olliTtRefreshSchedule === 'function') {
          await window.olliTtRefreshSchedule();
        }
      } catch (error) {
        alert(`학생은 등록되었지만 시간표 반영에 실패했어요.\n\n${error.message || error}\n\n학생정보에서 다시 저장하거나 시간표에서 확인해 주세요.`);
      }
    }
  } catch (err) {
    alert(`학생 저장에 실패했어요.\n\n${err.message || err}`);
  } finally {
    if (registrationRouting?.handled === true && typeof window.olliReleaseStudentRegistrationRouting === 'function') {
      window.olliReleaseStudentRegistrationRouting();
    }
  }
}
