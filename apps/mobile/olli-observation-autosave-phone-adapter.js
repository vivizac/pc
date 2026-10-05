/* Phone-only observation memo autosave policy. */
(function initObservationMemoPhoneAutosaveAdapter(global) {
  'use strict';

  global.shouldBlockObservationMemoAutoSave = function shouldBlockObservationMemoAutoSave() {
    return currentMemoType === 'elementary' && viewingArchivedElementaryRecord === true;
  };

  // currentMemoStudent/currentMemoType are global lexical bindings (let), not window properties.
  // Expose controlled accessors so shared observation memo safety modules see the live edit session.
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

  function getPhoneMemoAccountSessionToken() {
    try {
      return String(localStorage.getItem('olli_account_session_token_v1') || '').trim();
    } catch (_) {
      return '';
    }
  }

  async function ensurePhoneMemoWritableAccountSession() {
    // 오프라인에서는 기존 토큰과 로컬 pending/CAS 구조를 보존합니다.
    // 실제 서버 저장 성공 여부는 공통 저장 계층이 다시 검증합니다.
    if (global.navigator?.onLine === false) return !!getPhoneMemoAccountSessionToken();

    const validator = typeof global.refreshOlliPhoneAccountSessionValidation === 'function'
      ? global.refreshOlliPhoneAccountSessionValidation
      : global.requireOlliPhoneWritableAccountSession;

    if (typeof validator !== 'function') {
      console.warn('폰 인증 세션 검증 모듈이 준비되지 않아 관찰노트 서버 쓰기를 보류합니다.');
      return false;
    }

    try {
      return (await validator({ force: false })) === true;
    } catch (error) {
      console.warn('폰 관찰노트 쓰기 세션 확인 실패:', error?.message || error);
      return false;
    }
  }

  global.ensureOlliObservationMemoWritableSession = ensurePhoneMemoWritableAccountSession;

  function requestPhoneObservationDraftRefresh() {
    if (typeof global.requestObservationMemoCrossDeviceRefresh === 'function') {
      global.requestObservationMemoCrossDeviceRefresh();
    }
  }

  global.addEventListener('focus', requestPhoneObservationDraftRefresh);
  global.addEventListener('online', requestPhoneObservationDraftRefresh);
  global.addEventListener('olli:realtime-change', event => {
    if (event?.detail?.domain !== 'observation') return;
    requestPhoneObservationDraftRefresh();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) requestPhoneObservationDraftRefresh();
  });
  document.addEventListener('focusin', event => {
    if (event.target?.id !== 'memoEditor') return;
    if (typeof global.hasObservationMemoDirtyChanges === 'function' && global.hasObservationMemoDirtyChanges()) return;
    requestPhoneObservationDraftRefresh();
  });

  if (!global.__olliObservationMemoPhoneAutosaveLifecycleBound) {
    global.__olliObservationMemoPhoneAutosaveLifecycleBound = true;

    document.addEventListener('input', event => {
      const target = event.target;
      if (target?.id !== 'memoEditor' || target.readOnly || target.disabled || event.isComposing) return;
      if (typeof global.handleMemoPauseAutoSaveInput === 'function') {
        global.handleMemoPauseAutoSaveInput(target);
      }
    });

    document.addEventListener('compositionend', event => {
      const target = event.target;
      if (target?.id !== 'memoEditor' || target.readOnly || target.disabled) return;
      if (typeof global.handleMemoPauseAutoSaveInput === 'function') {
        global.handleMemoPauseAutoSaveInput(target);
      }
    }, true);

    document.addEventListener('blur', event => {
      if (event.target?.id !== 'memoEditor') return;
      if (typeof global.handleMemoPauseAutoSaveBlur === 'function') {
        global.handleMemoPauseAutoSaveBlur(event.target);
      }
    }, true);
  }

  let observationMemoHistoryReadyPromise = null;

  async function ensureOlliObservationMemoHistoryReady() {
    if (
      global.ObservationMemoVersionHistoryCore &&
      global.__olliObservationMemoVersionHistoryPhoneUiInstalled &&
      typeof global.openObservationMemoVersionHistory === 'function'
    ) {
      return true;
    }
    if (observationMemoHistoryReadyPromise) return observationMemoHistoryReadyPromise;

    observationMemoHistoryReadyPromise = (async () => {
      if (!global.ObservationMemoVersionHistoryCore) {
        await import('./observation-memo-version-history-core.js?v=20260928-history-core-1');
      }
      if (!global.ObservationMemoVersionHistoryCore) {
        throw new Error('관찰노트 이전 기록 Core를 불러오지 못했습니다.');
      }

      if (
        !global.__olliObservationMemoVersionHistoryPhoneUiInstalled ||
        typeof global.openObservationMemoVersionHistory !== 'function'
      ) {
        await import('./olli-observation-version-history-phone.js?v=20261005-exit-checkpoint-1');
      }

      if (typeof global.openObservationMemoVersionHistory !== 'function') {
        throw new Error('관찰노트 이전 기록 모바일 UI를 불러오지 못했습니다.');
      }
      return true;
    })();

    try {
      return await observationMemoHistoryReadyPromise;
    } catch (error) {
      observationMemoHistoryReadyPromise = null;
      throw error;
    }
  }

  global.ensureOlliObservationMemoHistoryReady = ensureOlliObservationMemoHistoryReady;

  async function loadObservationMemoHistoryModules() {
    try {
      await ensureOlliObservationMemoHistoryReady();
    } catch (error) {
      console.warn('관찰노트 이전 기록 모듈 로드 실패:', error?.message || error);
    }

  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadObservationMemoHistoryModules, { once: true });
  } else {
    loadObservationMemoHistoryModules();
  }
})(window);