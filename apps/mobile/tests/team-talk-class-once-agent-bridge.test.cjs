const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('mobile class-once gate uses only shared generic class parser',()=>{
  const start=talk.indexOf('function isOlliTalkClassOnceAgentCandidate');
  const end=talk.indexOf('function isOlliTalkMoveAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseClassMutationIntent\(commandText\)/);
  assert.match(block,/==='add_class_once'/);
  assert.doesNotMatch(block,/parseMakeupMutationIntent|parseTrialMutationIntent|parseWaitlistMutationIntent|prepareAction/);
});

test('mobile class-once route stays before move and legacy preparation',()=>{
  const start=talk.indexOf('async function resolveOlliTalkAiTurn');
  const end=talk.indexOf('function getOlliTalkMentionMessageText',start);
  const block=talk.slice(start,end);
  const once=block.indexOf('if(isOlliTalkClassOnceAgentCandidate(commandText,router))');
  const move=block.indexOf('if(isOlliTalkMoveAgentCandidate(commandText,router))');
  const legacy=block.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(once>=0);
  assert.ok(move>once);
  assert.ok(legacy>move);
  assert.match(block,/return resolveOlliTalkClassOnceAgentTurn\(commandText,context,replyToMessageId\)/);
});

test('mobile class-once bridge uses source-bound production without second action save',()=>{
  const start=talk.indexOf('async function resolveOlliTalkClassOnceAgentTurn');
  const end=talk.indexOf('async function resolveOlliTalkMoveAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'class_once_prepare'/);
  assert.match(block,/sourceMessageId=Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type \|\| ''\)\.trim\(\)!=='add_class_once'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveOlliTalkActionReply|olli_team_chat_send_action/);
});

test('mobile Bot path remains independent from class-once Agent routing',()=>{
  const start=talk.indexOf('async function resolveOlliTalkBotTurn');
  const end=talk.indexOf('function handleOlliTalkAiModeChanged',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveOlliTalkClassOnceAgentTurn|isOlliTalkClassOnceAgentCandidate|class_once_prepare/);
});
