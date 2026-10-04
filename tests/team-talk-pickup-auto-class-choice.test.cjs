'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const schedule=fs.readFileSync(path.join(root,'packages/common/olli-command-schedule-common.js'),'utf8');
const router=fs.readFileSync(path.join(root,'packages/common/olli-command-router-common.js'),'utf8');
const interpreter=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/context-route.cjs'),'utf8');
const migration=fs.readFileSync(
  path.join(root,'supabase/migrations/20261004212000_team_chat_pickup_class_choice.sql'),
  'utf8'
);

test('add_pickup can resolve the current regular class instead of requiring typed weekday and class time',()=>{
  const start=schedule.indexOf('async function preparePickupCommand');
  const end=schedule.indexOf('async function prepareMakeupCommand',start);
  const block=schedule.slice(start,end);
  assert.match(block,/activeStudentEnrollments/);
  assert.match(block,/sourceEnrollmentId/);
  assert.match(block,/targetType:'pickup_class'/);
  assert.match(block,/choiceKey:'sourceEnrollmentId'/);
  assert.match(block,/정규 수업이 여러 개 있어요/);
  assert.doesNotMatch(block,/수업 요일·시간, 픽업 장소/);
});

test('add_pickup target choice uses stable enrollment ids and returns to the existing pickup SOT',()=>{
  const start=router.indexOf("if (action === 'add_pickup')");
  const end=router.indexOf("const studentName = cleanText(command.student_name",start+20);
  const block=router.slice(start,end);
  assert.match(block,/sourceEnrollmentId:cleanText\(command\.source_enrollment_id \|\| command\.sourceEnrollmentId\)/);
  assert.match(block,/prepared\?\.code === 'target_choice_required'/);
  assert.match(block,/structuredTargetChoiceResult\('add_pickup'/);
});

test('pickup class choice migration only updates the draft selection and never executes schedule mutation',()=>{
  assert.match(migration,/'add_pickup'/);
  assert.match(migration,/'sourceEnrollmentId'/);
  assert.match(migration,/jsonb_set\(v_draft,array\[v_key\]/);
  assert.doesNotMatch(migration,/olli_schedule_execute\s*\(/);
  assert.doesNotMatch(migration,/olli_team_chat_action_execute\s*\(/);
});

test('routine interpreter is isolated on GPT-5.6 Luna with reasoning none',()=>{
  const start=interpreter.indexOf('async function defaultOlliInterpreterRunner');
  const end=interpreter.indexOf('\nasync function ',start+20);
  const block=interpreter.slice(start,end>start?end:interpreter.length);
  assert.match(block,/OPENAI_ROUTINE_INTERPRETER_MODEL/);
  assert.match(block,/'gpt-5\.6-luna'/);
  assert.match(block,/reasoning:\{effort:'none'\}/);
  assert.doesNotMatch(block,/OPENAI_AGENT_MODEL \|\| process\.env\.OPENAI_MODEL/);
  assert.match(block,/If the class is omitted, keep weekday\/class_time\/class_minute as 0/);
});
