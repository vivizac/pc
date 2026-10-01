const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const rosterPath = path.join(root, 'olli-observation-roster-phone.js');
const cssPath = path.join(root, 'olli-observation-roster-phone.css');
const indexPath = path.join(root, 'index.html');
const vercelPath = path.join(root, 'vercel.json');
const scrollResetPath = path.join(root, 'olli-page-scroll-reset.js');
const touchPath = path.join(root, 'olli-record-utility-touch.js');
const historyUiPath = path.join(root, 'olli-observation-version-history-phone.js');
const autosaveAdapterPath = path.join(root, 'olli-observation-autosave-phone-adapter.js');
const corePath = path.join(root, 'olli-observation-core.js');
const runtimePath = path.join(root, 'olli-observation-runtime.js');
const baseCssPath = path.join(root, 'olli-phone-base.css');
const legacyAdapterPath = path.join(root, 'olli-observation-editor-phone-adapter.js');
const legacyAdapterCssPath = path.join(root, 'olli-observation-editor-phone.css');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('phone observation owners parse as JavaScript', () => {
  execFileSync(process.execPath, ['--check', rosterPath], { stdio: 'pipe' });
  execFileSync(process.execPath, ['--check', scrollResetPath], { stdio: 'pipe' });
  execFileSync(process.execPath, ['--check', touchPath], { stdio: 'pipe' });
  execFileSync(process.execPath, ['--check', historyUiPath], { stdio: 'pipe' });
  execFileSync(process.execPath, ['--check', autosaveAdapterPath], { stdio: 'pipe' });
});

test('phone loads edit-state core before observation common from the shared PC source', () => {
  const html = read(indexPath);
  const vercel = JSON.parse(read(vercelPath));
  const coreIndex = html.indexOf('observation-memo-edit-state-core.js');
  const commonIndex = html.indexOf('observation-memo-common.js');

  assert.ok(coreIndex >= 0);
  assert.ok(commonIndex > coreIndex);

  const rewrite = vercel.rewrites.find(item => item.source === '/observation-memo-edit-state-core.js');
  assert.ok(rewrite);
  assert.match(rewrite.destination, /vivizac\/pc\/.+\/observation-memo-edit-state-core\.js$/);
});

test('phone no longer loads the legacy observation request-guard runtime', () => {
  const adapter = read(autosaveAdapterPath);
  const vercel = JSON.parse(read(vercelPath));

  assert.doesNotMatch(adapter, /observation-memo-request-guard-common\.js/);
  assert.equal(vercel.rewrites.some(item => item.source === '/observation-memo-request-guard-common.js'), false);
  assert.equal(vercel.headers.some(item => item.source === '/observation-memo-request-guard-common.js'), false);
});

test('phone adapter owns observation cross-device refresh lifecycle', () => {
  const adapter = read(autosaveAdapterPath);
  const vercel = JSON.parse(read(vercelPath));

  assert.match(adapter, /function requestPhoneObservationDraftRefresh\(\)/);
  assert.match(adapter, /global\.requestObservationMemoCrossDeviceRefresh/);
  assert.match(adapter, /addEventListener\('focus'/);
  assert.match(adapter, /addEventListener\('online'/);
  assert.match(adapter, /addEventListener\('olli:realtime-change'/);
  assert.match(adapter, /addEventListener\('visibilitychange'/);
  assert.match(adapter, /addEventListener\('focusin'/);
  assert.match(adapter, /event\?\.detail\?\.domain !== 'observation'/);
  assert.match(adapter, /hasObservationMemoDirtyChanges/);

  const commonRewrite = vercel.rewrites.find(item => item.source === '/observation-memo-common.js');
  assert.ok(commonRewrite);
  assert.match(commonRewrite.destination, /vivizac\/pc\/main\/observation-memo-common\.js$/);
});

test('phone adapter restores autosave input binding without saving active composition frames', () => {
  const adapter = read(autosaveAdapterPath);

  assert.match(adapter, /__olliObservationMemoPhoneAutosaveLifecycleBound/);
  assert.match(adapter, /addEventListener\('input'/);
  assert.match(adapter, /event\.isComposing/);
  assert.match(adapter, /target\.readOnly \|\| target\.disabled/);
  assert.match(adapter, /handleMemoPauseAutoSaveInput\(target\)/);
  assert.match(adapter, /addEventListener\('compositionend'/);
  assert.match(adapter, /addEventListener\('blur'/);
  assert.match(adapter, /handleMemoPauseAutoSaveBlur\(event\.target\)/);
});

test('legacy observation editor adapter and overlay stylesheet remain removed', () => {
  assert.equal(fs.existsSync(legacyAdapterPath), false);
  assert.equal(fs.existsSync(legacyAdapterCssPath), false);
  assert.doesNotMatch(read(corePath), /olli-observation-editor-phone-adapter/);
});

test('student roster is a real independent page outside studentMemoScreen', () => {
  const html = read(indexPath);
  const rosterStart = html.indexOf('id="observationRosterScreen"');
  const memoStart = html.indexOf('id="studentMemoScreen"');
  const rosterView = html.indexOf('id="memoStudentRosterView"');
  assert.ok(rosterStart >= 0 && memoStart > rosterStart);
  assert.ok(rosterView > rosterStart && rosterView < memoStart);
  const memoSegment = html.slice(memoStart, html.indexOf('<!-- PAGE:', memoStart + 1) === -1 ? html.length : html.indexOf('<!-- PAGE:', memoStart + 1));
  assert.doesNotMatch(memoSegment, /memoStudentRosterView/);
});

test('independent roster and memo page screens own the slide transition', () => {
  const source = read(rosterPath);
  const css = read(cssPath);
  assert.match(source, /getObservationRosterScreen/);
  assert.match(source, /observationRosterScreen/);
  assert.doesNotMatch(source, /observation-editor-transitioning/);
  assert.match(css, /#observationRosterScreen/);
  assert.match(css, /#studentMemoScreen\.observation-editor-slide-enter \{/);
  assert.match(css, /#studentMemoScreen\.observation-editor-slide-leave \{/);
  assert.doesNotMatch(css, /observation-editor-transitioning #memoStudentRosterView/);
  const curves = css.match(/cubic-bezier\(\.4,0,\.25,1\)/g) || [];
  assert.ok(curves.length >= 2);
  assert.match(source, /const OBSERVATION_MEMO_SLIDE_MS = 360;/);
  assert.ok((css.match(/360ms cubic-bezier\(\.4,0,\.25,1\)/g) || []).length >= 2);
});

test('record utility opens the independent roster and its search keyboard targets that screen', () => {
  const source = read(touchPath);
  assert.match(source, /memoScreenToReveal = document\.getElementById\('observationRosterScreen'\)/);
  assert.match(source, /return document\.getElementById\('observationRosterScreen'\)/);
  assert.doesNotMatch(source, /screen\.getAttribute\('data-memo-body-view'\) !== 'roster'/);
});

test('page scroll reset only reacts to hidden-to-visible navigation and protects focused editors', () => {
  const source = read(scrollResetPath);
  assert.match(source, /hasActiveEditableInside/);
  assert.match(source, /if \(!root \|\| hasActiveEditableInside\(root\)\) return/);
  assert.match(source, /const visibilityState = new WeakMap\(\)/);
  assert.match(source, /if \(!wasVisible && nowVisible\) scheduleReset\(el\)/);
  assert.doesNotMatch(source, /classList\.contains\('pageScreen'\) && isVisibleElement\(el\)\) \{\s*scheduleReset\(el\)/s);
});

test('memo history normalizes iOS Hangul first, then groups edits as user actions', () => {
  const source = read(rosterPath);
  assert.match(source, /const OBSERVATION_MEMO_ACTION_IDLE_MS = 900;/);
  assert.match(source, /const OBSERVATION_MEMO_ACTION_MAX_MS = 5000;/);
  assert.match(source, /const OBSERVATION_MEMO_ACTION_MAX_GRAPHEMES = 24;/);
  assert.match(source, /observationMemoCurrentAction/);
  assert.match(source, /recordObservationMemoActionEdit/);
  assert.match(source, /classifyObservationMemoAction/);
  assert.match(source, /type === 'typing' \|\| type === 'deleting'/);
  assert.match(source, /inputType === 'deleteContentBackward' && observationMemoHangulTransaction/);
  assert.match(source, /inputType === 'insertText' && isObservationMemoHangulText\(event\.data\)/);
  assert.match(source, /finalizeObservationMemoHistoryBoundary\(editor\)/);
  assert.doesNotMatch(source, /pushObservationMemoUndoSnapshot/);
  assert.doesNotMatch(source, /recordObservationMemoCompositionStep/);
  assert.doesNotMatch(source, /isObservationMemoHangulReplacementStep/);
  assert.doesNotMatch(source, /ensureObservationMemoCaretVisible/);\n  assert.doesNotMatch(source, /page\\.scrollTop \\+= delta/);
  assert.doesNotMatch(source, /visualViewport\.addEventListener\('scroll'/);
});

test('undo redo controls keep the memo textarea focused on iOS 26', () => {
  const source = read(rosterPath);
  const start = source.indexOf('function ensureObservationMemoEditingActions()');
  const end = source.indexOf('function getObservationMemoViewportBottom()', start);
  const actions = source.slice(start, end);
  assert.match(actions, /button\.addEventListener\('mousedown', event => event\.preventDefault\(\)\)/);
  assert.doesNotMatch(actions, /button\.addEventListener\('pointerdown', event => event\.preventDefault\(\)\)/);
});

test('editor tap behavior, stationary bottom baseline, centered undo redo and save owners stay intact', () => {
  const css = read(cssPath);
  const source = read(rosterPath);
  assert.doesNotMatch(css, /--vivizac-memo-bottom-y/);
  assert.match(css, /#memoEditorUtilityGroup \{[\s\S]*?bottom:var\(--olli-phone-guide-bottom, max\(10px, env\(safe-area-inset-bottom\)\)\)/);
  assert.match(css, /#memoEditor\.memoEditor[^}]*-webkit-tap-highlight-color:transparent/s);
  assert.doesNotMatch(source, /id="observationMemoDoneBtn"/);
  assert.doesNotMatch(css, /#observationMemoDoneBtn/);
  assert.match(css, /observation-editor-keyboard-open \.memoHeaderActions \{[\s\S]*left:50%;[\s\S]*right:auto;[\s\S]*transform:translateX\(-50%\);[\s\S]*justify-content:center;/);
  assert.match(css, /\.observationMemoEditingActions \{[\s\S]*justify-content:center;/);
  assert.match(source, /flushMemoAutoSave/);
  assert.doesNotMatch(source, /saveCurrentMemo\s*=/);
  assert.doesNotMatch(source, /supabase\s*\(/i);
  assert.doesNotMatch(source, /revision\s*=/i);
});


test('phone runtime owns observation view sync rendering and refresh', () => {
  const runtime = read(runtimePath);

  assert.match(runtime, /function applyReconciledObservationMemoDraft\(/);
  assert.match(runtime, /reason: 'user-edited-during-sync'/);
  assert.match(runtime, /function isObservationMemoScreenActive\(/);
  assert.match(runtime, /function refreshCurrentObservationMemoFromServer\(/);
  assert.match(runtime, /function requestObservationMemoCrossDeviceRefresh\(/);
});

test('phone loads feedback-clear core before observation runtime without a dynamic safety loader', () => {
  const html = read(indexPath);
  const adapter = read(autosaveAdapterPath);
  const vercel = JSON.parse(read(vercelPath));

  const clearIndex = html.indexOf('observation-memo-feedback-clear-common.js');
  const runtimeIndex = html.indexOf('olli-observation-runtime.js');
  assert.ok(clearIndex >= 0);
  assert.ok(runtimeIndex > clearIndex);

  assert.doesNotMatch(adapter, /observation-memo-feedback-clear-common\.js/);
  assert.doesNotMatch(adapter, /__olliObservationFeedbackClearSafetyLoaded/);

  const rewrite = vercel.rewrites.find(item => item.source === '/observation-memo-feedback-clear-common.js');
  assert.ok(rewrite);
  assert.match(rewrite.destination, /vivizac\/pc\/main\/observation-memo-feedback-clear-common\.js$/);
});

test('phone feedback reset waits for server clear before local reset', () => {
  const runtime = read(runtimePath);
  const start = runtime.indexOf('async function resetElementaryMemoAfterFeedbackSave');
  const end = runtime.indexOf('function getCurrentMemoStudentName()', start);
  const reset = runtime.slice(start, end);

  const serverClear = reset.indexOf("await clearCore.clearAfterFeedback(studentSnapshot, 'elementary_observation')");
  const localClear = reset.indexOf("clearMemoByStudent(studentSnapshot, 'elementary_observation')");
  assert.ok(serverClear >= 0);
  assert.ok(localClear > serverClear);
  assert.match(reset, /return \{ state: 'clear_failed', student: studentSnapshot, error \}/);
  assert.doesNotMatch(reset, /clearStudentNoteDraftFromSupabase/);
});

test('phone feedback save failure keeps the active observation memo instead of resetting it', () => {
  const runtime = read(runtimePath);
  const autoStart = runtime.indexOf('async function autoSaveMemoFeedback');
  const autoEnd = runtime.indexOf('function closeMemoFeedbackPopup()', autoStart);
  const autoSave = runtime.slice(autoStart, autoEnd);
  const catchStart = autoSave.indexOf('} catch (err) {');
  const catchBlock = autoSave.slice(catchStart);

  assert.ok(catchStart >= 0);
  assert.doesNotMatch(catchBlock, /resetElementaryMemoAfterFeedbackSave/);
  assert.match(catchBlock, /피드백 보관함에는 저장했지만, 서버 저장 중 오류가 발생했어요/);
});

test('phone runtime owns observation screen UI functions', () => {
  const runtime = read(runtimePath);
  [
    'returnFromObservationMemoScreen',
    'updateMemoStudentMetaDisplay',
    'forceObservationMemoControlsVisible',
    'renderMemoModeMenu',
    'toggleMemoModeMenu',
    'openObservationMemoScreenShell',
    'renderObservationMemoScreenChrome',
    'renderObservationMemoInitialView',
    'setMemoSaveStatus',
    'showPushToast'
  ].forEach(name => {
    assert.match(runtime, new RegExp('function ' + name + '\\\('));
  });
});

test('memo feedback button restores the original single-layer arrow after feedback completes', () => {
  const runtime = read(runtimePath);
  const baseCss = read(baseCssPath);
  assert.match(runtime, /btn\.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 19V5"><\/path><path d="M5 12l7-7 7 7"><\/path><\/svg>';/);
  assert.doesNotMatch(runtime, /memoFeedbackArrowCircle/);
  assert.doesNotMatch(runtime, /memoFeedbackBottomText/);
  assert.doesNotMatch(baseCss, /memoFeedbackArrowCircle/);
  assert.doesNotMatch(baseCss, /memoFeedbackBottomText/);
});


test('Hangul IME normalizer exposes stable grapheme snapshots before Action History grouping', () => {
  const source = read(rosterPath);
  const start = source.indexOf('function isObservationMemoHangulText(value)');
  const end = source.indexOf('function cancelObservationMemoPendingHangulDelete()', start);
  assert.ok(start >= 0 && end > start);

  const context = { Intl };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);

  const baseline = { value:'', selectionStart:0, selectionEnd:0 };
  const transaction = context.createObservationMemoHangulTransaction(baseline);
  const snapshots = [];

  for (const value of ['ㄱ', '가', '간', '가나', '가나다', '가나다라']) {
    const after = { value, selectionStart:value.length, selectionEnd:value.length };
    const result = context.buildObservationMemoHangulCommittedSnapshots(transaction, after);
    assert.equal(result.valid, true);
    snapshots.push(...result.snapshots.map(item => item.value));
    transaction.committedCount = result.committedCount;
    transaction.lastAfter = after;
  }

  assert.deepEqual(snapshots, ['가', '가나', '가나다']);
});


test('action history uses behavior boundaries instead of one-character snapshots', () => {
  const source = read(rosterPath);
  assert.match(source, /timestamp - action\.lastAt > OBSERVATION_MEMO_ACTION_IDLE_MS/);
  assert.match(source, /timestamp - action\.startedAt > OBSERVATION_MEMO_ACTION_MAX_MS/);
  assert.match(source, /action\.graphemeCount \|\| 0\) \+ deltaCount > OBSERVATION_MEMO_ACTION_MAX_GRAPHEMES/);
  assert.match(source, /type === 'deleting' && String\(action\.direction \|\| ''\) !== String\(meta\.direction \|\| ''\)/);
  assert.match(source, /type:'newline'/);
  assert.match(source, /type:'paste'/);
  assert.match(source, /type:'cut'/);
  assert.match(source, /type:'replace'/);
  assert.match(source, /finalizeObservationMemoCurrentAction\(\);[\s\S]*observationMemoUndoStack\.pop\(\)/);
  assert.match(source, /observationMemoRedoStack\.push\(action\)/);
  assert.match(source, /observationMemoUndoStack\.push\(action\)/);
});

test('closing only the keyboard preserves action history, while leaving the memo page resets it', () => {
  const source = read(rosterPath);
  const focusoutStart = source.indexOf("document.addEventListener('focusout'");
  const selectionStart = source.indexOf("document.addEventListener('selectionchange'", focusoutStart);
  const focusout = source.slice(focusoutStart, selectionStart);
  assert.match(focusout, /finalizeObservationMemoHistoryBoundary\(editor\)/);
  assert.doesNotMatch(focusout, /resetObservationMemoHistory\(\)/);
  assert.match(source, /observation-editor-slide-leave[\s\S]*resetObservationMemoHistory\(\);[\s\S]*renderObservationMemoRoster/);
});


test('memo utility pill keeps archive left of voice, history, and survey', () => {
  const touch = read(touchPath);
  const css = read(cssPath);
  assert.match(touch, /const ARCHIVE_ID = 'memoRecordsBtn';/);
  assert.match(touch, /const VOICE_ID = 'memoEditorVoiceBtn';/);
  assert.match(touch, /id = VOICE_ID/);
  assert.match(touch, /document\.querySelector\('#kcfVoiceBtn svg'\)/);
  assert.match(touch, /sharedMic\.outerHTML/);
  assert.match(touch, /<rect x="8" y="3" width="8" height="13" rx="4"/);
  assert.match(touch, /voice\.toggleForTarget\(editor, btn, \{[\s\S]*finalizeTranscript: organizeMemoVoiceTranscript,[\s\S]*showPanel:true,[\s\S]*panelHost:parent/);
  assert.match(touch, /\[archive, voice, history, survey\]\.forEach/);
  assert.match(touch, /promptType:'memo_voice_cleanup'/);
  assert.match(css, /#memoEditorUtilityGroup \{[\s\S]*width:226px;[\s\S]*min-width:226px;[\s\S]*max-width:226px;/);
  assert.match(css, /#memoEditorVoiceBtn svg \{[\s\S]*width:22px;[\s\S]*height:22px;[\s\S]*stroke-width:1\.9;/);
});


test('memo archive button returns as the leftmost utility without restoring automatic archive opening', () => {
  const touch = read(touchPath);
  const css = read(cssPath);
  const runtime = read(runtimePath);
  const html = read(indexPath);
  assert.match(html, /id="elementaryRecordsDropup"/);
  assert.match(touch, /const ARCHIVE_ID = 'memoRecordsBtn';/);
  assert.match(touch, /id = ARCHIVE_ID/);
  assert.match(touch, /className = 'memoRecordRoomBtn memoRecordBtn'/);
  assert.match(touch, /viewBox="24 21 80 80"/);
  assert.match(touch, /M31 52V40C31 33\.4 36\.4 28 43 28/);
  assert.match(touch, /stroke="#111111"/);
  assert.match(touch, /M31 53H97/);
  assert.match(touch, /stroke-width="5\.6"/);
  assert.match(touch, /typeof window\.toggleElementaryRecordsMenu === 'function'/);
  assert.match(touch, /\[archive, voice, history, survey\]\.forEach/);
  assert.match(css, /#memoEditorUtilityGroup #memoRecordsBtn \.memoRecordIcon \{[\s\S]*?width:23px;[\s\S]*?height:23px;[\s\S]*?transform:translateY\(-0\.5px\);/);
  assert.doesNotMatch(runtime, /openElementaryArchiveAfterDirectSave/);
});


test('memo voice capture expands the utility pill into the shared QuickNote recording window', () => {
  const css = read(cssPath);
  const shared = fs.readFileSync('kinder-feedback.css', 'utf8');
  assert.match(css, /#memoEditorUtilityGroup\.kcfVoiceCaptureMode \{[\s\S]*left:var\(--olli-phone-guide-x\);[\s\S]*right:var\(--olli-phone-guide-x\);[\s\S]*width:auto;[\s\S]*height:53px;[\s\S]*min-height:53px;/);
  assert.match(css, /#memoEditorUtilityGroup\.kcfVoiceCaptureMode > button \{[\s\S]*display:none !important;/);
  assert.match(shared, /:is\(#kinderChatFeedbackScreen, #studentMemoScreen\) \.kcfVoiceCapture \{/);
  assert.match(shared, /#studentMemoScreen #memoEditorUtilityGroup\.kcfVoiceCaptureMode/);
});


test('memo voice raw transcript is highlighted light blue with three loading dots until cleanup finishes', () => {
  const touch = read(touchPath);
  const css = read(cssPath);
  assert.match(touch, /function showMemoVoiceAiLoading\(rawTranscript, options = \{\}\)/);
  assert.match(touch, /raw\.className = 'memoVoiceAiRawTranscript'/);
  assert.match(touch, /dots\.className = 'memoVoiceAiLoadingDots'/);
  assert.match(touch, /for \(let i = 0; i < 3; i \+= 1\)/);
  assert.match(touch, /showMemoVoiceAiLoading\(transcript, context\)/);
  assert.match(touch, /hideMemoVoiceAiLoading\(\)/);
  assert.match(touch, /deferTranscriptUntilFinalized:true/);
  assert.match(css, /\.memoVoiceAiRawTranscript \{[\s\S]*?background:rgba\(10,132,255,\.14\);/);
  assert.match(css, /\.memoVoiceAiLoadingDot \{[\s\S]*?width:4px;[\s\S]*?height:4px;[\s\S]*?animation:memoVoiceAiLoadingWave/);
  assert.doesNotMatch(touch, /editor\.value\s*=\s*['"][^'"]*\.\.\.[^'"]*['"]/);
});


test('memo microphone uses the requested 22px size', () => {
  const css = read(cssPath);
  assert.match(css, /#memoEditorVoiceBtn svg \{[\s\S]*width:22px;[\s\S]*height:22px;/);
});


test('memo utility buttons are vertically centered inside the shared pill', () => {
  const css = read(cssPath);
  assert.match(css, /#memoEditorUtilityGroup \{[\s\S]*?align-items:center;/);
  assert.match(css, /#memoEditorUtilityGroup > button \{[\s\S]*?align-self:center;[\s\S]*?align-items:center;[\s\S]*?justify-content:center;/);
  assert.match(css, /#memoEditorUtilityGroup > button > svg \{[\s\S]*?display:block;[\s\S]*?margin:auto;/);
});


test('memo utility cleanup removes the old roster history owner and impossible shared-page guards', () => {
  const touch = read(touchPath);
  const css = read(cssPath);
  assert.equal((touch.match(/function ensureHistoryButton\(/g) || []).length, 1);
  assert.doesNotMatch(touch, /HISTORY_BUTTON_ID/);
  assert.doesNotMatch(touch, /HISTORY_RUNTIME_SRC/);
  assert.doesNotMatch(touch, /historyRuntimePromise/);
  assert.doesNotMatch(touch, /function forceVisible\(/);
  assert.doesNotMatch(touch, /function loadHistoryRuntime\(/);
  assert.doesNotMatch(touch, /showObservationRosterHeaderButtons/);
  assert.doesNotMatch(touch, /roster-history-1/);
  assert.doesNotMatch(css, /#observationRosterScreen \.memoHeaderActions/);
  assert.doesNotMatch(css, /#observationRosterScreen #olliMemoVersionHistoryBtn/);
  assert.doesNotMatch(css, /#observationRosterScreen #memoFeedbackBtn/);
  assert.doesNotMatch(css, /#observationRosterScreen #memoBottomAnalysisBtn/);
  assert.doesNotMatch(css, /#observationRosterScreen #memoEditorUtilityGroup/);
});


test('mobile owns previous-history button visibility and delegates module readiness to the phone adapter', () => {
  const touch = read(touchPath);
  assert.match(touch, /data-olli-history-visibility-owner', 'mobile'/);
  assert.match(touch, /window\.ensureOlliObservationMemoHistoryReady/);
  assert.match(touch, /window\.openObservationMemoVersionHistory/);
  assert.doesNotMatch(touch, /HISTORY_SRC/);
  assert.doesNotMatch(touch, /data-olli-observation-history-runtime/);
  assert.doesNotMatch(touch, /observation-memo-version-history-common\.js/);
});

test('phone history UI owns rendering only and delegates all version data operations to the shared core', () => {
  const ui = read(historyUiPath);

  assert.match(ui, /const versionHistoryCore = global\.ObservationMemoVersionHistoryCore/);
  assert.match(ui, /versionHistoryCore\.list\(\{/);
  assert.match(ui, /versionHistoryCore\.restore\(\{/);
  assert.match(ui, /olliMemoVersionHistoryOverlay/);

  assert.doesNotMatch(ui, /function makeButton\(/);
  assert.doesNotMatch(ui, /updateButtonVisibility/);
  assert.doesNotMatch(ui, /olliMemoVersionHistoryBtn/);
  assert.doesNotMatch(ui, /rpc\/olli_note_draft_version_list/);
  assert.doesNotMatch(ui, /rpc\/olli_note_draft_version_restore/);
  assert.doesNotMatch(ui, /p_session_token:/);
  assert.doesNotMatch(ui, /p_expected_revision:/);
});

test('phone adapter loads history core before phone UI and is the single history module loader', () => {
  const adapter = read(autosaveAdapterPath);
  const coreImport = adapter.indexOf("import('./observation-memo-version-history-core.js");
  const uiImport = adapter.indexOf("import('./olli-observation-version-history-phone.js");

  assert.ok(coreImport >= 0);
  assert.ok(uiImport > coreImport);
  assert.match(adapter, /global\.ensureOlliObservationMemoHistoryReady = ensureOlliObservationMemoHistoryReady/);
  assert.doesNotMatch(adapter, /observation-memo-version-history-common\.js/);
});

test('memo archive return assets are cache-busted', () => {
  const html = read(indexPath);
  assert.match(html, /olli-observation-roster-phone\.css\?v=20261001-native-keyboard-scroll-1/);
  assert.match(html, /olli-record-utility-touch\.js\?v=20260929-memo-fixed-group-1/);
});


test('feedback save resets the observation memo caret and scroll to the initial top state', () => {
  const runtime = read(runtimePath);
  const html = read(indexPath);
  assert.match(runtime, /function resetObservationMemoViewportAfterFeedbackSave\(memo\)/);
  assert.match(runtime, /editor\.setSelectionRange\(0, 0\)/);
  assert.match(runtime, /editor\.scrollTop = 0/);
  assert.match(runtime, /#studentMemoScreen \.memoPageInner/);
  assert.match(runtime, /page\.scrollTop = 0/);
  assert.match(runtime, /resizeObservationMemoEditorToContent\(\)/);
  assert.match(runtime, /memo\.value = '';\s*resetObservationMemoViewportAfterFeedbackSave\(memo\);/);
  assert.match(runtime, /requestAnimationFrame\(reset\)/);
  assert.match(runtime, /setTimeout\(reset, 80\)/);
  assert.match(html, /olli-observation-runtime\.js\?v=20260930-attendance-runtime-cleanup-1/);
});


test('observation memo keeps one scroll owner and only moves it when the caret is obscured', () => {
  const css = read(cssPath);
  const source = read(rosterPath);
  const pageRule = css.match(/#studentMemoScreen\[data-memo-body-view="editor"\] \.memoPageInner \{[\s\S]*?\}/)?.[0] || '';
  const wrapRule = css.match(/#studentMemoScreen\[data-memo-body-view="editor"\] #elementaryMemoWrap \{[\s\S]*?\}/)?.[0] || '';
  assert.match(pageRule,/overscroll-behavior-y:contain/);
  assert.match(pageRule,/touch-action:pan-y/);
  assert.match(pageRule,/overflow-anchor:none/);
  assert.doesNotMatch(wrapRule,/transform:/);
  assert.doesNotMatch(css,/--olli-observation-content-lift/);
  assert.match(source,/function ensureObservationMemoCaretVisible\(\)/);
  assert.match(source,/page\.scrollTop \+= delta/);
  assert.match(source,/function resetObservationMemoRootViewportScroll\(\)/);
  assert.match(source,/visualViewport\.addEventListener\('scroll',[\s\S]*?resetObservationMemoRootViewportScroll\(\)/);
  assert.doesNotMatch(source,/event\.pointerType === 'touch'[\s\S]{0,220}?editor\.focus\(\{ preventScroll:true \}\)/);
});
