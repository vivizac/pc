'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const picker=fs.readFileSync(path.join(root,'olli-record-student-picker-phone-adapter.js'),'utf8');
const archive=fs.readFileSync(path.join(root,'elementary-analysis-phone-adapter.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const ACADEMY='6871d975-6c50-426d-97b1-81ac4e35ba27';
const STUDENT='f999872d-1d48-4012-866a-dd5f8fa5ab99';
function extract(src,begin,end){
 const a=src.indexOf(begin),b=src.indexOf(end,a+begin.length);
 assert.ok(a>=0&&b>a,'missing source section '+begin);
 return src.slice(a,b);
}
const serverEdit=extract(picker,
 'function getMemoFeedbackArchiveEditFeature(tableName)',
 'async function saveMemoFeedbackArchiveEdit(id, btn = null)');
function serverHarness({failure=null,verifiedRow=null,activeAcademy=ACADEMY}={}){
 let calls=0;
 const expected={id:1695,academy_id:ACADEMY,student_id:STUDENT,content:'수정 내용'};
 const target=verifiedRow||expected;
 const core={
  AcademyContext:{getCurrent:()=>({academyId:activeAcademy})},
  FeatureRegistry:{require:feature=>({feature})},
  ServerAdapter:{
   write:async(spec,identity,patch,options)=>{
    calls++;
    assert.equal(spec.feature,'general_feedback_edit');
    assert.deepEqual(identity,{academyId:ACADEMY,studentId:STUDENT,recordId:'1695'});
    assert.equal(options.operation,'patch');
    assert.equal(patch.content,'수정 내용');
    if(failure)throw failure;
    return [target];
   },
   verifyReturnedRow:(_spec,identity,patch,rows)=>{
    const row=rows[0];
    if(String(row.id)!==identity.recordId ||
      row.academy_id!==identity.academyId || row.student_id!==identity.studentId ||
      row.content!==patch.content)throw Object.assign(new Error('SERVER_VERIFY_FAILED'),{code:'SERVER_VERIFY_FAILED'});
    return {verified:true,row};
   }
  }
 };
 const fn=new Function('window','getOlliCurrentAcademyId',serverEdit+
 '\nreturn saveMemoFeedbackArchiveEditDirectlyToSupabase;')(
  {OlliStorageCore:core},()=>ACADEMY);
 return {save:fn,expected,get calls(){return calls;}};
}
test('actual archive edit uses authenticated server patch with no common local-first save',async()=>{
 const h=serverHarness();
 const result=await h.save('feedbacks',1695,{id:STUDENT},{content:'수정 내용'});
 assert.deepEqual(result,h.expected);
 assert.equal(h.calls,1);
 assert.doesNotMatch(serverEdit,/saveOlliData\s*\(/);
 assert.doesNotMatch(serverEdit,/localStorage\s*\.\s*setItem\s*\(/);
});
test('server failures and wrong rows never report a successful edit',async()=>{
 const a=serverHarness({failure:new Error('network down')});
 await assert.rejects(a.save('feedbacks',1695,{id:STUDENT},{content:'수정 내용'}),/network down/);
 const b=serverHarness({verifiedRow:{id:1695,academy_id:ACADEMY,student_id:STUDENT,content:'previous'}});
 await assert.rejects(b.save('feedbacks',1695,{id:STUDENT},{content:'수정 내용'}),{code:'SERVER_VERIFY_FAILED'});
});
test('archive edit cannot change academy identity',async()=>{
 const h=serverHarness({activeAcademy:'another-academy'});
 await assert.rejects(h.save('feedbacks',1695,{id:STUDENT},{content:'수정 내용'}),{code:'STALE_ACADEMY_RESPONSE'});
 assert.equal(h.calls,0);
});
test('the actual save button requires a saved server row before updating UI',()=>{
 const handler=extract(picker,'async function saveMemoFeedbackArchiveEdit(id, btn = null)',
   'function ensureMemoFeedbackArchiveSheet(menu)');
 assert.match(handler,/await saveMemoFeedbackArchiveEditDirectlyToSupabase/);
 assert.match(handler,/serverOnly:true/);
 assert.doesNotMatch(handler,/saveOlliData\s*\(/);
 assert.doesNotMatch(handler,/localStorage\.setItem\s*\(/);
 assert.match(handler,/SERVER_RECORD_UNCONFIRMED/);
 assert.ok(handler.indexOf('await saveMemoFeedbackArchiveEditDirectlyToSupabase') <
   handler.indexOf('replaceMemoFeedbackArchiveItem(studentAtStart'));
});
test('confirmed archive edit updates only session memory and avoids quota-limited cache writes',()=>{
 const setter=extract(archive,'function setMemoFeedbackArchiveItems(student, items, options = {})',
  'function addMemoFeedbackArchiveItem(student, content, meta = {})');
 assert.match(setter,/if \(options\.serverOnly === true\) return;/);
 const saveSection=extract(picker,'async function saveMemoFeedbackArchiveEdit(id, btn = null)',
  'function ensureMemoFeedbackArchiveSheet(menu)');
 assert.match(saveSection,/\{serverOnly:true\}/);
 assert.match(html,/elementary-analysis-phone-adapter\.js\?v=20261120-archive-direct-server-1/);
 assert.match(html,/olli-record-student-picker-phone-adapter\.js\?v=20261120-archive-direct-server-1/);
});
