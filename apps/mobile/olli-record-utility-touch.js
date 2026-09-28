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

/* 2026-09-10: 수업기록 하단 유틸리티는 헤더 안에서 CSS로 이동시키지 않고
   studentMemoScreen 직속 포털로 실제 버튼 DOM을 옮겨 터치/클릭 레이어를 보장한다. */
(function () {
  if (window.__olliMemoEditorUtilityPortalV1) return;
  window.__olliMemoEditorUtilityPortalV1 = true;

  const GROUP_ID = 'memoEditorUtilityGroup';
  const ARCHIVE_ID = 'memoRecordsBtn';
  const VOICE_ID = 'memoEditorVoiceBtn';
  const HISTORY_ID = 'olliMemoVersionHistoryBtn';
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

  function ensureArchiveButton(parent) {
    let btn = document.getElementById(ARCHIVE_ID);
    if (btn) return btn;
    if (!parent) return null;

    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = ARCHIVE_ID;
    btn.className = 'memoRecordRoomBtn memoRecordBtn';
    btn.setAttribute('aria-label', '피드백 보관함');
    btn.title = '피드백 보관함';
    btn.innerHTML = '<svg aria-hidden="true" focusable="false" class="memoRecordIcon" width="23" height="23" viewBox="24 21 80 80" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M31 52V40C31 33.4 36.4 28 43 28H51.5C54.6 28 57.4 29.1 59.8 31L64.8 35H85C91.6 35 97 40.4 97 47V82C97 88.6 91.6 94 85 94H43C36.4 94 31 88.6 31 82V52Z" stroke="#111111" stroke-width="5.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M31 53H97" stroke="#111111" stroke-width="5.6" stroke-linecap="round"/></svg>';
    btn.addEventListener('click', function(event) {
      event.preventDefault();
      event.stopPropagation();
      if (!isEditor()) return;
      if (typeof window.toggleElementaryRecordsMenu === 'function') {
        window.toggleElementaryRecordsMenu(event);
      }
    });
    parent.appendChild(btn);
    return btn;
  }

  function ensureVoiceButton(parent) {
    let btn = document.getElementById(VOICE_ID);
    if (btn) return btn;
    if (!parent) return null;

    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = VOICE_ID;
    btn.className = 'memoEditorVoiceBtn';
    btn.setAttribute('aria-label', '음성 입력');
    btn.setAttribute('aria-pressed', 'false');
    btn.title = '음성 입력';
    const sharedMic = document.querySelector('#kcfVoiceBtn svg');
    btn.innerHTML = sharedMic
      ? sharedMic.outerHTML
      : '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><rect x="8" y="3" width="8" height="13" rx="4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></rect><path d="M5 12.5C5 16.09 8.13 19 12 19C15.87 19 19 16.09 19 12.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path><path d="M12 19V22" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
    btn.addEventListener('click', async function (event) {
      event.preventDefault();
      event.stopPropagation();
      const editor = document.getElementById('memoEditor');
      const voice = window.KcfVoiceTranscription;
      if (!editor || !isEditor()) return;
      if (!voice || typeof voice.toggleForTarget !== 'function') {
        try {
          if (typeof window.showPushToast === 'function') window.showPushToast('음성 입력을 준비하지 못했어요.');
        } catch (_) {}
        return;
      }
      await voice.toggleForTarget(editor, btn, {
        finalizeTranscript: organizeMemoVoiceTranscript,
        showPanel:true,
        panelHost:parent,
        deferTranscriptUntilFinalized:true
      });
    });
    parent.appendChild(btn);
    return btn;
  }

  function ensureHistoryButton(parent) {
    let btn = document.getElementById(HISTORY_ID);
    if (btn) {
      btn.setAttribute('data-olli-history-visibility-owner', 'mobile');
      return btn;
    }
    if (!parent) return null;

    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = HISTORY_ID;
    btn.className = 'memoRecordRoomBtn memoRecordBtn';
    btn.setAttribute('data-olli-history-visibility-owner', 'mobile');
    btn.setAttribute('aria-label', '관찰노트 이전 기록');
    btn.title = '이전 기록';
    btn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5.2 8.1A7.6 7.6 0 1 1 4.6 14"></path><path d="M5.2 4.8v4.5h4.5"></path><path d="M12 7.7v4.5l3 1.8"></path></svg>';
    btn.addEventListener('click', async function (event) {
      event.preventDefault();
      event.stopPropagation();
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
    parent.appendChild(btn);
    return btn;
  }

  function ensureGroup() {
    const root = screen();
    if (!root) return null;
    let group = document.getElementById(GROUP_ID);
    if (!group) {
      group = document.createElement('div');
      group.id = GROUP_ID;
      group.setAttribute('aria-label', '수업기록 도구');
      root.appendChild(group);
    }
    return group;
  }

  function mountEditorTools() {
    const root = screen();
    const group = ensureGroup();
    if (!root || !group) return;

    const survey = document.getElementById('memoBottomAnalysisBtn');
    const archive = ensureArchiveButton(group);
    const voice = ensureVoiceButton(group);
    const history = ensureHistoryButton(group);
    [archive, voice, history, survey].forEach(function (btn) {
      if (!btn) return;
      group.appendChild(btn);
      btn.hidden = false;
      btn.removeAttribute('hidden');
      btn.style.removeProperty('display');
      btn.style.removeProperty('visibility');
      btn.style.removeProperty('opacity');
      btn.style.removeProperty('pointer-events');
    });

    group.hidden = !isEditor();
    group.setAttribute('aria-hidden', isEditor() ? 'false' : 'true');
  }

  window.mountObservationMemoEditorTools = mountEditorTools;

  document.addEventListener('DOMContentLoaded', function () {
    mountEditorTools();
    setTimeout(mountEditorTools, 80);
  }, { once: true });
  requestAnimationFrame(mountEditorTools);
  setTimeout(mountEditorTools, 120);
})();
