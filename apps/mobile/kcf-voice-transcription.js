(function initKcfVoiceTranscription(global) {
  'use strict';

  var KCF_VOICE_MAX_CAPTURE_MS = 90000;

  var state = {
    active: false,
    starting: false,
    stopping: false,
    pc: null,
    dc: null,
    stream: null,
    baseText: '',
    itemOrder: [],
    itemText: new Map(),
    stopTimer: 0,
    uiOpen: false,
    stopped: false,
    pendingSubmit: false,
    returnToInputAfterStop: false,
    audioContext: null,
    sourceNode: null,
    analyser: null,
    waveData: null,
    waveFrame: 0,
    maxDurationTimer: 0,
    disposing: false,
    targetInput: null,
    targetButton: null,
    inlineMode: false,
    inlineFinalizer: null,
    processing: false,
    showInlinePanel: false,
    inlinePanelHost: null,
    panelOriginalParent: null,
    paused: false,
    deferInlineTranscript: false,
    deferClassTranscript: false,
    wakeLockSentinel: null,
    wakeLockRequest: null,
  };

  function button() {
    return state.targetButton || document.getElementById('kcfVoiceBtn');
  }

  function input() {
    return state.targetInput || document.getElementById('kcfInput');
  }

  function setTargetProcessing(active) {
    var btn = state.targetButton;
    state.processing = active === true;
    if (!btn) return;
    btn.classList.toggle('processing', state.processing);
    btn.setAttribute('aria-busy', state.processing ? 'true' : 'false');
  }

  function restorePanelHome() {
    var capture = document.getElementById('kcfVoiceCapture');
    if (!capture || !state.panelOriginalParent) return;
    if (capture.parentElement !== state.panelOriginalParent) {
      state.panelOriginalParent.appendChild(capture);
    }
    state.panelOriginalParent = null;
  }

  function clearTargetOverride() {
    setTargetProcessing(false);
    restorePanelHome();
    state.targetInput = null;
    state.targetButton = null;
    state.inlineMode = false;
    state.inlineFinalizer = null;
    state.showInlinePanel = false;
    state.inlinePanelHost = null;
    state.paused = false;
    state.deferInlineTranscript = false;
  }

  function panel() {
    return document.getElementById('kcfVoiceCapture');
  }

  function composer() {
    if (state.inlineMode && state.showInlinePanel && state.inlinePanelHost) {
      return state.inlinePanelHost;
    }
    return document.querySelector('#kinderChatFeedbackScreen .kcfComposer');
  }

  function screen() {
    if (state.inlineMode && state.showInlinePanel && state.targetInput) {
      return state.targetInput.closest('#studentMemoScreen') || document.getElementById('studentMemoScreen');
    }
    return document.getElementById('kinderChatFeedbackScreen');
  }

  function wave() {
    return document.getElementById('kcfVoiceWave');
  }

  async function requestScreenWakeLock() {
    if (!('wakeLock' in navigator) || !navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') {
      return null;
    }
    if (document.hidden) return null;
    if (state.wakeLockSentinel && !state.wakeLockSentinel.released) {
      return state.wakeLockSentinel;
    }
    if (state.wakeLockRequest) return state.wakeLockRequest;

    state.wakeLockRequest = navigator.wakeLock.request('screen')
      .then(function(sentinel) {
        state.wakeLockSentinel = sentinel || null;
        if (sentinel && typeof sentinel.addEventListener === 'function') {
          sentinel.addEventListener('release', function() {
            if (state.wakeLockSentinel === sentinel) state.wakeLockSentinel = null;
            if (!document.hidden && (state.active || state.starting)) {
              global.setTimeout(function() {
                requestScreenWakeLock().catch(function() {});
              }, 250);
            }
          }, { once:true });
        }
        return sentinel;
      })
      .catch(function(error) {
        console.warn('[OLLI Voice] screen wake lock unavailable:', error?.name || error?.message || error);
        return null;
      })
      .finally(function() {
        state.wakeLockRequest = null;
      });

    return state.wakeLockRequest;
  }

  function releaseScreenWakeLock() {
    var sentinel = state.wakeLockSentinel;
    state.wakeLockSentinel = null;
    if (!sentinel || sentinel.released || typeof sentinel.release !== 'function') return;
    try {
      var released = sentinel.release();
      if (released && typeof released.catch === 'function') released.catch(function() {});
    } catch (_) {}
  }

  function ensureWaveBars() {
    var host = wave();
    if (!host || host.children.length) return;
    for (var i = 0; i < 42; i += 1) {
      var bar = document.createElement('span');
      bar.className = 'kcfVoiceWaveBar';
      bar.style.height = '3px';
      host.appendChild(bar);
    }
  }

  function clearWaveBars() {
    var host = wave();
    if (!host) return;
    Array.from(host.children).forEach(function(bar) {
      bar.style.height = '3px';
    });
  }

  function prepareWaveformContext() {
    if (state.audioContext) return state.audioContext;
    var AudioContextCtor = global.AudioContext || global.webkitAudioContext;
    if (!AudioContextCtor) return null;
    try {
      state.audioContext = new AudioContextCtor();
      if (state.audioContext.state === 'suspended') {
        try { state.audioContext.resume(); } catch (_) {}
      }
      return state.audioContext;
    } catch (_) {
      state.audioContext = null;
      return null;
    }
  }

  function stopWaveform(preserve) {
    if (state.waveFrame) {
      global.cancelAnimationFrame(state.waveFrame);
      state.waveFrame = 0;
    }
    if (state.sourceNode) {
      try { state.sourceNode.disconnect(); } catch (_) {}
    }
    state.sourceNode = null;
    state.analyser = null;
    state.waveData = null;
    if (state.audioContext) {
      try { state.audioContext.close(); } catch (_) {}
    }
    state.audioContext = null;
    if (!preserve) clearWaveBars();
  }

  function startWaveform(stream) {
    ensureWaveBars();
    clearWaveBars();
    if (!stream) return;

    try {
      var context = prepareWaveformContext();
      if (!context) return;
      if (state.sourceNode) {
        try { state.sourceNode.disconnect(); } catch (_) {}
      }
      var source = context.createMediaStreamSource(stream);
      var analyser = context.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.78;
      source.connect(analyser);

      state.sourceNode = source;
      state.analyser = analyser;
      state.waveData = new Uint8Array(analyser.frequencyBinCount);
      try {
        if (context.state === 'suspended') context.resume();
      } catch (_) {}

      var draw = function() {
        if (!state.analyser || !state.waveData) return;
        var host = wave();
        if (!host) return;
        var bars = Array.from(host.children);
        state.analyser.getByteFrequencyData(state.waveData);
        var usable = Math.max(1, Math.min(state.waveData.length, 36));
        bars.forEach(function(bar, index) {
          var dataIndex = Math.min(usable - 1, Math.floor(index * usable / Math.max(1, bars.length)));
          var level = Number(state.waveData[dataIndex] || 0) / 255;
          var height = 3 + Math.pow(level, 1.12) * 27;
          bar.style.height = height.toFixed(1) + 'px';
        });
        state.waveFrame = global.requestAnimationFrame(draw);
      };
      draw();
    } catch (error) {
      console.warn('[OLLI Voice] waveform unavailable:', error);
      stopWaveform(false);
    }
  }

  function isMemoInlinePanel() {
    return !!(
      state.inlineMode &&
      state.showInlinePanel &&
      state.targetInput &&
      state.targetInput.closest('#studentMemoScreen')
    );
  }

  function setVoicePaused(paused) {
    if (!state.active || state.starting || state.stopping) return;
    state.paused = paused === true;
    if (state.stream) {
      try {
        state.stream.getAudioTracks().forEach(function(track) {
          track.enabled = !state.paused;
        });
      } catch (_) {}
    }
    if (state.paused) {
      stopWaveform(true);
    } else if (state.stream) {
      startWaveform(state.stream);
    }
    updateVoicePanel();
  }

  function toggleVoicePause() {
    setVoicePaused(!state.paused);
  }

  function updateVoicePanel() {
    if (state.inlineMode && !state.showInlinePanel) return;
    var capture = panel();
    var baseComposer = composer();
    var page = screen();
    if (!capture || !baseComposer || !page) return;

    capture.hidden = !state.uiOpen;
    capture.classList.toggle('connecting', state.starting);
    capture.classList.toggle('recording', state.active);
    capture.classList.toggle('stopping', state.stopping);
    capture.classList.toggle('stopped', state.stopped);
    baseComposer.classList.toggle('kcfVoiceCaptureMode', state.uiOpen);
    page.classList.toggle('kcfVoiceCaptureMode', state.uiOpen);

    var stopBtn = document.getElementById('kcfVoiceCaptureStop');
    var sendBtn = document.getElementById('kcfVoiceCaptureSend');
    capture.classList.toggle('paused', state.paused);

    if (stopBtn) {
      stopBtn.disabled = !state.active || state.stopping;
      stopBtn.setAttribute('aria-label', state.paused ? '음성 입력 계속하기' : '음성 입력 일시정지');
      stopBtn.title = state.paused ? '계속 녹음' : '일시정지';
    }
    if (sendBtn) {
      sendBtn.disabled = state.starting || state.stopping;
      sendBtn.setAttribute('aria-label', '음성 입력 종료');
      sendBtn.title = '녹음 종료';
    }
    capture.setAttribute('aria-busy', (state.starting || state.stopping) ? 'true' : 'false');
  }

  function openVoicePanel() {
    if (state.inlineMode && !state.showInlinePanel) {
      state.uiOpen = false;
      state.stopped = false;
      state.pendingSubmit = false;
      state.returnToInputAfterStop = false;
      return;
    }

    var target = input();
    if (target && document.activeElement === target) {
      try { target.blur(); } catch (_) {}
    }

    var capture = panel();
    if (state.inlineMode && state.showInlinePanel && capture && state.inlinePanelHost) {
      if (!state.panelOriginalParent) state.panelOriginalParent = capture.parentElement;
      if (capture.parentElement !== state.inlinePanelHost) {
        state.inlinePanelHost.appendChild(capture);
      }
    }

    state.uiOpen = true;
    state.stopped = false;
    state.pendingSubmit = false;
    state.returnToInputAfterStop = false;
    ensureWaveBars();
    prepareWaveformContext();
    updateVoicePanel();

    if (!state.inlineMode && typeof global.updateKinderChatFeedbackKeyboardOffset === 'function') {
      global.setTimeout(global.updateKinderChatFeedbackKeyboardOffset, 40);
    }
  }

  function closeVoicePanel() {
    state.uiOpen = false;
    state.stopped = false;
    state.pendingSubmit = false;
    state.returnToInputAfterStop = false;
    if (!state.inlineMode || state.showInlinePanel) updateVoicePanel();
    stopWaveform(false);
    restorePanelHome();
  }

  function setWarning(message) {
    if (state.inlineMode) {
      if (!message) return;
      if (typeof global.showPushToast === 'function') {
        global.showPushToast(String(message));
      } else {
        console.warn('[OLLI Voice]', message);
      }
      return;
    }
    if (typeof global.setKinderChatFeedbackWarning === 'function') {
      global.setKinderChatFeedbackWarning(message || '');
      return;
    }
    var el = document.getElementById('kcfInputWarning');
    if (!el) return;
    el.textContent = String(message || '');
    el.classList.toggle('show', !!message);
  }

  function updateButton() {
    var btn = button();
    if (!btn) return;
    btn.classList.toggle('active', state.active);
    btn.classList.toggle('connecting', state.starting);
    btn.setAttribute('aria-pressed', state.active ? 'true' : 'false');
    btn.setAttribute('aria-label', state.active ? '음성 입력 종료' : '음성 입력');
    btn.title = state.active ? '음성 입력 종료' : '음성 입력';
  }

  function normalizeSpace(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function buildTranscriptText() {
    var pieces = [];
    state.itemOrder.forEach(function(id) {
      var value = normalizeSpace(state.itemText.get(id));
      if (value) pieces.push(value);
    });
    return pieces.join(' ').trim();
  }

  function getNormalizedTranscriptText() {
    var transcript = buildTranscriptText();
    var normalizer = global.KcfVoiceTextNormalizer;
    if (normalizer && typeof normalizer.normalizeTimeExpressions === 'function') {
      transcript = normalizer.normalizeTimeExpressions(transcript);
    }
    return String(transcript || '').trim();
  }

  function composeTranscriptValue(baseText, transcript) {
    var base = String(baseText || '').trimEnd();
    var spoken = String(transcript || '').trim();
    if (!spoken) return base;
    return base + (base ? ' ' : '') + spoken;
  }

  function writeTranscriptValue(target, value) {
    if (!target) return;
    target.value = String(value || '');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    try {
      target.setSelectionRange(target.value.length, target.value.length);
    } catch (_) {}
  }

  function renderTranscript(forceWrite) {
    var target = input();
    if (!target) return;
    if (!forceWrite && state.inlineMode && state.deferInlineTranscript) return;
    if (!forceWrite && !state.inlineMode && state.deferClassTranscript) return;
    writeTranscriptValue(
      target,
      composeTranscriptValue(state.baseText, getNormalizedTranscriptText())
    );
  }

  function rememberItem(id) {
    var key = String(id || '').trim();
    if (!key) key = 'voice_' + Date.now();
    if (!state.itemText.has(key)) {
      state.itemText.set(key, '');
      state.itemOrder.push(key);
    }
    return key;
  }

  function handleRealtimeEvent(event) {
    if (!event || typeof event !== 'object') return;

    if (event.type === 'conversation.item.input_audio_transcription.delta') {
      var deltaId = rememberItem(event.item_id);
      var current = String(state.itemText.get(deltaId) || '');
      state.itemText.set(deltaId, current + String(event.delta || ''));
      renderTranscript();
      return;
    }

    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      var completedId = rememberItem(event.item_id);
      state.itemText.set(completedId, String(event.transcript || state.itemText.get(completedId) || ''));
      renderTranscript();
      if (state.stopping) finishStop();
      return;
    }

    if (event.type === 'error') {
      var message = event.error && event.error.message
        ? event.error.message
        : '음성 인식 중 오류가 발생했습니다.';
      console.error('[OLLI Voice] Realtime error:', event);
      setWarning(message);
    }
  }

  function cleanupConnection() {
    state.disposing = true;
    releaseScreenWakeLock();

    if (state.stopTimer) {
      clearTimeout(state.stopTimer);
      state.stopTimer = 0;
    }

    if (state.maxDurationTimer) {
      clearTimeout(state.maxDurationTimer);
      state.maxDurationTimer = 0;
    }

    if (state.dc) {
      try { state.dc.close(); } catch (_) {}
    }
    state.dc = null;

    if (state.pc) {
      try { state.pc.close(); } catch (_) {}
    }
    state.pc = null;

    if (state.stream) {
      try {
        state.stream.getTracks().forEach(function(track) { track.stop(); });
      } catch (_) {}
    }
    state.stream = null;
    stopWaveform(true);

    state.active = false;
    state.starting = false;
    state.stopping = false;
    state.paused = false;
    updateButton();
    state.disposing = false;
  }

  function hasVoiceTranscript() {
    return !!normalizeSpace(buildTranscriptText());
  }

  function finishStop() {
    var shouldReturnToInput = state.returnToInputAfterStop;
    var inlineTarget = state.inlineMode ? input() : null;
    var inlineFinalizer = state.inlineMode ? state.inlineFinalizer : null;
    var inlineButton = state.inlineMode ? state.targetButton : null;
    var inlineBaseText = state.inlineMode ? String(state.baseText || '') : '';
    var inlineTranscript = state.inlineMode ? getNormalizedTranscriptText() : '';
    var inlineDeferred = state.inlineMode && state.deferInlineTranscript;
    var wasInline = state.inlineMode;
    var hasTranscript = hasVoiceTranscript();
    renderTranscript(true);
    var inlineFallbackValue = wasInline && inlineTarget ? String(inlineTarget.value || '') : '';
    cleanupConnection();
    state.stopped = true;
    state.pendingSubmit = false;
    state.returnToInputAfterStop = false;

    if (wasInline) {
      closeVoicePanel();
      if (!hasTranscript) {
        setWarning('인식된 음성이 없어요. 다시 말해 주세요.');
        try { inlineTarget?.focus({ preventScroll:true }); } catch (_) {}
        clearTargetOverride();
        return;
      }

      if (typeof inlineFinalizer === 'function') {
        setTargetProcessing(true);
        Promise.resolve()
          .then(function() {
            return inlineFinalizer(inlineTranscript, {
              baseText: inlineBaseText,
              target: inlineTarget,
              button: inlineButton
            });
          })
          .then(function(cleanedText) {
            var cleaned = String(cleanedText || '').trim();
            if (!cleaned || !inlineTarget) return;
            if (String(inlineTarget.value || '') !== inlineFallbackValue) {
              if (typeof global.showPushToast === 'function') {
                global.showPushToast('정리 중 메모가 수정되어 음성 원문을 유지했어요.');
              }
              return;
            }
            writeTranscriptValue(
              inlineTarget,
              composeTranscriptValue(inlineBaseText, cleaned)
            );
          })
          .catch(function(error) {
            console.warn('[OLLI Voice] memo cleanup failed:', error?.message || error);
            if (
              inlineDeferred &&
              inlineTarget &&
              String(inlineTarget.value || '') === inlineFallbackValue &&
              inlineTranscript
            ) {
              writeTranscriptValue(
                inlineTarget,
                composeTranscriptValue(inlineBaseText, inlineTranscript)
              );
            }
            if (typeof global.showPushToast === 'function') {
              global.showPushToast('AI 정리에 실패해 음성 원문을 유지했어요.');
            }
          })
          .finally(function() {
            try { inlineTarget?.focus({ preventScroll:true }); } catch (_) {}
            clearTargetOverride();
          });
        return;
      }

      try { inlineTarget?.focus({ preventScroll:true }); } catch (_) {}
      clearTargetOverride();
      return;
    }

    if (shouldReturnToInput) {
      closeVoicePanel();
      var quickNoteTarget = input();
      if (!hasTranscript) {
        setWarning('인식된 음성이 없어요. 다시 말해 주세요.');
      }
      focusQuickNoteInputAfterVoiceEnd(quickNoteTarget);
      return;
    }

    updateVoicePanel();
  }

  function stop() {
    if (!state.active && !state.starting && !state.stopping) return;

    releaseScreenWakeLock();

    if (state.starting && !state.active) {
      cleanupConnection();
      state.stopped = true;
      updateVoicePanel();
      return;
    }

    state.starting = false;
    state.active = false;
    state.stopping = true;
    updateButton();
    updateVoicePanel();

    if (state.stream) {
      try {
        state.stream.getAudioTracks().forEach(function(track) { track.enabled = false; });
      } catch (_) {}
    }

    if (state.dc && state.dc.readyState === 'open') {
      try {
        state.dc.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      } catch (_) {
        finishStop();
        return;
      }
    } else {
      finishStop();
      return;
    }

    // Final transcription should arrive as a completed event after commit.
    // Keep a timeout so the microphone never remains open if the event is lost.
    state.stopTimer = global.setTimeout(finishStop, 3000);
  }

  function getVoiceStartErrorMessage(error) {
    var name = String(error?.name || '');
    var raw = String(error?.message || '');

    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return '마이크 권한이 꺼져 있어요. 브라우저 설정에서 마이크 권한을 허용해 주세요.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return '사용할 수 있는 마이크를 찾지 못했어요.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
      return '마이크를 사용할 수 없어요. 통화나 다른 앱에서 마이크를 사용 중인지 확인해 주세요.';
    }
    if (name === 'SecurityError') {
      return '보안 설정 때문에 마이크를 사용할 수 없어요.';
    }
    if (navigator.onLine === false) {
      return '인터넷 연결이 끊어졌어요. 연결을 확인한 뒤 다시 시도해 주세요.';
    }
    if (/network|fetch|connection|offline/i.test(raw)) {
      return '음성 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.';
    }
    return raw || '음성 입력을 시작하지 못했습니다.';
  }

  function interruptVoiceCapture(message) {
    if (!state.active && !state.starting && !state.stopping) return;
    var wasInline = state.inlineMode;
    state.pendingSubmit = false;
    renderTranscript(true);
    cleanupConnection();
    closeVoicePanel();
    setWarning(message || '음성 입력이 중단됐어요. 내용을 확인하고 다시 시도해 주세요.');
    if (wasInline) clearTargetOverride();
  }

  async function getClientSecret() {
    var response = await fetch('/api/realtime-transcription-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });

    var data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      throw new Error(data?.error || '음성 세션을 준비하지 못했습니다.');
    }

    var value = String(data?.value || '').trim();
    if (!value) throw new Error('음성 세션 키를 받지 못했습니다.');
    return value;
  }

  async function start() {
    if (state.active || state.starting) return;

    if (navigator.onLine === false) {
      setWarning('인터넷 연결이 끊어졌어요. 연결을 확인한 뒤 다시 시도해 주세요.');
      return;
    }

    if (!global.RTCPeerConnection || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setWarning('이 기기에서는 실시간 음성 입력을 사용할 수 없습니다.');
      return;
    }

    var target = input();
    if (!target) return;

    state.starting = true;
    state.baseText = String(target.value || '');
    state.itemOrder = [];
    state.itemText = new Map();
    state.stopped = false;
    state.pendingSubmit = false;
    state.returnToInputAfterStop = false;
    state.paused = false;
    state.deferClassTranscript = !!(
      !state.inlineMode &&
      global.KcfTeacherMode &&
      typeof global.KcfTeacherMode.isEnabled === 'function' &&
      global.KcfTeacherMode.isEnabled()
    );
    setWarning('');
    requestScreenWakeLock().catch(function() {});
    openVoicePanel();
    updateButton();
    updateVoicePanel();

    try {
      var tokenPromise = getClientSecret();
      var mediaPromise = navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      var results = await Promise.all([tokenPromise, mediaPromise]);
      var ephemeralKey = results[0];
      state.stream = results[1];
      startWaveform(state.stream);

      if (!state.starting) {
        cleanupConnection();
        return;
      }

      var pc = new RTCPeerConnection();
      state.pc = pc;

      var audioTrack = state.stream.getAudioTracks()[0];
      if (!audioTrack) throw new Error('마이크 오디오를 시작하지 못했습니다.');
      var currentStream = state.stream;
      audioTrack.addEventListener('ended', function() {
        if (state.disposing || state.stream !== currentStream) return;
        interruptVoiceCapture('마이크 연결이 중단됐어요. 통화나 다른 앱에서 마이크를 사용 중인지 확인해 주세요.');
      });
      pc.addTrack(audioTrack, state.stream);

      var dc = pc.createDataChannel('oai-events');
      state.dc = dc;

      dc.addEventListener('message', function(messageEvent) {
        try {
          handleRealtimeEvent(JSON.parse(messageEvent.data));
        } catch (error) {
          console.warn('[OLLI Voice] event parse failed:', error);
        }
      });

      dc.addEventListener('open', function() {
        if (!state.starting) return;
        try {
          dc.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
        } catch (_) {}
        state.starting = false;
        state.active = true;
        if (state.maxDurationTimer) clearTimeout(state.maxDurationTimer);
        state.maxDurationTimer = global.setTimeout(function() {
          if (!state.active || state.stopping) return;
          state.pendingSubmit = false;
          stop();
          setWarning('음성 입력이 길어져 자동으로 멈췄어요. 내용을 확인한 뒤 전송해 주세요.');
        }, KCF_VOICE_MAX_CAPTURE_MS);
        updateButton();
        updateVoicePanel();
      });

      dc.addEventListener('close', function() {
        if (state.disposing || state.dc !== dc) return;
        if (state.active || state.starting || state.stopping) {
          interruptVoiceCapture('음성 연결이 끊어졌어요. 내용을 확인하고 다시 시도해 주세요.');
        }
      });

      pc.addEventListener('connectionstatechange', function() {
        if (!state.pc || pc !== state.pc) return;
        if (pc.connectionState === 'failed') {
          interruptVoiceCapture('음성 연결이 끊어졌어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
        }
      });

      var offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      var sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + ephemeralKey,
          'Content-Type': 'application/sdp'
        },
        body: offer.sdp
      });

      if (!sdpResponse.ok) {
        var errorText = await sdpResponse.text();
        throw new Error(errorText || 'OpenAI 음성 연결에 실패했습니다.');
      }

      await pc.setRemoteDescription({
        type: 'answer',
        sdp: await sdpResponse.text()
      });
    } catch (error) {
      console.error('[OLLI Voice] start failed:', error);
      var wasInline = state.inlineMode;
      var message = getVoiceStartErrorMessage(error);
      setWarning(message);
      cleanupConnection();
      closeVoicePanel();
      if (wasInline) clearTargetOverride();
    }
  }

  function focusQuickNoteInputAfterVoiceEnd(target) {
    if (!target) return;
    try {
      target.focus({ preventScroll:true });
      var end = String(target.value || '').length;
      target.setSelectionRange(end, end);
    } catch (_) {
      try { target.focus(); } catch (_) {}
    }

    var resize = function() {
      if (typeof global.autoResizeKinderChatFeedbackInput === 'function') {
        global.autoResizeKinderChatFeedbackInput(target);
      }
      if (typeof global.updateKinderChatFeedbackKeyboardOffset === 'function') {
        global.updateKinderChatFeedbackKeyboardOffset();
      }
    };
    if (typeof global.requestAnimationFrame === 'function') {
      global.requestAnimationFrame(resize);
    } else {
      global.setTimeout(resize, 0);
    }
    global.setTimeout(resize, 80);
  }

  function cancelVoice(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    var wasInline = state.inlineMode;
    var target = input();
    if (target) {
      target.value = String(state.baseText || '');
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
    state.pendingSubmit = false;
    state.returnToInputAfterStop = false;
    cleanupConnection();
    closeVoicePanel();
    setWarning('');
    if (wasInline) clearTargetOverride();
  }

  function stopFromPanel(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (state.starting || state.stopping || !state.active) return;
    toggleVoicePause();
  }

  function sendFromPanel(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (state.starting || state.stopping) return;

    if (isMemoInlinePanel()) {
      if (!state.active) return;
      state.returnToInputAfterStop = false;
      state.pendingSubmit = false;
      stop();
      return;
    }

    var target = input();
    if (state.stopped) {
      closeVoicePanel();
      focusQuickNoteInputAfterVoiceEnd(target);
      return;
    }
    if (!state.active) return;

    closeVoicePanel();
    state.returnToInputAfterStop = true;
    state.pendingSubmit = false;
    focusQuickNoteInputAfterVoiceEnd(target);
    stop();
  }

  async function toggle(event) {
    if (state.processing) return;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (state.active || state.starting) {
      stop();
      return;
    }

    await start();
  }

  async function toggleForTarget(target, targetButton, options, event) {
    if (state.processing) return;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!target || target.readOnly || target.disabled) return;

    if ((state.active || state.starting || state.stopping) && state.targetInput !== target) {
      if (typeof global.showPushToast === 'function') {
        global.showPushToast('다른 음성 입력을 먼저 종료해 주세요.');
      }
      return;
    }

    if ((state.active || state.starting) && state.targetInput === target) {
      stop();
      return;
    }

    state.targetInput = target;
    state.targetButton = targetButton || null;
    state.inlineMode = true;
    state.inlineFinalizer = options && typeof options.finalizeTranscript === 'function'
      ? options.finalizeTranscript
      : null;
    state.showInlinePanel = !!(options && options.showPanel);
    state.inlinePanelHost = options && options.panelHost ? options.panelHost : null;
    state.deferInlineTranscript = !!(options && options.deferTranscriptUntilFinalized);
    await start();

    if (state.inlineMode && !state.active && !state.starting && !state.stopping) {
      clearTargetOverride();
    }
  }

  function bind() {
    var btn = button();
    if (!btn || btn.__olliVoiceBound) return;
    btn.__olliVoiceBound = true;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', toggle);

    var closeBtn = document.getElementById('kcfVoiceCaptureClose');
    var stopBtn = document.getElementById('kcfVoiceCaptureStop');
    var sendBtn = document.getElementById('kcfVoiceCaptureSend');
    if (closeBtn && !closeBtn.__olliVoiceBound) {
      closeBtn.__olliVoiceBound = true;
      closeBtn.addEventListener('click', cancelVoice);
    }
    if (stopBtn && !stopBtn.__olliVoiceBound) {
      stopBtn.__olliVoiceBound = true;
      stopBtn.addEventListener('click', stopFromPanel);
    }
    if (sendBtn && !sendBtn.__olliVoiceBound) {
      sendBtn.__olliVoiceBound = true;
      sendBtn.addEventListener('click', sendFromPanel);
    }

    ensureWaveBars();
    updateButton();
    updateVoicePanel();
  }

  document.addEventListener('visibilitychange', function() {
    if (document.hidden && (state.active || state.starting || state.stopping)) {
      interruptVoiceCapture('화면을 벗어나 음성 입력을 중단했어요. 내용을 확인한 뒤 다시 말해 주세요.');
      return;
    }
    if (!document.hidden && (state.active || state.starting)) {
      requestScreenWakeLock().catch(function() {});
    }
  });

  global.addEventListener('offline', function() {
    if (state.active || state.starting || state.stopping) {
      interruptVoiceCapture('인터넷 연결이 끊겨 음성 입력을 중단했어요. 연결 후 다시 시도해 주세요.');
    }
  });

  global.addEventListener('pagehide', function() {
    if (state.active || state.starting || state.stopping) cleanupConnection();
    closeVoicePanel();
  });

  global.KcfVoiceTranscription = {
    start: start,
    stop: stop,
    toggle: toggle,
    toggleForTarget: toggleForTarget,
    cancel: cancelVoice,
    send: sendFromPanel,
    isActive: function() { return state.active; },
    isPanelOpen: function() { return state.uiOpen; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})(window);
