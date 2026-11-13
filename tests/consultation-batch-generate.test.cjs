'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const client=fs.readFileSync(path.join(root,'packages/common/olli-consultation-progress-client.js'),'utf8');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-student-management.js'),'utf8');
const html=fs.readFileSync(path.join(root,'apps/pc/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/pc/pc-student-management.css'),'utf8');
const academyId='11111111-1111-4111-8111-111111111111';
const id=n=>'22222222-2222-4222-8222-22222222222'+n;
const key=n=>'id:'+id(n)+'|every_12|2026-11';
function fixture(role='owner'){
  const requests=[],names=[];
  let currentAcademy=academyId,ownerRole=role;
  const responses={
    [id(1)]:{inspect:{ok:true,status:'ready',feedbackId:501}},
    [id(2)]:{inspect:{ok:true,status:'insufficient'},generate:{ok:true,status:'ready',feedbackId:502}},
    [id(3)]:{inspect:{ok:true,status:'insufficient'},generate:{ok:true,status:'insufficient',reason:'자료부족'}},
    [id(4)]:{inspect:{ok:true,status:'insufficient'},generate:{ok:false,error:'SERVICE_UNAVAILABLE'}}
  };
  const window={
    location:{hostname:'pc-seven-silk.vercel.app'},
    localStorage:{getItem:()=> 'owner-session',setItem:()=>{}},
    supabase:async()=>({ok:true}),
    getOlliCurrentAcademyId:()=>currentAcademy,
    getOlliCurrentRole:()=>ownerRole,
    getConsultationDueTasksForStudent:student=>[{
      ruleKey:'every_12',
      dueMonth:student.dueMonth||'2026-11',
      key:'id:'+student.id+'|every_12|'+(student.dueMonth||'2026-11')
    }],
    fetch:async(_url,options)=>{
      const body=JSON.parse(options.body);
      requests.push(body);
      const entry=responses[body.studentId];
      const isInspect=body.action==='inspect';
      const answer=entry?.[isInspect?'inspect':'generate']||{ok:true,status:'insufficient'};
      return {ok:answer.ok!==false,status:answer.ok===false?503:200,json:async()=>answer};
    }
  };
  vm.runInNewContext(client,{window,Date,JSON,Number,Set,Error});
  const s=n=>({id:id(n),name:'학생'+n,academy_id:academyId});
  return{window,requests,names,s,changeAcademy:next=>currentAcademy=next};
}
test('explicit owner batch checks saved reports first, creates once and leaves insufficient untouched',async()=>{
  const f=fixture();
  const students=[f.s(1),f.s(2),f.s(3),f.s(2),{...f.s(4),academy_id:'foreign-academy'},
    {...f.s(5),dueMonth:'2026-12'}];
  const output=await f.window.OlliConsultationServer.generateDueSummaries(students,
    (progress,name)=>f.names.push({processed:progress.processed,name}));
  assert.equal(output.total,3);
  assert.equal(output.processed,3);
  assert.equal(output.existing,1);
  assert.equal(output.created,1);
  assert.equal(output.insufficient,1);
  assert.equal(output.error,0);
  assert.deepEqual(f.names.map(x=>x.processed),[1,2,3]);
  assert.equal(f.requests.filter(x=>x.action!=='inspect').length,2);
  assert.equal(f.requests.some(x=>x.studentId===id(1)&&x.action!=='inspect'),false);
  assert.equal(f.requests.some(x=>x.studentId===id(4)||x.studentId===id(5)),false);
});
test('manager and owner allowed, teacher denied before network calls',async()=>{
  for(const role of ['owner','manager','super_admin']){
    const f=fixture(role);
    const result=await f.window.OlliConsultationServer.generateDueSummaries([f.s(1)]);
    assert.equal(result.existing,1);
  }
  const denied=fixture('teacher');
  await assert.rejects(denied.window.OlliConsultationServer.generateDueSummaries([denied.s(1)]),/원장 또는 관리자/);
  assert.equal(denied.requests.length,0);
});
test('failed one student does not hide errors or prevent next student',async()=>{
  const f=fixture();
  const result=await f.window.OlliConsultationServer.generateDueSummaries([f.s(4),f.s(2)]);
  assert.equal(result.error,1);
  assert.equal(result.created,1);
  assert.equal(result.failedNames.length,1);
});
test('PC button uses only current academy, verifies first lesson and saves via common service',()=>{
  assert.match(pc,/await global\.loadOlliConsultationFirstLessonsFromServer\(\)/);
  assert.match(pc,/global\.OlliConsultationServer\.generateDueSummaries\(due/);
  assert.match(pc,/renderConsultationPanel\(\)/);
  assert.match(pc,/OlliPcStudentManagement\.generateConsultationBatch\(\)/);
  assert.match(html,/pc-student-management\.js\?v=20261113-consultation-batch-1/);
  assert.match(html,/olli-consultation-progress-client\.js\?v=20261113-consultation-batch-1/);
  assert.match(css,/pcAcademyConsultBatchGenerateBtn/);
  assert.doesNotMatch(client,/delete.*summary_feedbacks|truncate.*summary_feedbacks/i);
});
