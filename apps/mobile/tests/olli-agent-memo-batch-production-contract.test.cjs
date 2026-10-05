const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const endpoint=fs.readFileSync(path.join(root,'api/olli-agent.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'api/_lib/olli-agent/runtime.cjs'),'utf8');
const memoTool=fs.readFileSync(path.join(root,'api/_lib/olli-agent/tools/timetable-memo-tools.cjs'),'utf8');
const privacy=fs.readFileSync(path.join(root,'api/_lib/olli-agent/privacy.cjs'),'utf8');
const makeupCancel=fs.readFileSync(path.join(root,'api/_lib/olli-agent/tools/makeup-cancel-prepare-tools.cjs'),'utf8');
const makeupTool=fs.readFileSync(path.join(root,'api/_lib/olli-agent/tools/makeup-prepare-tools.cjs'),'utf8');
const pc=fs.readFileSync(path.resolve(root,'../pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'olli-talk-beta.js'),'utf8');

test('memo production validates stored source and returns persisted card',()=>{
  assert.match(endpoint,/'memo_prepare'/);
  assert.match(endpoint,/runTimetableMemoPrepare\(/);
  assert.match(runtime,/async function validateTimetableMemoSourceMessage/);
  assert.match(runtime,/async function runTimetableMemoPrepare\(/);
  assert.match(runtime,/requirePersistedMessage:true/);
  assert.match(runtime,/requestId:'team-chat-memo:' \+ sourceId/);
});

test('memo note is removed before model egress and omitted from tool schema/result',()=>{
  assert.match(privacy,/async function prepareTimetableMemoPrivacyInput/);
  assert.match(endpoint,/prepareTimetableMemoPrivacyInput/);
  const start=memoTool.indexOf('parameters:z.object({');
  const end=memoTool.indexOf('}),\n    async execute',start);
  assert.doesNotMatch(memoTool.slice(start,end),/memo_note|memoNote/);
  const resultStart=memoTool.indexOf('return sanitizePayload({');
  const resultEnd=memoTool.indexOf('function createPrepareTimetableMemoTool',resultStart);
  assert.doesNotMatch(memoTool.slice(resultStart,resultEnd),/memo_note/);
});

test('batch validates full stored source, parts, and all reasons before card preparation',()=>{
  assert.match(endpoint,/'batch_prepare'/);
  assert.match(endpoint,/runBatchPrepare\(/);
  const start=runtime.indexOf('async function runBatchPrepare({');
  const end=runtime.indexOf('\n\nmodule.exports = {',start);
  const block=runtime.slice(start,end);
  assert.match(block,/validatePickupSourceMessage\(/);
  assert.match(block,/splitBatchWriteParts\(sourceMessageText\)/);
  assert.match(block,/OLLI_AGENT_BATCH_PART_BODY_MISMATCH/);
  assert.match(block,/validateAbsenceReasonMessage/);
  assert.match(block,/validateMakeupReasonMessage/);
  assert.match(block,/validateTrialReasonMessage/);
  assert.ok(block.indexOf('validateAbsenceReasonMessage')<block.indexOf('const preparedMessages=[]'));
  assert.match(block,/preparedMessages\.push\(persisted\)/);
});

test('batch uses existing independent action types instead of storing batch_write',()=>{
  const start=runtime.indexOf('function batchExpectedActionTypes');
  const end=runtime.indexOf('async function prepareBatchPrivacy',start);
  const block=runtime.slice(start,end);
  for(const intent of ['add_timetable_memo','delete_timetable_memo','mark_absent','add_class_once','add_makeup','update_makeup','cancel_makeup','add_trial','update_trial','cancel_trial','add_waitlist','update_waitlist','cancel_waitlist','move_class','cancel_move','add_pickup','update_pickup','cancel_pickup']){
    assert.ok(block.includes(intent),intent);
  }
  assert.doesNotMatch(endpoint,/p_action_type\s*:\s*['"]batch_write/);
});

test('batch incomplete makeup uses date/time buttons and server revalidates the chosen stored slot',()=>{
  for(const source of [pc,mobile]){
    assert.match(source,/batchStructured:true/);
    assert.match(source,/structuredSelection:selection/);
    assert.match(source,/StructuredMakeupChoice|StructuredMakeup/);
    assert.match(source,/StructuredDateChoice/);
    assert.match(source,/StructuredTimeChoice/);
    assert.match(source,/StructuredTargetChoice/);
  }
  assert.match(endpoint,/structuredSelection/);
  assert.match(runtime,/async function runBatchStructuredMakeupPrepare/);
  assert.match(runtime,/selection:item\.structuredSelection/);
  assert.match(runtime,/selectedTimeSlot:timeSlot/);
  assert.match(makeupTool,/selectedTimeSlot = 0/);
  assert.match(makeupTool,/selectedStoredTimeSlot/);
});

test('makeup cancel reason is private server context and absent from tool schema',()=>{
  assert.match(privacy,/prepareMakeupCancelPrivacyInput/);
  assert.match(runtime,/async function validateMakeupReasonMessage/);
  assert.match(runtime,/cancellation reason is private server-side context/i);
  const start=makeupCancel.indexOf('parameters:z.object({');
  const end=makeupCancel.indexOf('}),\n    async execute',start);
  assert.doesNotMatch(makeupCancel.slice(start,end),/reason/);
});

test('batch validates stored clarification messages before card preparation',()=>{
  const start=runtime.indexOf('async function runBatchPrepare({');
  const end=runtime.indexOf('\n\nmodule.exports = {',start);
  const block=runtime.slice(start,end);
  assert.match(block,/clarificationMessageId/);
  assert.match(block,/OLLI_AGENT_BATCH_CLARIFICATION_BODY_MISMATCH/);
  assert.match(block,/expectedContext/);
  assert.ok(block.indexOf('OLLI_AGENT_BATCH_CLARIFICATION_BODY_MISMATCH')<block.indexOf('const preparedMessages=[]'));
});
