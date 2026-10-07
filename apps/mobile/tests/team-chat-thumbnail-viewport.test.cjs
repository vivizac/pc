const fs=require('node:fs');
const test=require('node:test');
const assert=require('node:assert/strict');

const beta=fs.readFileSync('olli-talk-beta.js','utf8');
const cache=fs.readFileSync('olli-talk-attachment-cache-phone.js','utf8');

test('Team Chat image list is thumbnail-first and viewport-driven',()=>{
  assert.match(beta,/variant=thumbnail/);
  assert.match(beta,/IntersectionObserver/);
  assert.match(beta,/rootMargin:'900px 0px 900px 0px'/);
  assert.match(beta,/observeOlliTalkAttachmentImage/);
  assert.doesNotMatch(beta,/scheduleOlliTalkImagePrewarm/);
  assert.doesNotMatch(beta,/olliTalkAttachmentPredecodedImages/);
});

test('persistent phone cache stores thumbnail variants with LRU access time',()=>{
  assert.match(cache,/DB_VERSION=3/);
  assert.match(cache,/if\(Number\(event\?\.oldVersion\|\|0\)<2\)[\s\S]*?store\.clear\(\)/);
  assert.match(cache,/variant:'thumbnail'|normalizeVariant/);
  assert.match(cache,/last_accessed_at/);
  assert.match(cache,/MAX_SCOPE_ITEMS=1000/);
  assert.match(cache,/store\.clear\(\)/);
  assert.match(cache,/async function removeAttachment\(input\)/);
  assert.match(cache,/removeAttachment,/);
});


test('stale local-first attachment metadata still asks the server for a thumbnail',()=>{
  const start=beta.indexOf('async function getOlliTalkAttachmentPreviewBlobUrl');
  const end=beta.indexOf('async function downloadOlliTalkAttachment',start);
  const body=beta.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.doesNotMatch(body,/if\(!hasThumbnail\)return getOlliTalkAttachmentBlobUrl/);
  assert.match(body,/variant=thumbnail/);
  assert.match(body,/X-Olli-Asset-Variant/);
  assert.match(body,/assetVariant==='thumbnail'/);
  assert.match(body,/olliTalkAttachmentPreviewFallbackIds\.add\(id\)/);
  assert.match(body,/rememberOlliTalkResolvedBlobUrl\(olliTalkAttachmentResolvedBlobUrls/);
});


test('viewport hydration owns lazy loading so hidden iOS previews cannot stall forever',()=>{
  const start=beta.indexOf('function loadOlliTalkThumbnailIntoImage');
  const end=beta.indexOf('async function hydrateOlliTalkAttachmentImage',start);
  const body=beta.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(body,/image\.loading='eager'/);
  assert.match(body,/image\.loading='eager';[\s\S]*image\.src=url/);
});


test('broken Team Chat thumbnails stay hidden until a real image load succeeds',()=>{
  const css=fs.readFileSync('olli-talk-beta.css','utf8');
  const html=fs.readFileSync('index.html','utf8');
  const start=beta.indexOf('function loadOlliTalkThumbnailIntoImage');
  const end=beta.indexOf('function observeOlliTalkAttachmentImage',start);
  const body=beta.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(body,/image\.loading='eager';[\s\S]*image\.hidden=true;[\s\S]*image\.onload=ready;[\s\S]*image\.onerror=fail;[\s\S]*image\.src=url/);
  assert.match(body,/image\.removeAttribute\('src'\)/);
  assert.match(body,/await loadOlliTalkThumbnailIntoImage\(image,url\)/);
  assert.match(body,/image\.hidden=false;[\s\S]*fallback\.hidden=true/);
  assert.match(beta,/image\.alt='';[\s\S]*image\.setAttribute\('aria-hidden','true'\)/);
  assert.match(css,/\.olliTalkBetaAttachmentImage\[hidden\]\{display:none\}/);
  assert.match(html,/olli-talk-beta\.js\?v=[^"']+/);
  assert.match(html,/olli-talk-beta\.css\?v=[^"']+/);
});


test('Team Chat image frames keep stable geometry through hydration and viewport release',()=>{
  const css=fs.readFileSync('olli-talk-beta.css','utf8');
  const html=fs.readFileSync('index.html','utf8');

  const createStart=beta.indexOf('function createOlliTalkAttachmentMessageBubble');
  const createEnd=beta.indexOf('function getOlliTalkArchiveCacheKey',createStart);
  const createBody=beta.slice(createStart,createEnd);
  assert.ok(createStart>=0&&createEnd>createStart);
  assert.match(createBody,/if\(imageWidth&&imageHeight\)[\s\S]*frame\.style\.aspectRatio/);
  assert.match(createBody,/frame\.classList\.add\('fallbackRatio'\)/);
  assert.match(createBody,/frame\.style\.aspectRatio='4 \/ 3'/);

  const releaseStart=beta.indexOf('function releaseOlliTalkAttachmentImageFrame');
  const releaseEnd=beta.indexOf('function loadOlliTalkThumbnailIntoImage',releaseStart);
  const releaseBody=beta.slice(releaseStart,releaseEnd);
  assert.ok(releaseStart>=0&&releaseEnd>releaseStart);
  assert.doesNotMatch(releaseBody,/style\.aspectRatio/);

  assert.doesNotMatch(css,/\.olliTalkBetaAttachmentImageFrame\.ready\{[^}]*min-height:0/);
  assert.match(css,/\.olliTalkBetaAttachmentImageFrame\.fallbackRatio \.olliTalkBetaAttachmentImage\{[^}]*height:100%;[^}]*max-height:none;[^}]*object-fit:contain/);
  assert.match(html,/olli-talk-beta\.js\?v=20261007-text-bubble-fit-1/);
  assert.match(html,/olli-talk-beta\.css\?v=20261007-reason-choice-1/);
});
