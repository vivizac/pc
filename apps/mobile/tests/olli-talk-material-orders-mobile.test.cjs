const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'olli-talk-material-orders-mobile.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'olli-talk-material-orders-mobile.js'), 'utf8');

test('mobile material request submit stays bound after the archive body is remounted', () => {
  assert.match(js, /state\.root\.addEventListener\('submit',event=>\{/);
  assert.match(js, /event\.target\.matches\('\[data-material-form\]'\)\)submitCreate\(event\)/);
  assert.match(js, /event\.target instanceof HTMLFormElement\?event\.target/);
  assert.doesNotMatch(js, /rootQuery\('\[data-material-form\]'\)\?\.addEventListener\('submit'/);
});

test('mobile material request modal backdrop close is delegated to the persistent root', () => {
  assert.match(js, /const modal=event\.target\.closest\('\[data-material-modal\]'\)/);
  assert.match(js, /if\(modal&&event\.target===modal\)closeCreate\(\)/);
  assert.doesNotMatch(js, /rootQuery\('\[data-material-modal\]'\)\?\.addEventListener\('click'/);
});

test('mobile date input cannot force the request form wider than the phone viewport', () => {
  assert.match(css, /\.olliMobileMatField\{min-width:0;/);
  assert.match(css, /\.olliMobileMatField input,[^\n]*textarea\{min-width:0;max-width:100%;width:100%;/);
  assert.match(css, /input\[type="date"\]\{min-inline-size:0;max-inline-size:100%\}/);
});

test('phone entrypoint loads the coffee card icon revision', () => {
  assert.match(html, /olli-talk-material-orders-mobile\.css\?v=20260924-coffee-card-icons-1/);
  assert.match(html, /olli-talk-material-orders-mobile\.js\?v=20260924-coffee-card-icons-1/);
});


test('quick order popup uses coffee copy without changing the archive material form copy', () => {
  assert.match(js, /createMaterialCreateModalHtml\('olliMobileMatQuickCreateTitle','coffee'\)/);
  assert.match(js, /const requestTitle=isCoffee\?'커피 요청':'재료 요청 등록'/);
  assert.match(js, /const requestSub=isCoffee\?'필요한 커피와 필요한 날짜를 적어주세요\.':'필요한 재료와 필요한 날짜를 적어 주세요\.'/);
  assert.match(js, /const itemLabel=isCoffee\?'커피명':'재료명'/);
  assert.match(js, /const useLabel=isCoffee\?'픽업':'사용수업'/);
});

test('quick order popup header is white while the archive material modal keeps its yellow fallback', () => {
  assert.match(css, /background:var\(--olli-mobile-mat-modal-head-bg,#FEE500\)/);
  assert.match(css, /\.olliMobileMatQuickHost\{[\s\S]*--olli-mobile-mat-modal-head-bg:#fff;/);
  assert.match(css, /--olli-mobile-mat-modal-sub-color:#747980;/);
});


test('quick order keeps material-order placeholders behind the coffee-themed labels', () => {
  assert.match(js, /const itemPlaceholder='예: 아크릴 물감 12색'/);
  assert.match(js, /const usePlaceholder='예: 초등부 수요일 3시'/);
  assert.doesNotMatch(js, /예: 아이스 아메리카노/);
  assert.doesNotMatch(js, /예: 오후 3시/);
});


test('material request action is a 44px floating plus and search UI is removed', () => {
  assert.doesNotMatch(js, /class="olliMobileMatSearch"/);
  assert.doesNotMatch(js, /class="olliMobileMatListTools"/);
  assert.match(js, /aria-label="요청 등록" class="olliMobileMatCreateBtn"[\s\S]*<span aria-hidden="true">＋<\/span>/);
  assert.match(css, /\.olliMobileMatCreateBtn\{[^\n]*position:fixed;[^\n]*right:var\(--vivizac-memo-shell-x,16px\);[^\n]*width:44px;[^\n]*height:44px;[^\n]*border-radius:999px;[^\n]*background:#0A84FF;color:#fff/);
  assert.match(css, /\.olliMobileMatList\{padding:12px 0 76px/);
});


test('material cards use seven stable coffee thumbnails instead of the old icon box', () => {
  assert.match(js, /const OLLI_COFFEE_THUMBS=\[/);
  for(let i=1;i<=7;i+=1)assert.match(js,new RegExp('/assets/olli-coffee/coffee-'+i+'\\.webp'));
  assert.match(js, /function coffeeThumbIndex\(value\)/);
  assert.match(js, /coffeeThumb\(item,index\)/);
  assert.doesNotMatch(js, /function materialIcon\(/);
  assert.doesNotMatch(css, /\.olliMobileMatItemIcon/);
  assert.match(css, /\.olliMobileMatCoffeeThumb\{[^\n]*width:48px;[^\n]*height:48px;[^\n]*border-radius:999px/);
});

test('request order arrival summary buttons use equal icon sizes and a vivid yellow line coffee cup', () => {
  assert.match(js, /olliMobileMatSummaryIcon coffee[\s\S]*olliMobileMatSummaryLabel">요청/);
  assert.match(js, /olliMobileMatSummaryIcon receipt[\s\S]*olliMobileMatSummaryLabel">주문/);
  assert.match(js, /olliMobileMatSummaryIcon delivery[\s\S]*olliMobileMatSummaryLabel">도착/);
  assert.match(css, /\.olliMobileMatSummaryIcon\{[^\n]*width:16px;[^\n]*height:16px;[^\n]*flex:0 0 16px;[^\n]*background:transparent/);
  assert.match(css, /\.olliMobileMatSummaryIcon\.coffee\{color:#FFD400\}/);
  assert.match(css, /\.olliMobileMatSummaryIcon\.coffee svg\{stroke-width:4\.6\}/);
  assert.match(css, /\.olliMobileMatSummaryIcon\.receipt\{color:#557ab7\}/);
  assert.match(css, /\.olliMobileMatSummaryIcon\.delivery\{color:#4e8a66\}/);
  assert.doesNotMatch(js, /<g fill="currentColor">/);
});


test('request order arrival controls use the Quick Note observation capsule geometry', () => {
  assert.match(css, /\.olliMobileMatSummary\{[^\n]*height:48px;[^\n]*padding:3px;[^\n]*gap:2px;[^\n]*border-radius:999px/);
  assert.match(css, /\.olliMobileMatSummaryCard\{[^\n]*height:40px;[^\n]*border:0;[^\n]*border-radius:999px;[^\n]*background:transparent/);
  assert.match(css, /\.olliMobileMatSummaryCard\.active\{background:#F3F0E9;color:#222;border-color:#F3F0E9;font-weight:450\}/);
  assert.match(css, /\.olliMobileMatRoot\{[\s\S]*padding:12px 0 36px/);
});


test('card status tags use white fill with blue border and blue text', () => {
  assert.match(css, /\.olliMobileMatStatusTag\{[^\n]*border:1px solid transparent/);
  assert.match(css, /\.olliMobileMatStatusTag\.requested,[\s\S]*\.olliMobileMatStatusTag\.ordered,[\s\S]*\.olliMobileMatStatusTag\.arrived\{background:#fff;color:#0A84FF;border-color:#0A84FF\}/);
  assert.match(html, /olli-talk-material-orders-mobile\.css\?v=20260924-card-status-outline-1/);
});


test('floating request plus aligns with the observation sort-button slot while remaining 44px', () => {
  assert.match(css, /\.olliMobileMatCreateBtn\{[^\n]*right:22\.5px;[^\n]*bottom:calc\(max\(10px, env\(safe-area-inset-bottom\)\) \+ 1\.5px\);[^\n]*width:44px;[^\n]*height:44px/);
  assert.match(html, /olli-talk-material-orders-mobile\.css\?v=20260924-request-sort-position-1/);
});


test('material requests restore the last academy cache before reconnect context is ready', () => {
  assert.match(js, /const LAST_CACHE_CONTEXT_KEY='olli_team_chat_last_cache_context_v1'/);
  assert.match(js, /function readLastCacheContext\(\)/);
  assert.match(js, /const resolvedAcademyId=clean\(academyContext\?\.academyId\|\|academyContext\?\.academy_id\|\|academyId\|\|readLastCacheContext\(\)\?\.academy_id\)/);
  assert.match(js, /state\.localSnapshotAvailable=renderedLocal/);
  assert.match(js, /if\(!current\.sessionToken\|\|!current\.academyId\)[\s\S]*const hasLocalSnapshot=state\.localSnapshotAvailable===true/);
  assert.match(js, /refresh\(\{\.\.\.options,showLoading:false,contextRetry:retryCount\+1\}\)/);
  assert.match(html, /olli-talk-material-orders-mobile\.js\?v=20260924-reconnect-cache-first-1/);
});


test('material local cache remains on screen when server returns identical data', () => {
  assert.match(js, /function materialPayloadSignature\(payload\)/);
  assert.match(js, /function currentMaterialPayloadSignature\(\)/);
  assert.match(js, /const changed=materialPayloadSignature\(payload\)!==currentMaterialPayloadSignature\(\)/);
  assert.match(js, /if\(changed\)renderPayload\(payload\)/);
  assert.match(js, /const wasLoading=state\.loading;[\s\S]*if\(wasLoading\)renderList\(\)/);
  assert.match(html, /olli-talk-material-orders-mobile\.js\?v=20260924-reconnect-cache-first-1/);
});


test('material summary inactive labels and counts are lighter while active values keep their weight', () => {
  assert.match(css, /\.olliMobileMatSummaryLabel\{font-size:12px;font-weight:450\}/);
  assert.match(css, /\.olliMobileMatSummaryCard\.active \.olliMobileMatSummaryLabel\{font-weight:750\}/);
  assert.match(css, /\.olliMobileMatSummaryCard strong\{font-size:17px;font-weight:600/);
  assert.match(css, /\.olliMobileMatSummaryCard\.active strong\{font-weight:800\}/);
  assert.match(html, /olli-talk-material-orders-mobile\.css\?v=20260924-material-line-list-1/);
});


test('material request rows use divider lines instead of rounded card boxes and keep details attached below the row', () => {
  assert.match(css, /\.olliMobileMatList\{padding:0 0 76px/);
  assert.match(css, /\.olliMobileMatItemCard\{[^\n]*margin:0;[^\n]*border:0;border-bottom:1px solid #eceef1;[^\n]*border-radius:0;[^\n]*background:transparent;[^\n]*overflow:visible/);
  assert.match(css, /\.olliMobileMatItemCard\.expanded\{[^\n]*box-shadow:none/);
  assert.match(css, /\.olliMobileMatItemMain\{[^\n]*padding:12px 2px;[^\n]*background:transparent/);
  assert.match(css, /\.olliMobileMatExpandedDetail\{[^\n]*border-top:1px solid #eceef1;[^\n]*background:#fafbfc;[^\n]*border-radius:0 0 14px 14px/);
  assert.match(html, /olli-talk-material-orders-mobile\.css\?v=20260924-material-line-list-1/);
});
