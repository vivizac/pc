/* PC/Phone common observation memo helpers. Notification behavior intentionally excluded. */

function autoResizeTextarea(el) {
  if (!el) return;
  const minHeight = Number(el.dataset.minHeight || 140);
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, minHeight) + 'px';
}

function isObservationMemoAutoSaveBlocked() {
  return typeof window.shouldBlockObservationMemoAutoSave === 'function'
    ? !!window.shouldBlockObservationMemoAutoSave()
    : false;
}

function scheduleMemoAutoSave() {
  if (!currentMemoStudent) return;
  if (isObservationMemoAutoSaveBlocked()) return;

  setMemoSaveStatus('작성 중...');
  if (window.__olliObservationMemoAutoSaveTimer) {
    clearTimeout(window.__olliObservationMemoAutoSaveTimer);
  }

  window.__olliObservationMemoAutoSaveTimer = setTimeout(() => {
    window.__olliObservationMemoAutoSaveTimer = null;
    saveCurrentMemo({ silent: true, status: true });
  }, MEMO_AUTOSAVE_DELAY);
}

function getMemoInputTypeFromTarget(target) {
  if (!target || !target.id) return '';
  return target.id === 'memoEditor' ? 'elementary' : '';
}

function handleMemoPauseAutoSaveInput(target) {
  const inputType = getMemoInputTypeFromTarget(target);
  if (!inputType || !currentMemoStudent || currentMemoType !== inputType) return;
  if (isObservationMemoAutoSaveBlocked()) return;
  scheduleMemoAutoSave();
}

function flushMemoAutoSave() {
  if (!currentMemoStudent) return;
  if (window.__olliObservationMemoAutoSaveTimer) {
    clearTimeout(window.__olliObservationMemoAutoSaveTimer);
    window.__olliObservationMemoAutoSaveTimer = null;
    saveCurrentMemo({ silent: true, status: true });
  }
}

function prepareObservationMemoPageClose() {
  flushMemoAutoSave();
  saveCurrentMemo({ silent: true });
}

function returnFromObservationMemoScreen(onReturned) {
  const current = vivizacGetVisibleNotePage();
  if (current && current.id === 'studentMemoScreen') {
    vivizacSlideOutPageToRecord(current, () => {
      if (typeof onReturned === 'function') onReturned();
    });
    return true;
  }

  const studentMemoScreen = document.getElementById('studentMemoScreen');
  if (studentMemoScreen) studentMemoScreen.style.display = 'none';
  const recordRoom = document.getElementById('recordRoomScreen');
  if (recordRoom) recordRoom.style.display = 'flex';
  if (typeof onReturned === 'function') onReturned();
  return false;
}

function handleMemoPauseAutoSaveBlur(target) {
  const inputType = getMemoInputTypeFromTarget(target);
  if (!inputType || currentMemoType !== inputType) return;
  flushMemoAutoSave();
}

function setupMemoPauseAutoSaveBindings() {
  if (window.__memoPauseAutoSaveDelegated === true) return;
  window.__memoPauseAutoSaveDelegated = true;

  document.addEventListener('input', event => {
    handleMemoPauseAutoSaveInput(event.target);
  });

  document.addEventListener('blur', event => {
    handleMemoPauseAutoSaveBlur(event.target);
  }, true);
}

function bindPauseAutoSaveForMemoInput(el, options = {}) {
  // 기존 개별 바인딩 방식은 초기화 중 오류가 나면 누락될 수 있어,
  // 실제 자동저장은 setupMemoPauseAutoSaveBindings()의 이벤트 위임으로 처리합니다.
  setupMemoPauseAutoSaveBindings();
}

function applyReconciledObservationMemoDraft(student, memoEditor, result) {
  if (!student || !memoEditor || !result || !result.adoptedRemote || !result.content) {
    return { applied: false, reason: 'no-remote-update' };
  }

  const isSameMemoPage =
    currentMemoStudent &&
    String(currentMemoStudent.id || '') === String(student.id || '') &&
    currentMemoType === 'elementary';

  if (!isSameMemoPage) {
    return { applied: false, reason: 'stale-session' };
  }

  const currentEditorText = memoEditor.value || '';
  if (currentEditorText.trim().length > 0) {
    return { applied: false, reason: 'visible-local-content' };
  }

  memoEditor.value = result.content;
  if (typeof updateMemoStudentMetaDisplay === 'function') {
    updateMemoStudentMetaDisplay(student, result.updatedAt || '');
  }

  return { applied: true, reason: 'remote-applied' };
}

function openObservationMemoScreenShell(session) {
  if (!session || session.type !== 'elementary') return false;

  const recordRoomScreen = document.getElementById('recordRoomScreen');
  const studentMemoScreenEl = document.getElementById('studentMemoScreen');
  if (recordRoomScreen) recordRoomScreen.style.display = 'none';

  if (studentMemoScreenEl) {
    studentMemoScreenEl.classList.remove('vivizac-slide-page', 'vivizac-slide-in', 'vivizac-slide-out');
    studentMemoScreenEl.style.animation = '';
    studentMemoScreenEl.style.transform = '';
    studentMemoScreenEl.style.display = 'flex';
    studentMemoScreenEl.setAttribute('data-current-memo-type', 'elementary');
  }

  return !!studentMemoScreenEl;
}

function renderObservationMemoScreenChrome(session) {
  if (!session || session.type !== 'elementary' || !session.student) return false;
  const student = session.student;

  if (typeof forceStudentMemoControlsVisible === 'function') {
    forceStudentMemoControlsVisible();
    requestAnimationFrame(forceStudentMemoControlsVisible);
    setTimeout(forceStudentMemoControlsVisible, 120);
  }

  if (typeof setMemoModePillLabel === 'function') {
    setMemoModePillLabel(student.name || '학생 이름');
  }
  if (typeof updateMemoStudentMetaDisplay === 'function') {
    updateMemoStudentMetaDisplay(student);
  }

  const memoNameBtn = document.getElementById('memoStudentNameBtn');
  if (memoNameBtn) {
    if (typeof toggleMemoModeMenu === 'function') memoNameBtn.onclick = toggleMemoModeMenu;
    memoNameBtn.title = '메모 유형 선택';
    memoNameBtn.setAttribute('aria-label', '메모 유형 선택');
  }

  const feedbackBtn = document.getElementById('memoFeedbackBtn');
  const analysisBtn = document.getElementById('memoBottomAnalysisBtn') || document.getElementById('memoAnalysisBtn');
  const elementaryWrap = document.getElementById('elementaryMemoWrap');

  if (feedbackBtn) {
    feedbackBtn.style.display = 'inline-flex';
    feedbackBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="M5 12l7-7 7 7\"></path></svg>피드백 생성';
  }
  if (analysisBtn) analysisBtn.style.display = 'inline-flex';
  if (elementaryWrap) elementaryWrap.style.display = 'block';

  if (typeof forceStudentMemoControlsVisible === 'function') {
    forceStudentMemoControlsVisible();
  }
  return true;
}

function renderObservationMemoInitialView(session) {
  const view = typeof prepareObservationMemoInitialView === 'function'
    ? prepareObservationMemoInitialView(session)
    : null;
  if (!view) return null;

  const memoEditor = document.getElementById('memoEditor');
  if (memoEditor) {
    memoEditor.readOnly = false;
    memoEditor.value = view.memoText || '';

    reconcileObservationMemoDraft(view.student, view.noteType)
      .then(result => {
        applyReconciledObservationMemoDraft(view.student, memoEditor, result);
      })
      .catch(err => {
        console.warn('student_note_drafts 불러오기 실패:', err.message || err);
      });
  }

  renderElementaryAnalysisSummaryCard(view.analysis.data || {}, {
    title: '분석 결과',
    createdAt: view.analysis.createdAt || ''
  });
  renderElementaryAnalysisHistoryCards(view.student);
  setMemoSaveStatus('자동 저장');

  return view;
}

function setMemoSaveStatus(text) {
  const el = document.getElementById('memoSaveStatus');
  if (!el) return;
  // 로컬 저장/서버 동기화 상태는 사용자 화면에 노출하지 않고 내부에서만 관리한다.
  el.textContent = '';
}

function showMemoSaveCheck() {
  setMemoSaveStatus('');
}

function handleMemoHeaderAction() {
  requestElementaryFeedback();
}

function showPushToast(message) {
  let toast = document.getElementById('pushToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'pushToast';
    toast.className = 'pushToast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(window.__pushToastTimer);
  window.__pushToastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
}

function openMoreMenuPlaceholder() {
  showPushToast('준비 중입니다.');
}
