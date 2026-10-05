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

  loadObservationMemoVersionHistory();
})(window);

(function bindObservationMemoPcRefreshLifecycle(global) {
  if (global.__olliObservationMemoPcRefreshLifecycleBound) return;
  global.__olliObservationMemoPcRefreshLifecycleBound = true;

  function requestRefresh() {
    if (typeof global.requestObservationMemoCrossDeviceRefresh === 'function') {
      global.requestObservationMemoCrossDeviceRefresh();
    }
  }

  global.addEventListener('focus', requestRefresh);
  global.addEventListener('online', requestRefresh);
  global.addEventListener('olli:realtime-change', event => {
    if (event?.detail?.domain !== 'observation') return;
    requestRefresh();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) requestRefresh();
  });
  document.addEventListener('focusin', event => {
    if (event.target?.id !== 'memoEditor') return;
    if (typeof global.hasObservationMemoDirtyChanges === 'function' && global.hasObservationMemoDirtyChanges()) return;
    requestRefresh();
  });
})(window);

(function bindObservationMemoPcAutosaveLifecycle(global) {
  if (global.__olliObservationMemoPcAutosaveLifecycleBound) return;
  global.__olliObservationMemoPcAutosaveLifecycleBound = true;

  document.addEventListener('input', event => {
    if (event.target?.id !== 'memoEditor' || event.isComposing) return;
    if (typeof global.handleMemoPauseAutoSaveInput === 'function') {
      global.handleMemoPauseAutoSaveInput(event.target);
    }
  });

  document.addEventListener('compositionend', event => {
    if (event.target?.id !== 'memoEditor') return;
    if (typeof global.handleMemoPauseAutoSaveInput === 'function') {
      global.handleMemoPauseAutoSaveInput(event.target);
    }
  }, true);

  document.addEventListener('blur', event => {
    if (event.target?.id !== 'memoEditor') return;
    if (typeof global.handleMemoPauseAutoSaveBlur === 'function') {
      global.handleMemoPauseAutoSaveBlur(event.target);
    }
  }, true);
})(window);

function autoResizeTextarea(el) {
  if (!el) return;
  const minHeight = Number(el.dataset.minHeight || 140);
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, minHeight) + 'px';
}

function markObservationMemoEditorClean() {
  const core = window.ObservationMemoEditStateCore;
  if (!core || typeof core.markClean !== 'function') return false;
  const memoEditor = document.getElementById('memoEditor');
  return core.markClean({
    studentId: currentMemoStudent?.id || '',
    currentType: currentMemoType,
    text: memoEditor?.value || ''
  });
}

async function saveObservationMemoServerSnapshot(options = {}) {
  if (!currentMemoStudent || !['elementary', 'kinder'].includes(currentMemoType)) return null;
  const editor = document.getElementById('memoEditor');
  if (!editor) return null;

  // A read-only visit must never become a write. Only an actual input event marks
  // the edit session dirty. Blur, Done and page close are flush triggers, not save
  // triggers by themselves.
  if (options.force !== true && !hasObservationMemoDirtyChanges()) {
    return getObservationMemoUnchangedResult();
  }

  if (window.__olliObservationMemoServerSavePromise) {
    return window.__olliObservationMemoServerSavePromise;
  }

  const studentId = String(currentMemoStudent.id || '');
  const textAtStart = String(editor.value || '');
  let savePromise;
  savePromise = (async () => {
    try {
      const result = await saveCurrentMemo({
        silent: true,
        status: options.status === true
      });
      const stillSameDraft =
        currentMemoStudent &&
        String(currentMemoStudent.id || '') === studentId &&
        String(document.getElementById('memoEditor')?.value || '') === textAtStart;
      if (
        stillSameDraft &&
        result &&
        (result.state === 'synced' || result.state === 'cleared' || result.state === 'unchanged') &&
        result.superseded !== true
      ) {
        markObservationMemoEditorClean();
      }
      return result;
    } catch (error) {
      console.warn('관찰노트 서버 자동저장 실패:', error?.message || error);
      return null;
    } finally {
      if (window.__olliObservationMemoServerSavePromise === savePromise) {
        window.__olliObservationMemoServerSavePromise = null;
      }
    }
  })();

  window.__olliObservationMemoServerSavePromise = savePromise;
  return savePromise;
}

function applyReconciledObservationMemoDraft(student, memoEditor, result) {
  if (!student || !memoEditor || !result) {
    return { applied: false, reason: 'no-remote-update' };
  }

  const isSameMemoPage =
    currentMemoStudent &&
    String(currentMemoStudent.id || '') === String(student.id || '') &&
    ['elementary', 'kinder'].includes(currentMemoType);

  if (!isSameMemoPage) {
    return { applied: false, reason: 'stale-session' };
  }

  const state = getObservationMemoEditState();
  if (state && isObservationMemoEditStateCurrent(student) && state.dirty) {
    return { applied: false, reason: 'user-edited-during-sync' };
  }

  if (!result.adoptedRemote) {
    const metadataOnly =
      result.conflictDetected !== true &&
      !!result.remoteRow &&
      ['remote-confirmed-local', 'remote-equivalent-local'].includes(String(result.source || ''));
    if (metadataOnly) {
      if (state && isObservationMemoEditStateCurrent(student)) {
        state.baselineText = String(result.content ?? memoEditor.value ?? '');
        state.dirty = false;
      }
      if (typeof updateMemoStudentMetaDisplay === 'function') {
        updateMemoStudentMetaDisplay(student, result.updatedAt || '');
      }
      return { applied: false, metadataUpdated: true, reason: 'remote-metadata-normalized' };
    }
    return { applied: false, reason: 'no-remote-update' };
  }

  memoEditor.value = String(result.content || '');
  autoResizeTextarea(memoEditor);
  if (state && isObservationMemoEditStateCurrent(student)) {
    state.baselineText = String(result.content || '');
    state.dirty = false;
  }
  if (typeof updateMemoStudentMetaDisplay === 'function') {
    updateMemoStudentMetaDisplay(student, result.updatedAt || '');
  }

  return { applied: true, reason: 'remote-applied' };
}

function isObservationMemoScreenActive() {
  const screen = document.getElementById('studentMemoScreen');
  return !!(
    screen &&
    screen.style.display !== 'none' &&
    currentMemoStudent &&
    ['elementary', 'kinder'].includes(currentMemoType)
  );
}

async function refreshCurrentObservationMemoFromServer() {
  if (!isObservationMemoScreenActive()) return null;
  if (hasObservationMemoDirtyChanges()) return null;
  if (isObservationMemoAutoSaveBlocked()) return null;

  const student = currentMemoStudent ? { ...currentMemoStudent } : null;
  const editor = document.getElementById('memoEditor');
  if (!student?.id || !editor) return null;

  try {
    const state = getObservationMemoEditState();
    const noteType = String(state?.noteType || 'elementary_observation');
    if (typeof window.getObservationMemoRequestGuardState === 'function') {
      const guard = window.getObservationMemoRequestGuardState(student, noteType);
      if (guard?.inFlight) return null;
    }
    const result = await reconcileObservationMemoDraft(student, noteType);
    applyReconciledObservationMemoDraft(student, editor, result);
    return result;
  } catch (error) {
    console.warn('관찰노트 서버 최신본 확인 실패:', error?.message || error);
    return null;
  }
}


function requestObservationMemoCrossDeviceRefresh() {
  if (window.__olliObservationMemoRemoteRefreshPending) return;
  window.__olliObservationMemoRemoteRefreshPending = true;
  setTimeout(async () => {
    try {
      await refreshCurrentObservationMemoFromServer();
    } finally {
      window.__olliObservationMemoRemoteRefreshPending = false;
    }
  }, 0);
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

function setMemoModePillLabel(label = '학생 이름', modeLabel = '관찰 모드') {
  const el = document.getElementById('memoStudentName');
  const sub = document.getElementById('memoModeSub');
  if (el) el.textContent = '관찰 노트';
  if (sub) sub.textContent = modeLabel || '관찰 모드';
}
function formatMemoUpdatedDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${d} ${hh}:${mm}`;
}
function updateMemoStudentMetaDisplay(student, updatedAt = '') {
  const nameEl = document.getElementById('memoPageStudentName');
  const dateEl = document.getElementById('memoStudentUpdatedDate');
  if (nameEl) nameEl.textContent = student?.name || '학생 이름';
  if (dateEl) {
    const activeNoteType = String(getObservationMemoEditState()?.noteType || 'elementary_observation');
    const localEntry = getMemoEntryByStudent(student, activeNoteType);
    const hasMemoContent = String(localEntry.content || '').trim().length > 0;
    const dateSource = updatedAt || (hasMemoContent ? localEntry.updatedAt : '');
    const dateText = formatMemoUpdatedDate(dateSource || '');
    if (dateText) {
      dateEl.hidden = false;
      dateEl.style.display = 'flex';
      dateEl.innerHTML = `<span>마지막 수정</span><span>${escapeHtml(dateText)}</span>`;
    } else {
      dateEl.hidden = true;
      dateEl.style.display = 'none';
      dateEl.innerHTML = '';
    }
  }
}
function forceObservationMemoControlsVisible(options = {}) {
  const screen = document.getElementById('studentMemoScreen');
  if (!screen) return false;
  if (screen.style.display === 'none') return false;

  const extraInlineFlex = Array.isArray(options.extraInlineFlex) ? options.extraInlineFlex : [];
  const showInlineFlex = [
    '#memoRecordRoomBtn',
    '#memoStudentListBtn',
    ...(currentMemoType === 'elementary' ? ['#memoBottomAnalysisBtn'] : []),
    '#memoFeedbackBtn',
    ...extraInlineFlex
  ];
  const showFlex = ['#studentMemoScreen .memoBottomBar'];
  const showBlock = ['#memoStudentSelectWrap'];

  const reveal = (selector, display) => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.hidden = false;
    el.removeAttribute('hidden');
    el.removeAttribute('aria-hidden');
    el.style.visibility = 'visible';
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
    el.style.display = display;
  };

  [...new Set(showInlineFlex)].forEach(selector => reveal(selector, 'inline-flex'));
  showFlex.forEach(selector => reveal(selector, 'flex'));
  showBlock.forEach(selector => reveal(selector, ''));
  return true;
}
function renderMemoModeMenu() {
  const menu = document.getElementById('memoModeDropup');
  if (!menu) return;
  const checkSvg = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"></path></svg>';
  const option = (active, title, guide, action) => `
    <button type="button" class="memoRecordOption ${active ? 'active' : ''}" onclick="${action}">
      <span class="memoModeCheck" aria-hidden="true">${active ? checkSvg : ''}</span>
      <span class="memoModeOptionText">
        <span class="memoModeOptionTitle">${title}</span>
        <span class="memoModeOptionGuide">${guide}</span>
      </span>
    </button>`;
  const division = currentMemoType === 'kinder' ? 'kinder' : 'elementary';
  menu.innerHTML = `
    ${option(false, '1분 피드백', '수업기록을 빠르게 수업 피드백으로 정리', `closeMemoModeMenu(); openKinderChatFeedbackPage({ division: '${division}' });`)}
    ${option(false, '실패-성장 피드백', '막힘·전환 장면을 깊게 정리', "openMemoFailGrowthMode(event);")}
    ${option(true, '관찰 노트', '관찰메모로 성장 피드백 작성', "closeMemoModeMenu(); openMemoObservationMode(event);")}
  `;
}
function closeMemoModeMenu() { const menu = document.getElementById('memoModeDropup'); if (menu) menu.classList.remove('show'); }
function toggleMemoModeMenu(event) {
  if (event) event.stopPropagation();
  renderMemoModeMenu();
  const menu = document.getElementById('memoModeDropup');
  if (menu) menu.classList.toggle('show');
}
function openMemoObservationMode(event) { if (event) event.stopPropagation(); closeMemoModeMenu(); const memo = document.getElementById('studentMemoScreen'); if (memo) memo.style.display = 'flex'; if (typeof forceStudentMemoControlsVisible === 'function') { forceStudentMemoControlsVisible(); requestAnimationFrame(forceStudentMemoControlsVisible); } }
function openMemoFailGrowthMode(event) {
  if (event) event.stopPropagation();
  closeMemoModeMenu();
  if (currentMemoType === 'kinder' && typeof openKinderChatFeedbackGrowthSheet === 'function') {
    openKinderChatFeedbackGrowthSheet();
    return;
  }
  if (currentMemoType === 'elementary' && typeof openElementaryGrowthFeedbackSheet === 'function') {
    openElementaryGrowthFeedbackSheet();
    return;
  }
  alert('실패-성장 피드백을 열 수 없습니다.');
}
document.addEventListener('click', (event) => { const wrap = document.getElementById('memoModeWrap'); if (wrap && !wrap.contains(event.target)) closeMemoModeMenu(); });

function openObservationMemoScreenShell(session) {
  if (!session || !['elementary', 'kinder'].includes(session.type)) return false;

  const recordRoomScreen = document.getElementById('recordRoomScreen');
  const studentMemoScreenEl = document.getElementById('studentMemoScreen');
  if (recordRoomScreen) recordRoomScreen.style.display = 'none';

  if (studentMemoScreenEl) {
    studentMemoScreenEl.classList.remove('vivizac-slide-page', 'vivizac-slide-in', 'vivizac-slide-out');
    studentMemoScreenEl.style.animation = '';
    studentMemoScreenEl.style.transform = '';
    studentMemoScreenEl.style.display = 'flex';
    studentMemoScreenEl.setAttribute('data-current-memo-type', session.type);
  }

  return !!studentMemoScreenEl;
}

function renderObservationMemoScreenChrome(session) {
  if (!session || !['elementary', 'kinder'].includes(session.type) || !session.student) return false;
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
    feedbackBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path></svg>성장 피드백 생성';
  }
  if (analysisBtn) analysisBtn.style.display = session.type === 'elementary' ? 'inline-flex' : 'none';
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
    beginObservationMemoEditSession(view.student, view.noteType, view.memoText || '');
    memoEditor.value = view.memoText || '';

    reconcileObservationMemoDraft(view.student, view.noteType)
      .then(result => {
        applyReconciledObservationMemoDraft(view.student, memoEditor, result);
      })
      .catch(err => {
        console.warn('student_note_drafts 불러오기 실패:', err.message || err);
      });
  }

  if (session.type === 'elementary') {
    renderElementaryAnalysisSummaryCard(view.analysis.data || {}, {
      title: '분석 결과',
      createdAt: view.analysis.createdAt || ''
    });
    renderElementaryAnalysisHistoryCards(view.student);
  }
  setMemoSaveStatus('자동 저장');

  return view;
}

function setMemoSaveStatus(text) {
  const el = document.getElementById('memoSaveStatus');
  if (!el) return;
  el.textContent = '';
}

function showMemoSaveCheck() {
  setMemoSaveStatus('');
}

function handleMemoHeaderAction() {
  if (typeof requestGrowthFeedback === 'function') requestGrowthFeedback();
  else requestElementaryFeedback();
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

function forceStudentMemoControlsVisible() {
  return forceObservationMemoControlsVisible();
}

function openStudentMemoPageById(studentId) {
  const session = beginObservationMemoSession(studentId);
  if (!session) return;
  const { student } = session;
  closeMemoModeMenu();
  closeMemoStudentSelectPopup();

  openObservationMemoScreenShell(session);
  renderObservationMemoScreenChrome(session);
  renderObservationMemoInitialView(session);
  if (typeof refreshObservationMemoVersionHistoryButton === 'function') {
    requestAnimationFrame(refreshObservationMemoVersionHistoryButton);
  }
}

async function closeMemoPage() {
  if (typeof window.finalizeObservationMemoSessionCheckpoint === 'function') {
    await window.finalizeObservationMemoSessionCheckpoint({ reason:'memo-close' });
  } else {
    prepareObservationMemoPageClose();
  }
  if (typeof closeObservationMemoVersionHistory === 'function') closeObservationMemoVersionHistory();
  returnFromObservationMemoScreen(() => loadRecords(''));
}

async function saveCurrentMemo(options = {}) {
  if (!currentMemoStudent || !['elementary', 'kinder'].includes(currentMemoType)) return;

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
      ? (getMemoEntryByStudent(currentMemoStudent, 'elementary_observation') || {})
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
    console.warn('관찰노트 Supabase 저장 실패:', result.error.message || result.error);
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

async function requestGrowthFeedback() {
  if (!currentMemoStudent || !['elementary', 'kinder'].includes(currentMemoType)) return;
  const editor = document.getElementById('memoEditor');
  const text = String(editor?.value || '').trim();
  const studentDivision = currentMemoType === 'kinder' ? 'kinder' : 'elementary';
  const isElementary = studentDivision === 'elementary';
  const analysisData = isElementary ? getElementaryAnalysisByStudent(currentMemoStudent) : null;
  const hasAnalysisContent = isElementary && (typeof elementaryAnalysisHasContent === 'function')
    ? elementaryAnalysisHasContent(analysisData)
    : false;
  const analysisPromptText = hasAnalysisContent ? buildElementaryAnalysisMemoText(analysisData, { forPrompt: true }) : '';

  if (!text && !hasAnalysisContent) {
    alert('수업 내용이 부족합니다.');
    return;
  }
  if (text) {
    const entry = typeof getMemoEntryByStudent === 'function'
      ? (getMemoEntryByStudent(currentMemoStudent, 'elementary_observation') || {})
      : {};
    setMemoByStudent(currentMemoStudent, text, {
      updatedAt: entry.updatedAt || new Date().toISOString(),
      lastSyncedAt: entry.lastSyncedAt || '',
      syncStatus: entry.syncStatus || 'local',
      revision: entry.revision || 0,
      mutationId: entry.mutationId || '',
      conflict: entry.conflict || null
    }, 'elementary_observation');
  }
  showMemoSaveCheck();
  await requestSceneCardFeedbackFromElementary(currentMemoStudent.name, text, analysisPromptText, {
    studentDivision,
    promptType: 'elementary',
    feedbackType: 'growth'
  });
}

async function requestElementaryFeedback() {
  return requestGrowthFeedback();
}

