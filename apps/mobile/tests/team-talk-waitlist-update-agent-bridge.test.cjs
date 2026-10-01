const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('mobile waitlist update gate uses only the shared candidate parser',()=>{
  const start=talk.indexOf('function isOlliTalkWaitlistUpdateAgentCandidate');
  const end=talk.indexOf('function isOlliTalkWaitlistCancelAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseWaitlistUpdateMutationIntent\(commandText\)/);
  assert.match(block,/==='update_waitlist'/);
  assert.doesNotMatch(block,/parseWriteIntent|prepareAction|add_waitlist|cancel_waitlist/);
});

test('mobile waitlist update is routed before student info and legacy prepareAction',()=>{
  const start=talk.indexOf('async function resolveOlliTalkAiTurn');
  const end=talk.indexOf('function getOlliTalkMentionMessageText',start);
  const block=talk.slice(start,end);
  const update=block.indexOf('if(isOlliTalkWaitlistUpdateAgentCandidate(commandText,router))');
  const studentInfo=block.indexOf('const studentInfo=resolveOlliTalkStudentInfoCommand(commandText)');
  const legacy=block.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(update>=0);
  assert.ok(studentInfo>update);
  assert.ok(legacy>studentInfo);
  assert.match(block,/return resolveOlliTalkWaitlistUpdateAgentTurn\(commandText,context,replyToMessageId\)/);
});

test('mobile waitlist update bridge uses source-bound production mode without creating a second action',()=>{
  const start=talk.indexOf('async function resolveOlliTalkWaitlistUpdateAgentTurn');
  const end=talk.indexOf('function isOlliTalkPendingReasonCancel',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'waitlist_update_prepare'/);
  assert.match(block,/sourceMessageId=Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type \|\| ''\)\.trim\(\)!=='update_waitlist'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveOlliTalkActionReply|olli_team_chat_send_action/);
});

test('mobile guest waitlist update stops with privacy-safe reply after server rejection',()=>{
  const start=talk.indexOf('async function resolveOlliTalkWaitlistUpdateAgentTurn');
  const end=talk.indexOf('function isOlliTalkPendingReasonCancel',start);
  const block=talk.slice(start,end);
  assert.match(block,/OLLI_AGENT_WAITLIST_REGISTERED_STUDENT_REQUIRED/);
  assert.match(block,/비재원 대기 변경은 현재 Team Chat에서 지원하지 않아요/);
  assert.match(block,/saveOlliTalkOlliReply\(context,message,sourceMessageId\)/);
});

test('mobile Bot path remains independent from waitlist update Agent routing',()=>{
  const start=talk.indexOf('async function resolveOlliTalkBotTurn');
  const end=talk.indexOf('function handleOlliTalkAiModeChanged',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveOlliTalkWaitlistUpdateAgentTurn|isOlliTalkWaitlistUpdateAgentCandidate|waitlist_update_prepare/);
});
