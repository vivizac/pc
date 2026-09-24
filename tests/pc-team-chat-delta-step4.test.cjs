const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');

test('PC loads shared Team Chat delta before Team Talk runtime',()=>{
  const html=read('index.html');
  assert.ok(html.indexOf('olli-team-chat-delta-common.js')>=0);
  assert.ok(html.indexOf('olli-team-chat-delta-common.js')<html.indexOf('pc-team-talk.js'));
});

test('PC keeps full list RPC as fallback',()=>{
  const src=read('pc-team-talk.js');
  assert.match(src,/async function loadMessages\(/);
  assert.match(src,/rpc\('olli_team_chat_list'/);
  assert.match(src,/return loadMessages\(\{ showLoading:false/);
});

test('PC realtime uses delta and no longer reloads archive on every chat signal',()=>{
  const src=read('pc-team-talk.js');
  const block=src.match(/async function refreshFromRealtime\(\)[\s\S]*?function bindRealtime\(/)?.[0]||'';
  assert.match(block,/syncTeamTalkDelta/);
  assert.doesNotMatch(block,/loadArchive/);
});

test('PC baselines cursor after full snapshot and applies archive delta in memory',()=>{
  const src=read('pc-team-talk.js');
  assert.match(src,/await baselineTeamTalkDelta\(current\)/);
  assert.match(src,/applyToArchive\(state\.archivePayload, delta/);
  assert.match(src,/state\.deltaCheckpoint = delta\.checkpoint/);
});
