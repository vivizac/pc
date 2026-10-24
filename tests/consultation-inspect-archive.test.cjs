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
  assert.match(pc,/OlliConsultationServer\.inspectSummary\(student.id,task.key\)/);
  assert.doesNotMatch(between(mobile,'async function runAcademyConsultationSummaryAutoCheck()', 'window.toggleAcademyConsultationSummaryPreview'),/fetchConsultationSummaryFromServer\(student,task\)/);
});

test('server inspection authenticates without writing jobs or generating AI, including preview deployments',async()=>{
  const beforeKey=process.env.SUPABASE_SECRET_KEY;
  const beforeEnv=process.env.VERCEL_ENV;
  const fetchBefore=global.fetch;
  const calls=[];
  process.env.SUPABASE_SECRET_KEY='test-service-key';
  process.env.VERCEL_ENV='preview';
  const academyId='6871d975-6c50-426d-97b1-81ac4e35ba27';
  const studentId='b552e5cc-4b22-45bb-b1d0-af6c51ab12ed';
  const key='id:'+studentId+'|after_1|2026-05';
  global.fetch=async (url,opts={})=>{
    const u=new URL(String(url));calls.push({pathname:u.pathname,method:opts.method||'GET'});
    const json=data=>({ok:true,status:200,text:async()=>JSON.stringify(data),json:async()=>data});
    if(u.pathname.endsWith('/rpc/olli_consultation_progress_access'))return json({ok:true,progress:{}});
    if(u.pathname.endsWith('/students'))return json([{id:studentId,name:'test',division:'kinder',enrolled_at:'2026-04-01',status:'active',is_deleted:false}]);
    if(u.pathname.endsWith('/feedbacks'))return json([1,2,3,4].map(x=>({id:x,date:'2026-04-'+(10+x),content:'lesson '+x,feedback_type:'class'})));
    if(u.pathname.endsWith('/summary_feedbacks'))return json([{id:9,summary_months:1,year:2026,created_at:'2026-05-07T04:00:00Z',content:'previously stored summary',client_mutation_id:null}]);
    throw new Error('Unexpected outbound call '+u.pathname);
  };
  try{
    let response;
    const res={setHeader(){},status(code){this.statusCode=code;return this},json(data){response=data;return this}};
    await server({method:'POST',body:{action:'inspect',academyId,studentId,sessionToken:'test-session',taskKey:key}},res);
    assert.equal(res.statusCode,200);
    assert.equal(response.status,'ready');
    assert.equal(response.materialStatus,'ready');
    assert.equal(response.savedSummaryStatus,'legacy_unlinked');
    assert.equal(response.content,'previously stored summary');
    assert.equal(calls.filter(c=>c.method==='POST').length,1,'only session validation RPC may POST');
    assert.ok(calls.every(c=>!c.pathname.includes('job_access')&&!c.pathname.includes('/chat')));
    assert.equal(calls.filter(c=>c.pathname.includes('/summary_feedbacks')).length,1);
  }finally{
    global.fetch=fetchBefore;
    if(beforeKey===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=beforeKey;
    if(beforeEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=beforeEnv;
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
