const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const voice = fs.readFileSync('kcf-voice-transcription.js', 'utf8');
const css = fs.readFileSync('kinder-feedback.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const talkJs = fs.readFileSync('olli-talk-beta.js', 'utf8');
const talkCss = fs.readFileSync('olli-talk-beta.css', 'utf8');

test('voice capture has dedicated close waveform stop and send controls', () => {
  assert.match(html, /id="kcfVoiceCapture"/);
  assert.match(html, /id="kcfVoiceCaptureClose"/);
  assert.match(html, /id="kcfVoiceWave"/);
  assert.match(html, /id="kcfVoiceCaptureStop"/);
  assert.match(html, /id="kcfVoiceCaptureSend"/);
});

test('voice capture replaces the normal composer while active', () => {
  assert.match(css, /\.kcfComposer\.kcfVoiceCaptureMode[\s\S]*?border-radius:24px/);
  assert.match(css, /\.kcfComposer\.kcfVoiceCaptureMode > \.kcfInput[\s\S]*?display:none !important/);
  assert.match(css, /\.kcfComposer\.kcfVoiceCaptureMode > \.kcfComposerBottom[\s\S]*?display:none !important/);
  assert.match(voice, /baseComposer\.classList\.toggle\('kcfVoiceCaptureMode', state\.uiOpen\)/);
  assert.match(voice, /page\.classList\.toggle\('kcfVoiceCaptureMode', state\.uiOpen\)/);
});

test('waveform is driven by the actual microphone MediaStream', () => {
  assert.match(voice, /prepareWaveformContext\(\)/);
  assert.match(voice, /createMediaStreamSource\(stream\)/);
  assert.match(voice, /createAnalyser\(\)/);
  assert.match(voice, /getByteFrequencyData\(state\.waveData\)/);
  assert.match(voice, /requestAnimationFrame\(draw\)/);
  assert.match(css, /\.kcfVoiceWaveBar[\s\S]*?width:3px/);
});

test('voice end commits audio without submitting feedback', () => {
  assert.match(voice, /input_audio_buffer\.commit/);
  const finish = voice.match(/function finishStop\(\)[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(finish, /renderTranscript\(\)/);
  assert.doesNotMatch(voice, /function submitVoiceNow\(\)/);
  assert.doesNotMatch(voice, /state\.pendingSubmit = true/);
});

test('QuickNote end returns to the text composer focused with raw transcript preserved', () => {
  const endFromPanel = voice.match(/function sendFromPanel\(event\)[\s\S]*?\n  \}/)?.[0] || '';
  const finish = voice.match(/function finishStop\(\)[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(endFromPanel, /closeVoicePanel\(\)/);
  assert.match(endFromPanel, /state\.returnToInputAfterStop = true/);
  assert.match(endFromPanel, /focusQuickNoteInputAfterVoiceEnd\(target\)/);
  assert.match(finish, /renderTranscript\(\)/);
  assert.match(finish, /if \(shouldReturnToInput\)[\s\S]*?focusQuickNoteInputAfterVoiceEnd\(quickNoteTarget\)/);
});

test('voice cancel restores text that existed before recording', () => {
  const cancel = voice.match(/function cancelVoice\(event\)[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(cancel, /target\.value = String\(state\.baseText \|\| ''\)/);
  assert.match(cancel, /cleanupConnection\(\)/);
  assert.match(cancel, /closeVoicePanel\(\)/);
});

test('voice capture assets are cache-busted together', () => {
  assert.match(html, /kinder-feedback\.css\?v=20261002-sheet-controls-1/);
  assert.match(html, /kcf-voice-transcription\.js\?v=20261002-sheet-controls-1/);
});

test('voice capture does not auto-submit after silence', () => {
  assert.doesNotMatch(voice, /KCF_VOICE_AUTO_SUBMIT_SILENCE_MS/);
  assert.doesNotMatch(voice, /trackLocalVoiceActivity/);
  assert.doesNotMatch(voice, /stop\('silence'\)/);
});

test('voice capture never submits feedback from the recording panel', () => {
  assert.match(voice, /function hasVoiceTranscript\(\)/);
  assert.doesNotMatch(voice, /submitKinderChatFeedback/);
  assert.doesNotMatch(voice, /submitVoiceNow/);
  assert.match(voice, /인식된 음성이 없어요/);
});

test('voice capture handles permission interruption background and offline failures', () => {
  assert.match(voice, /NotAllowedError/);
  assert.match(voice, /NotReadableError/);
  assert.match(voice, /audioTrack\.addEventListener\('ended'/);
  assert.match(voice, /document\.addEventListener\('visibilitychange'/);
  assert.match(voice, /global\.addEventListener\('offline'/);
  assert.match(voice, /function interruptVoiceCapture\(message\)/);
});


test('voice engine can target the memo editor without opening QuickNote voice UI', () => {
  assert.match(voice, /targetInput: null/);
  assert.match(voice, /targetButton: null/);
  assert.match(voice, /inlineMode: false/);
  assert.match(voice, /function toggleForTarget\(target, targetButton, options, event\)/);
  assert.match(voice, /state\.targetInput = target/);
  assert.match(voice, /state\.targetButton = targetButton \|\| null/);
  assert.match(voice, /if \(state\.inlineMode\) \{[\s\S]*state\.uiOpen = false/);
  assert.match(voice, /toggleForTarget: toggleForTarget/);
});


test('memo voice cannot hijack an active QuickNote voice session', () => {
  assert.match(
    voice,
    /if \(\(state\.active \|\| state\.starting \|\| state\.stopping\) && state\.targetInput !== target\) \{[\s\S]*?return;/
  );
});


test('inline target keeps raw STT while AI cleanup is pending and never overwrites later manual edits', () => {
  assert.match(voice, /inlineFinalizer: null/);
  assert.match(voice, /processing: false/);
  assert.match(voice, /var inlineFallbackValue = wasInline && inlineTarget/);
  assert.match(voice, /typeof inlineFinalizer === 'function'/);
  assert.match(voice, /String\(inlineTarget\.value \|\| ''\) !== inlineFallbackValue/);
  assert.match(voice, /AI 정리에 실패해 음성 원문을 유지했어요/);
  assert.match(voice, /finalizeTranscript/);
});


test('memo target reuses the physical QuickNote voice capture panel and restores it afterward', () => {
  assert.match(voice, /showInlinePanel: false/);
  assert.match(voice, /inlinePanelHost: null/);
  assert.match(voice, /panelOriginalParent: null/);
  assert.match(voice, /state\.inlinePanelHost\.appendChild\(capture\)/);
  assert.match(voice, /function restorePanelHome\(\)/);
  assert.match(voice, /state\.panelOriginalParent\.appendChild\(capture\)/);
  assert.match(voice, /state\.showInlinePanel = !!\(options && options\.showPanel\)/);
});


test('QuickNote and Memo recording panels share pause-resume and end semantics', () => {
  assert.match(voice, /function setVoicePaused\(paused\)/);
  assert.match(voice, /function toggleVoicePause\(\)/);
  assert.match(voice, /function stopFromPanel\(event\)[\s\S]*?toggleVoicePause\(\)/);
  assert.match(voice, /stopBtn\.setAttribute\('aria-label', state\.paused \? '음성 입력 계속하기' : '음성 입력 일시정지'\)/);
  assert.match(voice, /sendBtn\.setAttribute\('aria-label', '음성 입력 종료'\)/);
});


test('recording window matches the normal single-line composer height', () => {
  const css = fs.readFileSync('kinder-feedback.css', 'utf8');
  assert.match(css, /\.kcfVoiceCapture \{[\s\S]*?height:34px;[\s\S]*?min-height:34px;[\s\S]*?max-height:34px;/);
  assert.match(css, /\.kcfComposer\.kcfVoiceCaptureMode,[\s\S]*?#studentMemoScreen #memoEditorUtilityGroup\.kcfVoiceCaptureMode \{[\s\S]*?height:53px;[\s\S]*?min-height:53px;[\s\S]*?max-height:53px;/);
  assert.match(css, /\.kcfVoiceCaptureCircle \{[\s\S]*?width:33px;[\s\S]*?height:33px;/);
  assert.match(css, /\.kcfVoiceCaptureStop span \{[\s\S]*?linear-gradient/);
  assert.match(css, /\.kcfVoiceCaptureSend span \{[\s\S]*?width:15px;[\s\S]*?height:15px;/);
});


test('memo voice keeps live STT out of the editor until AI cleanup finishes', () => {
  assert.match(voice, /deferInlineTranscript: false/);
  assert.match(voice, /if \(state\.inlineMode && state\.deferInlineTranscript\) return;/);
  assert.match(voice, /state\.deferInlineTranscript = !!\(options && options\.deferTranscriptUntilFinalized\)/);
  assert.match(voice, /var inlineDeferred = state\.inlineMode && state\.deferInlineTranscript/);
  assert.match(voice, /composeTranscriptValue\(inlineBaseText, inlineTranscript\)/);
});


test('QuickNote microphone uses the uploaded shared SVG geometry', () => {
  assert.match(html, /id="kcfVoiceBtn"[\s\S]*?<rect x="8" y="3" width="8" height="13" rx="4"/);
  assert.match(html, /M5 12\.5C5 16\.09 8\.13 19 12 19C15\.87 19 19 16\.09 19 12\.5/);
  assert.match(html, /M12 19V22/);
});


test('voice recording keeps the screen awake until the session ends', () => {
  assert.match(voice, /wakeLockSentinel: null/);
  assert.match(voice, /wakeLockRequest: null/);
  assert.match(voice, /navigator\.wakeLock\.request\('screen'\)/);
  assert.match(voice, /requestScreenWakeLock\(\)\.catch\(function\(\) \{\}\);[\s\S]*?openVoicePanel\(\)/);
  assert.match(voice, /function stop\(\) \{[\s\S]*?releaseScreenWakeLock\(\);/);
  assert.match(voice, /function cleanupConnection\(\) \{[\s\S]*?releaseScreenWakeLock\(\);/);
  assert.match(voice, /if \(!document\.hidden && \(state\.active \|\| state\.starting\)\) \{[\s\S]*?requestScreenWakeLock\(\)/);
});

test('wake lock failure never blocks voice recording', () => {
  assert.match(voice, /screen wake lock unavailable/);
  assert.match(voice, /return null;/);
  assert.doesNotMatch(voice, /throw new Error\([^\n]*wake lock/i);
});


test('QuickNote voice end returns to the shared composer sheet without focusing the readonly inline source', () => {
  const focus = voice.match(/function focusQuickNoteInputAfterVoiceEnd\(target\)[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(focus, /target\.id === 'kcfInput'/);
  assert.match(focus, /global\.openKinderChatFeedbackComposerSheet\(\)/);
  assert.match(focus, /return;/);
  assert.doesNotMatch(focus, /updateKinderChatFeedbackKeyboardOffset/);
});


test('Team Chat reuses the QuickNote recording panel and returns to the focused text input after ending', () => {
  assert.match(talkJs, /showPanel:true,[\s\S]*panelHost:composer/);
  assert.match(voice, /closest\('#studentMemoScreen, #olliTalkBetaScreen'\)/);
  assert.match(css, /:is\(#kinderChatFeedbackScreen, #studentMemoScreen, #olliTalkBetaScreen\) \.kcfVoiceCapture/);
  assert.match(talkCss, /\.olliTalkBetaComposer\.kcfVoiceCaptureMode[\s\S]*display:flex/);
  assert.match(talkCss, /\.olliTalkBetaComposer\.kcfVoiceCaptureMode > :not\(\.kcfVoiceCapture\)[\s\S]*display:none !important/);
  assert.doesNotMatch(talkCss, /\.olliTalkBetaVoiceBtn\.active\{[\s\S]*background:#0A84FF/);
  assert.match(voice, /function sendFromPanel\(event\)[\s\S]*focusQuickNoteInputAfterVoiceEnd\(target\)[\s\S]*stop\(\)/);
  assert.match(voice, /function finishStop\(\)[\s\S]*renderTranscript\(true\)[\s\S]*inlineTarget\?\.focus/);
});
