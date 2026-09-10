/* PC는 공통 관찰노트 기본 컨트롤만 표시합니다. */
(function prepareObservationMemoRequestSafety(global) {
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

  function loadObservationMemoVersionHistory() {
    if (global.__olliObservationMemoVersionHistoryLoaderAdded) return;
    global.__olliObservationMemoVersionHistoryLoaderAdded = true;
    const historyScript = document.createElement('script');
    historyScript.src = 'observation-memo-version-history-common.js?v=20260908-history-1';
    historyScript.async = false;
    historyScript.onerror = () => {
      global.__olliObservationMemoVersionHistoryLoaderAdded = false;
      console.warn('관찰노트 이전 기록 모듈을 불러오지 못했습니다.');
    };
    document.head.appendChild(historyScript);
  }

  if (global.__olliObservationMemoRequestGuardLoaderAdded) {
    loadObservationMemoVersionHistory();
    return;
  }
  global.__olliObservationMemoRequestGuardLoaderAdded = true;
  const script = document.createElement('script');
  script.src = 'observation-memo-request-guard-common.js?v=20260908-order-1';
  script.async = false;
  script.onload = loadObservationMemoVersionHistory;
  script.onerror = () => {
    global.__olliObservationMemoRequestGuardLoaderAdded = false;
    console.warn('관찰노트 요청 순서 보호 모듈을 불러오지 못했습니다.');
  };
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
  if (typeof refreshObservationMemoVersionHistoryButton === 'function') {
    requestAnimationFrame(refreshObservationMemoVersionHistoryButton);
  }
}

function closeMemoPage() {
  prepareObservationMemoPageClose();
  if (typeof closeObservationMemoVersionHistory === 'function') closeObservationMemoVersionHistory();
  returnFromObservationMemoScreen(() => loadRecords(''));
}

async function saveCurrentMemo(options = {}) {
  if (!currentMemoStudent) return;
  if (currentMemoType === 'kinder') {
    if (typeof saveKinderChatFeedbackDraft === 'function') saveKinderChatFeedbackDraft();
    return;
  }

  // Navigation, focus changes and merely opening a student are not edits.
  // Some legacy callers still invoke saveCurrentMemo during student switching, so
  // enforce the read-only guard here as the final write boundary on PC. A genuine
  // text edit marks the current observation session dirty before reaching this path.
  if (
    options.force !== true &&
    typeof hasObservationMemoDirtyChanges === 'function' &&
    !hasObservationMemoDirtyChanges()
  ) {
    const entry = typeof getMemoEntryByStudent === 'function'
      ? (getMemoEntryByStudent(currentMemoStudent) || {})
      : {};
    return {
      state: 'unchanged',
      student: currentMemoStudent,
      error: null,
      revision: Number(entry.revision || 0),
      syncedAt: entry.lastSyncedAt || entry.updatedAt || ''
    };
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

  if (result?.superseded === true || result?.state === 'superseded') {
    return result;
  }
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
  if (text) setMemoByStudent(currentMemoStudent, text);
  showMemoSaveCheck();
  await requestSceneCardFeedbackFromElementary(currentMemoStudent.name, text, analysisPromptText);
}

/* Feedback completion is a semantic clear, not a historical reversion. The shared
   guard confirms the server clear before removing the local memo. */
import('./observation-memo-feedback-clear-common.js?v=20260910-feedback-clear-1')
  .catch(error => console.warn('관찰노트 피드백 초기화 보호 모듈 로드 실패:', error?.message || error));
