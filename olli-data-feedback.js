function ensureStudentFromSavedFeedback(studentName, preferredType = 'elementary') {
  const name = String(studentName || '').trim();
  if (!name) return null;
  const type = preferredType === 'kinder' ? 'kinder' : 'elementary';
  const matches = getAllStudents().filter(student =>
    String(student.name || '').trim() === name &&
    (student.type || 'elementary') === type
  );
  return matches.length === 1 ? matches[0] : null;
}

function getPreferredStudentTypeForSave() {
  if (currentMemoStudent?.type === 'kinder' || currentMemoType === 'kinder') return 'kinder';
  return 'elementary';
}

function getStudentNameForAutoFeedbackSave(studentDivision = '') {
  const division = studentDivision === 'kinder' ? 'kinder' : 'elementary';
  if (currentMemoStudent?.name) return currentMemoStudent.name;
  if (division === 'kinder') {
    const kinderName = document.querySelector('.kinderStudentRow.studentRowSelected .studentTextWrap span:first-child, .kinderStudentRow .studentTextWrap span:first-child')?.textContent?.trim() || '';
    if (kinderName) return kinderName;
  }
  const memoName = document.getElementById('memoStudentName')?.textContent?.replace(/\s*노트\s*$/, '').trim() || '';
  if (memoName && !['학생', '학생 이름', '학생 노트'].includes(memoName)) return memoName;
  return '';
}


async function getOrCreateStudentForSupabaseSave(studentName, preferredType = 'elementary', preferredStudentId = '') {
  const name = String(studentName || '').trim();
  if (!name) throw new Error('학생 이름이 없습니다.');

  const type = preferredType === 'kinder' ? 'kinder' : 'elementary';
  const targetId = String(preferredStudentId || '').trim();
  let student = null;

  if (targetId) {
    student = getAllStudents().find(item => String(item.id || '') === targetId) || null;
    if (!student) {
      throw new Error('학생코드와 일치하는 학생 정보를 찾지 못했습니다. 학생 목록을 새로고침한 뒤 다시 시도해 주세요.');
    }
  }

  if (!student && currentMemoStudent && String(currentMemoStudent.id || '').trim() && String(currentMemoStudent.name || '').trim() === name && (currentMemoStudent.type || 'elementary') === type) {
    student = currentMemoStudent;
  }

  if (!student) {
    const matches = getAllStudents().filter(item =>
      String(item.name || '').trim() === name &&
      (item.type || 'elementary') === type
    );
    if (matches.length === 1) {
      student = matches[0];
    } else if (matches.length > 1) {
      throw new Error(`${name} 이름의 학생이 ${matches.length}명 있습니다. 학생코드가 있는 학생 선택 화면에서 다시 저장해 주세요.`);
    }
  }

  if (!student) {
    throw new Error(`${name} 학생의 학생코드를 확인하지 못했습니다. 출석부에서 학생을 선택한 뒤 다시 저장해 주세요.`);
  }
  if (!String(student.id || '').trim()) {
    throw new Error('학생코드가 없는 학생은 피드백을 저장할 수 없습니다. 학생정보를 먼저 확인해 주세요.');
  }

  const savedStudent = await ensureStudentSavedToSupabase({
    ...student,
    id: student.id || uid(),
    name: student.name || name,
    type,
    status: 'active'
  });

  if (currentMemoStudent && currentMemoStudent.id === student.id) {
    currentMemoStudent = { ...currentMemoStudent, ...savedStudent };
  }

  return savedStudent;
}

function closeFeedbackResultCardFromButton(btn) {
  const card = btn?.closest?.('.feedbackResultCard');
  if (card) card.remove();
  closeMemoFeedbackPopup();
}

function bindGeneratedFeedbackSaveButton(card, options = {}) {
  const saveBtn = card?.querySelector?.('[data-feedback-save-button="true"]');
  if (!saveBtn || saveBtn.dataset.bound === '1') return;
  saveBtn.dataset.bound = '1';
  saveBtn.addEventListener('click', function(event) {
    event.preventDefault();
    event.stopPropagation();
    const hostCard = this.closest('.feedbackResultCard, .memoFeedbackPopupCard');
    const feedbackText = hostCard?._feedbackText || '';
    autoSaveGeneratedFeedback(feedbackText, options, this);
  });
}

async function refreshRecordsAfterFeedbackSave() {
  const recordRoomScreen = document.getElementById('recordRoomScreen');
  const recordVisible = recordRoomScreen && recordRoomScreen.style.display !== 'none';
  if (recordVisible && typeof loadRecords === 'function') {
    await loadRecords('');
  }
  
}

function getFeedbackTableNameByType(feedbackType) {
  const type = String(feedbackType || '').toLowerCase();
  if (['fail', 'growth', 'fail_growth', 'failgrowth', 'elementary_fail', 'kinder_fail'].includes(type)) return 'fail_feedbacks';
  return 'feedbacks';
}


function resetGrowthFeedbackAfterSuccessfulSave(studentDivision) {
  try {
    if (studentDivision === 'kinder' && typeof resetKinderChatFeedbackGrowthSheet === 'function') {
      resetKinderChatFeedbackGrowthSheet();
    }
  } catch (err) {
    console.warn('growth feedback reset skipped:', err);
  }
}

async function autoSaveGeneratedFeedback(text, options = {}, btn = null) {
  const content = String(text || '').trim();
  const rawType = options.feedbackType || currentSaveType || 'class';
  const tableName = getFeedbackTableNameByType(rawType);
  const feedbackType = tableName === 'fail_feedbacks' ? 'fail' : String(rawType || 'class').toLowerCase();
  const studentDivision = options.studentDivision === 'kinder' ? 'kinder' : 'elementary';
  const name = (options.studentName || getStudentNameForAutoFeedbackSave(studentDivision)).trim();
  const selectedStudentId = options.studentId || options.student_id || '';

  if (!name) { alert('아이 이름을 찾지 못했어요. 설문지의 아이 이름을 입력해 주세요.'); return; }
  if (!content) { alert('저장할 피드백 내용이 비어 있어요.'); return; }

  const year = new Date().getFullYear();
  const date = new Date().toLocaleDateString('ko-KR');

  try {
    if (btn) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent || '저장';
      btn.textContent = '저장 중...';
    }

    const savedStudent = await getOrCreateStudentForSupabaseSave(name, studentDivision, selectedStudentId);

    const feedbackPayload = addOlliAcademyToPayload({
      student_id: savedStudent.id,
      student_name: savedStudent.name || name,
      content,
      feedback_type: feedbackType,
      year,
      date
    }, tableName === 'fail_feedbacks' ? '실패·성장 피드백 저장' : '피드백 저장');
    const savedRow = await saveFeedbackRowVerified(tableName, feedbackPayload, tableName === 'fail_feedbacks' ? '실패·성장 피드백 저장' : '피드백 저장');

    await refreshRecordsAfterFeedbackSave();
    closeFeedbackResultCardFromButton(btn);
    if (tableName === 'fail_feedbacks' && typeof resetGrowthFeedbackAfterSuccessfulSave === 'function') {
      resetGrowthFeedbackAfterSuccessfulSave(studentDivision);
    }
    return savedRow || true;
  } catch (err) {
    console.error('피드백 저장 오류:', err);
    alert(`저장 중 오류가 발생했어요.\n\n${err.message || '알 수 없는 오류입니다.'}`);
    return false;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || '저장';
      delete btn.dataset.originalText;
    }
  }
}
window.autoSaveGeneratedFeedback = autoSaveGeneratedFeedback;


function addRecordSummaryPopup(text, label = '종합 피드백', options = {}) {
  closeMemoFeedbackPopup();
  const safeText = escapeHtml(text);
  const overlay = document.createElement('div');
  overlay.id = 'memoFeedbackPopupOverlay';
  overlay.className = 'memoFeedbackPopupOverlay recordSummaryPopupOverlay';
  overlay.innerHTML = `<div class="memoFeedbackPopupCard recordSummaryPopupCard">
    <div class="memoFeedbackPopupLabel">${escapeHtml(label)}</div>
    <div class="memoFeedbackPopupText">${safeText}</div>
    <div class="memoFeedbackPopupActions">
      <div class="memoFeedbackLeftActions">
        <button class="memoFeedbackIconBtn" onclick="enterMemoFeedbackEdit(this)" title="수정" aria-label="수정">
          <svg viewBox="0 0 24 24"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>
        </button>
        <button class="memoFeedbackIconBtn memoFeedbackEditSaveBtn" onclick="finishMemoFeedbackEdit(this)" title="수정 저장" aria-label="수정 저장">
          <svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"></path></svg>
        </button>
      </div>
      <div class="memoFeedbackRightActions">
        <button class="memoFeedbackActionBtn" onclick="closeMemoFeedbackPopup()">닫기</button>
        <button class="memoFeedbackActionBtn primary" onclick="saveRecordSummaryFromPopup(this)">저장</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const card = overlay.querySelector('.memoFeedbackPopupCard');
  if (card) {
    card._feedbackText = text;
    card._studentId = options.studentId || options.student_id || '';
    card._studentName = options.studentName || '';
    card._studentDivision = options.studentDivision || 'elementary';
    card._summaryMonths = options.months || '';
  }
}

async function saveRecordSummaryFromPopup(btn) {
  const card = btn?.closest?.('.memoFeedbackPopupCard');
  const content = String(card?._feedbackText || '').trim();
  const studentId = String(card?._studentId || '').trim();
  const studentName = String(card?._studentName || '').trim();
  const studentDivision = card?._studentDivision === 'kinder' ? 'kinder' : 'elementary';
  const months = card?._summaryMonths || '';

  if (!content) { alert('저장할 종합 피드백 내용이 비어 있어요.'); return; }
  if (!studentName) { currentSaveType = 'summary'; openSaveModal(content); return; }

  const year = new Date().getFullYear();
  const date = new Date().toLocaleDateString('ko-KR');

  try {
    if (btn) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent || '저장';
      btn.textContent = '저장 중...';
    }

    const savedStudent = await getOrCreateStudentForSupabaseSave(studentName, studentDivision, studentId);
    const summaryPayload = addOlliAcademyToPayload({
      student_id: savedStudent.id,
      student_name: savedStudent.name || studentName,
      content,
      summary_months: months ? Number(months) : null,
      year,
      date
    }, '종합 피드백 저장');
    await saveFeedbackRowVerified('summary_feedbacks', summaryPayload, '종합 피드백 저장');

    await refreshRecordsAfterFeedbackSave();
    closeMemoFeedbackPopup();
  } catch (err) {
    console.error('종합 피드백 저장 오류:', err);
    alert(`종합 피드백 저장 중 오류가 발생했어요.\n\n${err.message || '알 수 없는 오류입니다.'}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || '저장';
      delete btn.dataset.originalText;
    }
  }
}

window.saveRecordSummaryFromPopup = saveRecordSummaryFromPopup;

