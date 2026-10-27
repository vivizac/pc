'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../apps/pc/pc-student-management.js'),'utf8');
const start=src.indexOf('  function consultationStatusChipHtml(');
const end=src.indexOf('  function refreshConsultationMaterialStatuses(',start);
assert.ok(start>=0&&end>start,'use actual shared PC consultation rendering and async status logic');
const snippet=src.slice(start,end);

function harness({role='owner',status='insufficient',candidates=[],candidateError=false}={}){
 const seen={queries:[],warnings:[],readyWrites:[]};
 const row={
  dataset:{pcStudentRef:'id:student-a'},
  chip:{
   hidden:false,textContent:'',dataset:{},classList:{remove(){},add(){}},
   removeAttribute(k){delete this[k]}
  },
  button:{hidden:true}
 };
 row.querySelector=(q)=>q==='.recordAcademyConsultStatusChip'?row.chip:
  q==='.recordAcademyConsultLegacyReviewBtn'?row.button:null;
 const cache=new Map();
 const inflight=new Map();
 const server={
  readCachedStatus(){return null},
  writeCachedStatus(key,value){seen.readyWrites.push({key,value})},
  getPrimaryTask(){return {key:'id:student-a|every_12|2026-10',ruleKey:'every_12'}},
  getCacheKey(){return 'academy-a|id:student-a|every_12|2026-10'},
  async checkSummaryStatus(){seen.queries.push('inspect');return {status,reason:'이번 상담 회차에 연결된 종합 피드백이 없습니다.',feedbackId:status==='ready'?15:null}},
  async listLegacyCandidates(){seen.queries.push('candidates');if(candidateError)throw new Error('lookup failed');return {status:'pending',candidates}}
 };
 const sandbox={
  global:{OlliConsultationServer:server,getOlliCurrentRole:()=>role,getOlliCurrentAcademyId:()=> 'academy-a'},
  consultationStatusCache:cache,consultationStatusInFlight:inflight,
  consultationStatusKey:()=> 'academy-a|id:student-a|every_12|2026-10',
  consultationStudentRef:()=> 'id:student-a',
  getConsultationSummaryMonthsFromLabels:()=>12,
  document:{querySelectorAll:()=>[row]},
  console:{warn(...args){seen.warnings.push(args)}},
  Map,Date,Promise,Array,Number,String
 };
 vm.runInNewContext(snippet+'\n({consultationStatusChipHtml,resolveConsultationStatus});',sandbox);
 const methods=vm.runInNewContext(snippet+'\n({consultationStatusChipHtml,resolveConsultationStatus});',sandbox);
 return {methods,row,seen,cache};
}
const student={id:'student-a',name:'학생'};
const labels=['12개월'];

test('exact matching owner candidate replaces 자료부족 with one clickable link-needed button',async()=>{
 const h=harness({candidates:[{feedback_id:17}]});
 await h.methods.resolveConsultationStatus(student,labels);
 assert.deepEqual(h.seen.queries,['inspect','candidates']);
 assert.equal(h.row.chip.hidden,true);
 assert.equal(h.row.button.hidden,false);
 assert.equal(h.cache.get('academy-a|id:student-a|every_12|2026-10').hasLegacyCandidate,true);
 const chipHtml=h.methods.consultationStatusChipHtml(student,labels);
 assert.match(chipHtml,/data-pc-consult-material-status="insufficient" hidden/);
 assert.match(src,/>기존 기록 연결 필요<\/button>/);
 assert.match(src,/onclick="OlliPcStudentManagement\.openLegacyReview/);
 assert.ok(!h.seen.queries.includes('generate'),'candidate check must never generate a summary');
});
test('no eligible existing summary keeps regular 자료부족 chip, with no link button',async()=>{
 const h=harness();
 await h.methods.resolveConsultationStatus(student,labels);
 assert.deepEqual(h.seen.queries,['inspect','candidates']);
 assert.equal(h.row.chip.hidden,false);
 assert.equal(h.row.chip.textContent,'자료부족');
 assert.equal(h.row.button.hidden,true);
 assert.match(h.methods.consultationStatusChipHtml(student,labels),/>자료부족<\/span>/);
});
test('ready summary never offers legacy linking',async()=>{
 const h=harness({status:'ready',candidates:[{feedback_id:17}]});
 await h.methods.resolveConsultationStatus(student,labels);
 assert.deepEqual(h.seen.queries,['inspect']);
 assert.equal(h.row.chip.hidden,false);
 assert.equal(h.row.chip.textContent,'준비완료');
 assert.equal(h.row.button.hidden,true);
});
test('candidate lookup errors fail closed, and non-owner cannot list candidates',async()=>{
 const h=harness({candidateError:true});
 await h.methods.resolveConsultationStatus(student,labels);
 assert.equal(h.row.chip.textContent,'자료부족');
 assert.equal(h.row.chip.hidden,false);
 assert.equal(h.row.button.hidden,true);
 assert.equal(h.seen.warnings.length,1);
 const staff=harness({role:'teacher',candidates:[{feedback_id:17}]});
 await staff.methods.resolveConsultationStatus(student,labels);
 assert.deepEqual(staff.seen.queries,['inspect']);
 assert.equal(staff.row.button.hidden,true);
});
