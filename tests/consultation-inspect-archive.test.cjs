'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const server=require('../packages/common/api/_lib/consultation-summary-handler.cjs');
const pc=read('apps/pc/pc-student-management.js');
const pcData=read('apps/pc/olli-data-consultation-summary.js');
const mobile=read('apps/mobile/olli-student-core.js');
const archive=read('apps/mobile/olli-record-student-picker-phone-adapter.js');
const attendance=read('apps/mobile/olli-data-attendance-feedback.js');
const client=read('packages/common/olli-consultation-progress-client.js');
const between=(source,start,end)=>{
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'section not found '+start);
  return source.slice(a,b);
};

test('PC and mobile use inspectSummary on background checks; only explicit create uses requestSummary',()=>{
  assert.match(client,/async inspectSummary\(studentId, taskKey\)/);
  assert.match(client,/action:'inspect'/);
  assert.match(client,/async requestSummary\(studentId, taskKey\)/);
  assert.match(between(pcData,'async function runAcademyConsultationSummaryAutoCheck()', 'window.toggleAcademyConsultationSummaryPreview'),/await inspectConsultationSummaryFromServer\(student,task\)/);
  assert.match(between(mobile,'async function runAcademyConsultationSummaryAutoCheck()', 'window.toggleAcademyConsultationSummaryPreview'),/await inspectConsultationSummaryFromServer\(student,task\)/);
  assert.match(pc,/core\.checkSummaryStatus\(student,task\)/);
  assert.doesNotMatch(between(mobile,'async function runAcademyConsultationSummaryAutoCheck()', 'window.toggleAcademyConsultationSummaryPreview'),/fetchConsultationSummaryFromServer\(student,task\)/);
});

test('server inspection never treats lesson-material readiness or legacy-year candidates as a prepared consultation',async()=>{
  const prevSecret=process.env.SUPABASE_SECRET_KEY,prevEnv=process.env.VERCEL_ENV,prevFetch=global.fetch;
  const academyId='6871d975-6c50-426d-97b1-81ac4e35ba27';
  const studentId='b552e5cc-4b22-45bb-b1d0-af6c51ab12ed';
  const taskKey='id:'+studentId+'|after_1|2026-05';
  const calls=[];
  let jobStatus='legacy_review_required', linkedId=null, summaryStudent=studentId;
  process.env.SUPABASE_SECRET_KEY='test-key';process.env.VERCEL_ENV='preview';
  const json=data=>({ok:true,status:200,text:async()=>JSON.stringify(data),json:async()=>data});
  global.fetch=async(url,opts={})=>{
    const u=new URL(String(url));calls.push({path:u.pathname,method:opts.method||'GET'});
    if(u.pathname.endsWith('/rpc/olli_consultation_progress_access'))return json({ok:true,progress:{}});
    if(u.pathname.endsWith('/students'))return json([{id:studentId,division:'kinder',enrolled_at:'2026-04-01',status:'active',is_deleted:false}]);
    if(u.pathname.endsWith('/olli_consultation_summary_jobs'))return json([{status:jobStatus,feedback_id:linkedId}]);
    if(u.pathname.endsWith('/summary_feedbacks'))return json(summaryStudent===studentId
      ?[{id:9,summary_months:1,content:'verified exact task summary'}]:[]);
    throw Error('unexpected database request '+u.pathname);
  };
  const query=async()=>{
    let value;
    const res={setHeader(){},status(n){this.statusCode=n;return this},json(x){value=x;return this}};
    await server({method:'POST',body:{action:'inspect',academyId,sessionToken:'token',studentId,taskKey}},res);
    assert.equal(res.statusCode,200);return value;
  };
  try{
    const old=await query();
    assert.equal(old.status,'insufficient');
    assert.equal(old.reviewRequired,true);
    assert.equal(old.feedbackId,null);
    assert.equal(calls.some(c=>c.path.endsWith('/feedbacks')||c.path.endsWith('/fail_feedbacks')),false);
    assert.equal(calls.filter(c=>c.method==='POST').length,1);
    jobStatus='ready';linkedId=9;
    const exact=await query();
    assert.equal(exact.status,'ready');assert.equal(exact.feedbackId,9);
    assert.equal(exact.content,'verified exact task summary');
    summaryStudent='different';
    const foreign=await query();
    assert.equal(foreign.status,'insufficient');
    assert.equal(foreign.feedbackId,null);
    assert.equal(calls.every(c=>!c.path.includes('summary_job_access')&&!c.path.endsWith('/chat')),true);
  }finally{
    global.fetch=prevFetch;
    if(prevSecret===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=prevSecret;
    if(prevEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=prevEnv;
  }
});

test('archive independently requests all saved summaries and preserves local lesson data if its loader fails',async()=>{
  const script=between(archive,'function getArchiveServerRowKey(item) {','function refreshElementaryRecordsMenuFromServer(');
  const student={id:'student-1'};
  const summaryRows=[{id:1,content:'summary A',created_at:'2026-10-20'},{id:2,content:'summary B',created_at:'2026-10-21'}];
  const ctx={
    loadMemoFeedbackArchiveItemsFromSupabase:async()=>{throw Error('lesson archive offline')},
    loadAttendanceFeedbackRowsSecure:async(table,who,limit)=>{
      assert.equal(table,'summary_feedbacks');assert.equal(who,student);assert.equal(limit,100);
      return summaryRows;
    },
    normalizeAttendanceFeedbackRows:rows=>rows.map(row=>({
      id:'summary_feedbacks_'+row.id,rowId:row.id,sourceTable:'summary_feedbacks',
      row:{...row,source_table:'summary_feedbacks'},content:row.content,createdAt:row.created_at
    })),
    getMemoFeedbackArchiveSourceTable:item=>item.sourceTable,
    getMemoFeedbackArchiveSavedAt:item=>item.createdAt
  };
  vm.runInNewContext(script+';this.load=loadMemoArchiveWithServerSummaries;',ctx);
  const local=[{id:'feedbacks_5',rowId:5,sourceTable:'feedbacks',createdAt:'2026-10-15',content:'lesson'}];
  const result=await ctx.load(student,local);
  assert.equal(result.items.length,3);
  assert.equal(result.items.filter(x=>x.sourceTable==='summary_feedbacks').length,2);
  assert.equal(result.partial,true);
});

test('archive saves the merged server items locally before rendering, preserving copy and edit actions',()=>{
  assert.match(archive,/setMemoFeedbackArchiveItems\(student,items\);[\s\S]*?renderMemoFeedbackArchiveSheet\(menu,student,items/);
  assert.match(archive,/getMemoFeedbackArchiveNoteTitle\(item\)[\s\S]*?summary_feedbacks/);
});

test('attendance student archive keeps successful summaries when regular feedback retrieval fails',async()=>{
  const code=between(attendance,'async function loadAttendanceStudentFeedbackSheetItems(student) {','const attendanceStudentFeedbackSheetState');
  const existing={feedbacks:[{id:'cached-feedback',createdAt:'2026-10-12'}],summaries:[]};
  const saved=[];
  const ctx={
    isSupabaseConfigured:()=>true,
    loadAttendanceFeedbackRowsSecure:async(table)=>{
      if(table==='summary_feedbacks')return[{id:18,content:'stored summary',created_at:'2026-10-14'}];
      throw Error('offline');
    },
    normalizeAttendanceFeedbackRows:(rows,source)=>rows.map(x=>({...x,sourceTable:source,createdAt:x.created_at})),
    readAttendanceFeedbackLocalFirstCache:()=>existing,
    writeAttendanceFeedbackLocalFirstCache:(_,value)=>saved.push(value),
    console
  };
  vm.runInNewContext(code+';this.load=loadAttendanceStudentFeedbackSheetItems;',ctx);
  const result=await ctx.load({id:'student-1'});
  assert.equal(result.summaries.length,1);
  assert.equal(result.summaries[0].content,'stored summary');
  assert.equal(result.feedbacks.length,1);
  assert.equal(result.partialErrorTables.length,2);
  assert.equal(saved.length,1);
});
