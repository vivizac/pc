const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'olli-talk-beta.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('Olli Talk can create PC academy tasks from an owner-addressed task list', () => {
  assert.match(source, /parseOlliTalkTaskItems/);
  assert.match(source, /member\.role === 'owner'/);
  assert.match(source, /olli_academy_tasks_create_from_chat/);
});

test('general chat does not increment a badge client-side', () => {
  assert.doesNotMatch(source, /setOlliTalkMentionBadge\([^)]*messages\.length/);
});


test('teacher mention regex escaping remains valid', () => {
  const start=source.indexOf('  function escapeRegExp(value){');
  const end=source.indexOf('\n  function resolveMentionedMembers',start);
  assert.ok(start>=0&&end>start,'the production mention escaping function must be present');
  const escape=vm.runInNewContext('('+source.slice(start,end).trim()+')');
  for(const name of ['김민서','교사(A)','지점+이름','이름[1]','x.y','\\name','^$']){
    const pattern=new RegExp('^'+escape(name)+'$');
    assert.equal(pattern.test(name),true,name);
    assert.equal(pattern.test(name+'다른이름'),false,name);
  }
});

test('mobile moves shared one-minute operational commands to Olli Talk', () => {
  assert.match(source, /window\.__olliCommandsMovedToTalk = true/);
});


test('Team Talk marks all visible messages read and renders per-message unread counts', () => {
  assert.match(source, /olli_team_chat_mark_read/);
  assert.match(source, /item\?\.unread_count/);
  assert.match(source, /olliTalkBetaUnreadCount/);
});

test('Olli chat avatar uses Olli text instead of the old character image', () => {
  assert.match(source, /avatar\.textContent = 'Olli'/);
  assert.doesNotMatch(source, /avatarImg\.src = 'olli-character\.svg/);
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


test('Team Talk keeps chat viewport full height and uses measured bottom padding to screen edge', () => {
  const css = fs.readFileSync(path.join(root, 'olli-talk-beta.css'), 'utf8');
  const area = css.match(/#olliTalkBetaScreen \.olliTalkBetaChatArea\{([\s\S]*?)\}/)?.[1] || '';
  assert.match(area, /margin:0 auto/);
  assert.match(area, /var\(--olli-talk-chat-reserve, 74px\)/);
  assert.doesNotMatch(area, /margin:0 auto var\(--olli-talk-chat-reserve/);
  assert.match(area, /overflow-anchor:none/);
});

test('Team Talk composer is a dedicated visualViewport layer with one bottom owner', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(html,/id="olliTalkBetaComposerLayer"/);
  assert.match(source,/function syncOlliTalkComposerViewport/);
  const blocks=[...css.matchAll(/#olliTalkBetaScreen \.olliTalkBetaComposerWrap\{([\s\S]*?)\}/g)].map(m=>m[1]);
  assert.equal(blocks.filter(block=>/bottom:/.test(block)).length,1);
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

test('Team Talk composer has a reusable + file button before the message input', () => {
  assert.match(html,/id="olliTalkFileAddBtn"/);
  assert.match(html,/id="olliTalkComposerFileInput"/);
  const plusIndex=html.indexOf('id="olliTalkFileAddBtn"');
  const inputIndex=html.indexOf('id="olliTalkBetaInput"');
  assert.ok(plusIndex>=0 && plusIndex<inputIndex);
  assert.match(source,/composerFileAddButton\.addEventListener\('click'/);
  assert.match(source,/uploadOlliTalkArchiveFile\(file\)/);
});

test('Record-room Team Talk icon is nudged slightly left for academy management and attendance header', () => {
  const baseCss=fs.readFileSync(path.join(root,'olli-phone-base.css'),'utf8');
  assert.match(baseCss,/#recordRoomScreen \.recordOlliTalkIcon \{[\s\S]*?transform:translateX\(-2px\)/);
});


test('Team Talk chat owns iOS vertical gestures like one-minute feedback', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  const area=css.match(/#olliTalkBetaScreen \.olliTalkBetaChatArea\{([\s\S]*?)\}/)?.[1]||'';
  assert.match(area,/overflow-y:auto/);
  assert.match(area,/overscroll-behavior-y:contain/);
  assert.match(area,/touch-action:pan-y/);
  assert.match(css,/#olliTalkBetaScreen \.olliTalkBetaChatArea::after\{[\s\S]*?width:1px;[\s\S]*?height:1px/);
});

test('Team Talk top and bottom chat blur overlays remain after restoring controls', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(css,/\.olliTalkBetaEdgeBlurTop\{/);
  assert.match(css,/\.olliTalkBetaEdgeBlurBottom\{/);
});


test('Team Talk date divider has extra top spacing', () => {
  const css=fs.readFileSync(path.join(root,'olli-talk-beta.css'),'utf8');
  assert.match(css,/\.olliTalkBetaDateDivider\{[\s\S]*?margin:14px 0 18px/);
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
