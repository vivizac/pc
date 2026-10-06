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
  assert.match(html,/olli-talk-beta\\.css\\?v=20261006-typing-dot-3px-1/);
  assert.match(html,/olli-talk-beta\\.js\\?v=20261007-chat-layout-stability-1/);
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
  assert.match(css,/\.olliTalkBetaTypingDot\{[\s\S]*width:3px;[\s\S]*height:3px;/);
  assert.match(pcCss,/\.olliPcTeamTalkTypingDot\{[^}]*width:2px;[^}]*height:2px;/);
});

test('cancelled system request uses a normal white bubble with dark text on mobile',()=>{
  assert.match(js,/\/작업\\s\*요청\.\*취소\/\.test[\s\S]*olliTalkBetaCancelSystemBubble/);
  assert.match(css,/\.olliTalkBetaCancelSystemBubble\{[\s\S]*--olli-talk-bubble-bg:#fff;[\s\S]*color:#201818;/);
});


test('mobile Team Chat resolves initial and new-message bottom anchors before the next paint',()=>{
  assert.match(js,/const OLLI_TALK_COMPOSER_IDLE_HEIGHT = 47/);
  assert.match(js,/const OLLI_TALK_COMPOSER_ACTIVE_HEIGHT = 79/);
  assert.match(js,/function getOlliTalkComposerLayoutGeometry\(\)/);
  assert.match(js,/composerTop = viewportRect\.bottom - bottomGap - composerHeight/);
  assert.match(js,/function scrollOlliTalkMessageAboveComposer\(message\)/);
  assert.match(js,/geometry\.composerTop - OLLI_TALK_COMPOSER_MESSAGE_GAP/);
  const anchorStart=js.indexOf('function scheduleOlliTalkMessageAboveComposer(message){');
  const anchorEnd=js.indexOf('\n  function scheduleOlliTalkLatestMessageAnchor()',anchorStart);
  assert.ok(anchorStart>=0 && anchorEnd>anchorStart);
  const anchorBody=js.slice(anchorStart,anchorEnd);
  assert.match(anchorBody,/syncOlliTalkChatToComposer\(\)/);
  assert.match(anchorBody,/scrollOlliTalkMessageAboveComposer\(message\)/);
  assert.doesNotMatch(anchorBody,/requestAnimationFrame/);
  assert.match(js,/if\(openCachedPayload\)\{[\s\S]*scheduleOlliTalkLatestMessageAnchor\(\)/);
  assert.match(js,/if\(scrollMode==='initial-latest'\)\{[\s\S]*scheduleOlliTalkLatestMessageAnchor\(\)/);
  assert.match(js,/scheduleOlliTalkMessageAboveComposer\(next\)/);
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


test('Team Chat unread-only realtime updates never rebuild the whole message list',()=>{
  assert.match(js,/function areOlliTalkMessagePayloadsRenderEquivalent\(left,right\)/);
  assert.match(js,/const \{ unread_count, \.\.\.renderable \}=item/);
  assert.match(js,/const renderChanged=!basePayload\|\|!areOlliTalkMessagePayloadsRenderEquivalent\(basePayload,mergedPayload\)/);
  assert.match(js,/if\(options\.render!==false&&renderChanged\)/);
  assert.match(js,/if\(options\.render!==false&&changed\)syncOlliTalkRenderedUnreadCounts\(mergedPayload\)/);
  assert.match(js,/function syncOlliTalkRenderedUnreadCounts\(payload\)[\s\S]*badge\.style\.visibility='hidden'/);
});

test('Team Chat same-minute grouping hides the previous time without removing its layout slot',()=>{
  const markStart=js.indexOf('function markOlliTalkRenderedMessageConnectedToNext(message){');
  const markEnd=js.indexOf('\n  function appendOlliTalkInlineSystemResult',markStart);
  assert.ok(markStart>=0&&markEnd>markStart);
  const markBody=js.slice(markStart,markEnd);
  assert.match(markBody,/time\.style\.visibility='hidden'/);
  assert.doesNotMatch(markBody,/\.remove\(\)/);
  assert.match(js,/const messageTime=createMessageText\('div','olliTalkBetaMessageTime'/);
  assert.match(js,/if\(connectedToNext\)\{[\s\S]*messageTime\.style\.visibility='hidden'/);
});

test('Team Chat typing indicator uses one anchor owner and preserves its bottom when the reply replaces it',()=>{
  assert.match(js,/function syncOlliTalkAssistantTypingIndicator\(options = \{\}\)/);
  assert.match(js,/if\(options\.anchor!==false\) scheduleOlliTalkMessageAboveComposer\(typing\)/);
  assert.match(js,/syncOlliTalkAssistantTypingIndicator\(\{anchor:false\}\)/);
  const replaceStart=js.indexOf('function replaceOlliTalkAssistantTypingWithMessage(item, currentMemberId){');
  const replaceEnd=js.indexOf('\n  function appendOlliTalkPersistedMessage',replaceStart);
  assert.ok(replaceStart>=0&&replaceEnd>replaceStart);
  const replaceBody=js.slice(replaceStart,replaceEnd);
  assert.match(replaceBody,/const typingBottom=typing\.getBoundingClientRect\(\)\.bottom/);
  assert.match(replaceBody,/const growth=nextBottom-typingBottom/);
  assert.match(replaceBody,/if\(growth>0\.5\)/);
  assert.doesNotMatch(replaceBody,/scheduleOlliTalkMessageAboveComposer\(next\)/);
});

test('Team Chat link preview follows the bottom only once after its final layout settles',()=>{
  assert.match(js,/return 'ready'/);
  assert.match(js,/return 'pending'/);
  assert.match(js,/const followFinalLayout=\(\)=>\{/);
  assert.match(js,/const imageState=setOlliTalkLinkPreviewImage/);
  assert.match(js,/imageState!=='pending'/);
  const applyStart=js.indexOf('function applyOlliTalkLinkPreview(card,url,preview){');
  const applyEnd=js.indexOf('\n  function loadOlliTalkLinkPreview',applyStart);
  assert.ok(applyStart>=0&&applyEnd>applyStart);
  const applyBody=js.slice(applyStart,applyEnd);
  assert.equal((applyBody.match(/scheduleOlliTalkLatestMessageAnchor\(\)/g)||[]).length,1);
  const imageStart=js.indexOf('async function hydrateOlliTalkAttachmentImage(frame,image,attachment){');
  const imageEnd=js.indexOf('\n  function observeOlliTalkAttachmentImage',imageStart);
  assert.ok(imageStart>=0&&imageEnd>imageStart);
  assert.doesNotMatch(js.slice(imageStart,imageEnd),/scheduleOlliTalkLatestMessageAnchor/);
});

test('mobile Team Chat runtime JavaScript parses without syntax errors',()=>{
  assert.doesNotThrow(()=>new Function(js));
});

test('Team Chat idle state never keeps a dynamic inline chat reserve',()=>{
  const syncStart=js.indexOf('function syncOlliTalkChatToComposer(){');
  const syncEnd=js.indexOf('\n  function scheduleOlliTalkChatToComposer()',syncStart);
  assert.ok(syncStart>=0 && syncEnd>syncStart);
  const syncBody=js.slice(syncStart,syncEnd);
  assert.match(syncBody,/if \(!isOlliTalkComposerActive\(\)\) \{[\s\S]*removeProperty\('--olli-talk-chat-reserve'\)[\s\S]*return;/);
  assert.match(syncBody,/setProperty\('--olli-talk-chat-reserve'/);
});

test('Team Chat clears stale chat reserve both before opening and when leaving',()=>{
  assert.match(js,/const screen = getScreen\(\);[\s\S]{0,180}screen\.style\.removeProperty\('--olli-talk-chat-reserve'\);[\s\S]{0,180}syncOlliTalkContrastTheme\(\)/);
  const closeStart=js.indexOf('async function closeOlliTalkBetaPage(event){');
  const closeEnd=js.indexOf('\n  async function openOlliTalkContextPage',closeStart);
  assert.ok(closeStart>=0 && closeEnd>closeStart);
  const closeBody=js.slice(closeStart,closeEnd);
  assert.match(closeBody,/screen\?\.style\.removeProperty\('--olli-talk-chat-reserve'\)/);
  assert.match(closeBody,/if \(input\) input\.blur\(\)/);
});

test('Team Chat first layout uses the real idle composer reserve before JavaScript measurement',()=>{
  assert.match(css,/--olli-talk-chat-reserve:calc\(var\(--olli-phone-guide-bottom, max\(10px, env\(safe-area-inset-bottom\)\)\) \+ 57px\)/);
});

test('Team Chat hidden cache render never anchors until the screen is visible',()=>{
  assert.match(js,/if\(scrollMode==='initial-latest'\)\{[\s\S]*if \(isOlliTalkBetaVisible\(\)\) scheduleOlliTalkLatestMessageAnchor\(\)/);
  assert.match(js,/if\(openCachedPayload\)\{[\s\S]*scheduleOlliTalkLatestMessageAnchor\(\)/);
});

test('Team Chat deferred first-paint link previews do not pull the chat bottom again',()=>{
  assert.match(js,/card\.dataset\.olliSuppressAutoAnchor='1'/);
  assert.match(js,/const suppressAutoAnchor=String\(card\.dataset\.olliSuppressAutoAnchor\|\|''\)==='1'/);
  assert.match(js,/const keepBottom=!suppressAutoAnchor&&!!chatArea&&isOlliTalkChatNearBottom/);
});

test('Team Chat keyboard opening follows the latest bubble without restoring generic viewport anchoring',()=>{
  assert.match(js,/let olliTalkKeyboardFollowLatest = false/);
  assert.match(js,/visualViewport\.addEventListener\('resize',[\s\S]*olliTalkKeyboardFollowLatest && isOlliTalkComposerActive\(\)[\s\S]*scheduleOlliTalkLatestMessageAnchor\(\)/);
  assert.match(js,/input\.addEventListener\('focus',[\s\S]*olliTalkKeyboardFollowLatest = true;[\s\S]*scheduleOlliTalkLatestMessageAnchor\(\)/);
  assert.match(js,/input\.addEventListener\('blur',[\s\S]*olliTalkKeyboardFollowLatest = false;[\s\S]*syncViewport\(\)/);
});

test('Team Chat viewport and keyboard changes never own chat scroll position',()=>{
  assert.doesNotMatch(js,/olliTalkViewportSettleTimer/);
  assert.doesNotMatch(js,/olliTalkKeyboardBaselineBottom/);
  assert.doesNotMatch(js,/olliTalkChatGestureActive/);
  assert.doesNotMatch(js,/beginOlliTalkChatGesture/);
  assert.doesNotMatch(js,/scheduleOlliTalkViewportSettle/);
  assert.doesNotMatch(js,/setTimeout\(syncViewport/);
  assert.match(js,/window\.visualViewport\.addEventListener\('resize', \(\) => \{[\s\S]*syncViewport\(\)/);
  assert.match(js,/window\.visualViewport\.addEventListener\('scroll', \(\) => syncViewport\(\)/);
  assert.match(js,/input\.addEventListener\('pointerdown', event => \{[\s\S]*document\.activeElement === input[\s\S]*event\.preventDefault\(\)[\s\S]*input\.focus\(\{ preventScroll:true \}\)/);
  assert.match(js,/input\.addEventListener\('focus',[\s\S]*syncViewport\(\)/);
  assert.match(js,/input\.addEventListener\('blur',[\s\S]*syncViewport\(\)/);
  const viewportStart=js.indexOf('function syncViewport(){');
  const viewportEnd=js.indexOf('\n  function bindViewport()',viewportStart);
  assert.ok(viewportStart>=0 && viewportEnd>viewportStart);
  const viewportBody=js.slice(viewportStart,viewportEnd);
  assert.doesNotMatch(viewportBody,/scrollTop\s*=/);
  assert.doesNotMatch(viewportBody,/scheduleOlliTalkLatestMessageAnchor/);
  assert.doesNotMatch(js,/syncViewport\(\{anchorLatest:true\}\)/);
});

test('mention menu growth does not increase the reserved chat height beyond the active two-row composer contract',()=>{
  assert.match(js,/const composerHeight = active[\s\S]*OLLI_TALK_COMPOSER_ACTIVE_HEIGHT[\s\S]*OLLI_TALK_COMPOSER_IDLE_HEIGHT/);
  assert.match(js,/reserve: bottomGap \+ composerHeight \+ OLLI_TALK_COMPOSER_MESSAGE_GAP/);
  assert.doesNotMatch(js,/composerRect\.top/);
  assert.doesNotMatch(js,/ResizeObserver/);
  assert.match(js,/window\.openOlliTalkBetaPage = openOlliTalkBetaPage/);
});


test('Team Chat connected incoming bubbles use the visible sender identity and omit repeated sender DOM',()=>{
  assert.match(js,/return 'incoming:' \+ \(senderName \|\| senderMemberId \|\| 'unknown'\)/);
  assert.match(js,/if \(!connectedToPrevious\) incomingLayout\.appendChild\(createOlliTalkSenderProfile\(senderName\)\)/);
  assert.match(js,/if \(!connectedToPrevious\) \{[\s\S]*avatar\.textContent = 'Olli'/);
});

test('Team Chat mention placeholder shortens to the actual remaining width with an ellipsis',()=>{
  assert.match(js,/const OLLI_TALK_INPUT_PLACEHOLDER = '메시지를 입력하세요'/);
  assert.match(js,/function syncOlliTalkInputPlaceholder\(\)/);
  assert.match(js,/availableWidth = Math\.max\(0, input\.clientWidth - mentionIndent/);
  assert.match(js,/input\.placeholder = low > 0 \? full\.slice\(0, low\) \+ ellipsis : ellipsis/);
  assert.match(css,/\.olliTalkMentionAwaitingMessage \.olliTalkBetaInput\{[\s\S]*white-space:nowrap;[\s\S]*overflow-x:hidden;/);
});

test('Team Chat send keeps the established pointerdown flow without extra touch timing overrides',()=>{
  assert.doesNotMatch(js,/sendButton\.addEventListener\('touchstart'/);
  assert.match(js,/sendButton\.addEventListener\('pointerdown', event => \{[\s\S]*sendOlliTalkBetaMessage\(event\)/);
  assert.match(js,/await loadOlliTalkBetaMessages\([\s\S]{0,700}input\.focus\(\{ preventScroll:true \}\)/);
  assert.match(html,/olli-talk-beta\\.js\\?v=20261007-chat-layout-stability-1/);
});

test('Team Chat groups adjacent messages only when sender and displayed minute are identical',()=>{
  assert.match(js,/function getOlliTalkMessageMinuteKey\(value\)/);
  assert.match(js,/previousMinute === currentMinute/);
  assert.doesNotMatch(js,/diff >= 0 && diff < 60 \* 1000/);
  assert.match(js,/isOlliTalkConnectedRenderedMessage\(lastRendered, item, currentMemberId\)/);
  assert.match(js,/markOlliTalkRenderedMessageConnectedToNext\(lastRendered\)/);
  assert.match(js,/const connectedToNext = isOlliTalkConnectedMessage\(item, nextItem, currentMemberId\)/);
  assert.match(js,/const messageTime=createMessageText\('div','olliTalkBetaMessageTime'/);
  assert.match(js,/if\(connectedToNext\)\{[\s\S]*messageTime\.style\.visibility='hidden'/);
  assert.match(css,/\.olliTalkBetaMessageConnected \.olliTalkBetaSender\{[\s\S]*display:none;/);
  assert.match(html,/olli-talk-beta\\.css\\?v=20261006-typing-dot-3px-1/);
  assert.match(html,/olli-talk-beta\\.js\\?v=20261007-chat-layout-stability-1/);
});

test('Team Chat voice capture anchors directly to the screen bottom instead of following the shrinking visual viewport',()=>{
  assert.match(css,/#olliTalkBetaScreen\.kcfVoiceCaptureMode \.olliTalkBetaComposerLayer\{[\s\S]*position:absolute;[\s\S]*inset:0;[\s\S]*width:auto;[\s\S]*height:auto;/);
  assert.match(html,/olli-talk-beta\\.css\\?v=20261006-typing-dot-3px-1/);
});

test('Team Chat send starts on pointerdown before the active composer can blur and collapse',()=>{
  assert.match(js,/sendButton\.addEventListener\('pointerdown', event => \{[\s\S]*sendOlliTalkBetaMessage\(event\)/);
  assert.match(js,/sendButton\.addEventListener\('click', event => \{[\s\S]*if \(event\.detail !== 0\)/);
  assert.match(js,/async function sendOlliTalkBetaMessage\(event\)\{[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);/);
  assert.match(html,/olli-talk-beta\\.js\\?v=20261007-chat-layout-stability-1/);
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
  assert.match(html,/olli-talk-beta\\.css\\?v=20261006-typing-dot-3px-1/);
  assert.match(html,/olli-talk-beta\\.js\\?v=20261007-chat-layout-stability-1/);
});


test('Team Chat mention icon is larger without added visual weight and voice controls align with QuickNote spacing',()=>{
  assert.match(css,/\.olliTalkMentionTriggerBtn\{[\s\S]*font-size:30px;[\s\S]*font-weight:350;[\s\S]*-webkit-text-stroke:0;/);
  assert.match(css,/\.olliTalkBetaVoiceBtn\{[\s\S]*left:-6px;/);
  assert.match(css,/\.olliTalkQuickOrderBtn\{[\s\S]*left:-6px;/);
});
