
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
    if (!el) return false;
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
    const observer = new MutationObserver(function(mutations){
      mutations.forEach(function(mutation){
        const el = mutation.target;
        if (!el || !el.classList || !el.classList.contains('pageScreen')) return;
        const wasVisible = visibilityState.get(el) === true;
        const nowVisible = isVisibleElement(el);
        visibilityState.set(el, nowVisible);
        if (!wasVisible && nowVisible) scheduleReset(el);
      });
    });
    document.querySelectorAll('.pageScreen').forEach(function(screen){
      visibilityState.set(screen, isVisibleElement(screen));
      observer.observe(screen, { attributes: true, attributeFilter: ['style', 'class'] });
    });
    resetVisiblePageScroll();
  }

  function wrapPageFunction(name) {
    const original = window[name];
    if (typeof original !== 'function' || original.__olliScrollResetWrapped) return;
    const wrapped = function(){
      const result = original.apply(this, arguments);
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
