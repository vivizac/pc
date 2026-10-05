/* PC/Phone common observation memo helpers. Notification behavior intentionally excluded. */

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

async function finalizeObservationMemoSessionCheckpoint(options = {}) {
  const student = currentMemoStudent ? { ...currentMemoStudent } : null;
  if (!student?.id || !['elementary', 'kinder'].includes(currentMemoType)) {
    return { checkpointed:false, state:'skipped' };
  }
  if (isObservationMemoAutoSaveBlocked()) {
    return { checkpointed:false, state:'blocked-view' };
  }

  const studentId = String(student.id || '');
  const memoType = currentMemoType;
  const noteType = String(getObservationMemoEditState()?.noteType || 'elementary_observation');
  const stillCurrent = () =>
    currentMemoStudent &&
    String(currentMemoStudent.id || '') === studentId &&
    currentMemoType === memoType;

  if (window.__olliObservationMemoAutoSaveTimer) {
    clearTimeout(window.__olliObservationMemoAutoSaveTimer);
    window.__olliObservationMemoAutoSaveTimer = null;
  }

  try {
    if (window.__olliObservationMemoServerSavePromise) {
      await window.__olliObservationMemoServerSavePromise;
    }

    if (stillCurrent() && hasObservationMemoDirtyChanges()) {
      await saveObservationMemoServerSnapshot({ status: options.status === true });
    }
    if (window.__olliObservationMemoServerSavePromise) {
      await window.__olliObservationMemoServerSavePromise;
    }
    if (stillCurrent() && hasObservationMemoDirtyChanges()) {
      await saveObservationMemoServerSnapshot({ status: false });
    }
  } catch (error) {
    console.warn('관찰노트 종료 전 최종 저장 확인 실패:', error?.message || error);
  }

  if (!stillCurrent()) return { checkpointed:false, state:'stale-session' };

  const entry = typeof getMemoEntryByStudent === 'function'
    ? (getMemoEntryByStudent(student, noteType) || {})
    : {};
  const syncStatus = String(entry.syncStatus || '');
  if (
    hasObservationMemoDirtyChanges() ||
    ['pending', 'blocked', 'conflict'].includes(syncStatus)
  ) {
    return {
      checkpointed:false,
      state:syncStatus || 'unsynced',
      revision:Number(entry.revision || 0)
    };
  }

  if (typeof window.createObservationMemoExitCheckpoint !== 'function') {
    return { checkpointed:false, state:'checkpoint-unavailable', revision:Number(entry.revision || 0) };
  }

  try {
    const checkpoint = await window.createObservationMemoExitCheckpoint(student, noteType);
    return {
      checkpointed:checkpoint?.ok === true,
      state:checkpoint?.created === false ? 'already-checkpointed' : 'checkpointed',
      revision:Number(checkpoint?.revision || entry.revision || 0),
      checkpoint
    };
  } catch (error) {
    console.warn('관찰노트 종료 복구 지점 저장 실패:', error?.message || error);
    return {
      checkpointed:false,
      state:'checkpoint-failed',
      revision:Number(entry.revision || 0),
      error
    };
  }
}

window.finalizeObservationMemoSessionCheckpoint = finalizeObservationMemoSessionCheckpoint;
