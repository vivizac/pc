function getRecordSearchScreen() {
  return document.getElementById('recordRoomScreen');
}
function getRecordSearchPill() {
  return document.getElementById('recordSearchPill');
}
function getRecordSearchInput() {
  return document.getElementById('searchName');
}
function isRecordSearchOpen() {
  const screen = getRecordSearchScreen();
  return !!(screen && screen.classList.contains('record-search-open'));
}
let recordKeyboardBaselineHeight = 0;
let recordKeyboardHeldOffset = 0;
function captureRecordKeyboardBaseline() {
  const viewport = window.visualViewport;
  recordKeyboardBaselineHeight = Math.max(
    recordKeyboardBaselineHeight,
    Number(window.innerHeight || 0),
    Number(document.documentElement.clientHeight || 0),
    viewport ? Number(viewport.height || 0) + Number(viewport.offsetTop || 0) : 0
  );
}
function resetRecordKeyboardTracking() {
  recordKeyboardBaselineHeight = 0;
  recordKeyboardHeldOffset = 0;
}
function getRecordKeyboardOffset() {
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  if (!recordKeyboardBaselineHeight) captureRecordKeyboardBaseline();
  return Math.max(0, Math.round(recordKeyboardBaselineHeight - viewport.height - viewport.offsetTop) - 6);
}
function setRecordKeyboardOffset() {
  const input = getRecordSearchInput();
  const focused = document.activeElement === input;
  const active = isRecordSearchOpen() || focused;
  if (!active) {
    resetRecordKeyboardTracking();
    document.documentElement.style.setProperty('--record-keyboard-offset', '0px');
    return;
  }
  const rawOffset = getRecordKeyboardOffset();
  if (focused) recordKeyboardHeldOffset = Math.max(recordKeyboardHeldOffset, rawOffset);
  else recordKeyboardHeldOffset = rawOffset;
  const offset = focused ? Math.max(rawOffset, recordKeyboardHeldOffset) : rawOffset;
  document.documentElement.style.setProperty('--record-keyboard-offset', `${offset}px`);
}
function syncRecordSearchQueryState() {
  const screen = getRecordSearchScreen();
  const input = getRecordSearchInput();
  const hasQuery = !!(input && String(input.value || '').trim());
  if (screen) screen.classList.toggle('record-search-has-query', hasQuery);
}
function focusRecordSearchInput() {
  const input = getRecordSearchInput();
  if (!input) return;
  input.style.pointerEvents = 'auto';
  try { input.focus({ preventScroll: true }); } catch(err) { input.focus(); }
  try { input.setSelectionRange(input.value.length, input.value.length); } catch(err) {}
  setRecordKeyboardOffset();
}
function handleSearchPillClick(event) {
  if (event) event.stopPropagation();
  const screen = getRecordSearchScreen();
  const pill = getRecordSearchPill();

  captureRecordKeyboardBaseline();
  recordKeyboardHeldOffset = 0;
  if (screen) screen.classList.add('record-search-open');
  if (pill) pill.classList.add('active');
  syncRecordSearchQueryState();

  focusRecordSearchInput();
  setTimeout(focusRecordSearchInput, 20);
  setTimeout(setRecordKeyboardOffset, 120);
  setTimeout(setRecordKeyboardOffset, 280);
}
function closeSearch(event) {
  if (event) event.stopPropagation();
  const screen = getRecordSearchScreen();
  const pill = getRecordSearchPill();
  const input = getRecordSearchInput();

  if (screen) {
    screen.classList.remove('record-search-open');
    screen.classList.remove('record-search-has-query');
  }
  if (pill) pill.classList.remove('active');
  if (input) {
    input.value = '';
    try { input.blur(); } catch(err) {}
  }

  resetRecordKeyboardTracking();
  document.documentElement.style.setProperty('--record-keyboard-offset', '0px');
  loadRecords('');
}
async function searchRecords() {
  syncRecordSearchQueryState();
  const input = getRecordSearchInput();
  const name = input ? input.value.trim() : '';

  if (typeof window.refreshCurrentStudentRows === 'function') {
    window.refreshCurrentStudentRows();
    return;
  }
  if (!isRecordSearchOpen()) {
    await loadRecords('');
    return;
  }
  await loadRecords(name);
}
function restoreRecordSearchIfKeyboardClosed() {
  const input = getRecordSearchInput();
  if (!isRecordSearchOpen() || !input) return;

  const keyboardClosed = getRecordKeyboardOffset() < 24;
  const inputFocused = document.activeElement === input;
  const suppressUntil = window.__olliRecordSearchSuppressRestoreUntil || 0;
  const suppressRestore = Date.now() < suppressUntil;

  if (keyboardClosed && !inputFocused) {
    resetRecordKeyboardTracking();
    document.documentElement.style.setProperty('--record-keyboard-offset', '0px');
    return;
  }
}
function restoreRecordSearchAfterAppReturn() {
  if (document.hidden) return;

  const screen = getRecordSearchScreen();
  const input = getRecordSearchInput();
  const pill = getRecordSearchPill();

  const recordVisibleNow = !!(screen && getComputedStyle(screen).display !== 'none');
  const userSearchingNow = !!(recordVisibleNow && screen.classList.contains('record-search-open') && input && document.activeElement === input);
  if (userSearchingNow) return;

  if (input && document.activeElement === input) {
    try { input.blur(); } catch(err) {}
  }

  if (screen) {
    screen.classList.remove('record-search-open');
    screen.classList.remove('record-search-has-query');
  }
  if (pill) pill.classList.remove('active');
  document.documentElement.style.setProperty('--record-keyboard-offset', '0px');

  const list = document.getElementById('recordList');
  const query = input ? String(input.value || '').trim() : '';
  if (recordVisibleNow && list && list.children.length === 0 && !query) {
    loadRecords('');
  }
}
function openRecordSearchFromInputFallback(event) {
  if (isRecordSearchOpen()) return;
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  handleSearchPillClick(event);
}
function bindRecordSearchInput() {
  const input = getRecordSearchInput();
  if (!input || input.dataset.recordSearchMainBound === '1') return;
  input.dataset.recordSearchMainBound = '1';
  input.setAttribute('inputmode', 'search');
  input.setAttribute('enterkeyhint', 'done');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');

  input.addEventListener('input', function() {
    syncRecordSearchQueryState();
    searchRecords();
  });
  let compositionSearchTimer = null;
  const flushCompositionSearch = function() {
    clearTimeout(compositionSearchTimer);
    compositionSearchTimer = setTimeout(function() {
      syncRecordSearchQueryState();
      searchRecords();
    }, 0);
  };
  input.addEventListener('compositionupdate', flushCompositionSearch);
  input.addEventListener('compositionend', flushCompositionSearch);
  input.addEventListener('focus', function(event) {
    captureRecordKeyboardBaseline();
    recordKeyboardHeldOffset = 0;
    if (!isRecordSearchOpen()) {
      setTimeout(function() { openRecordSearchFromInputFallback(event); }, 0);
    }
    setTimeout(setRecordKeyboardOffset, 40);
    setTimeout(setRecordKeyboardOffset, 160);
    setTimeout(setRecordKeyboardOffset, 300);
  }, true);
  input.addEventListener('click', openRecordSearchFromInputFallback, true);
  input.addEventListener('blur', function() {
    setTimeout(restoreRecordSearchIfKeyboardClosed, 180);
    setTimeout(restoreRecordSearchIfKeyboardClosed, 360);
  });
  input.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch(event);
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    window.__olliRecordSearchSuppressRestoreUntil = Date.now() + 900;
    searchRecords();
    try { input.blur(); } catch(err) {}
    setTimeout(setRecordKeyboardOffset, 120);
    setTimeout(setRecordKeyboardOffset, 320);
  });
}
function initRecordSearchHandlers() {
  bindRecordSearchInput();
  if (window.visualViewport && !window.__olliRecordSearchViewportBound) {
    window.__olliRecordSearchViewportBound = true;
    window.visualViewport.addEventListener('resize', function() {
      setRecordKeyboardOffset();
      setTimeout(restoreRecordSearchIfKeyboardClosed, 180);
    });
    window.visualViewport.addEventListener('scroll', function() {
      setRecordKeyboardOffset();
      setTimeout(restoreRecordSearchIfKeyboardClosed, 180);
    });
  }
  if (!window.__olliRecordSearchWindowResizeBound) {
    window.__olliRecordSearchWindowResizeBound = true;
    window.addEventListener('resize', setRecordKeyboardOffset);
  }
  if (!window.__olliRecordSearchVisibilityBound) {
    window.__olliRecordSearchVisibilityBound = true;
    document.addEventListener('visibilitychange', restoreRecordSearchAfterAppReturn);
    window.addEventListener('pageshow', restoreRecordSearchAfterAppReturn);
  }
}
window.setRecordKeyboardOffset = setRecordKeyboardOffset;
window.toggleRecordSearch = handleSearchPillClick;
document.addEventListener('DOMContentLoaded', initRecordSearchHandlers);
initRecordSearchHandlers();

function clearRecordInteractionState() {
  const screen = document.getElementById('recordRoomScreen');
  const pill = document.getElementById('recordSearchPill');
  const input = document.getElementById('searchName');
  const overlay = document.getElementById('studentActionOverlay');
  const controls = document.getElementById('recordSelectionControls');

  if (screen) screen.classList.remove('record-search-open');
  if (pill) pill.classList.remove('active');
  if (input) input.value = '';
  if (overlay) overlay.classList.remove('show');
  if (controls) controls.classList.remove('show');
  studentSelectionMode = false;
  selectedStudentIds.clear();
  selectedStudentActionId = '';
  suppressNextStudentClick = false;
  closeRecordAddMenu();
  updateRecordHeaderUI();
}

function closeRecordAddMenu() {
  const menu = document.getElementById('recordAddMenu');
  const btn = document.getElementById('studentAddBtn');
  if (menu) {
    menu.classList.remove('show');
    menu.setAttribute('aria-hidden', 'true');
  }
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function toggleRecordAddMenu(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const menu = document.getElementById('recordAddMenu');
  const btn = document.getElementById('studentAddBtn');
  if (!menu) return;
  const wasOpen = menu.classList.contains('show');
  clearRecordInteractionState();
  if (wasOpen) {
    if (btn) btn.setAttribute('aria-expanded', 'false');
    return;
  }
  menu.classList.add('show');
  menu.setAttribute('aria-hidden', 'false');
  if (btn) btn.setAttribute('aria-expanded', 'true');
}

function openStudentAddFromRecordMenu(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  closeRecordAddMenu();
  clearRecordInteractionState();
  openStudentModal();
}

function openKinderChatFeedbackFromRecordMenu(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  closeRecordAddMenu();
  clearRecordInteractionState();
  if (typeof openKinderChatFeedbackPage === 'function') openKinderChatFeedbackPage();
}

function handleStudentAddButton(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  closeRecordAddMenu();
  clearRecordInteractionState();
  openStudentModal();
}

function bindStudentAddButton() {
  const btn = document.getElementById('studentAddBtn');
  if (!btn || btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';
}
if (!window.__olliStudentAddDelegatedBound) {
  window.__olliStudentAddDelegatedBound = true;
  document.addEventListener('click', function(event) {
    const btn = event.target && event.target.closest ? event.target.closest('#studentAddBtn') : null;
    if (!btn) return;
    handleStudentAddButton(event);
  }, true);
}
if (!window.__olliRecordAddMenuCloseBound) {
  window.__olliRecordAddMenuCloseBound = true;
  document.addEventListener('click', function(event) {
    const insideMenu = event.target && event.target.closest ? event.target.closest('#recordAddMenu') : null;
    const addBtn = event.target && event.target.closest ? event.target.closest('#studentAddBtn') : null;
    if (!insideMenu && !addBtn) closeRecordAddMenu();
  });
}
