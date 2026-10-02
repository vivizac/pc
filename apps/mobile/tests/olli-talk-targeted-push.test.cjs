const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const push = fs.readFileSync(path.join(root, 'olli-talk-push.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'olli-push-sw.js'), 'utf8');
const talk = fs.readFileSync(path.join(root, 'olli-talk-beta.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('targeted push infrastructure remains available while the Talk header uses search', () => {
  assert.match(push, /Notification\.requestPermission/);
  assert.match(push, /pushManager\.subscribe/);
  assert.match(push, /olli_team_chat_push_subscribe/);
  assert.match(push, /action:\s*'public-key'/);
  assert.doesNotMatch(html, /id="olliTalkPushBtn"/);
  assert.match(html, /id="olliTalkSearchBtn"/);
});

test('iPhone push permission is requested only from the installed home-screen app', () => {
  assert.match(push, /isIos\(\) && !isStandalone\(\)/);
  assert.match(push, /홈 화면에 추가/);
});

test('service worker shows a system notification only when no visible Olli window exists', () => {
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /hasVisibleWindow/);
  assert.match(sw, /showNotification/);
  assert.match(sw, /notificationclick/);
  assert.match(sw, /OLLI_TALK_OPEN_FROM_NOTIFICATION/);
});

test('push dispatch follows recipient registration for both targeted and broadcast chat', () => {
  const recipientIndex = talk.indexOf("registerOlliTalkMessageRecipients");
  const dispatchIndex = talk.indexOf("OlliTalkPush?.dispatch");
  assert.ok(recipientIndex >= 0);
  assert.ok(dispatchIndex > recipientIndex);
  assert.match(talk, /registerOlliTalkMessageRecipients\(Number\(payload\.message\.id\),mentionedIds,context\)/);
  assert.match(talk, /registerOlliTalkMessageRecipients\(messageId,\[\],context\)/);
});


test('Olli Talk Web Push explicitly requests audible notifications', () => {
  const serviceWorker = fs.readFileSync(path.join(root, 'olli-push-sw.js'), 'utf8');
  assert.match(serviceWorker, /showNotification\([\s\S]*?silent:\s*false/);
  assert.match(push, /olli-push-sw\.js\?v=20260924-app-badge-1/);
});


test('composer @ button focuses input, opens teacher picker and inserts only @teacher-name', () => {
  assert.match(talk, /function openOlliTalkMentionPicker\(/);
  assert.match(talk, /input\.setRangeText\(insertion, caret, caret, 'end'\)/);
  assert.match(talk, /await loadOlliTalkMembers\(\)/);
  assert.match(talk, /renderOlliTalkMentionMenu\(\)/);
  assert.match(talk, /const insertion = '@' \+ name \+ ' ';/);
  assert.doesNotMatch(talk, /const insertion = '@' \+ name \+ ' ' \+ honorific/);
  assert.match(talk, /'@' \+ displayName/);
});


test('push payload carries per-recipient unread badge count and service worker applies app icon badge', () => {
  const edge=fs.readFileSync(path.join(root,'supabase','functions','olli-team-chat-push','index.ts'),'utf8');
  assert.match(edge, /target\?\.unread_count/);
  assert.match(edge, /badgeCount/);
  assert.match(sw, /self\.navigator\?\.setAppBadge/);
  assert.match(sw, /data\.badgeCount/);
});


test('Work badge keeps all unread work while Work Hub badge shows material orders only', () => {
  assert.match(html, /aria-label="Work Hub"[\s\S]{0,650}data-olli-work-hub-badge/);
  assert.doesNotMatch(
    html.match(/<button[^>]*id="olliTalkArchiveBtn"[\s\S]*?<\/button>/)?.[0] || '',
    /data-olli-work-badge/
  );
  assert.match(html, /aria-label="Work 열기"[\s\S]{0,400}data-olli-work-badge/);

  const start = talk.indexOf('function setOlliTalkMentionBadge');
  const end = talk.indexOf('async function markOlliTalkMessagesRead', start);
  const badgeFlow = talk.slice(start, end);
  assert.match(badgeFlow, /querySelectorAll\('\[data-olli-work-badge\], #kcfOlliTalkBadge'\)/);
  assert.match(badgeFlow, /querySelectorAll\('\[data-olli-work-hub-badge\]'\)/);
  assert.match(badgeFlow, /setOlliTalkMentionBadge\(unreadCount,materialUnreadCount\)/);
  assert.match(badgeFlow, /setAppBadge\?\.\(value\)/);
});

test('Work Hub material read keeps using the dedicated material read RPC', () => {
  const start = talk.indexOf('async function markOlliTalkMaterialNotificationsRead');
  const end = talk.indexOf('function setOlliTalkArchiveTab', start);
  const materialRead = talk.slice(start, end);
  assert.match(materialRead, /olli_mobile_work_mark_material_read/);
  assert.match(materialRead, /olliTalkLastUnreadMaterialCount=0/);
  assert.match(materialRead, /await refreshOlliTalkMentionBadge\(\)/);
});

test('split Work and Work Hub badge bundle is cache-busted', () => {
  assert.match(html, /olli-talk-beta\.js\?v=20261002-workhub-material-badge-1/);
});
