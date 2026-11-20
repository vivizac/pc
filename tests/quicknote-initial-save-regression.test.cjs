'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const mobile = read('apps/mobile/olli-student-core.js');
const pc = read('apps/pc/olli-data-feedback.js');
const common = read('packages/common/olli-feedback-runtime.js');
const live = read('apps/mobile/kinder-feedback.js');
const academyId = '6871d975-6c50-426d-97b1-81ac4e35ba27';
const studentId = '123e4567-e89b-42d3-a456-426614174000';

function makeResolver(source, remote = {id:studentId, name:'서버 이름', division:'kinder', academy_id:academyId}) {
  const a = source.indexOf('async function getOrCreateStudentForSupabaseSave(');
  const b = source.indexOf('\nfunction closeFeedbackResultCardFromButton(', a);
  assert.ok(a >= 0 && b > a);
  const writes = [], reads = [];
  const local = {id:studentId, name:'로컬 이름', type:'kinder', status:'paused'};
  const window = {OlliStorageCore:{
    FeatureRegistry:{require:feature=>({feature})},
    ServerAdapter:{read:async(_spec, identity)=>{reads.push(identity); return remote ? [remote] : [];}}
  }};
  const fn = new Function('getAllStudents','currentMemoStudent','requireOlliAcademyId','window',
    'ensureStudentSavedToSupabase','uid', source.slice(a,b)+'\nreturn getOrCreateStudentForSupabaseSave;')(
    ()=>[local], null, ()=>academyId, window,
    async value=>{writes.push(value);return value;}, ()=>studentId
  );
  return {fn,reads,writes};
}

for (const [platform, source] of [['mobile',mobile],['pc',pc]]) {
  test(platform+' Quick Note checks server student without rewriting profile or status', async()=>{
    const ctx = makeResolver(source);
    const value = await ctx.fn('로컬 이름','kinder',studentId,{readOnlyExisting:true});
    assert.equal(value.name,'서버 이름');
    assert.equal(value.status,'paused');
    assert.deepEqual(ctx.reads,[{academyId,studentId}]);
    assert.equal(ctx.writes.length,0);
  });
  test(platform+' missing or deleted server student never recreated by Quick Note', async()=>{
    const missing = makeResolver(source,null);
    await assert.rejects(missing.fn('로컬 이름','kinder',studentId,{readOnlyExisting:true}),
      {code:'STUDENT_NOT_ON_SERVER'});
    assert.equal(missing.writes.length,0);
    const removed = makeResolver(source,{id:studentId,academy_id:academyId,is_deleted:true});
    await assert.rejects(removed.fn('로컬 이름','kinder',studentId,{readOnlyExisting:true}),
      {code:'STUDENT_INACTIVE'});
    assert.equal(removed.writes.length,0);
  });
  test(platform+' non Quick Note student save still uses legacy pathway', async()=>{
    const ctx=makeResolver(source);
    await ctx.fn('로컬 이름','kinder',studentId);
    assert.equal(ctx.reads.length,0);
    assert.equal(ctx.writes.length,1);
  });
  test(platform+' first-save code uses scoped read and a stable record ID',()=>{
    const a=source.indexOf('async function autoSaveGeneratedFeedback(');
    const b=source.indexOf('window.autoSaveGeneratedFeedback =',a);
    const snippet=source.slice(a,b);
    assert.match(snippet,/readOnlyExisting: !!options\.quickNoteRequestId/);
    assert.match(snippet,/client_record_id: ?String\(options\.clientRecordId\)/);
    assert.match(snippet,/!savedRow \|\| savedRow\.__pending_sync/);
    assert.match(snippet,/reportQuicknoteInitialSaveFailure/);
  });
}

test('pending inbox record never reports server save complete', async()=>{
  const a=common.indexOf('async function saveTodayFeedbackItem(');
  const b=common.indexOf('\nfunction getFeedbackMonthNumber(',a);
  assert.ok(a>=0&&b>a);
  const savedOptions=[],updates=[],links=[];
  const f=new Function('getTodayFeedbackItemById','getTodayFeedbackExportBlockReason','normalizeTodayFeedbackStudentName',
    'autoSaveGeneratedFeedback','showPushToast','updateTodayFeedbackItem','linkFeedbackPhotosToStudent',
    common.slice(a,b)+'\nreturn saveTodayFeedbackItem;')(
      ()=>({id:'tf_1',studentName:'학생',studentId,resultText:'본문',feedbackType:'class'}),
      () => '', s => s,
      async(_text,options)=>{savedOptions.push(options);return {__pending_sync:true};},
      ()=>{},(...args)=>updates.push(args),(...args)=>links.push(args)
    );
  assert.equal(await f('tf_1'),false);
  assert.equal(savedOptions[0].quickNoteRequestId,'tf_1');
  assert.equal(savedOptions[0].clientRecordId,'quicknote_tf_1');
  assert.equal(updates.length,0);
  assert.equal(links.length,0);
});

test('live retry uses a stable mutation ID and preserves pending normal feedback',()=>{
  assert.match(live,/quickNoteRequestId: item\.id/);
  assert.match(live,/'quicknote_' \+ String\(item\.id \|\| ''\)/);
  assert.match(live,/if \(savedOk && savedOk\.__pending_sync\)/);
  assert.match(live,/item\.saved = false;\s*item\.reviewed = false/);
  assert.doesNotMatch(live,/if \(saved !== true\) reportKinderChatFeedbackFailure\(item, 'SAVE_FAILED', 0\)/);
});

test('first-save reporting uses the authenticated endpoint and sanitized metadata',()=>{
  const api=read('apps/mobile/api/feedback-client-error.js');
  assert.match(api,/INITIAL_SAVE_PHASES/);
  assert.match(api,/\['EDIT_SAVE_FAILED','SAVE_FAILED'\]\.includes\(stage\)/);
  assert.match(common,/function reportQuicknoteInitialSaveFailure/);
  assert.match(common,/quicknote_feedback_save/);
  assert.match(common,/stage:'SAVE_FAILED',errorCode:code,savePhase:phase/);
});

test('new versions are used for both PC and mobile scripts',()=>{
  for(const file of ['olli-student-core.js'])
    assert.ok(read('apps/mobile/index.html').includes(file+'?v=20261119-quicknote-save-1'));
  assert.ok(read('apps/mobile/index.html').includes('olli-feedback-runtime.js?v=20261120-edit-server-first-1'));
  assert.ok(read('apps/mobile/index.html').includes('kinder-feedback.js?v=20261120-reconcile-saved-1'));
  for(const file of ['olli-data-feedback.js','olli-feedback-runtime.js'])
    assert.ok(read('apps/pc/index.html').includes(file+'?v=20261119-quicknote-save-1'));
});
