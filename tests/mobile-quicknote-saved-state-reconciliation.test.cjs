'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const phone=fs.readFileSync(path.join(__dirname,'..','apps/mobile/kinder-feedback.js'),'utf8');
const academyId='6871d975-6c50-426d-97b1-81ac4e35ba27';
const studentId='f999872d-1d48-4012-866a-dd5f8fa5ab99';
const item={id:'fbjob_20261120_sample',saved:false,reviewed:false,studentId,
  feedbackType:'class',resultText:'아이셔 클레이 활동',createdAt:'2026-11-20T01:10:00Z'};
const server={id:1695,academy_id:academyId,student_id:studentId,
  content:'아이셔 클레이 활동',created_at:'2026-11-20T01:11:57.897Z'};
function loadResolver({rows=[server],live=null,academy=academyId}={}){
 const a=phone.indexOf('async function reconcileKinderChatFeedbackSavedRecord(');
 const b=phone.indexOf('async function confirmKinderChatFeedbackLiveEdit(',a);
 assert.ok(a>=0&&b>a);
 let reads=0;
 const window={OlliStorageCore:{
   AcademyContext:{getCurrent:()=>({academyId:academy})},
   FeatureRegistry:{require:feature=>({feature})},
   ServerAdapter:{read:async(_spec,identity,opts)=>{
     reads++;
     assert.deepEqual(identity,{academyId,studentId});
     assert.equal(opts.limit,100);
     return rows;
   }}
 }};
 const resolve=new Function('window','getKinderChatFeedbackLiveItem',
   'getOlliCurrentAcademyId','getTodayFeedbackSavedSourceTable',
   phone.slice(a,b)+'\nreturn reconcileKinderChatFeedbackSavedRecord;')(
    window,()=>live,()=>academyId,()=> 'feedbacks');
 return {resolve,get reads(){return reads;}};
}
test('recover confirmed server ID 1695 when local inbox saved flag was stale',async()=>{
 const x=loadResolver();
 const r=await x.resolve({...item});
 assert.equal(x.reads,1);
 assert.equal(r.saved,true);
 assert.equal(r.reviewed,true);
 assert.equal(r.savedRowId,'1695');
 assert.equal(r.savedSourceTable,'feedbacks');
 assert.equal(r.savedAcademyId,academyId);
 assert.equal(r.savedRow.id,1695);
});
test('use server-verified LIVE ID when inbox update failed because quota was full',async()=>{
 const live={...item,saved:true,savedRowId:'1695',savedAcademyId:academyId,
    savedSourceTable:'feedbacks',savedRow:server};
 const x=loadResolver({live});
 const r=await x.resolve(item);
 assert.equal(r.saved,true);
 assert.equal(r.savedRowId,'1695');
 assert.equal(x.reads,0);
});
test('never assume saved when server row has wrong student or academy',async()=>{
 for(const rows of [[{...server,student_id:'different'}],[{...server,academy_id:'different'}]]){
  const x=loadResolver({rows});
  const r=await x.resolve(item);
  assert.equal(r.saved,false);
  assert.equal(r.savedRowId,undefined);
 }
});
test('do not patch an ambiguous or text-mismatched existing record',async()=>{
 for(const rows of [[server,{...server,id:1696}],[{...server,content:'different'}]]){
  const x=loadResolver({rows});
  const r=await x.resolve(item);
  assert.equal(r.saved,false);
 }
});
test('different-day identical text cannot be mistaken for today\'s feedback',async()=>{
 const x=loadResolver({rows:[{...server,created_at:'2026-11-12T01:11:57Z'}]});
 const r=await x.resolve(item);
 assert.equal(r.saved,false);
});
test('other academy or trial feedback does not attempt server reconciliation',async()=>{
 const x=loadResolver({academy:'another'});
 assert.equal((await x.resolve(item)).saved,false);
 assert.equal(x.reads,0);
 const y=loadResolver();
 assert.equal((await y.resolve({...item,trialSessionId:'trial_1'})).saved,false);
 assert.equal(y.reads,0);
});
test('both inbox and LIVE edit paths reconcile before deciding to skip server patch',()=>{
 assert.match(phone,/originalItem = await reconcileKinderChatFeedbackSavedRecord\(originalItem\)/);
 assert.match(phone,/savedItem = await reconcileKinderChatFeedbackSavedRecord\(item\)/);
 assert.match(phone,/await patchSavedTodayFeedbackItem\(originalItem, nextText\)/);
 assert.match(phone,/await patchSavedTodayFeedbackItem\(savedItem, nextText\)/);
 const html=fs.readFileSync(path.join(__dirname,'..','apps/mobile/index.html'),'utf8');
 assert.match(html,/kinder-feedback\.js\?v=20261120-reconcile-saved-1/);
});
