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

function getObservationMemoEditState() {
  return window.__olliObservationMemoEditState || null;
}

function beginObservationMemoEditSession(student, noteType = '', initialText = '') {
  window.__olliObservationMemoEditState = {
    studentId: String(student?.id || ''),
    noteType: String(noteType || ''),
    baselineText: String(initialText || ''),
    dirty: false
  };
  return window.__olliObservationMemoEditState;
}

function isObservationMemoEditStateCurrent(student = currentMemoStudent) {
  const state = getObservationMemoEditState();
  if (!state || !student) return false;
  return String(state.studentId || '') === String(student.id || '') && currentMemoType === 'elementary';
}

function markObservationMemoEditorDirty(target) {
  if (!target || target.id !== 'memoEditor' || !isObservationMemoEditStateCurrent()) return false;
  const state = getObservationMemoEditState();
  state.dirty = String(target.value || '') !== String(state.baselineText || '');
  return state.dirty;
}

function markObservationMemoEditorClean() {
  const state = getObservationMemoEditState();
  if (!state || !isObservationMemoEditStateCurrent()) return;
  const memoEditor = document.getElementById('memoEditor');
  state.baselineText = String(memoEditor?.value || '');
  state.dirty = false;
}

function hasObservationMemoDirtyChanges() {
  const state = getObservationMemoEditState();
  return !!(state && isObservationMemoEditStateCurrent() && state.dirty);
}

const OLLI_MEMO_SERVER_AUTOSAVE_DELAY = 1500;

function getMemoInputTypeFromTarget(target) {
  if (!target || !target.id) return '';
  return target.id === 'memoEditor' ? 'elementary' : '';
}

function persistObservationMemoInputLocally(target) {
  const inputType = getMemoInputTypeFromTarget(target);
  if (!inputType || !currentMemoStudent || currentMemoType !== inputType) return false;
  if (isObservationMemoAutoSaveBlocked()) return false;

  const content = String(target.value || '');
  const state = getObservationMemoEditState();
  if (
    state &&
    isObservationMemoEditStateCurrent() &&
    content === String(state.baselineText || '')
  ) {
    return false;
  }
  const updatedAt = new Date().toISOString();
  const noteType = String(state?.noteType || 'elementary_observation');

  if (typeof window.protectObservationMemoLocalDraft === 'function') {
    const protectedLocally = window.protectObservationMemoLocalDraft(
      currentMemoStudent,
      noteType,
      content,
      updatedAt
    );
    if (protectedLocally) return true;
  }

  try {
    const previous = typeof getMemoEntryByStudent === 'function'
      ? (getMemoEntryByStudent(currentMemoStudent) || {})
      : {};
    if (typeof setMemoByStudent === 'function') {
      setMemoByStudent(currentMemoStudent, content, {
        updatedAt,
        lastSyncedAt: previous.lastSyncedAt || '',
        syncStatus: 'pending',
        revision: previous.revision || 0,
        mutationId: previous.mutationId || '',
        conflict: previous.conflict || null
      });
      return true;
    }
  } catch (error) {
    console.warn('관찰노트 즉시 로컬 저장 실패:', error?.message || error);
  }
  return false;
}

function getObservationMemoUnchangedResult() {
  const entry = currentMemoStudent && typeof getMemoEntryByStudent === 'function'
    ? (getMemoEntryByStudent(currentMemoStudent) || {})
    : {};
  return {
    state: 'unchanged',
    student: currentMemoStudent || null,
    error: null,
    revision: Number(entry.revision || 0),
    syncedAt: entry.lastSyncedAt || entry.updatedAt || ''
  };
}

async function saveObservationMemoServerSnapshot(options = {}) {
  if (!currentMemoStudent || currentMemoType !== 'elementary') return null;
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

function scheduleMemoAutoSave() {
  if (!currentMemoStudent) return;
  if (isObservationMemoAutoSaveBlocked()) return;
  if (!hasObservationMemoDirtyChanges()) return;

  setMemoSaveStatus('작성 중...');
  if (window.__olliObservationMemoAutoSaveTimer) {
    clearTimeout(window.__olliObservationMemoAutoSaveTimer);
  }

  window.__olliObservationMemoAutoSaveTimer = setTimeout(() => {
    window.__olliObservationMemoAutoSaveTimer = null;
    if (hasObservationMemoDirtyChanges()) {
      void saveObservationMemoServerSnapshot({ status: true });
    }
  }, OLLI_MEMO_SERVER_AUTOSAVE_DELAY);
}

function handleMemoPauseAutoSaveInput(target) {
  const inputType = getMemoInputTypeFromTarget(target);
  if (!inputType || !currentMemoStudent || currentMemoType !== inputType) return;
  if (isObservationMemoAutoSaveBlocked()) return;
  markObservationMemoEditorDirty(target);
  if (!hasObservationMemoDirtyChanges()) return;
  persistObservationMemoInputLocally(target);
  scheduleMemoAutoSave();
}

function flushMemoAutoSave() {
  if (!currentMemoStudent) return false;
  if (window.__olliObservationMemoAutoSaveTimer) {
    clearTimeout(window.__olliObservationMemoAutoSaveTimer);
    window.__olliObservationMemoAutoSaveTimer = null;
  }
  if (!hasObservationMemoDirtyChanges()) return false;
  void saveObservationMemoServerSnapshot({ status: true });
  return true;
}

function prepareObservationMemoPageClose() {
  const flushed = flushMemoAutoSave();
  if (!flushed && hasObservationMemoDirtyChanges()) {
    void saveObservationMemoServerSnapshot({ status: false });
  }
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
    const localEntry = getMemoEntryByStudent(student);
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
    '#memoBottomAnalysisBtn',
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
  menu.innerHTML = `
    ${option(false, '1분 피드백(유치부)', '일상 관찰을 빠르게 정리', "closeMemoModeMenu(); openKinderChatFeedbackPage();")}
    ${option(false, '성장 피드백(유치부)', '막힘·전환 장면을 깊게 정리', "closeMemoModeMenu(); openKinderChatFeedbackGrowthSheet();")}
    ${option(true, '관찰 노트(초등부)', '초등부 관찰노트로 이동', "closeMemoModeMenu(); openMemoObservationMode(event);")}
  `;
}
function closeMemoModeMenu() { const menu = document.getElementById('memoModeDropup'); if (menu) menu.classList.remove('show'); }
function toggleMemoModeMenu(event) {
  if (event) event.stopPropagation();
  if (currentMemoType === 'kinder') return;
  renderMemoModeMenu();
  const menu = document.getElementById('memoModeDropup');
  if (menu) menu.classList.toggle('show');
}
function openMemoObservationMode(event) { if (event) event.stopPropagation(); closeMemoModeMenu(); const memo = document.getElementById('studentMemoScreen'); if (memo) memo.style.display = 'flex'; if (typeof forceStudentMemoControlsVisible === 'function') { forceStudentMemoControlsVisible(); requestAnimationFrame(forceStudentMemoControlsVisible); } }
function openMemoFailGrowthMode(event) {
  if (event) event.stopPropagation();
  closeMemoModeMenu();
  if (typeof openElementaryGrowthFeedbackSheet === 'function') {
    openElementaryGrowthFeedbackSheet();
    return;
  }
  alert('초등부 성장피드백을 열 수 없습니다.');
}
document.addEventListener('click', (event) => { const wrap = document.getElementById('memoModeWrap'); if (wrap && !wrap.contains(event.target)) closeMemoModeMenu(); });

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
  setupMemoPauseAutoSaveBindings();
}

function applyReconciledObservationMemoDraft(student, memoEditor, result) {
  if (!student || !memoEditor || !result) {
    return { applied: false, reason: 'no-remote-update' };
  }

  const isSameMemoPage =
    currentMemoStudent &&
    String(currentMemoStudent.id || '') === String(student.id || '') &&
    currentMemoType === 'elementary';

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
    currentMemoType === 'elementary'
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

if (!window.__olliObservationMemoCrossDeviceRefreshBound) {
  window.__olliObservationMemoCrossDeviceRefreshBound = true;
  window.addEventListener('focus', () => {
    setTimeout(() => { void refreshCurrentObservationMemoFromServer(); }, 0);
  });
  window.addEventListener('online', () => {
    setTimeout(() => { void refreshCurrentObservationMemoFromServer(); }, 0);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      setTimeout(() => { void refreshCurrentObservationMemoFromServer(); }, 0);
    }
  });
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
    feedbackBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path></svg>피드백 생성';
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