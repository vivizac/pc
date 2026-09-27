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

const observationMemoEditStateCore = window.ObservationMemoEditStateCore;
if (
  !observationMemoEditStateCore ||
  typeof observationMemoEditStateCore.getState !== 'function' ||
  typeof observationMemoEditStateCore.begin !== 'function' ||
  typeof observationMemoEditStateCore.isCurrent !== 'function' ||
  typeof observationMemoEditStateCore.markDirty !== 'function' ||
  typeof observationMemoEditStateCore.markClean !== 'function' ||
  typeof observationMemoEditStateCore.hasDirty !== 'function'
) {
  throw new Error('관찰노트 편집 상태 Core가 준비되지 않았습니다.');
}

function getObservationMemoEditState() {
  return observationMemoEditStateCore.getState();
}

function beginObservationMemoEditSession(student, noteType = '', initialText = '') {
  return observationMemoEditStateCore.begin({
    studentId: student?.id || '',
    noteType,
    baselineText: initialText
  });
}

function isObservationMemoEditStateCurrent(student = currentMemoStudent) {
  return observationMemoEditStateCore.isCurrent({
    studentId: student?.id || '',
    currentType: currentMemoType
  });
}

function markObservationMemoEditorDirty(target) {
  if (!target || target.id !== 'memoEditor') return false;
  return observationMemoEditStateCore.markDirty({
    studentId: currentMemoStudent?.id || '',
    currentType: currentMemoType,
    text: target.value || ''
  });
}

function markObservationMemoEditorClean() {
  const memoEditor = document.getElementById('memoEditor');
  return observationMemoEditStateCore.markClean({
    studentId: currentMemoStudent?.id || '',
    currentType: currentMemoType,
    text: memoEditor?.value || ''
  });
}

function hasObservationMemoDirtyChanges() {
  return observationMemoEditStateCore.hasDirty({
    studentId: currentMemoStudent?.id || '',
    currentType: currentMemoType
  });
}

const OLLI_MEMO_SERVER_AUTOSAVE_DELAY = 1500;

function getMemoInputTypeFromTarget(target) {
  if (!target || target.id !== 'memoEditor') return '';
  return ['elementary', 'kinder'].includes(currentMemoType) ? currentMemoType : '';
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
      ? (getMemoEntryByStudent(currentMemoStudent, noteType) || {})
      : {};
    if (typeof setMemoByStudent === 'function') {
      setMemoByStudent(currentMemoStudent, content, {
        updatedAt,
        lastSyncedAt: previous.lastSyncedAt || '',
        syncStatus: 'pending',
        revision: previous.revision || 0,
        mutationId: previous.mutationId || '',
        conflict: previous.conflict || null
      }, noteType);
      return true;
    }
  } catch (error) {
    console.warn('관찰노트 즉시 로컬 저장 실패:', error?.message || error);
  }
  return false;
}

function getObservationMemoUnchangedResult() {
  const noteType = String(getObservationMemoEditState()?.noteType || 'elementary_observation');
  const entry = currentMemoStudent && typeof getMemoEntryByStudent === 'function'
    ? (getMemoEntryByStudent(currentMemoStudent, noteType) || {})
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

function handleMemoPauseAutoSaveBlur(target) {
  const inputType = getMemoInputTypeFromTarget(target);
  if (!inputType || currentMemoType !== inputType) return;
  flushMemoAutoSave();
}
