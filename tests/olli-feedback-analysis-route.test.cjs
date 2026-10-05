'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const runtime=require(path.join(root,'apps/mobile/api/_lib/olli-agent/runtime.cjs'));
const records=require(path.join(root,'apps/mobile/api/_lib/olli-agent/tools/record-tools.cjs'));

test('feedback analysis resolves Korean longitudinal periods deterministically',()=>{
  assert.deepEqual(
    runtime.resolveFeedbackAnalysisWindow('학생A 피드백을 확인해서 1년간 변화 알려줘','2026-10-05'),
    {startDate:'2025-10-05',endDate:'2026-10-05',label:'최근 1년',months:12}
  );
  assert.deepEqual(
    runtime.resolveFeedbackAnalysisWindow('최근 6개월 변화','2026-10-05'),
    {startDate:'2026-04-05',endDate:'2026-10-05',label:'최근 6개월',months:6}
  );
  assert.deepEqual(
    runtime.resolveFeedbackAnalysisWindow('작년 피드백 변화','2026-10-05'),
    {startDate:'2025-01-01',endDate:'2025-12-31',label:'작년',months:12}
  );
});

test('feedback analysis record reader reads all three saved record sources and filters by period',async()=>{
  const called=[];
  const rows={
    olli_general_feedback_data_access:[
      {lesson_date:'2026-01-12',created_at:'2026-01-12T10:00:00Z',content:'초기 기록',feedback_type:'수업 피드백'},
      {lesson_date:'2024-12-01',created_at:'2024-12-01T10:00:00Z',content:'기간 밖 기록',feedback_type:'수업 피드백'},
    ],
    olli_growth_feedback_data_access:[
      {year:2026,date:'6월 성장노트',created_at:'2026-09-01T00:00:00Z',content:'중간 성장 기록',feedback_type:'성장 피드백'},
    ],
    olli_note_archive_data_access:[
      {year:2026,month:9,day:20,created_at:'2026-09-20T00:00:00Z',content:'최근 관찰 기록',note_type:'elementary_observation',record_label:'관찰'},
    ],
  };
  const result=await records.readFeedbackAnalysisRecords({
    requestContext:{sessionToken:'session',academyId:'academy'},
    subjectAccess:{resolve(label){ return label==='학생A'?{studentId:'student-id'}:null; }},
    studentLabel:'학생A',
    startDate:'2025-10-05',
    endDate:'2026-10-05',
    sanitizePayload(value){ return value; },
    async callRpc(name,params){
      called.push({name,params});
      return {ok:true,rows:rows[name]||[]};
    },
  });

  assert.deepEqual(called.map(item=>item.name),[
    'olli_general_feedback_data_access',
    'olli_growth_feedback_data_access',
    'olli_note_archive_data_access',
  ]);
  assert.equal(result.record_count,3);
  assert.equal(result.records.length,3);
  assert.deepEqual(result.records.map(item=>item.analysis_date),[
    '2026-01-12','2026-06-01','2026-09-20'
  ]);
  assert.ok(called.every(item=>item.params.p_identity.student_id==='student-id'));
  assert.ok(called.every(item=>item.params.p_limit===records.ANALYSIS_SOURCE_LIMIT));
});

test('PC and Mobile feedback lanes call feedback_analysis instead of general talk chat',()=>{
  const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
  const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');

  assert.match(pc,/async function resolveFeedbackAnalysis\(/);
  assert.match(pc,/mode:'feedback_analysis'/);
  assert.match(pc,/if\(interpreterLane==='feedback'\)[\s\S]{0,500}?resolveFeedbackAnalysis\(/);
  assert.doesNotMatch(
    pc.match(/if\(interpreterLane==='feedback'\)[\s\S]{0,700}?\n    }/)?.[0]||'',
    /resolveAiReply\(/
  );

  assert.match(mobile,/async function resolveOlliTalkFeedbackAnalysis\(/);
  assert.match(mobile,/mode:'feedback_analysis'/);
  assert.match(mobile,/if\(interpreterLane==='feedback'\)[\s\S]{0,500}?resolveOlliTalkFeedbackAnalysis\(/);
  assert.doesNotMatch(
    mobile.match(/if\(interpreterLane==='feedback'\)[\s\S]{0,700}?\n    }/)?.[0]||'',
    /resolveOlliTalkAiReply\(/
  );
});

test('feedback analysis server mode is exposed without returning raw records',()=>{
  const api=fs.readFileSync(path.join(root,'apps/mobile/api/olli-agent.js'),'utf8');
  assert.match(api,/'feedback_analysis'/);
  assert.match(api,/runFeedbackAnalysis\(/);
  const responseBlock=api.match(/mode:'feedback_analysis'[\s\S]{0,500}?\n      }\);/)?.[0]||'';
  assert.match(responseBlock,/output:/);
  assert.match(responseBlock,/recordCount:/);
  assert.doesNotMatch(responseBlock,/records:/);
});

test('interpreter explicitly classifies longitudinal feedback requests into feedback lane',()=>{
  const route=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/context-route.cjs'),'utf8');
  assert.match(route,/피드백을 확인해서 1년간 어떤 변화가 있었는지 알려줘/);
  assert.match(route,/lane feedback, route chat, intent complex_analysis/);
  assert.match(route,/dedicated Feedback Analysis path is connected downstream/);
});
