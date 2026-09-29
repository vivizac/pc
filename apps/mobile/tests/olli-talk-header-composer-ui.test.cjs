const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const talkCss = fs.readFileSync(path.join(root, 'olli-talk-beta.css'), 'utf8');
const talkJs = fs.readFileSync(path.join(root, 'olli-talk-beta.js'), 'utf8');
const attachmentCacheJs = fs.readFileSync(path.join(root, 'olli-talk-attachment-cache-phone.js'), 'utf8');
const kinderCss = fs.readFileSync(path.join(root, 'kinder-feedback.css'), 'utf8');
const observationCss = fs.readFileSync(path.join(root, 'olli-observation-roster-phone.css'), 'utf8');
const baseCss = fs.readFileSync(path.join(root, 'olli-phone-base.css'), 'utf8');

test('Olli Talk header keeps one circular star archive button', () => {
  assert.doesNotMatch(html, /id="olliTalkSearchBtn"/);
  assert.match(html, /id="olliTalkArchiveBtn"/);
  assert.doesNotMatch(html, /id="olliTalkPushBtn"/);
  assert.match(html, /class="olliTalkArchiveIcon"[\s\S]*?<path d="M12 3\.5l2\.63 5\.33 5\.88\.85/);
  assert.match(talkCss, /\.olliTalkHeaderTools\{[\s\S]*width:46px;[\s\S]*min-width:46px;[\s\S]*max-width:46px;[\s\S]*height:46px;/);
  assert.match(talkCss, /\.olliTalkHeaderToolBtn\{[\s\S]*width:46px;[\s\S]*height:46px;[\s\S]*border-radius:999px;/);
  assert.match(talkCss, /\.olliTalkArchiveIcon\{[\s\S]*width:24px;[\s\S]*height:24px;/);
  assert.doesNotMatch(talkCss, /\.olliTalkArchiveBtn img/);
});

test('Olli Talk back icon uses the observation memo rounded chevron geometry', () => {
  for (const value of ['width:28px', 'height:28px', 'left:5.5px', 'top:12px', 'width:17px', 'height:2.5px']) {
    assert.ok(talkCss.includes(value));
    assert.ok(observationCss.includes(value));
  }
  assert.match(html, /class="olliTalkBetaBackIcon"/);
  assert.doesNotMatch(html, /class="olliTalkBetaBackBtn"[\s\S]{0,160}<svg/);
});

test('Olli Talk composer is a direct one-row layout', () => {
  assert.match(talkCss, /\.olliTalkBetaComposer\{[\s\S]*flex-direction:row;[\s\S]*align-items:flex-end/);
  assert.doesNotMatch(html, /olliTalkBetaComposerBottom/);
  assert.doesNotMatch(html, /olliTalkBetaComposerSpacer/);
});


test('Olli Talk composer shows @ while keyboard is closed and send while keyboard is open', () => {
  assert.match(html, /id="olliTalkMentionTriggerBtn"[^>]*>@<\/button>/);
  assert.match(html, /id="olliTalkBetaSendBtn"/);
  assert.match(talkCss, /\.olliTalkMentionTriggerBtn\{[\s\S]*display:inline-flex/);
  assert.match(talkCss, /\.olliTalkBetaSendBtn\{[\s\S]*display:none/);
  assert.match(talkCss, /\.olliTalkKeyboardOpen \.olliTalkMentionTriggerBtn\{[\s\S]*display:none/);
  assert.match(talkCss, /\.olliTalkKeyboardOpen \.olliTalkBetaSendBtn\{[\s\S]*display:inline-flex/);
});

test('Olli Talk mention picker uses wrapped teacher chips above the composer', () => {
  assert.match(talkCss, /\.olliTalkMentionMenu\{[\s\S]*bottom:calc\(100% \+ 8px\);[\s\S]*display:flex;[\s\S]*flex-wrap:wrap/);
  assert.match(talkCss, /\.olliTalkMentionOption\{[\s\S]*border-radius:999px;[\s\S]*background:#ECECEC/);
});


test('Olli Talk message bubble keeps compact text and curved top tail', () => {
  assert.match(talkCss, /\.olliTalkBetaBubble\{[\s\S]*?border-radius:14px;[\s\S]*?font-size:calc\(14\.5px \* var\(--olli-text-scale, 1\)\)/);
  assert.match(talkCss, /\.olliTalkBetaMessageGroupStart\.outgoing \.olliTalkBetaBubble::after\{[\s\S]*?right:-3px;[\s\S]*?top:0;[\s\S]*?width:19px;[\s\S]*?height:13px;[\s\S]*?clip-path:path\("M 0 4 C 4 4 7 6 10 9 C 12 6 15 3 19 1 C 17 4 16 7 16 11 C 12 9 9 8 6 8 C 3 8 1 7 0 6 Z"\)/);
  assert.match(talkCss, /\.olliTalkBetaBubbleMeta\{[\s\S]*?padding-bottom:0;/);
  assert.match(html, /olli-talk-beta\.css\?v=20260922-olli-themes-1/);
});

test('Phone loads the latest shared Team Talk background settings UI', () => {
  assert.match(html, /olli-settings-team-talk-common\.css\?v=20260922-olli-styles-1/);
  assert.match(html, /olli-settings-team-talk-common\.js\?v=20260922-olli-styles-1/);
});

test('Phone Team Talk supports Olli light and dark styles with blue outgoing bubbles', () => {
  assert.match(talkCss, /data-olli-talk-theme="olli-light"[\s\S]*--olli-talk-outgoing-bg:#0A84FF[\s\S]*--olli-talk-outgoing-text:#fff/);
  assert.match(talkCss, /data-olli-talk-theme="olli-dark"[\s\S]*--olli-talk-outgoing-bg:#0A84FF[\s\S]*--olli-talk-outgoing-text:#fff/);
  assert.match(talkCss, /incoming \.olliTalkBetaBubble,[\s\S]*var\(--olli-talk-incoming-bg\)/);
  assert.match(talkCss, /outgoing \.olliTalkBetaBubble\{[\s\S]*var\(--olli-talk-outgoing-bg\)/);
});


test('Team Talk bottom blur is anchored to the chat viewport, not the keyboard-following composer layer', () => {
  const viewportStart = html.indexOf('<div class="olliTalkBetaViewport">');
  const bottomBlur = html.indexOf('class="olliTalkBetaEdgeBlur olliTalkBetaEdgeBlurBottom"');
  const composerLayerStart = html.indexOf('class="olliTalkBetaComposerLayer"');
  assert.ok(viewportStart >= 0);
  assert.ok(bottomBlur > viewportStart);
  assert.ok(composerLayerStart > bottomBlur);
  assert.equal((html.match(/olliTalkBetaEdgeBlurBottom/g) || []).length, 1);
});

test('Team Talk top blur follows the selected background color with the 60 to 30 to 30 gradient', () => {
  assert.match(talkCss, /\.olliTalkBetaEdgeBlurTop\{[\s\S]*height:calc\(var\(--olli-phone-guide-top\) \+ 70px\);[\s\S]*background:linear-gradient\([\s\S]*color-mix\(in srgb, var\(--olli-talk-bg\) 60%, transparent\) 0%[\s\S]*color-mix\(in srgb, var\(--olli-talk-bg\) 30%, transparent\) 46%[\s\S]*color-mix\(in srgb, var\(--olli-talk-bg\) 30%, transparent\) 100%[\s\S]*backdrop-filter:blur\(2px\)/);
  assert.doesNotMatch(talkCss, /\.olliTalkBetaEdgeBlurTop\{[\s\S]*rgba\(255,255,255,/);
});

test('Team Talk controls keep 2px blur with a white translucent overlay layer', () => {
  assert.match(talkCss, /\.olliTalkBetaBackBtn,[\s\S]*\.olliTalkHeaderTools,[\s\S]*\.olliTalkBetaComposer\{[\s\S]*backdrop-filter:blur\(2px\);[\s\S]*-webkit-backdrop-filter:blur\(2px\);/);
  assert.match(talkCss, /\.olliTalkBetaBackBtn::before,[\s\S]*\.olliTalkHeaderTools::before,[\s\S]*\.olliTalkBetaComposer::before\{[\s\S]*background:rgba\(255,255,255,\.30\);[\s\S]*z-index:0;/);
  assert.match(talkCss, /\.olliTalkBetaBackIcon\{[\s\S]*position:relative;[\s\S]*z-index:2;/);
  assert.doesNotMatch(talkCss, /backdrop-filter:blur\(2px\)\s+saturate/);
  assert.doesNotMatch(talkCss, /brightness\(1\.05\)/);
});

test('glass controls use inner edge highlights without outer glow', () => {
  assert.match(kinderCss, /\.kcfRoundBtn\{[\s\S]*inset 0 1px 0 rgba\(255,255,255,0\.96\)[\s\S]*inset 1px 0 0 rgba\(255,255,255,0\.30\)/);
  assert.match(kinderCss, /\.kcfComposer \{[\s\S]*inset 0 1px 0 rgba\(255,255,255,0\.96\)[\s\S]*inset 1px 0 0 rgba\(255,255,255,0\.30\)/);
  assert.match(talkCss, /\.olliTalkBetaBackBtn::after,[\s\S]*\.olliTalkHeaderTools::after,[\s\S]*\.olliTalkBetaComposer::after\{[\s\S]*inset -1px 0 0 rgba\(255,255,255,\.28\)/);
  assert.doesNotMatch(talkCss, /\.olliTalkBetaBackBtn::after,[\s\S]*\.olliTalkBetaComposer::after\{[\s\S]*inset 0 1px 0 rgba\(255,255,255,\.88\)/);
});



test('archive uses Olli Coffee naming, order, and raised tab layout', () => {
  assert.match(html, /data-page-name="올리 커피"/);
  assert.match(html, /class="olliTalkArchiveTitle">올리 커피<\/div>/);
  assert.match(html, /data-archive-tab="materials"[^>]*>[\s\S]*재료주문[\s\S]*<\/button>[\s\S]*data-archive-tab="files"[^>]*>[\s\S]*수업 레시피[\s\S]*<\/button>[\s\S]*data-archive-tab="media"[^>]*>[\s\S]*포토리뷰[\s\S]*<\/button>/);
  assert.match(talkJs, /let olliTalkArchiveTab = 'materials';/);
  assert.match(talkCss, /\.olliTalkArchiveHeader\{[^\n]*max\(80px,[^\n]*66px/);
});


test('archive title shares the common 44px top-control vertical center', () => {
  assert.match(talkCss, /\.olliTalkArchiveTitle\{[^\n]*top:calc\(var\(--olli-phone-guide-top\) \+ 22px\);[^\n]*transform:translate\(-50%,-50%\)/);
  assert.match(talkCss, /\.olliTalkArchiveBackBtn\{[^\n]*top:var\(--olli-phone-guide-top\)/);
});


test('archive category tabs are pulled further upward without moving the title controls', () => {
  assert.match(html, /olli-talk-beta\.css\?v=20260924-archive-tabs-up-2/);
  assert.match(talkCss, /\.olliTalkArchiveHeader\{[^\n]*max\(80px,[^\n]*66px/);
});


test('archive tabs move directly upward instead of relying only on header height', () => {
  assert.match(html, /olli-talk-beta\.css\?v=20260924-archive-tabs-direct-up-1/);
  assert.match(talkCss, /\.olliTalkArchiveTabs\{[^\n]*margin-top:-18px/);
});


test('Work Hub title reuses the Work archive star and back button aligns with other Work pages', () => {
  assert.match(html, /data-page-name="Work Hub"/);
  assert.match(html, /class="olliTalkArchiveTitle">[\s\S]*<span>Work<\/span>[\s\S]*class="olliTalkArchiveTitleStar"[\s\S]*M12 3\.5l2\.63 5\.33 5\.88\.85[\s\S]*<span>Hub<\/span>/);
  assert.match(talkCss, /\.olliTalkArchiveBackBtn\{[^\n]*top:var\(--olli-phone-guide-top\)/);
  assert.match(talkCss, /\.olliTalkArchiveTitleStar\{[^\n]*width:20px;[^\n]*fill:#111;stroke:#111/);
});

test('archive tab labels move down independently of the tab underline', () => {
  assert.match(html, /class="olliTalkArchiveTabText">재료주문<\/span>/);
  assert.match(talkCss, /\.olliTalkArchiveTabText\{display:inline-block;transform:translateY\(5px\)\}/);
});


test('Work Hub star is filled black and active archive underline spans one exact screen third', () => {
  assert.match(talkCss, /\.olliTalkArchiveTitleStar\{[^\n]*fill:#111;stroke:#111/);
  assert.match(talkCss, /\.olliTalkArchiveTabs\{[^\n]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\);[^\n]*padding:0;/);
  assert.match(talkCss, /\.olliTalkArchiveTab\.active::after\{[^\n]*left:0;right:0;[^\n]*height:2px/);
  assert.match(html, /olli-talk-beta\.css\?v=20260924-third-tab-line-1/);
});


test('Work Hub title star is enlarged to 20px', () => {
  assert.match(talkCss, /\.olliTalkArchiveTitleStar\{[^\n]*width:20px;height:20px/);
  assert.match(html, /olli-talk-beta\.css\?v=20260924-work-star-20-1/);
});


test('Work Hub title center revision is loaded', () => {
  assert.match(talkCss, /\.olliTalkArchiveTitle\{[^\n]*top:calc\(var\(--olli-phone-guide-top\) \+ 22px\);[^\n]*align-items:center;justify-content:center/);
  assert.match(html, /olli-talk-beta\.css\?v=20260924-work-title-center-1/);
});


test('archive recipe upload is a blue capsule and composer accepts multiple files', () => {
  assert.match(html, /id="olliTalkComposerFileInput" multiple type="file"/);
  assert.match(html, /id="olliTalkArchiveUploadBtn" hidden type="button">레시피 파일 올리기<\/button>/);
  assert.match(talkCss, /\.olliTalkArchiveUploadBtn\{[^\n]*border-radius:999px;[^\n]*background:#0A84FF;color:#fff/);
});

test('chat image attachments render inline while generic files use white blue extension tiles', () => {
  assert.match(talkJs, /function isOlliTalkImageAttachment\(attachment\)/);
  assert.match(talkJs, /olliTalkBetaImageAttachmentBubble/);
  assert.match(talkJs, /async function uploadOlliTalkComposerFiles\(files\)/);
  assert.match(talkJs, /const files=Array\.from\(event\.target\?\.files\|\|\[\]\)/);
  assert.match(talkCss, /\.olliTalkBetaAttachmentIcon\{[^\n]*background:#fff;color:#0A84FF/);
  assert.match(talkCss, /\.olliTalkBetaAttachmentImageFrame\{[^\n]*width:min\(64vw,280px\)/);
});


test('Work archive resolves the last academy cache across reconnect and renders it before context validation', () => {
  assert.match(talkJs, /const OLLI_TALK_LAST_CACHE_CONTEXT_KEY = 'olli_team_chat_last_cache_context_v1'/);
  assert.match(talkJs, /function resolveOlliTalkCachedAcademyId\(preferredAcademyId\)/);
  assert.match(talkJs, /function readOlliTalkArchiveCache\(context=getOlliTalkBetaContext\(\)\)[\s\S]*resolveOlliTalkCachedAcademyId\(context\?\.academyId\)/);
  assert.match(talkJs, /const cachedPayload=readOlliTalkArchiveCache\(context\);[\s\S]*if\(!context\.sessionToken\|\|!context\.academyId\)/);
  assert.match(talkJs, /rememberOlliTalkLastCacheContext\(academyId\)/);
  assert.match(html, /olli-talk-beta\.js\?v=20260927-member-count-local-2/);
});


test('chat local-first survives reconnect context delay and avoids replacing cached content with an empty state', () => {
  assert.match(talkJs, /const cachedPayload = options\.cachedPayload \|\| \(options\.localFirst === false \? readOlliTalkMessageCache\(context\) : renderOlliTalkCachedMessages\(context\)\)/);
  assert.match(talkJs, /const renderedLocal = !!basePayload;[\s\S]*if \(!context\.sessionToken \|\| !context\.academyId\)/);
  assert.match(talkJs, /if\(!renderedLocal\)[\s\S]*setOlliTalkLoadingState\(\)/);
  assert.match(talkJs, /contextRetry:retryCount\+1/);
  assert.match(html, /olli-talk-beta\.js\?v=20260927-member-count-local-2/);
});

test('Team Chat member count renders from the shared local cache before the members RPC refresh', () => {
  assert.match(talkJs, /member_count:normalizeOlliTalkMemberCount\(cached\.member_count\)/);
  assert.match(talkJs, /member_count:cachedMemberCount,/);
  assert.match(talkJs, /function renderOlliTalkCachedMemberCount\(cachedPayload\)/);
  assert.match(talkJs, /const openCachedPayload = readOlliTalkMessageCache\(openContext\);[\s\S]*renderOlliTalkCachedMemberCount\(openCachedPayload\);[\s\S]*screen\.style\.display = 'flex'/);
  assert.match(talkJs, /async function loadOlliTalkMembers\(\)[\s\S]*olli_team_chat_members[\s\S]*member_count:memberCount[\s\S]*writeOlliTalkMessageCache\(context,nextCache\)/);
  assert.match(talkJs, /olliTalkMembers = Array\.isArray\(payload\?\.members\) \? payload\.members : \[\]/);
  assert.doesNotMatch(talkJs, /members:Array\.isArray\(cached\.members\)/);
});

test('Work Hub becomes visible before local archive rendering and server refresh', () => {
  assert.match(talkJs, /function openOlliTalkArchivePage\(event\)[\s\S]*archive\.style\.display='flex'[\s\S]*requestAnimationFrame\(\(\)=>\{[\s\S]*renderOlliTalkArchive\(\)/);
  assert.match(talkJs, /requestAnimationFrame\(\(\)=>\{[\s\S]*setTimeout\(\(\)=>\{[\s\S]*loadOlliTalkArchive\(\{renderLocal:false\}\)/);
  assert.match(talkJs, /function areOlliTalkArchivePayloadsEquivalent\(left,right\)/);
  assert.match(talkJs, /if\(olliTalkArchiveTab!=='materials'&&changed\)renderOlliTalkArchive\(\)/);
});

test('chat image blobs are reused synchronously after first load to prevent flicker', () => {
  assert.match(talkJs, /const olliTalkAttachmentResolvedBlobUrls = new Map\(\)/);
  assert.match(talkJs, /if\(olliTalkAttachmentResolvedBlobUrls\.has\(id\)\)return olliTalkAttachmentResolvedBlobUrls\.get\(id\)/);
  assert.match(talkJs, /olliTalkAttachmentResolvedBlobUrls\.set\(id,url\)/);
  assert.match(talkJs, /const resolved=id\?olliTalkAttachmentResolvedBlobUrls\.get\(id\):''/);
  assert.match(talkJs, /image\.loading='eager'/);
});


test('Work becomes visible before local cache parsing and renders only the newest 100 messages first', () => {
  assert.match(talkJs, /const OLLI_TALK_INITIAL_RENDER_LIMIT = 100/);
  assert.match(talkJs, /screen\.style\.display = 'flex'[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*setTimeout\(\(\) => \{[\s\S]*const openCachedPayload = readOlliTalkMessageCache\(openContext\)/);
  assert.match(talkJs, /renderOlliTalkServerMessages\(openCachedPayload,\{[\s\S]*messageLimit:OLLI_TALK_INITIAL_RENDER_LIMIT/);
  assert.match(talkJs, /loadOlliTalkBetaMessages\(\{[\s\S]*cachedPayload:openCachedPayload,[\s\S]*messageLimit:OLLI_TALK_INITIAL_RENDER_LIMIT/);
});


test('archive inactive tabs use a lighter weight while the active tab keeps its emphasis', () => {
  assert.match(talkCss, /\.olliTalkArchiveTab\{[^\n]*font-weight:400/);
  assert.match(talkCss, /\.olliTalkArchiveTab\.active\{[^\n]*font-weight:500/);
  assert.match(html, /olli-talk-beta\.css\?v=20260924-team-chat-weight-350-1/);
});


test('Work header shows Team Chat with member count between the top buttons', () => {
  assert.match(html, /class="olliTalkBetaTitleWrap"[\s\S]*class="olliTalkBetaTitle">Team Chat<\/span>[\s\S]*class="olliTalkBetaMemberCount" id="olliTalkBetaMemberCount"/);
  assert.doesNotMatch(html, /<span hidden id="olliTalkBetaMemberCount"/);
  assert.match(talkCss, /\.olliTalkBetaTitleWrap\{[\s\S]*top:calc\(var\(--olli-phone-guide-top\) \+ 22px\);[\s\S]*transform:translate\(-50%,-50%\)/);
  assert.match(talkCss, /\.olliTalkBetaTitle\{[\s\S]*font-size:calc\(20px \* var\(--olli-text-scale, 1\)\);[\s\S]*font-weight:350/);
  assert.match(talkCss, /\.olliTalkBetaMemberCount\{[\s\S]*color:#55585F;[\s\S]*font-size:calc\(20px \* var\(--olli-text-scale, 1\)\);[\s\S]*font-weight:400/);
});

test('Work back chevron matches the Work Hub archive back chevron size', () => {
  assert.match(talkCss, /\.olliTalkBetaBackBtn \.memoRosterBackIcon\{[\s\S]*width:21px;[\s\S]*height:21px;[\s\S]*flex:0 0 21px/);
  assert.match(talkCss, /\.olliTalkBetaBackBtn \.memoRosterBackIcon::before,[\s\S]*width:13px;[\s\S]*height:2px/);
  assert.match(talkCss, /#olliTalkArchiveScreen \.olliTalkArchiveBackIcon\{position:relative;width:21px;height:21px\}/);
  assert.match(html, /olli-talk-beta\.css\?v=20260924-team-chat-weight-350-1/);
});


test('Work and Work Hub image attachments use a phone-only IndexedDB cache before server fetch', () => {
  const cacheScriptIndex = html.indexOf('olli-talk-attachment-cache-phone.js?v=20260924-indexeddb-image-cache-1');
  const talkScriptIndex = html.indexOf('olli-talk-beta.js?v=20260924-fast-work-open-1');
  assert.ok(cacheScriptIndex >= 0);
  assert.ok(talkScriptIndex > cacheScriptIndex);

  assert.match(attachmentCacheJs, /const DB_NAME='olli_phone_attachment_cache_v1'/);
  assert.match(attachmentCacheJs, /global\.OlliTalkAttachmentCachePhone=Object\.freeze/);
  assert.match(attachmentCacheJs, /async function getBlob\(input\)/);
  assert.match(attachmentCacheJs, /async function putBlob\(input,blob,meta=\{\}\)/);
  assert.match(attachmentCacheJs, /accountId\+'::'\+academyId/);
  assert.match(attachmentCacheJs, /MAX_SCOPE_BYTES=120\*1024\*1024/);

  assert.match(talkJs, /const persistentCache=window\.OlliTalkAttachmentCachePhone/);
  assert.match(talkJs, /const cachedBlob=await persistentCache\.getBlob\(cacheInput\)/);
  assert.match(talkJs, /if\(cachedBlob\)[\s\S]*URL\.createObjectURL\(cachedBlob\)[\s\S]*return cachedUrl/);
  assert.match(talkJs, /persistentCache\.putBlob\(cacheInput,blob/);

  const cacheReadIndex = talkJs.indexOf('persistentCache.getBlob(cacheInput)');
  const networkFetchIndex = talkJs.indexOf("fetch('/api/team-talk-file?attachmentId='");
  assert.ok(cacheReadIndex >= 0);
  assert.ok(networkFetchIndex > cacheReadIndex);
});


test('Work cached images are prewarmed and decoded before page navigation', () => {
  assert.match(talkJs, /const olliTalkAttachmentPredecodedImages = new Map\(\)/);
  assert.match(talkJs, /async function getOlliTalkLocalCachedAttachmentUrl\(attachment\)/);
  assert.match(talkJs, /async function predecodeOlliTalkAttachment\(attachment\)/);
  assert.match(talkJs, /function collectOlliTalkCachedImageAttachments\(limit=24\)/);
  assert.match(talkJs, /async function prewarmOlliTalkCachedImages\(\)/);
  assert.match(talkJs, /function scheduleOlliTalkImagePrewarm\(delay=160\)/);
  assert.match(talkJs, /requestIdleCallback/);
  assert.match(talkJs, /scheduleOlliTalkImagePrewarm\(120\)/);
  assert.match(talkJs, /\.loading='eager'/);
  assert.match(html, /olli-talk-beta\.js\?v=20260927-member-count-local-2/);
});


test('Work keeps the full 500-message cache but reveals older local history in 100-message steps before server history', () => {
  assert.match(talkJs, /messages:Array\.isArray\(payload\.messages\) \? payload\.messages\.slice\(-500\) : \[\]/);
  assert.match(talkJs, /const OLLI_TALK_LOCAL_HISTORY_STEP = 100/);
  assert.match(talkJs, /const requestedMessageLimit=Math\.max\(0,Math\.floor\(Number\(options\.messageLimit\)\|\|0\)\)/);
  assert.match(talkJs, /allMessages\.slice\(-requestedMessageLimit\)/);
  assert.match(talkJs, /if\(renderedLimit>0&&renderedLimit<messages\.length\)\{[\s\S]*messageLimit:nextLimit[\s\S]*return true;[\s\S]*if\(olliTalkHistoryExhausted\)return false;/);
  assert.match(html, /olli-talk-beta\.js\?v=20260927-member-count-local-2/);
});
