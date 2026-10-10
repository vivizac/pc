'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');

const routing=require('../../../packages/common/olli-agent-routing-common.js');

function routerWith(values={}){
  return new Proxy({},{
    get(_target,key){
      if(Object.hasOwn(values,key)) return values[key];
      return undefined;
    }
  });
}

function parser(value){
  return ()=>value;
}

test('route contract has no duplicate routes and covers current Agent business modes',()=>{
  assert.equal(routing.ROUTE_ORDER.length,new Set(routing.ROUTE_ORDER).size);
  for(const route of [
    'attendance_status_prepare','timetable_admin_prepare','batch_prepare','memo_prepare',
    'trial_cancel_prepare','makeup_cancel_prepare','absence_prepare','trial_add_prepare',
    'trial_update_prepare','waitlist_add_prepare','waitlist_update_prepare','waitlist_cancel_prepare',
    'pickup_cancel_prepare','pickup_update_prepare','pickup_prepare','makeup_update_prepare',
    'makeup_prepare','class_once_prepare','move_prepare','move_cancel_prepare',
    'timetable_read','attendance_read','pickup_read','schedule_read'
  ]){
    assert.ok(routing.ROUTE_ORDER.includes(route),route);
  }
});

test('specific attendance status route wins before other write parsers',()=>{
  const router=routerWith({
    parseAttendanceStatusMutationIntent:parser({intent:'set_attendance_status'}),
    parseMakeupMutationIntent:parser({intent:'add_makeup'}),
  });
  assert.equal(routing.classify('command',router).route,'attendance_status_prepare');
});

test('timetable admin is a single route over existing deterministic admin parsers',()=>{
  const router=routerWith({
    parseClassLayoutMutationIntent:parser(null),
    parseTeacherAssignmentMutationIntent:parser({intent:'set_teacher_override'}),
    parseSessionOrderMutationIntent:parser({intent:'set_session_order'}),
  });
  const result=routing.classify('command',router);
  assert.equal(result.route,'timetable_admin_prepare');
  assert.equal(result.candidate.intent,'set_teacher_override');
});

test('cancel/absence without reason remain explicit legacy reason bridges',()=>{
  const cases=[
    ['parseTrialCancelMutationIntent',{intent:'cancel_trial',reason:''},routing.LEGACY_BRIDGES.trial_cancel_reason],
    ['parseMakeupCancelMutationIntent',{intent:'cancel_makeup',reason:''},routing.LEGACY_BRIDGES.makeup_cancel_reason],
    ['parseAbsenceMutationIntent',{intent:'mark_absent',studentName:'학생A',reason:''},routing.LEGACY_BRIDGES.absence_reason],
  ];
  for(const [name,value,bridge] of cases){
    const result=routing.classify('command',routerWith({[name]:parser(value)}));
    assert.equal(result.kind,'legacy_bridge');
    assert.equal(result.legacyBridge,bridge);
    assert.equal(result.route,'');
  }
});

test('reason-complete cancellation can use Agent prepare directly',()=>{
  const result=routing.classify('command',routerWith({
    parseMakeupCancelMutationIntent:parser({intent:'cancel_makeup',reason:'reason'}),
  }));
  assert.equal(result.kind,'agent');
  assert.equal(result.route,'makeup_cancel_prepare');
});

test('trial add without explicit department preserves current legacy department bridge',()=>{
  const result=routing.classify('command',routerWith({
    parseTrialMutationIntent:parser({intent:'add_trial',division:''}),
  }));
  assert.equal(result.kind,'legacy_bridge');
  assert.equal(result.legacyBridge,routing.LEGACY_BRIDGES.trial_department);
});

test('trial add with explicit department is Agent eligible',()=>{
  for(const division of ['elementary','kinder']){
    const result=routing.classify('command',routerWith({
      parseTrialMutationIntent:parser({intent:'add_trial',division}),
    }));
    assert.equal(result.route,'trial_add_prepare');
  }
});

test('canonical classifier resolves pickup/makeup before regular class move family',()=>{
  const router=routerWith({
    parsePickupMutationIntent:parser({intent:'add_pickup'}),
    parseMakeupMutationIntent:parser({intent:'add_makeup'}),
    parseClassMutationIntent:parser({intent:'add_class_once'}),
    parseScheduleMoveMutationIntent:parser({intent:'move_class'}),
  });
  assert.equal(routing.classify('command',router).route,'pickup_prepare');
});

test('generic timetable reads keep precedence over student-specific read heuristics',()=>{
  const router=routerWith({
    parseQueryIntent:parser({intent:'find_pickups'}),
  });
  assert.equal(routing.classify('학생A 픽업 일정 알려줘',router).route,'timetable_read');
});

test('student-specific read heuristics are shared instead of duplicated per platform',()=>{
  const empty=routerWith({});
  assert.equal(routing.classify('학생A 출결 알려줘',empty).route,'attendance_read');
  assert.equal(routing.classify('학생A 픽업 일정 알려줘',empty).route,'pickup_read');
  assert.equal(routing.classify('학생A 시간표 알려줘',empty).route,'schedule_read');
});

test('parser exceptions fail closed and continue to later deterministic routes',()=>{
  const router=routerWith({
    parseAttendanceStatusMutationIntent(){throw new Error('boom');},
    parseMakeupMutationIntent:parser({intent:'add_makeup'}),
  });
  assert.equal(routing.classify('command',router).route,'makeup_prepare');
});

test('classifier only classifies and never owns legacy execution or mutation',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../../../packages/common/olli-agent-routing-common.js'),'utf8');
  assert.doesNotMatch(source,/prepareAction\s*\(/);
  assert.doesNotMatch(source,/runQuery\s*\(/);
  assert.doesNotMatch(source,/executePreparedWrite\s*\(/);
  assert.doesNotMatch(source,/olli_team_chat_action_execute/);
  assert.doesNotMatch(source,/fetch\s*\(/);
});

test('platform-only adapters remain explicit instead of being hidden in common classifier',()=>{
  assert.deepEqual(routing.PLATFORM_ADAPTERS.pc,[]);
  assert.deepEqual(routing.PLATFORM_ADAPTERS.mobile,[
    'makeup_add_draft_prompt',
    'student_info_lookup',
  ]);
});

test('phase A keeps the classifier out of runtime manifests until PC/Mobile wiring',()=>{
  for(const relative of [
    '../../../packages/common/mobile-runtime-manifest.json',
    '../../../packages/common/pc-runtime-manifest.json',
    '../../../packages/common/source-manifest.json',
  ]){
    const json=JSON.parse(fs.readFileSync(path.join(__dirname,relative),'utf8'));
    assert.equal(json.files.includes('olli-agent-routing-common.js'),false,relative);
  }
});
