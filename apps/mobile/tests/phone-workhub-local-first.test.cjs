const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const talk = fs.readFileSync('olli-talk-beta.js', 'utf8');
const materials = fs.readFileSync('olli-talk-material-orders-mobile.js', 'utf8');
const startup = fs.readFileSync('olli-app-startup.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('Work Hub archive cache is academy scoped and account scoped', () => {
  assert.match(talk, /function getOlliTalkArchiveCacheKey\(academyId\)/);
  assert.match(talk, /olli_team_chat_archive_cache_v1:/);
  assert.match(talk, /const accountId=getOlliTalkLocalAccountId\(\);\s*if\(accountId&&String\(cached\.account_id\|\|'\'\)!==accountId\)return null;/);
});

test('Work Hub prepares the current tab from local data before exposing the archive screen', () => {
  const start = talk.indexOf('function openOlliTalkArchivePage');
  const end = talk.indexOf('function openOlliTalkQuickOrder', start);
  const body = talk.slice(start, end);

  const materialLocal = body.indexOf("renderOlliTalkArchive({localOnly:true,deferHydration:true})");
  const archiveLocalRead = body.indexOf('const cachedArchive=readOlliTalkArchiveCache(context)');
  const archiveLocalRender = body.indexOf("renderOlliTalkArchive({localOnly:true,deferHydration:true})", archiveLocalRead);
  const showArchive = body.indexOf("archive.style.display='flex'");

  assert.ok(materialLocal >= 0);
  assert.ok(archiveLocalRead >= 0);
  assert.ok(archiveLocalRender > archiveLocalRead);
  assert.ok(showArchive > materialLocal);
  assert.ok(showArchive > archiveLocalRender);
});

test('material orders can mount local-only without realtime or server refresh', () => {
  assert.match(materials, /async function mount\(target,options=\{\}\)/);
  assert.match(materials, /const cached=readCache\(context\(\)\);[\s\S]*?if\(cached\)renderPayload\(cached\);[\s\S]*?if\(options\.localOnly===true\)return true;[\s\S]*?bindRealtime\(\);[\s\S]*?await refresh/);
  assert.match(materials, /async function activate\(\)[\s\S]*?bindRealtime\(\);[\s\S]*?await refresh\(\{showLoading:false\}\)/);
});

test('material-order local cache is account scoped', () => {
  assert.match(materials, /const accountId=localAccountId\(\);\s*if\(accountId&&clean\(cached\.account_id\)!==accountId\)return null;/);
});

test('Work Hub clears previous in-memory material and archive state before using scoped local data', () => {
  assert.match(materials, /state\.items=\[\];\s*state\.summary=\{requested:0,on_hold:0,ordered:0,arrived:0\};[\s\S]*?state\.currentRole='';[\s\S]*?state\.canProcess=false;[\s\S]*?const cached=readCache\(context\(\)\)/);
  assert.match(talk, /const cachedArchive=readOlliTalkArchiveCache\(context\);\s*olliTalkArchivePayload=cachedArchive\|\|null;/);
});

test('photo review media hydration is deferred until after first Work Hub paint', () => {
  assert.match(talk, /function renderOlliTalkArchiveMedia\(body,items,options=\{\}\)/);
  assert.match(talk, /data-olli-archive-deferred-media/);
  assert.match(talk, /function hydrateOlliTalkArchiveDeferredMedia\(\)/);

  const start = talk.indexOf('function openOlliTalkArchivePage');
  const end = talk.indexOf('function openOlliTalkQuickOrder', start);
  const body = talk.slice(start, end);
  assert.match(body, /requestAnimationFrame\(\(\)=>\{\s*setTimeout\(\(\)=>\{[\s\S]*?hydrateOlliTalkArchiveDeferredMedia\(\)/);
});

test('Work Hub server refresh remains changed-only for archive and material orders', () => {
  assert.match(talk, /const changed=!areOlliTalkArchivePayloadsEquivalent\(cachedPayload,payload\);/);
  assert.match(talk, /if\(olliTalkArchiveTab!=='materials'&&changed\)renderOlliTalkArchive\(\);/);
  assert.match(materials, /const changed=materialPayloadSignature\(payload\)!==currentMaterialPayloadSignature\(\);/);
  assert.match(materials, /if\(changed\)renderPayload\(payload\);/);
});

test('saved Work Hub tab is restored before its first archive render', () => {
  assert.match(startup, /case 'olliTalkArchiveScreen':[\s\S]*?openOlliTalkArchivePage\(null, \{ tab: state\.archiveTab \}\)/);
  assert.doesNotMatch(startup, /case 'olliTalkArchiveScreen':[\s\S]{0,900}data-archive-tab/);
});

test('Work Hub Local-first bundles are cache-busted', () => {
  assert.match(html, /olli-talk-material-orders-mobile\.js\?v=20260924-workhub-local-first-1/);
  assert.match(html, /olli-talk-beta\.js\?v=20260924-workhub-local-first-1/);
  assert.match(html, /olli-app-startup\.js\?v=20260924-workhub-resume-local-first-1/);
});


test('material order card thumbnails are warmed before Work Hub paint and never lazy-load on tab remount', () => {
  assert.match(materials, /const OLLI_COFFEE_THUMB_PRELOADS=OLLI_COFFEE_THUMBS\.map\(src=>\{/);
  assert.match(materials, /const image=new Image\(\);[\s\S]*?image\.src=src;[\s\S]*?image\.decode\?\.\(\)\.catch\(\(\)=>\{\}\);/);
  assert.match(materials, /function coffeeThumb\(item,index\)[\s\S]*?image\.loading='eager';[\s\S]*?image\.decoding='sync';[\s\S]*?image\.src=OLLI_COFFEE_THUMBS\[coffeeThumbIndex\(seed\)\]/);
  assert.doesNotMatch(materials, /function coffeeThumb\(item,index\)[\s\S]{0,500}?image\.loading='lazy'/);
  assert.match(html, /olli-talk-material-orders-mobile\.js\?v=20260928-coffee-thumb-local-first-1/);
});
