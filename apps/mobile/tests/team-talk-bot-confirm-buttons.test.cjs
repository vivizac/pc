const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const js=fs.readFileSync('olli-talk-beta.js','utf8');
const html=fs.readFileSync('index.html','utf8');

test('mobile bot no longer uses legacy router.route execution flow',()=>{
  const start=js.indexOf('async function resolveOlliTalkBotTurn');
  const end=js.indexOf('function buildOlliTalkAiConversationMessages',start);
  assert.ok(start>=0 && end>start);
  const block=js.slice(start,end);
  assert.match(block,/router\.prepareAction\(commandText/);
  assert.match(block,/router\.runQuery\(commandText/);
  assert.doesNotMatch(block,/router\.route\(/);
  assert.doesNotMatch(block,/executePreparedWrite/);
});

test('mobile bot mutations persist an action card before any execution',()=>{
  const start=js.indexOf('async function resolveOlliTalkBotTurn');
  const end=js.indexOf('function buildOlliTalkAiConversationMessages',start);
  const block=js.slice(start,end);
  assert.match(block,/prepared\.kind==='action_pending'/);
  assert.match(block,/saveOlliTalkActionReply\(/);
  assert.match(block,/action_needs_reason/);
});

test('mobile Team Talk bot send flow uses button-confirm turn',()=>{
  assert.match(js,/const turn=await resolveOlliTalkBotTurn\(commandText,context,Number\(payload\.message\.id\)\)/);
  assert.doesNotMatch(js,/resolveOlliTalkOlliReply\(commandText\)/);
});

test('mobile action cards use cancel and confirm labels',()=>{
  assert.match(js,/function getOlliTalkActionPrimaryLabel\(\)\{\s*return '확인';\s*\}/);
  assert.match(js,/cancel\.textContent='취소'/);
});

test('typing confirm does not execute a mobile Team Talk bot mutation',()=>{
  const start=js.indexOf('async function resolveOlliTalkBotTurn');
  const end=js.indexOf('function buildOlliTalkAiConversationMessages',start);
  const block=js.slice(start,end);
  assert.match(block,/말풍선 아래 \[취소\] \[확인\] 버튼을 눌러주세요/);
  assert.doesNotMatch(block,/olli_team_chat_action_execute/);
});

test('mobile bot asset cache version is refreshed',()=>{
  assert.match(html,/olli-talk-beta\.js\?v=20260921-bot-confirm-buttons-1/);
});
