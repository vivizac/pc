'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../packages/common/olli-feedback-runtime.js'),'utf8');
const start=source.indexOf('function getTodayFeedbackSavedSourceTable(');
const end=source.indexOf('// A corrected class record',start);
assert.ok(start>=0&&end>start,'saved feedback original editing functions must exist');
const functions=source.slice(start,end);
const item={savedSourceTable:'feedbacks',savedAcademyId:'academy-A',savedStudentId:'student-A',
  savedRow:{id:123,content:'original'}};
const create=saveOlliData=>new Function('saveOlliData','getFeedbackTableNameByType',
  functions+'\nreturn {patchSavedTodayFeedbackItem,getTodayFeedbackSavedRowId};'
)(saveOlliData,()=> 'feedbacks');
test('saved kinder feedback reads authoritative id from savedRow even without savedRowId',()=>{
  const api=create(async()=>({serverSaved:true,verified:true,serverRow:{id:123,content:'edited'}}));
  assert.equal(api.getTodayFeedbackSavedRowId(item),'123');
});
test('editing succeeds when pending-result helper is not installed and server confirms the write',async()=>{
  let input;
  const api=create(async(feature,payload)=>{
    input={feature,payload};return {serverSaved:true,verified:true,serverRow:{id:123,content:'edited'}};
  });
  const row=await api.patchSavedTodayFeedbackItem(item,'edited');
  assert.equal(row.content,'edited');
  assert.equal(input.feature,'general_feedback_edit');
  assert.equal(input.payload.recordId,'123');
  assert.equal(input.payload.studentId,'student-A');
  assert.equal(input.payload.academyId,'academy-A');
});
test('pending and failed saves never report success or overwrite the edit card',async()=>{
  for(const response of [{pending:true},{serverSaved:false,verified:false},null]){
    const api=create(async()=>response);
    await assert.rejects(()=>api.patchSavedTodayFeedbackItem(item,'unsaved'));
  }
});
