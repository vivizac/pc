/* v-fix: 선생님/관리자 계정에서도 초등부 관찰노트 상단·하단 버튼 강제 복구 */
function forceStudentMemoControlsVisible() {
  const screen = document.getElementById('studentMemoScreen');
  if (!screen) return;
  const screenVisible = screen.style.display !== 'none';
  if (!screenVisible) return;

  const showInlineFlex = [
    '#memoRecordRoomBtn',
    '#memoStudentListBtn',
    '#memoBottomAnalysisBtn',
    '#memoFeedbackBtn'
  ];
  const showFlex = [
    '#studentMemoScreen .memoBottomBar'
  ];
  const showBlock = [
    '#memoStudentSelectWrap'
  ];

  showInlineFlex.forEach(selector => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.hidden = false;
    el.removeAttribute('hidden');
    el.removeAttribute('aria-hidden');
    el.style.visibility = 'visible';
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
    el.style.display = 'inline-flex';
  });

  showFlex.forEach(selector => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.hidden = false;
    el.removeAttribute('hidden');
    el.removeAttribute('aria-hidden');
    el.style.visibility = 'visible';
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
    el.style.display = 'flex';
  });

  showBlock.forEach(selector => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.hidden = false;
    el.removeAttribute('hidden');
    el.removeAttribute('aria-hidden');
    el.style.visibility = 'visible';
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
    el.style.display = '';
  });
}

function openStudentMemoPageById(studentId) {
  const session = beginObservationMemoSession(studentId);
  if (!session) return;
  const { student } = session;
  if (session.type === 'kinder') {
    if (typeof openKinderChatFeedbackPage === 'function') openKinderChatFeedbackPage();
    return;
  }
  closeMemoModeMenu();
  closeMemoStudentSelectPopup();

  openObservationMemoScreenShell(session);

  renderObservationMemoScreenChrome(session);
  renderObservationMemoInitialView(session);
}



function closeMemoPage() {
  prepareObservationMemoPageClose();

  const current = vivizacGetVisibleNotePage();
  if (current && current.id === 'studentMemoScreen') {
    vivizacSlideOutPageToRecord(current, () => {
      loadRecords('');
    });
    return;
  }

  const studentMemoScreen = document.getElementById('studentMemoScreen');
if (studentMemoScreen) studentMemoScreen.style.display = 'none';
document.getElementById('recordRoomScreen').style.display = 'flex';
  loadRecords('');
}





async function saveCurrentMemo(options = {}) {
  if (!currentMemoStudent) return;
  if (currentMemoType === 'kinder') {
    if (typeof saveKinderChatFeedbackDraft === 'function') saveKinderChatFeedbackDraft();
    return;
  }

  const savingStudent = { ...currentMemoStudent };
  const savingType = currentMemoType;
  const isStillCurrentMemoStudent = () =>
    currentMemoStudent &&
    String(currentMemoStudent.id || '') === String(savingStudent.id || '') &&
    currentMemoType === savingType;

  const memoText = document.getElementById('memoEditor')?.value || '';
  const result = await persistObservationMemoDraft(savingStudent, memoText, {
    noteType: 'elementary_observation'
  });

  if (result?.state === 'pending' && result.error) {
    console.warn('초등부 관찰노트 Supabase 저장 실패:', result.error.message || result.error);
  }

  if (isStillCurrentMemoStudent() && result?.student) {
    currentMemoStudent = result.student;
    if (result.state === 'cleared') updateMemoStudentMetaDisplay(result.student, '');
  }

  if (options.status) setMemoSaveStatus('');
  if (result?.state === 'cleared') return;
  if (!options.silent || options.status) showMemoSaveCheck();
}





















async function showBrowserNotification(message) {
  if (!('Notification' in window)) return false;

  try {
    if (Notification.permission === 'granted') {
      new Notification('올리', { body: message, tag: 'olli-notification' });
      return true;
    }

    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        new Notification('올리', { body: message, tag: 'olli-notification' });
        return true;
      }
    }
  } catch (err) {
    console.warn('browser notification failed:', err);
  }

  return false;
}


window.addEventListener('focus', () => {
});
setTimeout(() => {
}, 700);

async function requestElementaryFeedback() {
  if (!currentMemoStudent || currentMemoType !== 'elementary') return;

  const text = document.getElementById('memoEditor').value.trim();
  const analysisData = getElementaryAnalysisByStudent(currentMemoStudent);
  const hasAnalysisContent = (typeof elementaryAnalysisHasContent === 'function') ? elementaryAnalysisHasContent(analysisData) : false;
  const analysisPromptText = hasAnalysisContent ? buildElementaryAnalysisMemoText(analysisData, { forPrompt: true }) : '';

  if (!text && !hasAnalysisContent) {
    alert('수업 내용이 부족합니다.');
    return;
  }

  if (text) {
    setMemoByStudent(currentMemoStudent, text);
  }

  showMemoSaveCheck();

  await requestSceneCardFeedbackFromElementary(currentMemoStudent.name, text, analysisPromptText);
}
