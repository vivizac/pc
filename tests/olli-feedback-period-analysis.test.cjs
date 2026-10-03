'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const runtimeModule=require('../apps/mobile/api/_lib/olli-agent/runtime.cjs');
const recordTools=require('../apps/mobile/api/_lib/olli-agent/tools/record-tools.cjs');
const perf=require('../apps/mobile/api/_lib/olli-agent/perf.cjs');

test('feedback period parser resolves common Korean long-range expressions deterministically',()=>{
  assert.deepEqual(
    runtimeModule.resolveFeedbackEvidenceRange(
      '@올리 금우주 학생 1년간의 피드백을 확인해서 어떤 변화가 있는지 분석해줘',
      '2026-10-03'
    ),
    {startDate:'2025-10-03',endDate:'2026-10-03',label:'1년'}
  );

  assert.deepEqual(
    runtimeModule.resolveFeedbackEvidenceRange('최근 6개월 피드백을 비교해줘','2026-10-03'),
    {startDate:'2026-04-03',endDate:'2026-10-03',label:'6개월'}
  );

  assert.deepEqual(
    runtimeModule.resolveFeedbackEvidenceRange('작년 피드백과 비교해줘','2026-10-03'),
    {startDate:'2025-01-01',endDate:'2025-12-31',label:'작년'}
  );

  assert.deepEqual(
    runtimeModule.resolveFeedbackEvidenceRange('2025년 피드백을 분석해줘','2026-10-03'),
    {startDate:'2025-01-01',endDate:'2025-12-31',label:'2025년'}
  );

  assert.equal(
    runtimeModule.resolveFeedbackEvidenceRange('최근 피드백에서 어떤 변화가 보여?','2026-10-03'),
    null
  );
});

test('legacy recent-record merge contract remains an array capped at 20',()=>{
  const rows=Array.from({length:30},(_,index)=>({
    content:'기록 '+index,
    lesson_date:'2026-09-'+String((index%28)+1).padStart(2,'0'),
    created_at:'2026-10-01T00:00:00Z',
  }));

  const result=recordTools.mergeRecentRecords(rows,[],[],30);
  assert.ok(Array.isArray(result));
  assert.equal(result.length,20);
});

test('period evidence filters by lesson date and keeps old/new coverage when sampling',()=>{
  const rows=[
    {content:'A',lesson_date:'2025-09-01',created_at:'2026-10-01T00:00:00Z'},
    {content:'B',lesson_date:'2025-10-03',created_at:'2026-10-01T00:00:00Z'},
    {content:'C',lesson_date:'2026-01-01',created_at:'2026-10-01T00:00:00Z'},
    {content:'D',lesson_date:'2026-06-01',created_at:'2026-10-01T00:00:00Z'},
    {content:'E',lesson_date:'2026-10-03',created_at:'2026-10-01T00:00:00Z'},
    {content:'F',lesson_date:'2026-10-04',created_at:'2026-10-01T00:00:00Z'},
  ];

  const result=recordTools.mergeFeedbackRecordSet(
    rows,[],[],3,
    {
      directEvidence:true,
      rangeStart:'2025-10-03',
      rangeEnd:'2026-10-03',
    }
  );

  assert.equal(result.matchedCount,4);
  assert.equal(result.records.length,3);
  assert.equal(result.records[0].date,'2026-10-03');
  assert.equal(result.records.at(-1).date,'2025-10-03');
});

test('feedback evidence retains future direction and structured observation analysis',()=>{
  const feedback=recordTools.normalizeFeedbackRecord({
    content:'표현이 구체적으로 바뀜',
    future_direction:'질문으로 선택 이유를 확장한다',
    lesson_date:'2026-09-01',
  },'feedback');
  assert.equal(feedback.future_direction,'질문으로 선택 이유를 확장한다');

  const analysis={strengths:['관찰'],teacherActions:['기다려주기']};
  const observation=recordTools.normalizeObservationRecord({
    content:'재료를 비교한 뒤 스스로 선택함',
    analysis,
    year:2026,
    month:9,
    day:2,
  });
  assert.deepEqual(observation.analysis,analysis);
});

test('direct period read widens only server evidence reads while legacy tool limits stay unchanged',async()=>{
  const calls=[];
  const fakeRpc=async(name,params)=>{
    calls.push({name,params});
    return {
      ok:true,
      rows:[{
        content:name,
        lesson_date:'2026-05-01',
        created_at:'2026-05-01T00:00:00Z',
      }],
    };
  };
  const subjectAccess={
    resolve(label){
      return label==='학생A' ? {studentId:'student-private-id'} : null;
    },
  };
  const common={
    requestContext:{sessionToken:'session',academyId:'academy'},
    subjectAccess,
    studentLabel:'학생A',
    sanitizePayload:(payload)=>payload,
    callRpc:fakeRpc,
  };

  const direct=await recordTools.readRecentRecords({
    ...common,
    maxRecords:180,
    rangeStart:'2025-10-03',
    rangeEnd:'2026-10-03',
    directEvidence:true,
  });
  assert.equal(direct.range_start,'2025-10-03');
  assert.equal(direct.range_end,'2026-10-03');
  assert.equal(calls.length,3);
  assert.ok(calls.every((call)=>call.params.p_limit===recordTools.MAX_DIRECT_PER_SOURCE));

  calls.length=0;
  await recordTools.readRecentRecords({
    ...common,
    maxRecords:20,
  });
  assert.equal(calls.length,3);
  assert.ok(calls.every((call)=>call.params.p_limit<=recordTools.MAX_PER_SOURCE));
});

test('production feedback lane bypasses generic chat and direct runtime has no tools',()=>{
  const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
  const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
  const endpoint=fs.readFileSync(path.join(root,'apps/mobile/api/olli-agent.js'),'utf8');
  const runtime=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/runtime.cjs'),'utf8');

  assert.match(endpoint,/['"]feedback_read['"]/);
  assert.match(endpoint,/runtimeModule\.runFeedbackDirectRead\(/);

  const pcStart=pc.indexOf("if(interpreterLane==='feedback')");
  const pcEnd=pc.indexOf("if(\n      interpreterLane==='routine'",pcStart);
  assert.ok(pcStart>=0 && pcEnd>pcStart);
  const pcBlock=pc.slice(pcStart,pcEnd);
  assert.match(pcBlock,/resolveFeedbackDirectReadTurn\(/);
  assert.doesNotMatch(pcBlock,/resolveAiReply\(/);

  const mobileStart=mobile.indexOf("if(interpreterLane==='feedback')");
  const mobileEnd=mobile.indexOf("if(\n      interpreterLane==='routine'",mobileStart);
  assert.ok(mobileStart>=0 && mobileEnd>mobileStart);
  const mobileBlock=mobile.slice(mobileStart,mobileEnd);
  assert.match(mobileBlock,/resolveOlliTalkFeedbackDirectReadTurn\(/);
  assert.doesNotMatch(mobileBlock,/resolveOlliTalkAiReply\(/);

  const directStart=runtime.indexOf('async function runFeedbackDirectRead');
  const directEnd=runtime.indexOf('async function runRecentRecordsProbe',directStart);
  assert.ok(directStart>=0 && directEnd>directStart);
  const directBlock=runtime.slice(directStart,directEnd);
  assert.match(directBlock,/tools:\[\]/);
  assert.equal(directBlock.split('await run(agent,').length-1,1);
  assert.match(directBlock,/maxRecords:requestedRange \? 180 : 20/);
});


test('feedback latency instrumentation exposes only structural timing metadata',()=>{
  const event=perf.buildPerfEvent({
    phase:'feedback_data_read',
    status:'ok',
    mode:'feedback_read',
    model:'gpt-test',
    durationMs:12.3,
    recordCount:8,
    matchedRecordCount:10,
    evidenceChars:1234,
    conversationItems:4,
    conversationChars:300,
    rangeSampled:1,
    sourceMayBeTruncated:0,
    studentName:'민감정보',
    content:'피드백 원문',
  });

  assert.equal(event.phase,'feedback_data_read');
  assert.equal(event.model,'gpt-test');
  assert.equal(event.recordCount,8);
  assert.equal(event.matchedRecordCount,10);
  assert.equal(event.evidenceChars,1234);
  assert.equal(event.conversationItems,4);
  assert.equal(event.conversationChars,300);
  assert.equal(event.rangeSampled,1);
  assert.equal(event.sourceMayBeTruncated,0);
  assert.equal('studentName' in event,false);
  assert.equal('content' in event,false);
});

test('feedback path is instrumented across interpretation, privacy, data, evidence and synthesis',()=>{
  const endpoint=fs.readFileSync(path.join(root,'apps/mobile/api/olli-agent.js'),'utf8');
  const runtime=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/runtime.cjs'),'utf8');
  const contextRoute=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/context-route.cjs'),'utf8');
  const requestContext=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/request-context.cjs'),'utf8');

  for(const phase of [
    'feedback_source_validate',
    'feedback_privacy_prepare',
    'feedback_pipeline_total',
  ]){
    assert.match(endpoint,new RegExp(phase));
  }

  for(const phase of [
    'feedback_sdk_load',
    'feedback_data_read',
    'feedback_evidence_build',
    'feedback_analysis_model',
    'feedback_runtime_total',
  ]){
    assert.match(runtime,new RegExp(phase));
  }

  assert.match(contextRoute,/interpreter_openai/);
  assert.match(contextRoute,/interpreter_total/);
  assert.match(requestContext,/request_context_load/);
});


test('feedback direct read overlaps SDK loading with evidence reads',()=>{
  const runtime=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/runtime.cjs'),'utf8');
  const start=runtime.indexOf('async function runFeedbackDirectRead');
  const end=runtime.indexOf('async function runRecentRecordsProbe',start);
  assert.ok(start>=0 && end>start);
  const block=runtime.slice(start,end);

  assert.match(block,/const sdkPromise=loadAgentsSdk\(\)\.then/);
  assert.match(block,/const dataPromise=Promise\.all\(\[/);
  assert.match(block,/await Promise\.all\(\[sdkPromise,dataPromise\]\)/);
  assert.doesNotMatch(block,/const \{Agent,run\}=await loadAgentsSdk\(\)/);
});

test('feedback second-stage AI prefers compact interpreter output with safe fallback',()=>{
  const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
  const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
  const endpoint=fs.readFileSync(path.join(root,'apps/mobile/api/olli-agent.js'),'utf8');

  assert.match(pc,/resolvedMessage:clean\(resolvedText\)/);
  assert.match(pc,/resolveFeedbackDirectReadTurn\(\s*rawCommandText,\s*commandText,/);

  assert.match(mobile,/resolvedMessage:String\(resolvedText \|\| ''\)\.trim\(\)/);
  assert.match(mobile,/resolveOlliTalkFeedbackDirectReadTurn\(\s*rawCommandText,\s*commandText,/);

  assert.match(endpoint,/compactFeedbackInput=mode==='feedback_read' && !!resolvedMessage/);
  assert.match(endpoint,/primaryPrivacyConversation=compactFeedbackInput \? \[\] : conversation/);
  assert.match(endpoint,/primarySubjectRefs\.length===0/);
  assert.match(endpoint,/contextFallback=true/);
  assert.match(endpoint,/sourceMessageText:message/);
});
