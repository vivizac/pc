const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'olli-talk-beta.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'olli-talk-beta.css'), 'utf8');

test('Team Talk composer places the selected mention token immediately before the message textarea', () => {
  const prefixIndex=html.indexOf('id="olliTalkSelectedMentionPrefix"');
  const inputIndex=html.indexOf('id="olliTalkBetaInput"');
  assert.ok(prefixIndex>=0 && inputIndex>prefixIndex);
  assert.match(css,/\.olliTalkSelectedMentionPrefix\{[\s\S]*?margin-right:\.38em[\s\S]*?color:#1687F8/);
});

test('Olli Talk supports targeted member mention selection and badge', () => {
  assert.match(source, /olli_team_chat_members/);
  assert.match(source, /olli_team_chat_set_mentions/);
  assert.match(source, /olli_team_chat_mention_summary/);
  assert.match(source, /olli_team_chat_mark_read/);
  assert.match(html, /id="kcfOlliTalkBadge"/);
  assert.match(html, /id="olliTalkMentionMenu"/);
});

test('Olli Talk can create PC academy tasks from an owner-addressed task list', () => {
  assert.match(source, /parseOlliTalkTaskItems/);
  assert.match(source, /member\.role === 'owner'/);
  assert.match(source, /olli_academy_tasks_create_from_chat/);
});

test('general chat does not increment a badge client-side', () => {
  assert.doesNotMatch(source, /setOlliTalkMentionBadge\([^)]*messages\.length/);
});


test('Olli Talk routes Olli-prefixed messages through the shared schedule command router and stores an AI reply', () => {
  assert.match(source, /source:'olli_talk'/);
  assert.match(source, /OlliCommandRouter/);
  assert.match(source, /olli_team_chat_send_ai/);
  assert.match(source, /message_type \|\| 'text'/);
  assert.match(source, /type === 'ai'/);
  assert.match(html, /id="olliTalkOlliTriggerBtn"/);
  assert.match(html, /id="olliTalkOlliTriggerBtn"[^>]*>봇<\/button>/);
  assert.doesNotMatch(html, /id="olliTalkOlliPrefix"/);
});

test('teacher mention regex escaping remains valid', () => {
  assert.match(source, /function escapeRegExp\(value\)/);
  assert.ok(source.includes("'\\\\test('teacher mention regex escaping remains valid', () => {
  assert.match(source, /replace\(\/\[\.\*\+\?\^\$\(\)\|\[\\\]\{\}\\\\\]\/g, '\\\\$&'\)/);
});'"));
  assert.doesNotMatch(source, /async function callOlliTalkRpc\(name, params\).*escapeRegExp/);
});

test('mobile moves shared one-minute operational commands to Olli Talk', () => {
  assert.match(source, /window\.__olliCommandsMovedToTalk = true/);
});


test('Team Talk marks all visible messages read and renders per-message unread counts', () => {
  assert.match(source, /olli_team_chat_mark_read/);
  assert.match(source, /item\?\.unread_count/);
  assert.match(source, /olliTalkBetaUnreadCount/);
});

test('Team Talk header uses the feedback title pattern and beta guide', () => {
  assert.match(html, /비비작 팀톡/);
  assert.match(html, /class="olliTalkBetaSub">beta<\/div>/);
  assert.match(html, /id="olliTalkBetaMemberCount"/);
});

test('Olli chat avatar uses Olli text instead of the old character image', () => {
  assert.match(source, /avatar\.textContent = 'Olli'/);
  assert.doesNotMatch(source, /avatarImg\.src = 'olli-character\.svg/);
});


test('Team Talk shows unread count on both outgoing and incoming human messages', () => {
  assert.match(source, /const unreadCount = isAi \? 0 : Math\.max/);
});

test('Team Talk renders URLs as clean clickable links inside the normal bubble', () => {
  assert.match(source, /function createOlliTalkMessageBubble/);
  assert.match(source, /olliTalkBetaLinkOnly/);
  assert.match(source, /link\.target = '_blank'/);
});


test('Team Talk builds rich server-backed link preview cards', () => {
  assert.match(source, /\/api\/link-preview\?url=/);
  assert.match(source, /olliTalkBetaLinkPreviewCard/);
  assert.match(source, /olliTalkBetaLinkPreviewImage/);
});

test('Team Talk header and chat layer do not use visual viewport geometry', () => {
  const css = fs.readFileSync(path.join(root, 'olli-talk-beta.css'), 'utf8');
  const viewport = css.match(/#olliTalkBetaScreen \.olliTalkBetaViewport\{([\s\S]*?)\}/)?.[1] || '';
  const header = css.match(/#olliTalkBetaScreen \.olliTalkBetaHeader\{([\s\S]*?)\}/)?.[1] || '';
  assert.match(viewport, /position:absolute/);
  assert.match(viewport, /inset:0/);
  assert.match(viewport, /height:100%/);
  assert.doesNotMatch(viewport, /--olli-talk-vv-/);
  assert.match(header, /top:0/);
});


test('Team Talk groups same-sender messages inside one minute and tails only group starts', () => {
  assert.match(source, /diff >= 0 && diff < 60 \* 1000/);
  assert.match(source, /olliTalkBetaMessageConnected/);
  assert.match(source, /olliTalkBetaMessageGroupStart/);
});

test('Team Talk keeps composer visible while the keyboard viewport moves', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(source, /olliTalkViewportMoving/);
  assert.match(source, /scheduleOlliTalkViewportSettle/);
  assert.doesNotMatch(css, /olliTalkViewportMoving \.olliTalkBetaComposerWrap\{[\s\S]*?opacity:0/);
});


test('Team Talk one-minute grouping uses the first bubble in the group', () => {
  assert.match(source, /let groupStartItem = null/);
  assert.match(source, /isOlliTalkConnectedMessage\(groupStartItem, item/);
});

test('Team Talk no longer hides the focused composer during keyboard motion', () => {
  const css = fs.readFileSync(path.join(root, 'olli-talk-beta.css'), 'utf8');
  assert.doesNotMatch(css, /#olliTalkBetaScreen\.olliTalkViewportMoving \.olliTalkBetaComposerWrap\{[\s\S]*?opacity:0/);
  assert.doesNotMatch(css, /#olliTalkBetaScreen\.olliTalkViewportMoving \.olliTalkBetaComposerWrap\{[\s\S]*?visibility:hidden/);
  assert.doesNotMatch(css, /#olliTalkBetaScreen\.olliTalkViewportMoving \.olliTalkBetaComposerWrap\{[\s\S]*?display:none/);
});


test('Team Talk physically ends the chat scroller at the measured composer top', () => {
  const start = source.indexOf('function syncOlliTalkChatToComposer');
  const end = source.indexOf('function scheduleOlliTalkChatToComposer', start);
  const body = source.slice(start, end);
  assert.match(body, /composerWrap\.getBoundingClientRect\(\)/);
  assert.match(body, /viewport\.getBoundingClientRect\(\)/);
  assert.match(body, /--olli-talk-chat-bottom-gap/);
  assert.doesNotMatch(body, /--olli-talk-chat-reserve/);
  assert.doesNotMatch(body, /olliTalkKeyboardOpen/);
  assert.doesNotMatch(body, /getOlliTalkKeyboardOffset/);
});

test('Team Talk header stays fixed while the message scroller ends above composer', () => {
  const css = fs.readFileSync(path.join(root, 'olli-talk-beta.css'), 'utf8');
  assert.match(css, /--olli-talk-chat-bottom-gap:74px/);
  assert.match(css, /bottom:var\(--olli-talk-chat-bottom-gap, 74px\)/);
  assert.doesNotMatch(css, /--olli-talk-chat-reserve/);
  assert.match(css, /#olliTalkBetaScreen \.olliTalkBetaHeader\{[\s\S]*?transition:none/);
});


test('Team Talk message scroller is physically bounded above the composer', () => {
  const css = fs.readFileSync(path.join(root, 'olli-talk-beta.css'), 'utf8');
  const area = css.match(/#olliTalkBetaScreen \.olliTalkBetaChatArea\{([\s\S]*?)\}/)?.[1] || '';
  assert.match(area, /position:absolute/);
  assert.match(area, /top:0/);
  assert.match(area, /bottom:var\(--olli-talk-chat-bottom-gap, 74px\)/);
  assert.match(area, /padding:[\s\S]*?16px[\s\S]*?12px/);
  assert.doesNotMatch(area, /--olli-talk-chat-reserve/);
  assert.match(area, /overflow-y:auto/);
  assert.match(area, /overscroll-behavior-y:contain/);
  assert.match(area, /touch-action:pan-y/);
});




test('Team Talk locks composer viewport after the keyboard finishes opening', () => {
  const start = source.indexOf('function syncViewport');
  const end = source.indexOf('function bindViewport', start);
  const body = source.slice(start, end);
  assert.match(source, /let olliTalkComposerViewportLock = null/);
  assert.match(source, /function lockOlliTalkComposerViewport\(\)/);
  assert.match(source, /function scheduleOlliTalkComposerViewportLock\(\)/);
  assert.match(body, /keyboardTracking = inputFocused[\s\S]*?olliTalkKeyboardTransitionActive/);
  assert.match(body, /scheduleOlliTalkComposerViewportLock\(\)/);
  assert.match(body, /syncOlliTalkComposerViewport\(\);/);
});

test('Team Talk chat position tracking no longer subscribes directly to visualViewport', () => {
  const start = source.indexOf('function bindOlliTalkChatComposerTracking');
  const end = source.indexOf('function getOlliTalkViewportBottom', start);
  const body = source.slice(start, end);
  assert.doesNotMatch(body, /visualViewport/);
  assert.match(body, /ResizeObserver/);
});

test('Team Talk composer is a dedicated visualViewport layer with one bottom owner', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(html,/id="olliTalkBetaComposerLayer"/);
  assert.match(source,/function syncOlliTalkComposerViewport/);
  const blocks=[...css.matchAll(/#olliTalkBetaScreen \.olliTalkBetaComposerWrap\{([\s\S]*?)\}/g)].map(m=>m[1]);
  assert.equal(blocks.filter(block=>/bottom:/.test(block)).length,1);
});
test('Team Talk header groups independent search and archive buttons', () => {
  assert.match(html,/class="olliTalkHeaderTools"/);
  assert.match(html,/id="olliTalkSearchBtn"/);
  assert.match(html,/id="olliTalkArchiveBtn"/);
  assert.match(html,/kcf-inbox-mode\.svg/);
});
test('Team Talk archive provides media, class files, material orders and upload', () => {
  assert.match(html,/팀톡 자료실/);
  assert.match(html,/data-archive-tab="media"/);
  assert.match(html,/data-archive-tab="files"/);
  assert.match(html,/data-archive-tab="materials"/);
  assert.doesNotMatch(html,/data-archive-tab="links"/);
  assert.match(html,/id="olliTalkArchiveUploadBtn"/);
  assert.match(source,/olli_team_chat_archive/);
  assert.match(source,/OlliMobileTeamTalkMaterialOrders/);
  assert.match(source,/api\/team-talk-file/);
});


test('Team Talk class-file upload supports 20 MB and uses signed direct Storage upload', () => {
  const api=fs.readFileSync(path.join(root,'api','team-talk-file.js'),'utf8');
  assert.match(source,/20\*1024\*1024/);
  assert.match(source,/callOlliTalkFileApi\('prepare'/);
  assert.match(source,/method:'PUT'/);
  assert.match(source,/callOlliTalkFileApi\('finalize'/);
  assert.match(api,/MAX_FILE_BYTES = 20 \* 1024 \* 1024/);
  assert.match(api,/object\/upload\/sign/);
  assert.doesNotMatch(api,/readRaw\(req,MAX_FILE_BYTES\)/);
});


test('Team Talk does not lock html/body with position fixed', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.doesNotMatch(source,/setOlliTalkRootScrollLocked/);
  assert.doesNotMatch(css,/olli-talk-root-locked/);
});

test('Team Talk header tools match record-room grouped action pill geometry', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  const tools=css.match(/#olliTalkBetaScreen \.olliTalkHeaderTools\{([\s\S]*?)\}/)?.[1]||'';
  assert.match(tools,/width:104px/);
  assert.match(tools,/height:46px/);
  assert.match(tools,/background:#fff/);
  assert.match(tools,/0 2px 12px rgba\(0,0,0,\.10\)/);
});

test('Connected Team Talk bubbles keep a small positive gap', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(css,/\.olliTalkBetaMessageConnected\{\s*margin-top:4px/);
  assert.doesNotMatch(css,/\.olliTalkBetaMessageConnected\{\s*margin-top:-/);
});

test('Team Talk archive header aligns to shared phone header position variables', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(css,/#olliTalkArchiveScreen \.olliTalkArchiveBackBtn\{[\s\S]*?top:var\(--vivizac-memo-top-y\)/);
  assert.match(css,/#olliTalkArchiveScreen \.olliTalkArchiveTitle\{[\s\S]*?top:calc\(var\(--vivizac-memo-top-y\) \+ 4px\)/);
});

test('Team Talk header search and archive icons are enlarged inside the shared pill', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(css,/\.olliTalkSearchBtn svg\{[\s\S]*?width:27px;[\s\S]*?height:27px/);
  assert.match(css,/\.olliTalkArchiveBtn img\{[\s\S]*?width:27px;[\s\S]*?height:27px/);
});


test('Team Talk visualViewport scroll reuses the locked composer geometry', () => {
  const start=source.indexOf('function bindViewport');
  const end=source.indexOf('function resizeInput',start);
  const body=source.slice(start,end);
  assert.match(body,/visualViewport\.addEventListener\('scroll', \(\) => \{[\s\S]*?if \(olliTalkComposerViewportLock\)[\s\S]*?syncOlliTalkComposerViewport\(\);[\s\S]*?return;/);
  assert.doesNotMatch(body,/visualViewport\.addEventListener\('scroll', syncOlliTalkComposerViewport/);
});

test('Team Talk moves chat content by the exact composer delta at every scroll position', () => {
  const start=source.indexOf('function syncOlliTalkChatToComposer');
  const end=source.indexOf('function scheduleOlliTalkChatToComposer',start);
  const body=source.slice(start,end);
  assert.match(source,/let olliTalkLastComposerTop = null/);
  assert.match(body,/const composerDelta = previousComposerTop - currentComposerTop/);
  assert.match(body,/chatArea\.scrollTop = Math\.max\(0, Number\(chatArea\.scrollTop \|\| 0\) \+ composerDelta\)/);
  assert.doesNotMatch(body,/isOlliTalkChatNearBottom|followBottom/);
});

test('Team Talk realtime refresh preserves middle scroll and follows only when near bottom', () => {
  const rtStart=source.indexOf('function bindOlliTalkRealtime');
  const rtEnd=source.indexOf('function bindOlliTalkMentionBadgeRealtime',rtStart);
  const realtime=source.slice(rtStart,rtEnd);
  assert.match(realtime,/scrollMode:'follow-if-near-bottom'/);
  assert.match(source,/const previousScrollTop = Math\.max/);
  assert.match(source,/const wasNearBottom = isOlliTalkChatNearBottom/);
  assert.match(source,/chatArea\.scrollTop = previousScrollTop/);
});


test('Team Talk composer has a reusable + file button before the message input', () => {
  assert.match(html,/id="olliTalkFileAddBtn"/);
  assert.match(html,/id="olliTalkComposerFileInput"/);
  const plusIndex=html.indexOf('id="olliTalkFileAddBtn"');
  const inputIndex=html.indexOf('id="olliTalkBetaInput"');
  assert.ok(plusIndex>=0 && plusIndex<inputIndex);
  assert.match(source,/composerFileAddButton\.addEventListener\('click'/);
  assert.match(source,/uploadOlliTalkArchiveFile\(file\)/);
});

test('Team Talk + bot and mention buttons use a warm light gray background', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(css,/\.olliTalkFileAddBtn,[\s\S]*?\.olliTalkOlliTriggerBtn,[\s\S]*?\.olliTalkMentionTriggerBtn\{[\s\S]*?background:#F3F2EF/);
});

test('Team Talk composer classifies image and video uploads as media', () => {
  assert.match(source,/uploadKind=\/\^\(image\|video\)\\\//);
  assert.match(source,/kind:uploadKind/);
});

test('Record-room Team Talk icon is nudged slightly left for academy management and attendance header', () => {
  const baseCss=fs.readFileSync(path.join(root,'olli-phone-base.css'),'utf8');
  assert.match(baseCss,/#recordRoomScreen \.recordOlliTalkIcon \{[\s\S]*?transform:translateX\(-2px\)/);
});


test('Team Talk composer action buttons use a very light gray background and thinner bot/mention text', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(css,/\.olliTalkFileAddBtn,[\s\S]*?\.olliTalkOlliTriggerBtn,[\s\S]*?\.olliTalkMentionTriggerBtn\{[\s\S]*?background:#FAFAF8/);
  assert.match(css,/\.olliTalkOlliTriggerBtn\{[\s\S]*?font-weight:500/);
  assert.match(css,/\.olliTalkMentionTriggerBtn\{[\s\S]*?font-weight:400/);
});


test('Team Talk keyboard settling uses composer geometry only and keeps no old transition anchor state', () => {
  const start = source.indexOf('function finishOlliTalkViewportTransition');
  const end = source.indexOf('function scheduleOlliTalkViewportSettle', start);
  const body = source.slice(start, end);
  assert.match(body, /syncOlliTalkChatToComposer\(\)/);
  assert.doesNotMatch(source, /olliTalkViewportTransitionComposerTop|olliTalkViewportTransitionChatScrollTop|olliTalkViewportTransitionUserTouchedChat|olliTalkFollowBottomAfterViewportSettle/);
});

test('Team Talk direct first touch focuses like mention without cancelling tap or caret placement', () => {
  const start = source.indexOf("input.addEventListener('pointerdown'");
  const end = source.indexOf("input.addEventListener('input'", start);
  const body = source.slice(start, end);
  assert.match(body, /event\.pointerType === 'touch'/);
  assert.match(body, /document\.activeElement !== input/);
  assert.match(body, /input\.focus\(\{ preventScroll:true \}\)/);
  assert.doesNotMatch(body, /event\.preventDefault\(\)/);
});

test('Team Talk locked composer geometry is authoritative during viewport pan', () => {
  const start=source.indexOf('function syncOlliTalkComposerViewport');
  const end=source.indexOf('function getOlliTalkViewportBottom',start);
  const body=source.slice(start,end);
  assert.match(body,/if \(olliTalkComposerViewportLock && options\.followKeyboard !== true\)[\s\S]*?applyOlliTalkComposerViewportGeometry\(layer, olliTalkComposerViewportLock\);[\s\S]*?return;/);
  assert.match(source,/function releaseOlliTalkComposerViewportLock\(\)/);
});


test('Team Talk uses the uploaded reference gray for chat background', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(css,/--olli-talk-bg:#666D77/);
  assert.match(css,/#olliTalkBetaScreen\{[\s\S]*?background:#666D77/);
  assert.match(css,/\.olliTalkBetaViewport\{[\s\S]*?background:#666D77/);
  assert.match(css,/rgba\(102,109,119,1\)/);
});

test('Team Talk composer utility buttons are white and header tools reuse composer glass', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(css,/\.olliTalkFileAddBtn,[\s\S]*?\.olliTalkOlliTriggerBtn,[\s\S]*?\.olliTalkMentionTriggerBtn\{[\s\S]*?background:#FFFFFF/);
  const tools=css.match(/#olliTalkBetaScreen \.olliTalkHeaderTools\{([\s\S]*?)\}/)?.[1]||'';
  assert.match(tools,/var\(--olli-talk-glass-start\)/);
  assert.match(tools,/backdrop-filter:blur\(20px\) saturate\(155%\) brightness\(1\.10\)/);
});

test('Team Talk search and academy settings icons are visually nudged left only', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  const baseCss=fs.readFileSync(path.join(root,'olli-phone-base.css'),'utf8');
  assert.match(css,/\.olliTalkSearchBtn svg\{[\s\S]*?transform:translateX\(-2px\)/);
  assert.match(baseCss,/\.recordAcademyMiniIcon svg\{[\s\S]*?transform: translateX\(-2px\)/);
});


test('Team Talk buttons render without box shadows', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  const back=css.match(/#olliTalkBetaScreen \.olliTalkBetaBackBtn\{([\s\S]*?)\}/)?.[1]||'';
  const tools=css.match(/#olliTalkBetaScreen \.olliTalkHeaderTools\{([\s\S]*?)\}/)?.[1]||'';
  const archiveBack=css.match(/#olliTalkArchiveScreen \.olliTalkArchiveBackBtn\{([\s\S]*?)\}/)?.[1]||'';
  const archiveUpload=css.match(/#olliTalkArchiveScreen \.olliTalkArchiveUploadBtn\{([\s\S]*?)\}/)?.[1]||'';
  assert.match(back,/box-shadow:none/);
  assert.match(tools,/box-shadow:none/);
  assert.match(archiveBack,/box-shadow:none/);
  assert.match(archiveUpload,/box-shadow:none/);
});


test('Team Talk search and archive glass has no shadow and reduced blur', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  const tools=css.match(/#olliTalkBetaScreen \.olliTalkHeaderTools\{([\s\S]*?)\}/)?.[1]||'';
  assert.match(tools,/box-shadow:none/);
  assert.match(tools,/backdrop-filter:blur\(8px\) saturate\(135%\) brightness\(1\.06\)/);
  assert.match(tools,/-webkit-backdrop-filter:blur\(8px\) saturate\(135%\) brightness\(1\.06\)/);
  assert.doesNotMatch(tools,/0 0 22px/);
  assert.doesNotMatch(tools,/blur\(20px\)/);
});


test('Team Talk glass uses no backdrop blur and remains transparent', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.doesNotMatch(css,/backdrop-filter:blur/);
  assert.doesNotMatch(css,/-webkit-backdrop-filter:blur/);
  assert.match(css,/--olli-talk-glass-start:rgba\(255,255,255,\.44\)/);
  assert.match(css,/--olli-talk-glass-end:rgba\(255,255,255,\.12\)/);
  assert.match(css,/rgba\(255,255,255,\.22\) 46%/);
});


test('Team Talk chat owns iOS vertical gestures like one-minute feedback', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  const area=css.match(/#olliTalkBetaScreen \.olliTalkBetaChatArea\{([\s\S]*?)\}/)?.[1]||'';
  assert.match(area,/overflow-y:auto/);
  assert.match(area,/overscroll-behavior-y:contain/);
  assert.match(area,/touch-action:pan-y/);
  assert.match(css,/#olliTalkBetaScreen \.olliTalkBetaChatArea::after\{[\s\S]*?width:1px;[\s\S]*?height:1px/);
});

test('Team Talk unlocks composer on blur and follows the keyboard until it actually closes', () => {
  const start=source.indexOf('function syncViewport');
  const end=source.indexOf('function bindViewport',start);
  const body=source.slice(start,end);
  assert.match(source,/input\.addEventListener\('blur',[\s\S]*?releaseOlliTalkComposerViewportLock\(\);[\s\S]*?olliTalkKeyboardTransitionActive = true/);
  assert.match(body,/if \(keyboardOpen\) \{[\s\S]*?if \(!inputFocused\) \{[\s\S]*?syncOlliTalkComposerViewport\(\{ followKeyboard:true \}\)/);
  assert.match(body,/if \(!keyboardOpen && !inputFocused\) \{[\s\S]*?releaseOlliTalkComposerViewportLock\(\);[\s\S]*?olliTalkKeyboardTransitionActive = false/);
});


test('Team Talk freezes composer and viewport correction while the user drags chat', () => {
  assert.match(source,/let olliTalkChatGestureActive = false/);
  assert.match(source,/function syncOlliTalkComposerViewport\(options = \{\}\)\{[\s\S]{0,120}olliTalkChatGestureActive && options\.force !== true/);
  assert.match(source,/if \(olliTalkChatGestureActive\) \{[\s\S]{0,120}olliTalkLastViewportSignature = signature;[\s\S]{0,80}return;/);
  assert.match(source,/chatArea\.addEventListener\('pointerdown', beginOlliTalkChatGesture/);
  assert.match(source,/window\.addEventListener\('touchend', endOlliTalkChatGesture/);
  assert.match(source,/syncOlliTalkComposerViewport\(\{ force:true \}\)/);
});

test('Team Talk cancels vertical touch drag inside composer instead of freezing viewport after it starts', () => {
  assert.match(source,/const composer = input\.closest\('\.olliTalkBetaComposer'\)/);
  assert.match(source,/composer\.addEventListener\('touchstart',[\s\S]{0,260}composerTouchStartY/);
  assert.match(source,/composer\.addEventListener\('touchmove',[\s\S]{0,620}deltaY < 6 \|\| deltaY <= deltaX[\s\S]{0,260}event\.preventDefault\(\)/);
  assert.match(source,/composer\.addEventListener\('touchmove',[\s\S]{0,900}\{ passive:false \}/);
  assert.doesNotMatch(source,/inputTouchDragActive|inputTouchStartY/);
  assert.doesNotMatch(source,/input\.addEventListener\('touchmove',[\s\S]{0,500}beginOlliTalkChatGesture\(\)/);
  assert.match(source,/input\.addEventListener\('focus',[\s\S]{0,220}captureOlliTalkKeyboardBaseline\(true\)/);
});



test('Team Talk has separate top and bottom chat blur layers', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(html,/olliTalkBetaEdgeBlurTop/);
  assert.match(html,/olliTalkBetaEdgeBlurBottom/);
  assert.match(css,/\.olliTalkBetaEdgeBlurTop\{[\s\S]*?height:calc\(max\(170px/);
  assert.match(css,/\.olliTalkBetaEdgeBlurBottom\{[\s\S]*?height:104px/);
  assert.match(css,/\.olliTalkBetaEdgeBlurTop\{[\s\S]*?backdrop-filter:blur\(12px\)/);
  assert.match(css,/\.olliTalkBetaEdgeBlurBottom\{[\s\S]*?backdrop-filter:blur\(12px\)/);
});


test('Team Talk input and top buttons restore the exact pre-3bc glass values', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(css,/--olli-talk-glass-start:rgba\(255,255,255,\.66\)/);
  assert.match(css,/--olli-talk-glass-end:rgba\(255,255,255,\.30\)/);
  assert.match(css,/--olli-talk-glass-border:rgba\(255,255,255,\.88\)/);

  const back=css.match(/#olliTalkBetaScreen \.olliTalkBetaBackBtn\{([\s\S]*?)\}/)?.[1]||'';
  const composer=css.match(/#olliTalkBetaScreen \.olliTalkBetaComposer\{([\s\S]*?)\}/)?.[1]||'';
  const tools=css.match(/#olliTalkBetaScreen \.olliTalkHeaderTools\{([\s\S]*?)\}/)?.[1]||'';

  assert.match(back,/rgba\(255,255,255,\.46\) 46%/);
  assert.match(back,/backdrop-filter:blur\(20px\) saturate\(155%\) brightness\(1\.10\)/);
  assert.match(composer,/rgba\(255,255,255,\.46\) 46%/);
  assert.match(composer,/backdrop-filter:blur\(20px\) saturate\(155%\) brightness\(1\.10\)/);
  assert.match(tools,/rgba\(255,255,255,\.46\) 46%/);
  assert.match(tools,/backdrop-filter:blur\(8px\) saturate\(135%\) brightness\(1\.06\)/);
});

test('Team Talk top and bottom chat blur overlays remain after restoring controls', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(css,/\.olliTalkBetaEdgeBlurTop\{/);
  assert.match(css,/\.olliTalkBetaEdgeBlurBottom\{/);
});


test('Team Talk edge blur is slightly reduced to 9px', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(css,/\.olliTalkBetaEdgeBlurTop\{[\s\S]*?backdrop-filter:blur\(9px\)/);
  assert.match(css,/\.olliTalkBetaEdgeBlurBottom\{[\s\S]*?backdrop-filter:blur\(9px\)/);
});

test('Team Talk system chrome switches contrast for dark and light backgrounds', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(css,/--olli-talk-system-pill-bg:rgba\(255,255,255,\.14\)/);
  assert.match(css,/#olliTalkBetaScreen\[data-olli-talk-theme="light"\]/);
  assert.match(css,/--olli-talk-system-pill-bg:#E9E9E6/);
  assert.match(css,/--olli-talk-control-shadow:/);
  assert.match(css,/box-shadow:var\(--olli-talk-control-shadow\)/);
  assert.match(source,/function syncOlliTalkContrastTheme\(\)/);
  assert.match(source,/getOlliTalkRelativeLuminance/);
  assert.match(source,/window\.setOlliTalkBackgroundColor/);
});


test('Team Talk top blur ends around beta label instead of extending deep into chat', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(css,/\.olliTalkBetaEdgeBlurTop\{[\s\S]*?height:calc\(var\(--vivizac-memo-top-y\) \+ 40px\)/);
  assert.match(css,/\.olliTalkBetaHeader\{[\s\S]*?height:calc\(var\(--vivizac-memo-top-y\) \+ 40px\)/);
});

test('Team Talk date divider has extra top spacing', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(css,/\.olliTalkBetaDateDivider\{[\s\S]*?margin:14px 0 18px/);
});

test('Team Talk bot and mention labels are slightly smaller', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(css,/\.olliTalkOlliTriggerBtn\{[\s\S]*?font-size:15px/);
  assert.match(css,/\.olliTalkMentionTriggerBtn\{[\s\S]*?font-size:21px/);
});

test('Team Talk archive title is shortened', () => {
  assert.match(html,/data-page-name="팀톡 자료실"/);
  assert.match(html,/class="olliTalkArchiveTitle">팀톡 자료실<\/div>/);
});


test('Team Talk mention picker expands inside the composer instead of floating above it', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  const composerStart=html.indexOf('class="olliTalkBetaComposer"');
  const menuIndex=html.indexOf('id="olliTalkMentionMenu"');
  const inputIndex=html.indexOf('id="olliTalkBetaInput"');
  assert.ok(composerStart>=0 && menuIndex>composerStart && menuIndex<inputIndex);
  const menu=css.match(/#olliTalkBetaScreen \.olliTalkMentionMenu\{([\s\S]*?)\}/)?.[1]||'';
  assert.match(menu,/position:relative/);
  assert.match(menu,/flex:0 0 100%/);
  assert.doesNotMatch(menu,/bottom:/);
  assert.doesNotMatch(menu,/box-shadow:[\s\S]*0 12px/);
  assert.match(source,/scheduleOlliTalkChatToComposer\(\)/);
});

test('Team Talk bot mode uses the existing bot button as a black toggle and no prefix chip', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.doesNotMatch(html,/id="olliTalkOlliPrefix"/);
  assert.match(html,/id="olliTalkOlliTriggerBtn"[^>]*aria-pressed="false"/);
  assert.match(source,/trigger\.classList\.toggle\('active', olliTalkOlliModeActive\)/);
  assert.match(source,/trigger\.setAttribute\('aria-pressed'/);
  assert.match(css,/\.olliTalkOlliTriggerBtn\.active,[\s\S]*?background:#111;[\s\S]*?color:#fff/);
});


test('Mobile Team Talk material orders reuse PC material RPCs and expand details inline', () => {
  const material=fs.readFileSync(path.join(root,'olli-talk-material-orders-mobile.js'),'utf8');
  const materialCss=fs.readFileSync(path.join(root,'olli-talk-material-orders-mobile.css'),'utf8');
  assert.match(material,/olli_team_material_requests_list/);
  assert.match(material,/olli_team_material_request_create/);
  assert.match(material,/olli_team_material_request_set_status/);
  assert.match(material,/data-material-filter="requested"/);
  assert.match(material,/data-material-filter="ordered"/);
  assert.match(material,/data-material-filter="arrived"/);
  assert.doesNotMatch(material,/data-material-filter-select/);
  assert.match(material,/state\.expandedId=state\.expandedId===id\?'':id/);
  assert.match(material,/재료 요청 등록/);
  assert.match(material,/name="purchase_url"/);
  assert.match(materialCss,/\.olliMobileMatItemCard\.expanded/);
});

test('Archive-specific link tab renderer is removed but chat link previews remain', () => {
  assert.doesNotMatch(source,/function renderOlliTalkArchiveLinks/);
  assert.doesNotMatch(source,/function createOlliTalkArchiveLinkCard/);
  assert.match(source,/function createOlliTalkLinkPreviewCard/);
});


test('Material order realtime is torn down when leaving its archive tab', () => {
  assert.match(source,/if\(!materialMode\)[\s\S]*?OlliMobileTeamTalkMaterialOrders\?\.destroy/);
  assert.match(source,/function closeOlliTalkArchivePage[\s\S]*?OlliMobileTeamTalkMaterialOrders\?\.destroy/);
});


test('Team Chat keeps older history accessible instead of truncating display to 50 messages', () => {
  assert.match(source, /messages:Array\.isArray\(payload\.messages\) \? payload\.messages\.slice\(-500\)/);
  assert.match(source, /p_limit:100/);
  assert.match(source, /async function loadOlderOlliTalkMessages\(\)/);
  assert.match(source, /p_before_message_id:oldestId/);
  assert.match(source, /scrollTop>96/);
  assert.match(source, /scrollMode:'preserve-prepend'/);
});

test('messages without a teacher target register broadcast recipients while targeted messages keep selected member ids', () => {
  assert.match(source, /async function registerOlliTalkMessageRecipients\(messageId,memberIds/);
  assert.match(source, /registerOlliTalkMessageRecipients\(Number\(payload\.message\.id\),mentionedIds,context\)/);
  assert.match(source, /registerOlliTalkMessageRecipients\(messageId,\[\],context\)/);
});


test('Team Talk captures composer top before keyboard open and clears it after keyboard close', () => {
  assert.match(source,/input\.addEventListener\('focus',[\s\S]{0,320}olliTalkLastComposerTop = Number\.isFinite\(composerTop\) \? composerTop : null/);
  const start=source.indexOf('function syncViewport');
  const end=source.indexOf('function bindViewport',start);
  const body=source.slice(start,end);
  assert.match(body,/if \(!keyboardOpen && !inputFocused\)[\s\S]*?olliTalkLastComposerTop = null/);
});
