const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const talk = fs.readFileSync('olli-talk-beta.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('Team Chat keeps one academy-scoped message cache and validates account scope', () => {
  assert.match(talk, /function getOlliTalkMessageCacheKey\(academyId\)/);
  assert.match(talk, /olli_team_chat_cache_v1:/);
  assert.match(talk, /messages:Array\.isArray\(payload\.messages\) \? payload\.messages\.slice\(-500\) : \[\]/);
  assert.match(talk, /const accountId=getOlliTalkLocalAccountId\(\);\s*if\(accountId && String\(cached\.account_id\|\|'\'\)!==accountId\)return null;/);
  assert.doesNotMatch(talk, /olli_team_chat_first_paint/);
});

test('Team Chat renders cached content before making the Work screen visible', () => {
  const openStart = talk.indexOf('async function openOlliTalkBetaPage');
  const openEnd = talk.indexOf('async function closeOlliTalkBetaPage', openStart);
  const body = talk.slice(openStart, openEnd);

  const readLocal = body.indexOf('const openCachedPayload = readOlliTalkMessageCache(openContext)');
  const renderLocal = body.indexOf('renderOlliTalkServerMessages(openCachedPayload', readLocal);
  const showScreen = body.indexOf("screen.style.display = 'flex'", renderLocal);
  const refresh = body.indexOf('loadOlliTalkBetaMessages({', showScreen);

  assert.ok(readLocal >= 0, 'single local cache must be read during open');
  assert.ok(renderLocal > readLocal, 'cached messages must mount after the cache read');
  assert.ok(showScreen > renderLocal, 'screen must only be exposed after cached messages are mounted');
  assert.ok(refresh > showScreen, 'server refresh must begin after the local screen is exposed');
});

test('initial local render is bounded to 100 messages while the full cache stays available for history', () => {
  assert.match(talk, /const OLLI_TALK_INITIAL_RENDER_LIMIT = 100;/);
  assert.match(talk, /renderOlliTalkServerMessages\(openCachedPayload,[\s\S]*?messageLimit:OLLI_TALK_INITIAL_RENDER_LIMIT/);
  assert.match(talk, /function renderOlliTalkCachedMessages[\s\S]*?messageLimit:OLLI_TALK_INITIAL_RENDER_LIMIT/);
  assert.match(talk, /const current=olliTalkCurrentPayload\|\|readOlliTalkMessageCache\(context\)/);
  assert.match(talk, /nextLimit=Math\.min\(messages\.length,renderedLimit\+OLLI_TALK_LOCAL_HISTORY_STEP\)/);
});

test('image and link hydration are deferred past the first local paint', () => {
  assert.match(talk, /function createOlliTalkLinkPreviewCard\(url, options = \{\}\)/);
  assert.match(talk, /data-olli-deferred-preview/);
  assert.match(talk, /function createOlliTalkAttachmentMessageBubble\(item, options = \{\}\)/);
  assert.match(talk, /data-olli-deferred-image/);
  assert.match(talk, /function hydrateOlliTalkDeferredFirstPaintAssets\(\)/);
  assert.match(talk, /requestAnimationFrame\(\(\) => \{[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?hydrateOlliTalkDeferredFirstPaintAssets\(\)/);
});

test('server result only replaces the visible message list when the merged payload changed', () => {
  assert.match(talk, /const mergedPayload=basePayload\?mergeOlliTalkMessagePayloads\(basePayload,payload\):payload;/);
  assert.match(talk, /const changed=!basePayload\|\|!areOlliTalkMessagePayloadsEquivalent\(basePayload,mergedPayload\);/);
  assert.match(talk, /if\(options\.render!==false&&changed\)/);
});

test('Team Chat bundle is cache-busted', () => {
  assert.match(html, /olli-talk-beta\\.js\\?v=20260925-image-actions-1/);
});
