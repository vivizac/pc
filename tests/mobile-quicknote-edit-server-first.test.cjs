'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const common = fs.readFileSync(path.join(__dirname,'..','packages/common/olli-feedback-runtime.js'),'utf8');
const phone = fs.readFileSync(path.join(__dirname,'..','apps/mobile/kinder-feedback.js'),'utf8');
const academyId = '6871d975-6c50-426d-97b1-81ac4e35ba27';
const studentId = 'f999872d-1d48-4012-866a-dd5f8fa5ab99';
const record = {id:1695,academy_id:academyId,student_id:studentId,content:'수정된 내용'};
const item = {id:'fbjob_1',saved:true,savedRowId:'1695',savedStudentId:studentId,
 savedAcademyId:academyId,savedSourceTable:'feedbacks',savedRow:record};

function makePatch({phoneMode=true,remote=record,writeError=null,academy=academyId,verified=true}={}) {
 const start=common.indexOf('async function patchSavedTodayFeedbackItem(');
 const end=common.indexOf('\n// A corrected class record',start);
 assert.ok(start >= 0 && end > start,'real mobile edit source must be readable');
 let serverWrites=0, legacyWrites=0, verifiedCalls=0;
 let currentAcademy=academy;
 const window={OLLI_MOBILE_FEEDBACK_24H_RETENTION:phoneMode,OlliStorageCore:{
  AcademyContext:{getCurrent:()=>({academyId:currentAcademy})},
  FeatureRegistry:{require:feature=>({feature,verification:{compareFields:['content']}})},
  ServerAdapter:{
   write:async(_spec,identity,patch,opts)=>{
    serverWrites++;
    assert.deepEqual(identity,{academyId,studentId,recordId:'1695'});
    assert.equal(patch.content,'수정된 내용');
    assert.equal(opts.operation,'patch');
    if(writeError)throw writeError;
    return [remote];
   },
   verifyReturnedRow:(_spec,identity,patch,rows)=>{
    verifiedCalls++;
    const row=rows[0];
    if(!verified || !row || row.content!==patch.content ||
       String(row.id)!==identity.recordId || row.academy_id!==identity.academyId)
      throw Object.assign(new Error('SERVER_VERIFY_FAILED'),{code:'SERVER_VERIFY_FAILED'});
    return {verified:true,row};
   }
  }
 }};
 const make=new Function('window','getTodayFeedbackSavedSourceTable','getTodayFeedbackEditFeatureByTable',
  'getTodayFeedbackSavedRowId','getOlliCurrentAcademyId','saveOlliData','isOlliPendingCommonSaveResult',
  common.slice(start,end)+'\nreturn patchSavedTodayFeedbackItem;');
 const patch=make(window,x=>x.savedSourceTable,()=> 'general_feedback_edit',x=>x.savedRowId,
  ()=>academyId, async()=>{legacyWrites++; if(phoneMode)throw new Error('QuotaExceededError');return {serverSaved:true,verified:true,serverRow:record};},
  () => false);
 return {patch,get serverWrites(){return serverWrites;},get legacyWrites(){return legacyWrites;},
  get verifiedCalls(){return verifiedCalls;},switchAcademy:x=>currentAcademy=x};
}
test('iPhone previously saved feedback uses server-only patch even if local cache is full',async()=>{
 const m=makePatch();
 assert.deepEqual(await m.patch(item,'수정된 내용'),record);
 assert.equal(m.serverWrites,1);
 assert.equal(m.verifiedCalls,1);
 assert.equal(m.legacyWrites,0,'mobile must never call local-first AppDataService.save for edit');
});
test('failed server or mismatched row never becomes a successful edit',async()=>{
 const fail=makePatch({writeError:new Error('network unavailable')});
 await assert.rejects(fail.patch(item,'수정된 내용'),/network unavailable/);
 assert.equal(fail.serverWrites,1);
 const mismatch=makePatch({remote:{...record,content:'이전 내용'}});
 await assert.rejects(mismatch.patch(item,'수정된 내용'),{code:'SERVER_VERIFY_FAILED'});
});
test('academy switching blocks stale edit results',async()=>{
 const x=makePatch({academy:'another-academy'});
 await assert.rejects(x.patch(item,'수정된 내용'),{code:'STALE_ACADEMY_RESPONSE'});
 assert.equal(x.serverWrites,0);
});
test('PC and observation pathways retain original common save',async()=>{
 const m=makePatch({phoneMode:false});
 assert.equal((await m.patch(item,'수정된 내용')).content,'수정된 내용');
 assert.equal(m.legacyWrites,1);
 assert.equal(m.serverWrites,0);
});
test('server-verified edit can remain visible during a phone local quota error',()=>{
 const start=common.indexOf('const olliPhoneQuickNoteVerifiedEditsInMemory =');
 const end=common.indexOf('/* ── 내부 피드백 작업 보관함:',start);
 assert.ok(start>=0&&end>start);
 let academy='academy-a';
 const window={OLLI_MOBILE_FEEDBACK_24H_RETENTION:true};
 const helpers=new Function('window','getFeedbackJobQueueStorageKey',
   common.slice(start,end)+'\nreturn {remember:rememberOlliPhoneQuickNoteVerifiedEdit,merge:mergeOlliPhoneQuickNoteVerifiedEdits};')(
  window,()=> 'jobs_'+academy);
 const original={id:'q1',resultText:'이전 내용'},updated={id:'q1',resultText:'수정 내용'};
 helpers.remember(updated);
 assert.equal(helpers.merge([original])[0].resultText,'수정 내용');
 academy='academy-b';
 assert.equal(helpers.merge([original])[0].resultText,'이전 내용');
  assert.match(phone,/if \(!wasServerSaved\) \{/);
  assert.doesNotMatch(phone,/setTodayFeedbackItemsRaw\s*\(nextList\)/);
 assert.match(phone,/window\.rememberOlliPhoneQuickNoteVerifiedEdit\(updatedItem\)/);
});
