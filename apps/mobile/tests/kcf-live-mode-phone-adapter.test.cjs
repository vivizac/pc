const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const adapter = fs.readFileSync('olli-feedback-registration-phone-adapter.js', 'utf8');
const liveRuntime = fs.readFileSync('kinder-feedback.js', 'utf8');
const phoneCss = fs.readFileSync('kcf-auto-mode.css', 'utf8');
const liveIcon = fs.readFileSync('olli-character.svg', 'utf8');
const inboxIcon = fs.readFileSync('kcf-inbox-mode.svg', 'utf8');

test('LIVE submitted record keeps the original full-text user bubble while Inbox keeps the document card', () => {
  assert.match(adapter, /const isLiveMinute = variant === 'minute'[\s\S]*?getKinderChatFeedbackTopMode\(\) === 'live'/);
  assert.match(adapter, /if \(isLiveMinute\) \{[\s\S]*?addKinderChatMessage\('user', String\(bodyText \|\| ''\)\);[\s\S]*?return null;/);
  assert.match(adapter, /return originalAddDocumentMessage\.apply\(this, arguments\);/);
  assert.match(liveRuntime, /function addKinderChatMessage\(role, text\)[\s\S]*?if \(role === 'user'\) bubble\.textContent = messageText;/);
});

test('Phone LIVE feedback removes the separate save action', () => {
  assert.match(adapter, /querySelector\('\.kcfLiveSaveBtn'\)/);
  assert.match(adapter, /if \(saveBtn\) saveBtn\.remove\(\);/);
});

test('Phone LIVE copy reuses the existing save path automatically after copy succeeds', () => {
  const copyWrapper = adapter.match(/async function phoneCopyKinderChatFeedbackLive\(id, btn\)[\s\S]*?\n    \}/)?.[0] || '';
  assert.match(copyWrapper, /const copied = await originalCopyLive\.call\(this, id, btn\);/);
  assert.match(copyWrapper, /if \(copied !== true\) return copied;/);
  assert.match(copyWrapper, /!item\.saved && !item\.reviewed/);
  assert.match(copyWrapper, /await window\.saveKinderChatFeedbackLive\(id, null\);/);
});

test('LIVE feedback edit uses a dedicated sheet with only cancel and done below the text', () => {
  assert.match(adapter, /function ensurePhoneKcfLiveEditSheet\(\)/);
  assert.match(adapter, /overlay\.id = 'phoneKcfLiveEditOverlay'/);
  assert.match(adapter, /class=\"phoneKcfLiveEditSheet\"/);
  assert.match(adapter, /phoneKcfLiveEditInlineActions/);
  assert.match(adapter, />취소<\/button>/);
  assert.match(adapter, />완료<\/button>/);
  assert.doesNotMatch(adapter, /phoneKcfLiveEditSendBar/);
  assert.doesNotMatch(adapter, /phoneKcfLiveEditSendBtn/);
  assert.match(adapter, /submitPhoneKcfLiveEditSheet\(doneBtn\)/);
  assert.match(phoneCss, /\.phoneKcfLiveEditOverlay \{[\s\S]*?z-index:9800;/);
});

test('LIVE feedback edit focuses after the sheet becomes visible and puts the caret at the last character', () => {
  assert.match(adapter, /overlay\.style\.visibility = 'visible'/);
  assert.match(adapter, /void overlay\.offsetHeight/);
  assert.match(adapter, /focusPhoneKcfLiveEditSheetInput\(input\)/);
  assert.match(adapter, /input\.setSelectionRange\(end, end\)/);
  assert.match(adapter, /input\.scrollTop = input\.scrollHeight/);
});

test('submitted class record edit prepares data directly and opens its own sheet without focusing the TODAY composer first', () => {
  assert.match(adapter, /function preparePhoneKcfRecordEdit\(modeName, jobId, row\)/);
  assert.match(adapter, /state\.editing = \{[\s\S]*?phoneDedicatedSheet:true/);
  assert.match(adapter, /window\.editKinderChatLiveRecord = function\(jobId, row\)[\s\S]*?preparePhoneKcfRecordEdit\('live', jobId, row\)[\s\S]*?openPhoneKcfRecordEditSheet\(jobId\)/);
  assert.match(adapter, /window\.editKinderChatSubmittedRecord = function\(jobId\)[\s\S]*?preparePhoneKcfRecordEdit\('archive', jobId, null\)[\s\S]*?openPhoneKcfRecordEditSheet\(jobId\)/);
  const installRecordBlock = adapter.match(/function installPhoneKcfRecordEditSheets\(\)[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(installRecordBlock, /originalLiveEdit\.apply/);
  assert.doesNotMatch(installRecordBlock, /originalArchiveEdit\.apply/);
  assert.doesNotMatch(installRecordBlock, /restorePhoneKcfComposerAfterRecordEditSetup/);
  assert.match(phoneCss, /\.phoneKcfRecordEditOverlay \{[\s\S]*?z-index:9810;/);
});

test('dedicated edit overlays are sized and positioned from the actual visual viewport', () => {
  assert.match(adapter, /function getPhoneKcfVisibleViewportRect\(\)[\s\S]*?window\.visualViewport[\s\S]*?offsetTop[\s\S]*?offsetLeft[\s\S]*?viewport\.width[\s\S]*?viewport\.height/);
  assert.match(adapter, /function applyPhoneKcfVisibleViewport\(overlay\)[\s\S]*?--phone-kcf-vv-top[\s\S]*?--phone-kcf-vv-left[\s\S]*?--phone-kcf-vv-width[\s\S]*?--phone-kcf-vv-height/);
  assert.match(phoneCss, /\.phoneKcfLiveEditOverlay,[\s\S]*?\.phoneKcfRecordEditOverlay \{[\s\S]*?top:var\(--phone-kcf-vv-top\);[\s\S]*?left:var\(--phone-kcf-vv-left\);[\s\S]*?width:var\(--phone-kcf-vv-width\);[\s\S]*?height:var\(--phone-kcf-vv-height\);/);
  assert.match(adapter, /visualViewport\.addEventListener\('resize', schedulePhoneKcfDedicatedEditViewportSync\)/);
  assert.match(adapter, /visualViewport\.addEventListener\('scroll', schedulePhoneKcfDedicatedEditViewportSync\)/);
});

test('old keyboard-bottom inset positioning is removed from dedicated edit sheets', () => {
  assert.doesNotMatch(adapter, /phoneKcfLiveEditKeyboardBaselineBottom/);
  assert.doesNotMatch(adapter, /phoneKcfRecordEditKeyboardBaselineBottom/);
  assert.doesNotMatch(adapter, /--phone-kcf-live-edit-bottom/);
  assert.doesNotMatch(adapter, /--phone-kcf-record-edit-bottom/);
  assert.doesNotMatch(phoneCss, /--phone-kcf-live-edit-bottom/);
  assert.doesNotMatch(phoneCss, /--phone-kcf-record-edit-bottom/);
});

test('edit sheet document is locked while only the textarea remains touch-scrollable', () => {
  assert.match(adapter, /kcfDedicatedEditViewportLocked/);
  assert.match(adapter, /function preventPhoneKcfDedicatedEditBackgroundTouchMove\(event\)[\s\S]*?isPhoneKcfDedicatedEditTextarea\(event\.target\)[\s\S]*?event\.preventDefault\(\)/);
  assert.match(adapter, /document\.addEventListener\('touchmove', preventPhoneKcfDedicatedEditBackgroundTouchMove, \{ capture:true, passive:false \}\)/);
  assert.match(phoneCss, /html\.kcfDedicatedEditViewportLocked,[\s\S]*?body\.kcfDedicatedEditViewportLocked \{[\s\S]*?overflow:hidden !important;[\s\S]*?overscroll-behavior:none;/);
  assert.doesNotMatch(phoneCss, /body\.kcfDedicatedEditViewportLocked \{[\s\S]*?position:fixed/);
});

test('both edit sheets keep controls fixed inside the visible viewport and scroll only their textarea', () => {
  assert.match(phoneCss, /\.phoneKcfLiveEditSheet,[\s\S]*?\.phoneKcfRecordEditSheet \{[\s\S]*?top:var\(--vivizac-memo-top-y\);[\s\S]*?bottom:0;[\s\S]*?display:grid;[\s\S]*?grid-template-rows:auto minmax\(0,1fr\);[\s\S]*?overflow:hidden;/);
  assert.match(phoneCss, /\.phoneKcfLiveEditBody,[\s\S]*?\.phoneKcfRecordEditBody \{[\s\S]*?display:grid;[\s\S]*?grid-template-rows:minmax\(0,1fr\) auto;[\s\S]*?overflow:hidden;/);
  assert.match(phoneCss, /\.phoneKcfLiveEditInput,[\s\S]*?\.phoneKcfRecordEditInput \{[\s\S]*?height:100%;[\s\S]*?overflow-y:auto;[\s\S]*?touch-action:pan-y;/);
  assert.match(phoneCss, /\.phoneKcfLiveEditInlineActions,[\s\S]*?\.phoneKcfRecordEditInlineActions \{[\s\S]*?padding:10px 0 12px;/);
});

test('opening either edit sheet temporarily hides the underlying 1-minute feedback page and restores it on close', () => {
  assert.match(adapter, /function syncPhoneKcfBasePageVisibility\(\)[\s\S]*?kcfDedicatedEditSheetOpen/);
  assert.match(adapter, /openPhoneKcfLiveEditSheet[\s\S]*?syncPhoneKcfBasePageVisibility\(\)/);
  assert.match(adapter, /openPhoneKcfRecordEditSheet[\s\S]*?syncPhoneKcfBasePageVisibility\(\)/);
  assert.match(adapter, /closePhoneKcfLiveEditSheet[\s\S]*?syncPhoneKcfBasePageVisibility\(\)/);
  assert.match(adapter, /closePhoneKcfRecordEditSheet[\s\S]*?syncPhoneKcfBasePageVisibility\(\)/);
  assert.match(phoneCss, /body\.kcfDedicatedEditSheetOpen #kcfPersistentTopLayer,[\s\S]*?body\.kcfDedicatedEditSheetOpen #kinderChatFeedbackScreen \.kcfInner/);
});

test('record edit cancel keeps the already received feedback because discard is deferred until successful send', () => {
  const cancelBlock = adapter.match(/function cancelPhoneKcfRecordEditSheet\(\)[\s\S]*?\n\}/)?.[0] || '';
  const submitBlock = adapter.match(/async function submitPhoneKcfRecordEditSheet\(sendBtn\)[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(adapter, /capturePhoneKcfRecordFeedbackUndo/);
  assert.doesNotMatch(adapter, /restorePhoneKcfRecordFeedbackUndo/);
  assert.match(cancelBlock, /state\.editing = null/);
  assert.doesNotMatch(cancelBlock, /discardFeedbackJob/);
  assert.match(submitBlock, /await mode\.saveSubmittedRecordEdit\(\);[\s\S]*?if \(completed\) \{[\s\S]*?mode\.discardFeedbackJob\(context\.sourceJobId\)/);
});

test('record edit sheet focuses at the end and sends through the existing feedback edit save path', () => {
  assert.match(adapter, /focusPhoneKcfTextareaAtEnd\(input\)/);
  assert.match(adapter, /phoneKcfRecordEditInlineActions/);
  assert.match(adapter, /phoneKcfRecordEditSendBtn/);
  assert.match(adapter, /aria-label=\"수정한 수업기록 전송\"/);
  assert.match(adapter, /<path d=\"M12 19V5\"><\/path><path d=\"M6 11l6-6 6 6\"><\/path>/);
  assert.match(adapter, /await mode\.saveSubmittedRecordEdit\(\)/);
  assert.match(phoneCss, /\.phoneKcfRecordEditSendBtn \{[\s\S]*?background:#1677ff;[\s\S]*?color:#fff;/);
  assert.match(phoneCss, /\.phoneKcfRecordEditSendBtn svg \{[\s\S]*?width:21px;[\s\S]*?stroke-width:2\.4;/);
  assert.doesNotMatch(adapter, /phoneKcfRecordEditDoneBtn/);
});

test('record edit save suppresses ordinary composer refocus and restores the draft without focusing it', () => {
  const submitBlock = adapter.match(/async function submitPhoneKcfRecordEditSheet\(sendBtn\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(submitBlock, /const resumeValue = editing\.resumeValue \|\| '';/);
  assert.match(submitBlock, /editing\.resumeValue = '';/);
  assert.match(submitBlock, /composerInput\.value = resumeValue;/);
  assert.doesNotMatch(submitBlock, /composerInput\.focus/);
});

test('dedicated edit sheets are created lazily and edit contexts keep only values used after opening', () => {
  const decorateBlock = adapter.match(/function decoratePhoneKcfLiveMessage\(ui\)[\s\S]*?\n\}/)?.[0] || '';
  const installRecordBlock = adapter.match(/function installPhoneKcfRecordEditSheets\(\)[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(decorateBlock, /ensurePhoneKcfLiveEditSheet\(\)/);
  assert.doesNotMatch(installRecordBlock, /ensurePhoneKcfRecordEditSheet\(\)/);
  assert.match(adapter, /phoneKcfLiveEditContext = \{ id:String\(id \|\| ''\), editArea, submitting:false \};/);
  assert.match(adapter, /phoneKcfRecordEditContext = \{[\s\S]*?sourceJobId:String\(sourceJobId \|\| ''\)[\s\S]*?\};/);
});

test('LIVE waiting indicator keeps the wave motion with 9px dots', () => {
  assert.match(adapter, /kcfLiveTypingIndicator[\s\S]*?kcfLiveTypingDot[\s\S]*?kcfLiveTypingDot[\s\S]*?kcfLiveTypingDot/);
  assert.match(phoneCss, /\.kcfLiveTypingDot \{[\s\S]*?width:9px;[\s\S]*?height:9px;[\s\S]*?animation:kcfLiveTypingWave \.9s/);
  assert.match(phoneCss, /@keyframes kcfLiveTypingWave/);
});

test('LIVE and Inbox mode icons both use non-scaling 2px strokes', () => {
  assert.match(liveIcon, /stroke-width=\"2\"/);
  assert.match(liveIcon, /vector-effect=\"non-scaling-stroke\"/);
  assert.match(inboxIcon, /stroke-width=\"2\"/);
  assert.match(inboxIcon, /vector-effect=\"non-scaling-stroke\"/);
});

test('normal inline submit keyboard-completion hook is rolled back for root-cause analysis', () => {
  assert.doesNotMatch(adapter, /closeComposerAfterSuccessfulSubmit/);
  assert.doesNotMatch(adapter, /__olliPhoneSubmitCloseInstalled/);
  assert.doesNotMatch(adapter, /onKinderChatFeedbackInlineSubmitComplete/);
  assert.doesNotMatch(adapter, /isTeacherSheetOpen/);
  assert.match(adapter, /window\.renderKinderChatFeedbackCommandConfirmation = function\(\)/);
  assert.match(adapter, /function installPhoneKcfEditHooks\(\)/);
});

test('phone adapter installs only the dedicated record-edit wrappers', () => {
  const installBlock = adapter.match(/function installPhoneKcfEditHooks\(\)[\s\S]*?\n\}\)\(\);/)?.[0] || '';
  assert.match(installBlock, /installPhoneKcfRecordEditSheets\(\)/);
  assert.doesNotMatch(installBlock, /completeSuccessfulSubmit/);
  assert.doesNotMatch(installBlock, /submitKinderChatFeedback/);
});

test('write-command confirmation renders cancel and confirm buttons instead of requiring typed confirmation', () => {
  assert.match(adapter, /window\.renderKinderChatFeedbackCommandConfirmation = function\(\)/);
  assert.match(adapter, /kcfCommandConfirmActions/);
  assert.match(adapter, /cancelBtn\.textContent = '취소'/);
  assert.match(adapter, /confirmBtn\.textContent = '확인'/);
  assert.match(adapter, /submitKinderChatFeedbackCommandChoice\(choice\)/);
});
