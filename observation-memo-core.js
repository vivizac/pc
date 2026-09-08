/* PC는 공통 관찰노트 기본 컨트롤만 표시합니다. */
(function prepareObservationMemoCasSafety(global) {
  // currentMemoStudent/currentMemoType are global lexical bindings (let), not window properties.
  // Expose controlled accessors so the shared CAS module sees the same live edit session.
  try {
    if (!Object.prototype.hasOwnProperty.call(global, 'currentMemoStudent')) {
      Object.defineProperty(global, 'currentMemoStudent', {
        configurable: true,
        get() { return currentMemoStudent; },
        set(value) { currentMemoStudent = value; }
      });
    }
    if (!Object.prototype.hasOwnProperty.call(global, 'currentMemoType')) {
      Object.defineProperty(global, 'currentMemoType', {
        configurable: true,
        get() { return currentMemoType; },
        set(value) { currentMemoType = value; }
      });
    }
  } catch (error) {
    console.warn('관찰노트 편집 상태 브리지 준비 실패:', error?.message || error);
  }

  if (global.__olliObservationMemoCasLoaderAdded) return;
  global.__olliObservationMemoCasLoaderAdded = true;
  const script = document.createElement('script');
  script.src = 'observation-memo-cas-common.js?v=20260908-cas-2';
  script.async = false;
  document.head.appendChild(script);
})(window);

function forceStudentMemoControlsVisible() {
  return forceObservationMemoControlsVisible();
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
  returnFromObservationMemoScreen(() => loadRecords(''));
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
  if (result?.state === 'conflict') {
    if (options.status) setMemoSaveStatus('다른 기기에서 수정됨');
    return result;
  }
  if (result?.state === 'blocked') {
    if (options.status) setMemoSaveStatus('저장 확인 필요');
    return result;
  }

  if (isStillCurrentMemoStudent() && result?.student) {
    currentMemoStudent = result.student;
    if (result.state === 'cleared') updateMemoStudentMetaDisplay(result.student, '');
  }

  if (options.status) setMemoSaveStatus('');
  if (result?.state === 'cleared') return result;
  if (!options.silent || options.status) showMemoSaveCheck();
  return result;
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
