'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'apps/mobile/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.css'),'utf8');
const js=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const pcJs=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const pcCss=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.css'),'utf8');

test('active mobile Team Chat composer is two rows with text first and controls second',()=>{
  assert.match(html,/class="olliTalkComposerTextRow" id="olliTalkComposerTextRow"/);
  assert.match(css,/\.olliTalkKeyboardOpen \.olliTalkComposerTextRow\{[\s\S]*grid-column:1 \/ -1;[\s\S]*grid-row:1;/);
  assert.match(css,/\.olliTalkKeyboardOpen \.olliTalkFileAddBtn\{[\s\S]*grid-row:2;/);
  assert.match(css,/\.olliTalkKeyboardOpen \.olliTalkQuickOrderBtn\{[\s\S]*grid-row:2;/);
  assert.match(css,/\.olliTalkKeyboardOpen \.olliTalkBetaSendBtn\{[\s\S]*grid-column:3;[\s\S]*grid-row:2;/);
});


test('active Team Chat keeps @ visible until the input has a sendable message',()=>{
  assert.match(js,/screen\.classList\.toggle\('olliTalkCanSend', canSend\)/);
  assert.match(css,/\.olliTalkKeyboardOpen \.olliTalkMentionTriggerBtn\{\s*display:inline-flex;/);
  assert.match(css,/\.olliTalkKeyboardOpen \.olliTalkBetaSendBtn\{\s*display:none;/);
  assert.match(css,/\.olliTalkKeyboardOpen\.olliTalkCanSend \.olliTalkMentionTriggerBtn\{\s*display:none;/);
  assert.match(css,/\.olliTalkKeyboardOpen\.olliTalkCanSend \.olliTalkBetaSendBtn\{\s*display:inline-flex;/);
});

test('teacher and Olli mentions are blue while multiline text starts after the mention only on line one',()=>{
  assert.match(css,/\.olliTalkSelectedMentionToken,[\s\S]*\.olliTalkSelectedMentionToken\.olli\{\s*color:#1687F8/);
  assert.match(css,/text-indent:var\(--olli-talk-mention-indent,0px\)/);
  assert.match(js,/getElementById\('olliTalkComposerTextRow'\)/);
  assert.match(js,/getBoundingClientRect\(\)\.width/);
});

test('mention menu restores the original in-flow row above the input',()=>{
  assert.match(css,/\.olliTalkMentionMenu\{[\s\S]*position:relative;[\s\S]*order:-1;[\s\S]*grid-column:1 \/ -1;[\s\S]*grid-row:1;[\s\S]*margin:0 0 9px;/);
  assert.doesNotMatch(css,/\.olliTalkMentionMenu\{[\s\S]*position:absolute;/);
  assert.match(css,/\.olliTalkComposerTextRow\{[\s\S]*grid-row:2;/);
  assert.match(css,/\.olliTalkKeyboardOpen \.olliTalkFileAddBtn\{[\s\S]*grid-row:3;/);
});

test('AI avatar label is Olli while sender name remains the Korean display name',()=>{
  assert.equal((js.match(/avatar\.textContent = 'Olli';/g)||[]).length,2);
  assert.doesNotMatch(js,/avatar\.textContent = '올리';/);
  assert.match(js,/createMessageText\('span', 'olliTalkBetaSenderName', '올리'\)/);
});


test('Olli profile text uses the strongest completed-bubble pink without a later black override',()=>{
  assert.match(css,/--olli-talk-olli-accent:color\(display-p3 \.9255 \.4392 \.6863\)/);
  assert.match(css,/\.olliTalkBetaAiIncomingLayout \.olliTalkBetaAiAvatar\{[\s\S]*color:var\(--olli-talk-olli-accent\)/);
  assert.doesNotMatch(css,/\.olliTalkBetaAiIncomingLayout \.olliTalkBetaAiAvatar\{[\s\S]{0,120}color:#111/);
  assert.match(pcCss,/--olli-pc-talk-olli-accent:color\(display-p3 \.9255 \.4392 \.6863\)/);
  assert.match(pcCss,/\.olliPcTeamTalkAvatar\.ai\{[^}]*color:var\(--olli-pc-talk-olli-accent\)/);
});

test('Team Chat system notice renders as an Olli bubble while keeping the Display P3 gradient',()=>{
  assert.match(js,/const isAi = type === 'ai' \|\| type === 'system';/);
  assert.match(js,/if \(type === 'system'\) \{[\s\S]*bubble\.classList\.add\('olliTalkBetaSystemBubble'\)/);
  assert.doesNotMatch(js,/message\.className = 'olliTalkBetaSystemMessage'/);
  assert.match(css,/\.olliTalkBetaSystemBubble\{[\s\S]*color\(display-p3[\s\S]*color:#fff;/);
});

test('completed or cancelled repetitive-work result stays attached below the action without a new tail',()=>{
  assert.match(js,/status==='completed'[\s\S]*confirmed\.textContent='확인';[\s\S]*confirmed\.disabled=true/);
  assert.match(js,/\['completed','cancelled'\]\.includes\(previousActionStatus\)/);
  assert.match(js,/isInlineSystemResult[\s\S]*appendOlliTalkInlineSystemResult\(previousMessage,item\)/);
  assert.match(css,/\.olliTalkBetaIncomingLayout \.olliTalkBetaInlineSystemResult\{[\s\S]*grid-column:2;[\s\S]*grid-row:4;[\s\S]*width:max-content;/);
  assert.match(css,/\.olliTalkBetaInlineSystemResult::before,[\s\S]*content:none !important;/);
});

test('mobile Team Chat assets share mention-restore cache bust revision',()=>{
  assert.match(html,/olli-talk-beta\.css\?v=20261005-mention-menu-restore-1/);
  assert.match(html,/olli-talk-beta\.js\?v=20261005-mention-menu-restore-1/);
});


test('Team Chat runs deterministic rules before calling Luna on both phone and PC',()=>{
  assert.match(js,/router\.classifyRequest\(rawCommandText\)[\s\S]*localRuleHandled[\s\S]*await interpretOlliTalkSystemLanguage/);
  assert.match(pcJs,/router\.classifyRequest\(rawCommandText\)[\s\S]*localRuleHandled[\s\S]*await interpretOlliSystemLanguage/);
});

test('first Olli response shows smaller three-dot typing indicator for at least one second',()=>{
  assert.match(js,/dot\.className = 'olliTalkBetaTypingDot'/);
  assert.match(js,/isOlliWorkflowFollowup[\s\S]*1000-\(Date\.now\(\)-olliTalkFirstReplyStartedAt\)/);
  assert.match(pcJs,/create\('span', 'olliPcTeamTalkTypingDot'\)/);
  assert.match(pcJs,/isOlliWorkflowFollowup[\s\S]*1000-\(Date\.now\(\)-firstReplyStartedAt\)/);
  assert.match(css,/\.olliTalkBetaTypingDot\{[\s\S]*width:2px;[\s\S]*height:2px;/);
  assert.match(pcCss,/\.olliPcTeamTalkTypingDot\{[^}]*width:2px;[^}]*height:2px;/);
});

test('cancelled system request uses a normal white bubble with dark text on mobile',()=>{
  assert.match(js,/\/작업\\s\*요청\.\*취소\/\.test[\s\S]*olliTalkBetaCancelSystemBubble/);
  assert.match(css,/\.olliTalkBetaCancelSystemBubble\{[\s\S]*--olli-talk-bubble-bg:#fff;[\s\S]*color:#201818;/);
});


test('mobile Team Chat keeps the newest bubble anchored above the fixed one-row or two-row composer height',()=>{
  assert.match(js,/const OLLI_TALK_COMPOSER_IDLE_HEIGHT = 47/);
  assert.match(js,/const OLLI_TALK_COMPOSER_ACTIVE_HEIGHT = 79/);
  assert.match(js,/function getOlliTalkComposerLayoutGeometry\(\)/);
  assert.match(js,/composerTop = viewportRect\.bottom - bottomGap - composerHeight/);
  assert.match(js,/function scrollOlliTalkMessageAboveComposer\(message\)/);
  assert.match(js,/geometry\.composerTop - OLLI_TALK_COMPOSER_MESSAGE_GAP/);
  assert.match(js,/scheduleOlliTalkMessageAboveComposer\(next\)/);
  assert.match(js,/scheduleOlliTalkLatestMessageAnchor\(\)/);
});


test('makeup cancellation reason prompt offers no-reason and direct-input choices without Luna',()=>{
  assert.match(js,/noReason\.textContent='사유 없음'/);
  assert.match(js,/inputButton\.textContent='사유 입력'/);
  assert.match(js,/pendingStructuredMakeupCancel=olliTalkPendingActionReason\?\.__structuredMakeupCancel/);
  assert.match(js,/return resolveOlliTalkStructuredMakeupCancelTurn\(\{/);
  assert.match(js,/return saveOlliTalkPendingTextInputReply\(context,reasonMessage,replyToMessageId\)/);
  assert.match(pcJs,/noReason\.textContent='사유 없음'/);
  assert.match(pcJs,/inputButton\.textContent='사유 입력'/);
  assert.match(pcJs,/pendingStructuredMakeupCancel=state\.pendingActionReason\?\.__structuredMakeupCancel/);
  assert.match(pcJs,/return resolveStructuredMakeupCancelTurn\(\{/);
  assert.match(pcJs,/return savePendingTextInputReply\(current,reasonMessage,replyToMessageId\)/);
  assert.match(css,/\.olliTalkBetaPendingInput\{[\s\S]*gap:6px/);
  assert.match(pcCss,/\.olliPcTeamTalkPendingInput\{[^}]*gap:6px/);
});


test('makeup cancellation preflights student and schedule before showing reason controls',()=>{
  const preflightIndex=js.indexOf("preflight=await router.prepareStructuredAction(merged");
  const pendingIndex=js.indexOf("olliTalkPendingActionReason={",preflightIndex);
  assert.ok(preflightIndex>=0);
  assert.ok(pendingIndex>preflightIndex);
  assert.match(js,/preflight\?\.handled===true && preflight\.kind==='action_rejected'/);
  assert.match(js,/rejectedMessage[\s\S]*saveOlliTalkOlliReply/);

  const pcPreflightIndex=pcJs.indexOf("preflight=await router.prepareStructuredAction(merged");
  const pcPendingIndex=pcJs.indexOf("state.pendingActionReason={",pcPreflightIndex);
  assert.ok(pcPreflightIndex>=0);
  assert.ok(pcPendingIndex>pcPreflightIndex);
  assert.match(pcJs,/preflight\?\.handled===true && preflight\.kind==='action_rejected'/);
  assert.match(pcJs,/rejectedMessage[\s\S]*saveAssistantReply/);
});


test('Team Chat keyboard layout has one direct viewport path without delayed settle or drag correction',()=>{
  assert.doesNotMatch(js,/olliTalkViewportSettleTimer/);
  assert.doesNotMatch(js,/olliTalkKeyboardBaselineBottom/);
  assert.doesNotMatch(js,/olliTalkChatGestureActive/);
  assert.doesNotMatch(js,/beginOlliTalkChatGesture/);
  assert.doesNotMatch(js,/scheduleOlliTalkViewportSettle/);
  assert.doesNotMatch(js,/setTimeout\(syncViewport/);
  assert.match(js,/window\.visualViewport\.addEventListener\('resize', \(\) => syncViewport\(\)/);
  assert.match(js,/window\.visualViewport\.addEventListener\('scroll', \(\) => syncViewport\(\)/);
  assert.match(js,/input\.addEventListener\('pointerdown', event => \{[\s\S]*document\.activeElement === input[\s\S]*event\.preventDefault\(\)[\s\S]*input\.focus\(\{ preventScroll:true \}\)/);
  assert.match(js,/input\.addEventListener\('focus',[\s\S]*syncViewport\(\{anchorLatest:true\}\)/);
  assert.match(js,/input\.addEventListener\('blur',[\s\S]*syncViewport\(\{anchorLatest:true\}\)/);
});

test('mention menu growth does not increase the reserved chat height beyond the active two-row composer contract',()=>{
  assert.match(js,/const composerHeight = active[\s\S]*OLLI_TALK_COMPOSER_ACTIVE_HEIGHT[\s\S]*OLLI_TALK_COMPOSER_IDLE_HEIGHT/);
  assert.match(js,/reserve: bottomGap \+ composerHeight \+ OLLI_TALK_COMPOSER_MESSAGE_GAP/);
  assert.doesNotMatch(js,/composerRect\.top/);
  assert.doesNotMatch(js,/ResizeObserver/);
  assert.match(js,/window\.openOlliTalkBetaPage = openOlliTalkBetaPage/);
});


test('Team Chat microphone reuses QuickNote voice and turns Olli wake word into a real mention',()=>{
  assert.match(html,/id="olliTalkBetaVoiceBtn"[\s\S]*?<rect x="8" y="3" width="8" height="13" rx="4"/);
  assert.match(js,/voice\.toggleForTarget\(input,button,\{/);
  assert.match(js,/finalizeTranscript:finalizeOlliTalkVoiceTranscript/);
  assert.match(js,/oll[iI]TalkMentionSelections\.set\(OLLI_TALK_AI_MENTION_ID, OLLI_TALK_AI_MENTION\)/);
  assert.match(js,/oll[iI]TalkMentionModeActive = true/);
  assert.match(js,/올리\\s\*야/);
  assert.match(js,/오리\\s\*야/);
  assert.match(js,/if\(!parsed\.mentionOlli\) return parsed\.text/);
  assert.doesNotMatch(js,/toggleOlliTalkVoiceInput[\s\S]{0,1600}sendOlliTalkBetaMessage\(/);
  assert.match(js,/voiceButton\.addEventListener\('pointerdown',event=>\{[\s\S]*toggleOlliTalkVoiceInput\(event\)/);
  assert.match(js,/voiceButton\.addEventListener\('click',event=>\{[\s\S]*if\(event\.detail!==0\)/);
  assert.match(css,/\.olliTalkBetaVoiceBtn\{[\s\S]*?width:33px;[\s\S]*?height:33px;/);
  assert.doesNotMatch(css,/\.olliTalkBetaVoiceBtn\.active\{[\s\S]*?background:#0A84FF;/);
  assert.match(js,/showPanel:true,[\s\S]*panelHost:composer/);
  assert.match(html,/olli-talk-beta\.css\?v=20261006-stable-anchor-1/);
  assert.match(html,/olli-talk-beta\.js\?v=20261006-voice-pointerdown-1/);
});


test('Team Chat mention icon is larger without added visual weight and voice controls align with QuickNote spacing',()=>{
  assert.match(css,/\.olliTalkMentionTriggerBtn\{[\s\S]*font-size:30px;[\s\S]*font-weight:350;[\s\S]*-webkit-text-stroke:0;/);
  assert.match(css,/\.olliTalkBetaVoiceBtn\{[\s\S]*left:-6px;/);
  assert.match(css,/\.olliTalkQuickOrderBtn\{[\s\S]*left:-6px;/);
});
