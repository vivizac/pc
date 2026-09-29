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

function syncRecordControlRail() {
  const screen = getRecordSearchScreen();
  if (!screen) return;

  const viewportWidth = Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0);
  if (!viewportWidth) return;

  // 상단 검색과 출석 버튼은 페이지 폭/드로어 폭과 무관하게 같은 고정 세로축을 사용한다.
  const fixedEdgeX = 276;
  const right = Math.max(0, Math.round(viewportWidth - fixedEdgeX));
  document.documentElement.style.setProperty('--record-control-rail-edge-x', fixedEdgeX + 'px');
  document.documentElement.style.setProperty('--record-control-rail-right', right + 'px');

  const utilityRow = screen.querySelector('.recordUtilityRow');
  if (utilityRow) {
    const rowRect = utilityRow.getBoundingClientRect();
    if (rowRect.height > 0) {
      document.documentElement.style.setProperty('--record-utility-fixed-top', Math.round(rowRect.top) + 'px');
    }
  }

  const bottomButton = document.getElementById('studentAddBtn') || document.getElementById('recordSortBtn');
  if (bottomButton) {
    const bottomRect = bottomButton.getBoundingClientRect();
    const viewportHeight = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
    if (bottomRect.height && viewportHeight) {
      const bottom = Math.max(0, Math.round(viewportHeight - bottomRect.bottom));
      document.documentElement.style.setProperty('--record-bottom-control-bottom', bottom + 'px');
    }
  }
}
function setRecordSearchDrawerStripHidden(hidden) {
  if (typeof window.setOlliMainSubpageDrawerSearchActive === 'function') {
    window.setOlliMainSubpageDrawerSearchActive(!!hidden);
    return;
  }
  const drawerOpen = typeof window.isOlliMainSubpageDrawerOpen === 'function'
    ? window.isOlliMainSubpageDrawerOpen()
    : false;
  document.body.classList.toggle('olli-main-subpage-drawer-search-active', !!hidden && drawerOpen);
}
function getRecordVisualViewportBottom() {
  const viewport = window.visualViewport;
  if (!viewport) return Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
  return Number(viewport.offsetTop || 0) + Number(viewport.height || 0);
}
function captureRecordSearchViewportBaseline(force = false) {
  const currentBottom = getRecordVisualViewportBottom();
  if (!currentBottom) return;
  const previous = Number(window.__olliRecordSearchViewportBottomBaseline || 0);
  if (force || !previous) window.__olliRecordSearchViewportBottomBaseline = currentBottom;
}
function getRecordKeyboardOffset() {
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  const currentBottom = getRecordVisualViewportBottom();
  let baseline = Number(window.__olliRecordSearchViewportBottomBaseline || 0);
  if (!baseline) baseline = Math.max(currentBottom, window.innerHeight || 0, document.documentElement.clientHeight || 0);
  return Math.max(0, Math.round(baseline - currentBottom));
}
function setRecordKeyboardOffset() {
  const input = getRecordSearchInput();
  const screen = getRecordSearchScreen();
  const closingBeforeUpdate = !!(screen && screen.classList.contains('record-keyboard-closing'));
  const active = isRecordSearchOpen() || document.activeElement === input || closingBeforeUpdate;
  const offset = active ? getRecordKeyboardOffset() : 0;
  const previousOffset = Number(window.__olliRecordKeyboardLastOffset || 0);
  const wasKeyboardOpen = !!(screen && screen.classList.contains('record-keyboard-open'));
  const keyboardOpen = active && offset > 24;
  const detectedClosing = !!(
    screen &&
    !closingBeforeUpdate &&
    wasKeyboardOpen &&
    previousOffset > 24 &&
    offset > 24 &&
    previousOffset - offset > 16
  );

  document.documentElement.style.setProperty('--record-keyboard-offset', `${offset}px`);

  if (screen) {
    if (detectedClosing) screen.classList.add('record-keyboard-closing');
    screen.classList.toggle('record-keyboard-open', keyboardOpen);

    // 검색 상태는 터치 순간이 아니라 실제 키보드로 visualViewport가 줄어든 뒤에만 시작합니다.
    // 순서: 터치 → focus → 키보드 상승 → viewport 변화 감지 → record-search-open.
    if (
      keyboardOpen &&
      !closingBeforeUpdate &&
      input &&
      document.activeElement === input &&
      !isRecordSearchOpen()
    ) {
      screen.classList.add('record-search-open');
      const pill = getRecordSearchPill();
      if (pill) pill.classList.add('active');
      syncRecordSearchQueryState();
    }

    const closingNow = screen.classList.contains('record-keyboard-closing');
    if (!keyboardOpen && closingNow) {
      screen.classList.remove('record-keyboard-closing');

      // 키보드가 완전히 내려온 순간 검색 모드도 닫아
      // [+][검색][정렬]과 상단 메뉴를 한 번에 원래 상태로 복원합니다.
      if (isRecordSearchOpen()) {
        if (input && document.activeElement === input) {
          try { input.blur(); } catch(err) {}
        }
        closeSearch();
        return;
      }

      document.documentElement.style.setProperty('--record-keyboard-offset', '0px');
      window.__olliRecordSearchViewportBottomBaseline = 0;
      window.__olliRecordKeyboardLastOffset = 0;
      return;
    }
  }

  window.__olliRecordKeyboardLastOffset = offset;
}
function syncRecordSearchQueryState() {
  const screen = getRecordSearchScreen();
  const input = getRecordSearchInput();
  const hasQuery = !!(input && String(input.value || '').trim());
  if (screen) screen.classList.toggle('record-search-has-query', hasQuery);
}
function focusRecordSearchInput() {
  const input = getRecordSearchInput();
  const screen = getRecordSearchScreen();
  if (!input) return;
  if (screen) screen.classList.remove('record-keyboard-closing');
  try { input.focus({ preventScroll: true }); } catch(err) { input.focus(); }
  try { input.setSelectionRange(input.value.length, input.value.length); } catch(err) {}
  setRecordKeyboardOffset();
}
function handleSearchPillClick(event) {
  if (event) event.stopPropagation();
  const screen = getRecordSearchScreen();
  syncRecordControlRail();
  setRecordSearchDrawerStripHidden(true);

  // iOS 키보드가 열리기 전 visual viewport 하단을 기준값으로 고정합니다.
  captureRecordSearchViewportBaseline(true);
  window.__olliRecordKeyboardLastOffset = 0;

  // 터치 시점에는 검색 상태를 바꾸지 않고 input focus만 먼저 줍니다.
  // 실제 검색 UI 전환은 setRecordKeyboardOffset()에서 viewport 축소가 확인된 뒤 실행합니다.
  if (screen) screen.classList.remove('record-keyboard-closing');
  focusRecordSearchInput();
  setTimeout(setRecordKeyboardOffset, 120);
  setTimeout(setRecordKeyboardOffset, 280);
}
function closeSearch(event) {
  if (event) event.stopPropagation();
  const screen = getRecordSearchScreen();
  const pill = getRecordSearchPill();
  setRecordSearchDrawerStripHidden(false);
  const input = getRecordSearchInput();
  const keyboardVisible = !!(
    screen &&
    (screen.classList.contains('record-keyboard-open') || getRecordKeyboardOffset() > 24)
  );

  // 키보드가 열린 상태에서 닫는 경우, 키보드가 내려가는 동안 하단 바를 숨깁니다.
  // 실제 viewport가 원래 높이로 돌아온 뒤 기본 하단 바가 다시 나타납니다.
  if (screen && keyboardVisible) screen.classList.add('record-keyboard-closing');

  if (screen) {
    screen.classList.remove('record-search-open');
    screen.classList.remove('record-search-has-query');
  }
  if (pill) pill.classList.remove('active');
  if (input) {
    input.value = '';
    input.style.removeProperty('pointer-events');
    try { input.blur(); } catch(err) {}
  }

  if (keyboardVisible) {
    setRecordKeyboardOffset();
  } else {
    document.documentElement.style.setProperty('--record-keyboard-offset', '0px');
    if (screen) {
      screen.classList.remove('record-keyboard-open');
      screen.classList.remove('record-keyboard-closing');
    }
    window.__olliRecordSearchViewportBottomBaseline = 0;
    window.__olliRecordKeyboardLastOffset = 0;
  }
  loadRecords('');
}
async function searchRecords() {
  syncRecordSearchQueryState();
  const input = getRecordSearchInput();
  const name = input ? input.value.trim() : '';

  // 학생 명단 검색은 메모리의 학생 목록을 즉시 필터링합니다.
  // 키 입력마다 Supabase를 다시 호출해 이전 요청이 최신 결과를 덮어쓰는 경쟁 상태를 만들지 않습니다.
  if (currentRecordView === 'elementary') {
    renderElementaryRecords(isRecordSearchOpen() ? name : '');
    return;
  }
  if (currentRecordView === 'kinder') {
    renderKinderRecords(isRecordSearchOpen() ? name : '');
    return;
  }

  if (!isRecordSearchOpen()) {
    await loadRecords('');
    return;
  }
  if (!name) {
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

  if (keyboardClosed && !inputFocused) {
    closeSearch();
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

  if (input) {
    input.style.removeProperty('pointer-events');
    if (document.activeElement === input) {
      try { input.blur(); } catch(err) {}
    }
  }

  if (screen) {
    screen.classList.remove('record-search-open');
    screen.classList.remove('record-search-has-query');
    screen.classList.remove('record-keyboard-open');
    screen.classList.remove('record-keyboard-closing');
    setRecordSearchDrawerStripHidden(false);
  }
  if (pill) pill.classList.remove('active');
  document.documentElement.style.setProperty('--record-keyboard-offset', '0px');
  window.__olliRecordSearchViewportBottomBaseline = 0;
  window.__olliRecordKeyboardLastOffset = 0;

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
  input.style.removeProperty('pointer-events');
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
  input.addEventListener('compositionend', function() {
    syncRecordSearchQueryState();
    searchRecords();
  });
  input.addEventListener('focus', function() {
    const screen = getRecordSearchScreen();
    if (screen) screen.classList.remove('record-keyboard-closing');
    if (!window.__olliRecordSearchViewportBottomBaseline) captureRecordSearchViewportBaseline(true);
    setTimeout(setRecordKeyboardOffset, 40);
    setTimeout(setRecordKeyboardOffset, 160);
    setTimeout(setRecordKeyboardOffset, 300);
  }, true);
  input.addEventListener('click', openRecordSearchFromInputFallback, true);
  input.addEventListener('blur', function() {
    const screen = getRecordSearchScreen();
    if (screen && screen.classList.contains('record-keyboard-open')) {
      screen.classList.add('record-keyboard-closing');
    }

    // iOS 키보드가 내려가는 동안에는 하단 검색바를 숨긴 채 viewport만 추적합니다.
    setTimeout(setRecordKeyboardOffset, 40);
    setTimeout(setRecordKeyboardOffset, 120);
    setTimeout(function() {
      const currentScreen = getRecordSearchScreen();
      const keyboardClosed = getRecordKeyboardOffset() < 24;
      if (keyboardClosed && isRecordSearchOpen() && document.activeElement !== input) {
        closeSearch();
        return;
      }
      if (!keyboardClosed && currentScreen && document.activeElement === input) {
        currentScreen.classList.remove('record-keyboard-closing');
      }
      setRecordKeyboardOffset();
    }, 320);
  });
  input.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch(event);
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    searchRecords();
    try { input.blur(); } catch(err) {}
  });
}
function initRecordSearchHandlers() {
  bindRecordSearchInput();
  syncRecordControlRail();
  requestAnimationFrame(syncRecordControlRail);
  setTimeout(syncRecordControlRail, 120);

  if (!window.__olliRecordSearchRailBound) {
    window.__olliRecordSearchRailBound = true;
    window.addEventListener('resize', syncRecordControlRail);
    window.addEventListener('orientationchange', function() {
      setTimeout(syncRecordControlRail, 180);
    });
    if (typeof ResizeObserver !== 'undefined') {
      try {
        const row = document.querySelector('#recordRoomScreen .recordUtilityRow');
        if (row) {
          const observer = new ResizeObserver(function() {
            requestAnimationFrame(syncRecordControlRail);
          });
          observer.observe(row);
          window.__olliRecordSearchRailObserver = observer;
        }
      } catch (_) {}
    }
  }

  if (window.visualViewport && !window.__olliRecordSearchViewportBound) {
    window.__olliRecordSearchViewportBound = true;
    window.visualViewport.addEventListener('resize', function() {
      setRecordKeyboardOffset();
      requestAnimationFrame(setRecordKeyboardOffset);
    });
    window.visualViewport.addEventListener('scroll', function() {
      setRecordKeyboardOffset();
      requestAnimationFrame(setRecordKeyboardOffset);
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
window.syncRecordControlRail = syncRecordControlRail;
window.toggleRecordSearch = handleSearchPillClick;
document.addEventListener('DOMContentLoaded', initRecordSearchHandlers);
initRecordSearchHandlers();
