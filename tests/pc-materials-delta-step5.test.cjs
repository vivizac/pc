const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');

test('PC loads materials sync common before material orders runtime',()=>{
  const html=read('index.html');
  assert.ok(html.indexOf('olli-materials-sync-common.js')>=0);
  assert.ok(html.indexOf('olli-materials-sync-common.js')<html.indexOf('pc-team-talk-material-orders.js'));
});

test('Realtime common accepts independent materials domain',()=>{
  const src=read('olli-realtime-common.js');
  assert.match(src,/VALID_DOMAINS = new Set\(\['observation', 'schedule', 'chat', 'materials'\]\)/);
});

test('PC material watcher uses materials domain instead of chat',()=>{
  const src=read('pc-team-talk-material-orders.js');
  const block=src.match(/function bindRealtime\(\)[\s\S]*?\n  \}/)?.[0]||'';
  assert.match(block,/watchDomain\('materials'/);
  assert.doesNotMatch(block,/watchDomain\('chat'/);
  assert.match(block,/syncMaterialsDelta/);
});

test('PC keeps full material list RPC as fallback and CAS writes unchanged',()=>{
  const src=read('pc-team-talk-material-orders.js');
  assert.match(src,/olli_team_material_requests_list/);
  assert.match(src,/return refresh\(\{showLoading:false\}\)/);
  assert.match(src,/p_expected_revision: Number\(item\.revision \|\| 0\)/);
});

test('PC captures event head before full snapshot and commits after render',()=>{
  const src=read('pc-team-talk-material-orders.js');
  const block=src.match(/async function refresh\(options = \{\}\)[\s\S]*?\n  \}/)?.[0]||'';
  const captureIndex=block.indexOf('captureMaterialsBaseline(current)');
  const listIndex=block.indexOf("rpc('olli_team_material_requests_list'");
  const renderIndex=block.indexOf('renderPayload(payload)');
  const commitIndex=block.indexOf('commitMaterialsBaseline(current,baselineCheckpoint)');
  assert.ok(captureIndex>=0);
  assert.ok(listIndex>captureIndex);
  assert.ok(renderIndex>listIndex);
  assert.ok(commitIndex>renderIndex);
});

test('PC material delta checkpoint advances only after payload apply',()=>{
  const src=read('pc-team-talk-material-orders.js');
  const block=src.match(/async function syncMaterialsDelta\(options = \{\}\)[\s\S]*?\n  \}/)?.[0]||'';
  const applyIndex=block.indexOf('api.applyToPayload');
  const renderIndex=block.indexOf('renderPayload(next)');
  const cursorIndex=block.indexOf('api.writeCheckpoint');
  assert.ok(applyIndex>=0);
  assert.ok(renderIndex>applyIndex);
  assert.ok(cursorIndex>renderIndex);
});


test('New realtime client ignores legacy chat compatibility alias for materials',()=>{
  const src=read('olli-realtime-common.js');
  assert.match(src,/compatibility_alias/);
  assert.match(src,/domain === 'chat' && compatibilityAlias === 'materials'/);
});
