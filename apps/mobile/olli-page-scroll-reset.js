
/* 2026-06-22: 페이지 전환 시 이전 화면 스크롤 위치가 남지 않도록 공통 리셋 */
(function(){
  if (window.__olliPageScrollResetPatchV1) return;
  window.__olliPageScrollResetPatchV1 = true;

  const SCROLL_CONTAINER_SELECTOR = [
    '.pageInner', '.recordPageInner', '.memoPageInner', '.settingsPageInner',
    '.settingsBody', '.settingsDetailBody', '.settingsPageBody',
        '.chatArea', '.kcfInner', '.kcfBody', '.kcfChatArea', '.kcfInboxList',
    '.memoFeedbackArchiveSheet', '.attendanceFeedbackSheetPanel',
    '.analysisSheetPanel', '.analysisResultSheetPanel',
    '#recordPageInner', '#recordList', '#memoEditor'
  ].join(',');

  function isVisibleElement(el) {
    // Prepared attendance is a background layer, not a navigated screen.
    if (!el || el.classList?.contains('olliAttendanceRearPrepared')) return false;
    const style = window.getComputedStyle ? getComputedStyle(el) : null;
    return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0');
  }

  function resetScrollElement(el) {
    if (!el) return;
    try {
      if ('scrollTop' in el) el.scrollTop = 0;
      if ('scrollLeft' in el) el.scrollLeft = 0;
    } catch (e) {}
  }

  // Academy management and attendance share the same real scrolling element.
  // Clear only that element on a genuine route/view transition; never change
  // the front page or clear a prewarmed rear during local preparation.
  function resetRecordRoomInnerScroll(screen) {
    if (screen?.id !== 'recordRoomScreen') return;
    const inner = screen.querySelector?.('#recordPageInner')
      || document.getElementById?.('recordPageInner');
    resetScrollElement(inner);
  }

  function resetScrollElementForPage(root, el) {
    if (!el) return;
    const isFeedbackChat = root?.id === 'kinderChatFeedbackScreen' && el.classList?.contains('kcfChatArea');
    if (isFeedbackChat) {
      try {
        if ('scrollTop' in el) el.scrollTop = el.scrollHeight;
        if ('scrollLeft' in el) el.scrollLeft = 0;
      } catch (e) {}
      return;
    }
    resetScrollElement(el);
  }

  function hasActiveEditableInside(root) {
    const active = document.activeElement;
    if (!root || !active || !root.contains(active)) return false;
    if (active.matches?.('textarea, input, [contenteditable="true"]')) return true;
    return false;
  }

  function resetPageScroll(root) {
    if (!root || hasActiveEditableInside(root)) return;
    // Delayed navigation resets must not move the page or viewport during a slide.
    if (window.isOlliMainSubpageDrawerOpen?.() || window.isOlliPhoneNavigationInFlight?.()) return;
    resetScrollElement(root);
    try {
      root.querySelectorAll(SCROLL_CONTAINER_SELECTOR).forEach(function(el){
        resetScrollElementForPage(root, el);
      });
    } catch (e) {}
    try { window.scrollTo(0, 0); } catch (e) {}
  }

  function resetVisiblePageScroll() {
    try {
      document.querySelectorAll('.pageScreen').forEach(function(screen){
        if (isVisibleElement(screen)) resetPageScroll(screen);
      });
    } catch (e) {}
  }

  function scheduleReset(target) {
    if (target) resetPageScroll(target);
    requestAnimationFrame(function(){
      if (target) resetPageScroll(target);
      else resetVisiblePageScroll();
    });
    setTimeout(function(){
      if (target) resetPageScroll(target);
      else resetVisiblePageScroll();
    }, 320);
  }

  function bindPageObservers() {
    const visibilityState = new WeakMap();
    const academyViewState = new WeakMap();
    const observer = new MutationObserver(function(mutations){
      mutations.forEach(function(mutation){
        const el = mutation.target;
        if (!el || !el.classList || !el.classList.contains('pageScreen')) return;
        const wasVisible = visibilityState.get(el) === true;
        const nowVisible = isVisibleElement(el);
        visibilityState.set(el, nowVisible);

        if (el.id === 'recordRoomScreen') {
          const wasAcademy = academyViewState.get(el) === true;
          const nowAcademy = el.classList.contains('record-academy-view');
          academyViewState.set(el, nowAcademy);
          // Leaving either Students or Attendance discards the old position.
          // The two tabs stay inside recordRoomScreen, so detect their class
          // switch as well as a real page hide.
          if ((wasVisible && !nowVisible) ||
              (wasVisible && nowVisible && wasAcademy !== nowAcademy)) {
            resetRecordRoomInnerScroll(el);
          } else if (!wasVisible && nowVisible &&
              !window.isOlliMainSubpageDrawerOpen?.() &&
              !window.isOlliPhoneNavigationInFlight?.()) {
            // Direct entry (not an inert/prepared or sliding drawer rear).
            resetRecordRoomInnerScroll(el);
          }
        }
        if (!wasVisible && nowVisible) scheduleReset(el);
      });
    });
    document.querySelectorAll('.pageScreen').forEach(function(screen){
      visibilityState.set(screen, isVisibleElement(screen));
      if (screen.id === 'recordRoomScreen') {
        academyViewState.set(screen, screen.classList.contains('record-academy-view'));
      }
      observer.observe(screen, { attributes: true, attributeFilter: ['style', 'class'] });
    });
    resetVisiblePageScroll();
  }

  function wrapPageFunction(name) {
    const original = window[name];
    if (typeof original !== 'function' || original.__olliScrollResetWrapped) return;
    const wrapped = function(){
      const result = original.apply(this, arguments);
      // Idle local preparation is not navigation and must not reset other pages.
      if (name === 'openRecordAttendanceDashboard' && arguments[0]?.localOnly === true) return result;
      Promise.resolve(result).finally(function(){ scheduleReset(); });
      return result;
    };
    wrapped.__olliScrollResetWrapped = true;
    window[name] = wrapped;
  }

  function bindFunctionWrappers() {
    [
      'vivizacSlideInPage',
      'showRecordRoom',
      'hideRecordRoom',
      'openRecordAttendanceDashboard',
      'openStudentMemoPageById',
      'openKinderChatFeedbackPage',
      'closeKinderChatFeedbackPage',
      'openSettingsPage',
      'openSettingsDetail',
      'hideSettingsPage',
      'showOlliLoginScreenById',
      'showOlliStartPageSetup'
    ].forEach(wrapPageFunction);
  }

  window.olliResetPageScroll = resetVisiblePageScroll;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      bindPageObservers();
      bindFunctionWrappers();
    });
  } else {
    bindPageObservers();
    bindFunctionWrappers();
  }
})();


