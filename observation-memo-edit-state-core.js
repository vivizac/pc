/* PC/Phone shared observation memo edit-state contract.
   Owns baseline/dirty state only. Platform DOM and save orchestration stay outside. */
(function initObservationMemoEditStateCore(global) {
  'use strict';

  if (global.ObservationMemoEditStateCore) return;

  function clean(value) {
    return String(value == null ? '' : value);
  }

  function getState() {
    return global.__olliObservationMemoEditState || null;
  }

  function begin({ studentId = '', noteType = '', baselineText = '' } = {}) {
    global.__olliObservationMemoEditState = {
      studentId: clean(studentId),
      noteType: clean(noteType),
      baselineText: clean(baselineText),
      dirty: false
    };
    return global.__olliObservationMemoEditState;
  }

  function isCurrent({ studentId = '', currentType = '' } = {}) {
    const state = getState();
    if (!state) return false;
    const resolvedStudentId = clean(studentId);
    const resolvedType = clean(currentType);
    return !!resolvedStudentId
      && clean(state.studentId) === resolvedStudentId
      && (resolvedType === 'elementary' || resolvedType === 'kinder');
  }

  function markDirty({ studentId = '', currentType = '', text = '' } = {}) {
    const state = getState();
    if (!state || !isCurrent({ studentId, currentType })) return false;
    state.dirty = clean(text) !== clean(state.baselineText);
    return state.dirty;
  }

  function markClean({ studentId = '', currentType = '', text = '' } = {}) {
    const state = getState();
    if (!state || !isCurrent({ studentId, currentType })) return false;
    state.baselineText = clean(text);
    state.dirty = false;
    return true;
  }

  function hasDirty({ studentId = '', currentType = '' } = {}) {
    const state = getState();
    return !!(state && isCurrent({ studentId, currentType }) && state.dirty);
  }

  global.ObservationMemoEditStateCore = Object.freeze({
    getState,
    begin,
    isCurrent,
    markDirty,
    markClean,
    hasDirty
  });
})(window);
