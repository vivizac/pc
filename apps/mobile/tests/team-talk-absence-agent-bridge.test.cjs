const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('mobile absence candidate uses shared absence parser and requires a named student',()=>{
  const start=talk.indexOf('function parseOlliTalkAbsenceAgentCandidate');
  const end=talk.indexOf('function isOlliTalkClassOnceAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseAbsenceMutationIntent\(commandText\)/);
  assert.match(block,/==='mark_absent'/);
  assert.match(block,/parsed\?\.studentName/);
  assert.doesNotMatch(block,/prepareAction|parseMakeupMutationIntent/);
});

test('mobile inline absence reason routes directly to source-bound Agent',()=>{
  const start=talk.indexOf('async function resolveOlliTalkAiTurn');
  const end=talk.indexOf('function getOlliTalkMentionMessageText',start);
  const block=talk.slice(start,end);
  assert.match(block,/const absenceCandidate=parseOlliTalkAbsenceAgentCandidate/);
  assert.match(block,/String\(absenceCandidate\.reason \|\| ''\)\.trim\(\)/);
  assert.match(block,/return resolveOlliTalkAbsenceAgentTurn\(\{/);
});

test('mobile two-turn absence keeps existing reason prompt then uses Agent for the second message',()=>{
  const start=talk.indexOf('async function resolveOlliTalkAiTurn');
  const end=talk.indexOf('function getOlliTalkMentionMessageText',start);
  const block=talk.slice(start,end);
  assert.match(block,/pendingPayload\.__absenceAgent/);
  assert.match(block,/const pendingAbsence=olliTalkPendingActionReason\.__absenceAgent/);
  assert.match(block,/return resolveOlliTalkAbsenceAgentTurn\(\{/);
  assert.match(block,/reasonMessageId:Number\(replyToMessageId \|\| 0\)/);
});

test('mobile absence resolver binds both messages and never stores a second action client-side',()=>{
  const start=talk.indexOf('async function resolveOlliTalkAbsenceAgentTurn');
  const end=talk.indexOf('async function resolveOlliTalkClassOnceAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'absence_prepare'/);
  assert.match(block,/sourceMessageId:sourceId/);
  assert.match(block,/reasonMessageId:reasonId/);
  assert.match(block,/reasonMessageText:String\(reasonMessageText \|\| ''\)\.trim\(\)/);
  assert.match(block,/reason:String\(reasonText \|\| ''\)\.trim\(\)/);
  assert.match(block,/action_type \|\| ''\)\.trim\(\)!=='mark_absent'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.doesNotMatch(block,/saveOlliTalkActionReply|olli_team_chat_send_action/);
});

test('mobile Bot path remains independent from absence Agent routing',()=>{
  const start=talk.indexOf('async function resolveOlliTalkBotTurn');
  const end=talk.indexOf('function handleOlliTalkAiModeChanged',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveOlliTalkAbsenceAgentTurn|parseOlliTalkAbsenceAgentCandidate|absence_prepare/);
});
