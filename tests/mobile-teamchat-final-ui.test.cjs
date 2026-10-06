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


test('mobile Team Chat keeps new AI and teacher messages above the composer instead of forcing raw scrollHeight',()=>{
  assert.match(js,/function scrollOlliTalkMessageAboveComposer\(message\)/);
  assert.match(js,/const visibleBottom = Number\.isFinite\(composerTop\)[\s\S]*Math\.min\(chatRect\.bottom, composerTop\) - 10/);
  assert.match(js,/scheduleOlliTalkMessageAboveComposer\(next\)/);
  assert.match(js,/latestOlliTalkRenderedMessage\(chatArea\)/);
  assert.match(js,/if \(shouldFollowBottom\) \{[\s\S]*scrollOlliTalkMessageAboveComposer\(latest\)/);
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
