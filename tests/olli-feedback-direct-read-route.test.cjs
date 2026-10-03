'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const runtime=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/runtime.cjs'),'utf8');
const endpoint=fs.readFileSync(path.join(root,'apps/mobile/api/olli-agent.js'),'utf8');
const interpreter=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/context-route.cjs'),'utf8');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');

function block(source,startText,endText){
  const start=source.indexOf(startText);
  assert.ok(start>=0,startText+' missing');
  const end=source.indexOf(endText,start+startText.length);
  assert.ok(end>start,endText+' missing after '+startText);
  return source.slice(start,end);
}

test('feedback_read API keeps source validation and uses contextual privacy before direct synthesis',()=>{
  assert.match(endpoint,/['"]feedback_read['"]/);
  const readBlock=block(
    endpoint,
    "if (mode === 'context_read' || mode === 'timetable_read'",
    "if (mode === 'timetable_admin_prepare')"
  );
  assert.match(readBlock,/mode==='context_read' \|\| mode==='feedback_read'/);
  assert.match(readBlock,/prepareAgentContextReadPrivacyInput/);
  assert.match(readBlock,/runtimeModule\.runFeedbackDirectRead\(/);
  assert.ok(
    readBlock.indexOf('validatePickupSourceMessage') < readBlock.indexOf('prepareAgentContextReadPrivacyInput'),
    'saved Team Chat source must be validated before feedback privacy resolution'
  );
});

test('feedback direct runtime bypasses Agent tool selection and runs one synthesis model call',()=>{
  const direct=block(runtime,'async function runFeedbackDirectRead','async function runRecentRecordsProbe');
  assert.match(direct,/const \[profile, recentRecords\] = await Promise\.all\(\[/);
  assert.match(direct,/readStudentProfile\(\{/);
  assert.match(direct,/readRecentRecords\(\{/);
  assert.match(direct,/maxRecords:\s*20/);
  assert.match(direct,/tools:\s*\[\]/);
  assert.doesNotMatch(direct,/createGetRecentRecordsTool|createGetStudentProfileTool/);
  assert.equal(direct.split('await run(agent,').length-1,1);
  assert.match(direct,/reasoning:\{effort:'minimal'\}/);
  assert.match(direct,/restorePreparedSubjectLabels\(/);
});

test('PC feedback lane calls feedback_read with the raw source message and active Olli conversation',()=>{
  const helper=block(pc,'async function resolveFeedbackDirectReadTurn','async function resolveBatchAgentTurn');
  assert.match(helper,/mode:'feedback_read'/);
  assert.match(helper,/message:clean\(commandText\)/);
  assert.match(helper,/state\.aiConversationMessages/);
  assert.match(helper,/recordAi:true/);

  const route=block(
    pc,
    "if(interpreterLane==='feedback')",
    "if(\n      interpreterLane==='routine'"
  );
  assert.match(route,/resolveFeedbackDirectReadTurn\(/);
  assert.doesNotMatch(route,/resolveAiReply\(/);
  assert.match(route,/rawCommandText/);
});

test('Mobile feedback lane calls feedback_read with the raw source message and active Olli conversation',()=>{
  const helper=block(mobile,'async function resolveOlliTalkFeedbackDirectReadTurn','async function resolveOlliTalkBatchAgentTurn');
  assert.match(helper,/mode:'feedback_read'/);
  assert.match(helper,/message:String\(commandText \|\| ''\)\.trim\(\)/);
  assert.match(helper,/olliTalkAiConversationMessages/);
  assert.match(helper,/recordAi:true/);

  const route=block(
    mobile,
    "if(interpreterLane==='feedback')",
    "if(\n      interpreterLane==='routine'"
  );
  assert.match(route,/resolveOlliTalkFeedbackDirectReadTurn\(/);
  assert.doesNotMatch(route,/resolveOlliTalkAiReply\(/);
  assert.match(route,/rawCommandText/);
});

test('interpreter no longer describes feedback lane as unconnected',()=>{
  assert.match(interpreter,/Clients send lane feedback to the dedicated Feedback analysis path/);
  assert.doesNotMatch(interpreter,/dedicated Feedback Agent is connected/);
  assert.doesNotMatch(interpreter,/complex_analysis is not yet connected/);
});
