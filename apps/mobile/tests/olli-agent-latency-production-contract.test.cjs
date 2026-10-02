'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const requestContext=fs.readFileSync(path.join(root,'api/_lib/olli-agent/request-context.cjs'),'utf8');
const runtime=fs.readFileSync(path.join(root,'api/_lib/olli-agent/runtime.cjs'),'utf8');

test('Agent request context reads independent settings and member data in parallel',()=>{
  assert.match(
    requestContext,
    /const \[settings, members\] = await Promise\.all\(\[[\s\S]*?olli_team_talk_settings_get[\s\S]*?olli_team_chat_members[\s\S]*?\]\);/
  );
});

test('production prepare agents stop after the persisted tool result instead of running the model twice',()=>{
  const conditional="toolUseBehavior: requirePersistedMessage ? 'stop_on_first_tool' : 'run_llm_again'";
  const count=runtime.split(conditional).length-1;
  assert.equal(count,17);

  assert.match(
    runtime,
    /name:'Olli Timetable Admin Prepare'[\s\S]*?modelSettings:\{toolChoice:'prepare_timetable_admin'\},[\s\S]*?toolUseBehavior:'stop_on_first_tool'/
  );
  assert.match(
    runtime,
    /name:'Olli Attendance Status Prepare'[\s\S]*?modelSettings:\{toolChoice:'prepare_attendance_status'\},[\s\S]*?toolUseBehavior:'stop_on_first_tool'/
  );
});

test('read agents still keep the post-tool model pass for natural-language answers',()=>{
  const scheduleStart=runtime.indexOf("name: 'Olli Student Schedule Probe'");
  const scheduleEnd=runtime.indexOf('async function runRecentRecordsProbe',scheduleStart);
  assert.ok(scheduleStart>=0 && scheduleEnd>scheduleStart);
  assert.doesNotMatch(runtime.slice(scheduleStart,scheduleEnd),/toolUseBehavior:\s*'stop_on_first_tool'/);

  const timetableStart=runtime.indexOf("name:'Olli Timetable Read'");
  const timetableEnd=runtime.indexOf('function parseTimetableAdminSource',timetableStart);
  assert.ok(timetableStart>=0 && timetableEnd>timetableStart);
  assert.doesNotMatch(runtime.slice(timetableStart,timetableEnd),/toolUseBehavior:\s*'stop_on_first_tool'/);
});
