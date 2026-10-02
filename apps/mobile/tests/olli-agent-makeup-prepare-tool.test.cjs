'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');

const {
  makeupDialogueOutcomeFromError,
}=require('../api/_lib/olli-agent/tools/makeup-prepare-tools.cjs');

function businessError(code){
  const error=new Error('human text must not be exposed as the tool dialogue contract');
  error.code=code;
  error.statusCode=409;
  return error;
}

test('split makeup slot becomes structured clarification with class options',()=>{
  const result=makeupDialogueOutcomeFromError(
    businessError('OLLI_AGENT_MAKEUP_GROUP_REQUIRED'),
    {
      sessionDate:'2026-10-06',
      classHour:4,
      classMinute:0,
      classGroup:'AUTO',
    }
  );

  assert.deepEqual(result,{
    ok:false,
    status:'needs_clarification',
    reason:'class_group_required',
    session_date:'2026-10-06',
    class_hour:4,
    class_minute:0,
    options:{class_groups:['A','B']},
  });
  assert.equal('message' in result,false);
  assert.equal('error' in result,false);
});

test('full makeup slot becomes structured blocked result rather than a thrown dialogue sentence',()=>{
  const result=makeupDialogueOutcomeFromError(
    businessError('OLLI_AGENT_MAKEUP_FULL'),
    {
      sessionDate:'2026-10-06',
      classHour:4,
      classMinute:0,
      classGroup:'B',
    }
  );

  assert.equal(result.status,'blocked');
  assert.equal(result.reason,'class_full');
  assert.equal(result.requested_class_group,'B');
  assert.equal('message' in result,false);
  assert.equal('error' in result,false);
});

test('unexpected internal errors remain errors instead of becoming user dialogue outcomes',()=>{
  const result=makeupDialogueOutcomeFromError(
    businessError('OLLI_AGENT_INTERNAL_UNEXPECTED'),
    {
      sessionDate:'2026-10-06',
      classHour:4,
      classMinute:0,
      classGroup:'AUTO',
    }
  );
  assert.equal(result,null);
});
