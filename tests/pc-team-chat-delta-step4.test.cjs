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

test('PC captures delta head before full snapshot and commits it after apply',()=>{
  const src=read('pc-team-talk.js');
  const block=src.match(/async function loadMessages\(options = \{\}\)[\s\S]*?\n  \}/)?.[0]||'';
  const captureIndex=block.indexOf('captureTeamTalkDeltaBaseline(current)');
  const listIndex=block.indexOf("rpc('olli_team_chat_list'");
  const commitIndex=block.indexOf('commitTeamTalkDeltaBaseline(current, baselineCheckpoint)');
  assert.ok(captureIndex>=0);
  assert.ok(listIndex>captureIndex);
  assert.ok(commitIndex>listIndex);
  assert.match(src,/applyToArchive\(state\.archivePayload, delta/);
  assert.match(src,/state\.deltaCheckpoint = delta\.checkpoint/);
});
