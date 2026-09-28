(function () {
  if (window.__olliRecordUtilityTouchV5) return;
  window.__olliRecordUtilityTouchV5 = true;

  const ROOT_SELECTOR = '#recordRoomScreen .recordUtilityBtn';
  const BUTTON_SELECTOR = '.recordUtilityCircle';
  const MAX_MOVE_PX = 14;
  const MAX_TAP_MS = 900;
  const SUPPRESS_CLICK_MS = 800;
  const ACTIVATION_LOCK_MS = 180;

  let gesture = null;
  let suppressClickUntil = 0;
  let suppressButtonId = '';
  let activationLockedUntil = 0;

  function getWrap(target) {
    return target && target.closest ? target.closest(ROOT_SELECTOR) : null;
  }

  function getButton(wrap) {
    return wrap ? wrap.querySelector(BUTTON_SELECTOR) : null;
  }

  function isTouchLikePointer(event) {
    return event && (event.pointerType === 'touch' || event.pointerType === 'pen');
  }

  function setPressed(wrap, pressed) {
    if (!wrap) return;
    wrap.classList.toggle('utility-touch-pressed', !!pressed);
  }

  function runUtilityAction(button) {
    if (!button || button.disabled) return;

    let action = null;
    let memoScreenToReveal = null;
    let recordScreenToHold = null;
    switch (button.id) {
      case 'recordAcademyManageBtn':
        action = window.toggleRecordAcademyManagementMode;
        break;
      case 'recordAttendanceDashboardBtn':
        action = window.openRecordAttendanceDashboard;
        break;
      case 'recordModeToggleBtn':
        action = window.openOlliObservationFromRecordShortcut;
        break;
      case 'recordStorageToggleBtn':
        action = window.openOlliQuickNoteFromRecordShortcut;
        break;
      default:
        return;
    }

    if (typeof action !== 'function') {
      if (memoScreenToReveal) memoScreenToReveal.style.visibility = '';
      return;
    }

    const isMemoScreenOpen = function () {
      if (!memoScreenToReveal) return false;
      return window.getComputedStyle(memoScreenToReveal).display !== 'none';
    };

    const revealMemoWhenReady = function () {
      if (!memoScreenToReveal) return;
      if (recordScreenToHold && isMemoScreenOpen()) {
        recordScreenToHold.style.display = 'flex';
      }

      requestAnimationFrame(function () {
        if (recordScreenToHold && isMemoScreenOpen()) {
          recordScreenToHold.style.display = 'none';
        }
        memoScreenToReveal.style.visibility = '';
      });
    };

    try {
      const result = action();
      revealMemoWhenReady();
      if (result && typeof result.catch === 'function') {
        result.catch(function (error) {
          if (memoScreenToReveal) memoScreenToReveal.style.visibility = '';
          console.warn('상단 메뉴 실행 실패:', button.id, error);
        });
      }
    } catch (error) {
      if (memoScreenToReveal) memoScreenToReveal.style.visibility = '';
      console.warn('상단 메뉴 실행 실패:', button.id, error);
    }
  }

  document.addEventListener('pointerdown', function (event) {
    if (!isTouchLikePointer(event)) return;
    if (performance.now() < activationLockedUntil) return;

    const wrap = getWrap(event.target);
    if (!wrap) return;
    const button = getButton(wrap);
    if (!button || button.disabled) return;

    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      moved: false,
      wrap: wrap,
      button: button
    };
    setPressed(wrap, true);
  }, true);

  document.addEventListener('pointermove', function (event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = Math.abs(event.clientX - gesture.startX);
    const dy = Math.abs(event.clientY - gesture.startY);
    if (dx > MAX_MOVE_PX || dy > MAX_MOVE_PX) {
      gesture.moved = true;
      setPressed(gesture.wrap, false);
    }
  }, true);

  function finishPointer(event, cancelled) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;

    const current = gesture;
    gesture = null;

    const elapsed = performance.now() - current.startedAt;
    if (cancelled || current.moved || elapsed > MAX_TAP_MS) {
      setPressed(current.wrap, false);
      return;
    }

    suppressButtonId = current.button.id;
    suppressClickUntil = performance.now() + SUPPRESS_CLICK_MS;
    activationLockedUntil = performance.now() + ACTIVATION_LOCK_MS;

    event.preventDefault();
    event.stopPropagation();

    runUtilityAction(current.button);
    requestAnimationFrame(function () {
      setPressed(current.wrap, false);
    });
  }

  document.addEventListener('pointerup', function (event) {
    finishPointer(event, false);
  }, true);

  document.addEventListener('pointercancel', function (event) {
    finishPointer(event, true);
  }, true);

  document.addEventListener('click', function (event) {
    const wrap = getWrap(event.target);
    if (!wrap) return;
    const button = getButton(wrap);
    if (!button || button.disabled) return;

    if (performance.now() < suppressClickUntil && button.id === suppressButtonId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const clickedCircle = event.target && event.target.closest
      ? event.target.closest(BUTTON_SELECTOR)
      : null;
    if (clickedCircle) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    button.click();
  }, true);
})();

/* 관찰노트 학생목록 검색 키보드 보정.
   검색 터치의 기본 스크롤을 막고, 하단 검색 도구만 visualViewport 높이만큼 이동한다. */
(function () {
  if (window.__olliObservationRosterKeyboardV3) return;
  window.__olliObservationRosterKeyboardV3 = true;

  let baselineBottom = 0;

  function getScreen() {
    return document.getElementById('observationRosterScreen');
  }

  function getInput() {
    return document.getElementById('memoRosterSearchInput');
  }

  function isRosterOpen() {
    const screen = getScreen();
    if (!screen) return false;
    try { return getComputedStyle(screen).display !== 'none'; }
    catch (_) { return screen.style.display !== 'none'; }
  }

  function viewportBottom() {
    const viewport = window.visualViewport;
    if (!viewport) return Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
    return Number(viewport.offsetTop || 0) + Number(viewport.height || 0);
  }

  function captureBaseline(force) {
    const current = viewportBottom();
    if (!current) return;
    if (force || !baselineBottom) baselineBottom = current;
  }

  function syncKeyboardOffset() {
    const screen = getScreen();
    const input = getInput();
    const active = !!(screen && isRosterOpen() && input && document.activeElement === input);

    if (!active) {
      document.documentElement.style.setProperty('--olli-observation-keyboard-offset', '0px');
      if (screen) screen.classList.remove('observation-keyboard-open');
      return;
    }

    if (!baselineBottom) captureBaseline(true);
    const offset = Math.max(0, Math.round(baselineBottom - viewportBottom()));
    document.documentElement.style.setProperty('--olli-observation-keyboard-offset', offset + 'px');
    screen.classList.toggle('observation-keyboard-open', offset > 24);
  }

  function focusRosterInputWithoutScroll(event) {
    if (!isRosterOpen()) return;
    const target = event && event.target && event.target.closest
      ? event.target.closest('#memoRosterSearchBtn')
      : null;
    if (!target) return;

    const input = getInput();
    if (!input) return;

    captureBaseline(true);
    if (event && event.cancelable) event.preventDefault();
    try { input.focus({ preventScroll: true }); }
    catch (_) { input.focus(); }
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
    syncKeyboardOffset();
  }

  document.addEventListener('pointerdown', focusRosterInputWithoutScroll, true);

  document.addEventListener('focusin', function (event) {
    if (!event.target || event.target.id !== 'memoRosterSearchInput') return;
    if (!baselineBottom) captureBaseline(true);
    syncKeyboardOffset();
    setTimeout(syncKeyboardOffset, 60);
    setTimeout(syncKeyboardOffset, 160);
    setTimeout(syncKeyboardOffset, 300);
  }, true);

  document.addEventListener('focusout', function (event) {
    if (!event.target || event.target.id !== 'memoRosterSearchInput') return;
    setTimeout(function () {
      const input = getInput();
      if (input && document.activeElement === input) return;
      baselineBottom = 0;
      syncKeyboardOffset();
    }, 180);
  }, true);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function () {
      requestAnimationFrame(syncKeyboardOffset);
    });
    window.visualViewport.addEventListener('scroll', function () {
      requestAnimationFrame(syncKeyboardOffset);
    });
  }
})();

/* 관찰노트 하단 4버튼은 index.html이 고정 소유한다.
   이 파일은 DOM 생성/이동 없이 보관함·마이크·이전기록 기능만 연결한다. */
(function () {
  if (window.__olliMemoEditorUtilityBindingsV1) return;
  window.__olliMemoEditorUtilityBindingsV1 = true;

  function isMemoEditorActive() {
    const root = document.getElementById('studentMemoScreen');
    return !!root && root.getAttribute('data-memo-body-view') === 'editor';
  }

  async function loadHistory() {
    if (typeof window.openObservationMemoVersionHistory === 'function') return true;
    if (typeof window.ensureOlliObservationMemoHistoryReady !== 'function') {
      throw new Error('이전 기록 준비 함수를 찾지 못했습니다.');
    }

    const ready = await window.ensureOlliObservationMemoHistoryReady();
    if (!ready || typeof window.openObservationMemoVersionHistory !== 'function') {
      throw new Error('이전 기록 기능을 불러오지 못했습니다.');
    }
    return true;
  }

  function getMemoVoiceAcademyId() {
    try {
      if (typeof window.getOlliCurrentAcademyId === 'function') {
        return String(window.getOlliCurrentAcademyId() || '').trim();
      }
      if (typeof window.getCurrentOlliAcademyId === 'function') {
        return String(window.getCurrentOlliAcademyId() || '').trim();
      }
    } catch (_) {}
    return '';
  }

  function getMemoVoiceLoadingHost() {
    return document.getElementById('elementaryMemoWrap');
  }

  function positionMemoVoiceLoading(loader, editor) {
    const target = editor || document.getElementById('memoEditor');
    const host = getMemoVoiceLoadingHost();
    if (!loader || !target || !host) return;

    const hostRect = host.getBoundingClientRect();
    const editorRect = target.getBoundingClientRect();
    loader.style.left = Math.max(0, editorRect.left - hostRect.left) + 'px';
    loader.style.top = Math.max(0, editorRect.top - hostRect.top) + 'px';
    loader.style.width = editorRect.width + 'px';
    loader.style.minHeight = editorRect.height + 'px';

    try {
      const computed = getComputedStyle(target);
      loader.style.font = computed.font;
      loader.style.fontSize = computed.fontSize;
      loader.style.fontFamily = computed.fontFamily;
      loader.style.fontWeight = computed.fontWeight;
      loader.style.lineHeight = computed.lineHeight;
      loader.style.letterSpacing = computed.letterSpacing;
      loader.style.padding = computed.padding;
      loader.style.overflowWrap = computed.overflowWrap || 'anywhere';
      loader.style.wordBreak = computed.wordBreak || 'break-word';
    } catch (_) {}
  }

  function showMemoVoiceAiLoading(rawTranscript, options = {}) {
    const host = getMemoVoiceLoadingHost();
    const editor = options?.target || document.getElementById('memoEditor');
    const transcript = String(rawTranscript || '').trim();
    if (!host || !editor || !transcript) return null;

    let loader = document.getElementById('memoVoiceAiLoading');
    if (!loader) {
      loader = document.createElement('div');
      loader.id = 'memoVoiceAiLoading';
      loader.className = 'memoVoiceAiLoading';
      loader.setAttribute('aria-live', 'polite');
      host.appendChild(loader);
    }

    const value = String(editor.value || '');
    let transcriptStart = value.endsWith(transcript)
      ? value.length - transcript.length
      : value.lastIndexOf(transcript);
    if (transcriptStart < 0) transcriptStart = Math.max(0, value.length - transcript.length);

    loader.replaceChildren();
    loader.appendChild(document.createTextNode(value.slice(0, transcriptStart)));

    const raw = document.createElement('span');
    raw.className = 'memoVoiceAiRawTranscript';
    raw.textContent = transcript;
    loader.appendChild(raw);

    const dots = document.createElement('span');
    dots.className = 'memoVoiceAiLoadingDots';
    dots.setAttribute('aria-label', 'AI 정리 중');
    for (let i = 0; i < 3; i += 1) {
      const dot = document.createElement('span');
      dot.className = 'memoVoiceAiLoadingDot';
      dots.appendChild(dot);
    }
    loader.appendChild(dots);

    loader.dataset.expectedValue = value;
    loader.hidden = false;
    loader.setAttribute('aria-busy', 'true');
    positionMemoVoiceLoading(loader, editor);
    requestAnimationFrame(function () {
      if (!loader.hidden) positionMemoVoiceLoading(loader, editor);
    });
    return loader;
  }

  function hideMemoVoiceAiLoading() {
    const loader = document.getElementById('memoVoiceAiLoading');
    if (!loader) return;
    loader.hidden = true;
    loader.setAttribute('aria-busy', 'false');
    delete loader.dataset.expectedValue;
  }

  document.addEventListener('input', function (event) {
    if (event.target?.id !== 'memoEditor') return;
    const loader = document.getElementById('memoVoiceAiLoading');
    if (!loader || loader.hidden || !loader.dataset.expectedValue) return;
    if (String(event.target.value || '') !== loader.dataset.expectedValue) hideMemoVoiceAiLoading();
  }, true);

  async function organizeMemoVoiceTranscript(rawTranscript, context = {}) {
    const transcript = String(rawTranscript || '').trim();
    if (!transcript) return '';

    const student = window.currentMemoStudent || {};
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(function () { controller.abort(); }, 20000) : 0;

    showMemoVoiceAiLoading(transcript, context);
    try {
      const response = await fetch('/api/chat', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        signal: controller ? controller.signal : undefined,
        body:JSON.stringify({
          promptType:'memo_voice_cleanup',
          stream:false,
          academyId:getMemoVoiceAcademyId(),
          studentId:String(student.id || '').trim(),
          studentName:String(student.name || '').trim(),
          studentDivision:String(window.currentMemoType || student.type || '').trim(),
          messages:[{ role:'user', content:transcript }]
        })
      });

      const raw = await response.text();
      let data;
      try { data = raw ? JSON.parse(raw) : {}; }
      catch (_) { data = { raw }; }

      if (!response.ok) {
        throw new Error(data?.error || '메모 음성 정리에 실패했습니다.');
      }
      const cleaned = String(data?.reply || '').trim();
      if (!cleaned) throw new Error('정리된 메모가 비어 있습니다.');
      return cleaned;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      hideMemoVoiceAiLoading();
    }
  }

  function bindFixedEditorTools() {
    const group = document.getElementById('memoEditorUtilityGroup');
    const archive = document.getElementById('memoRecordsBtn');
    const voiceBtn = document.getElementById('memoEditorVoiceBtn');
    const history = document.getElementById('olliMemoVersionHistoryBtn');
    if (!group) return;

    if (archive && archive.dataset.olliFixedUtilityBound !== '1') {
      archive.dataset.olliFixedUtilityBound = '1';
      archive.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (!isMemoEditorActive()) return;
        if (typeof window.toggleElementaryRecordsMenu === 'function') {
          window.toggleElementaryRecordsMenu(event);
        }
      });
    }

    if (voiceBtn && voiceBtn.dataset.olliFixedUtilityBound !== '1') {
      voiceBtn.dataset.olliFixedUtilityBound = '1';
      voiceBtn.addEventListener('click', async function (event) {
        event.preventDefault();
        event.stopPropagation();
        const editor = document.getElementById('memoEditor');
        const voice = window.KcfVoiceTranscription;
        if (!editor || !isMemoEditorActive()) return;
        if (!voice || typeof voice.toggleForTarget !== 'function') {
          try {
            if (typeof window.showPushToast === 'function') window.showPushToast('음성 입력을 준비하지 못했어요.');
          } catch (_) {}
          return;
        }
        await voice.toggleForTarget(editor, voiceBtn, {
          finalizeTranscript: organizeMemoVoiceTranscript,
          showPanel:true,
          panelHost:group,
          deferTranscriptUntilFinalized:true
        });
      });
    }

    if (history && history.dataset.olliFixedUtilityBound !== '1') {
      history.dataset.olliFixedUtilityBound = '1';
      history.addEventListener('click', async function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (!isMemoEditorActive()) return;
        const student = window.currentMemoStudent;
        if (!student || !student.id || window.currentMemoType !== 'elementary') {
          try { window.alert('학생을 선택한 뒤 이전 기록을 확인해 주세요.'); } catch (_) {}
          return;
        }
        try {
          await loadHistory();
          if (typeof window.openObservationMemoVersionHistory === 'function') {
            window.openObservationMemoVersionHistory();
          }
        } catch (error) {
          console.warn('관찰노트 이전 기록 열기 실패:', error && error.message ? error.message : error);
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindFixedEditorTools, { once:true });
  } else {
    bindFixedEditorTools();
  }
})();
