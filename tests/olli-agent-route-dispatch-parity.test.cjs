'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.resolve(__dirname,'..');
const COMMON=path.join(ROOT,'packages','common');
const pc=fs.readFileSync(path.join(ROOT,'apps','pc','pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(ROOT,'apps','mobile','olli-talk-beta.js'),'utf8');
const pcHtml=fs.readFileSync(path.join(ROOT,'apps','pc','index.html'),'utf8');
const mobileHtml=fs.readFileSync(path.join(ROOT,'apps','mobile','index.html'),'utf8');
const pcManifest=JSON.parse(fs.readFileSync(path.join(COMMON,'pc-runtime-manifest.json'),'utf8'));
const mobileManifest=JSON.parse(fs.readFileSync(path.join(COMMON,'mobile-runtime-manifest.json'),'utf8'));

function pos(html,name){return html.indexOf(name);}

test('shared classifier remains staged before Team Chat runtimes',()=>{
  for(const manifest of [pcManifest,mobileManifest]){
    assert.ok(manifest.files.includes('olli-team-talk-agent-route-common.js'));
  }
  assert.ok(pos(pcHtml,'olli-team-talk-agent-route-common.js')>pos(pcHtml,'olli-command-router-common.js'));
  assert.ok(pos(pcHtml,'pc-team-talk.js')>pos(pcHtml,'olli-team-talk-agent-route-common.js'));
  assert.ok(pos(mobileHtml,'olli-team-talk-agent-route-common.js')>pos(mobileHtml,'olli-command-router-common.js'));
  assert.ok(pos(mobileHtml,'olli-talk-beta.js')>pos(mobileHtml,'olli-team-talk-agent-route-common.js'));
});

test('PC and Mobile still use shared classifier only for Agent-routed intents',()=>{
  assert.match(pc,/OlliTeamTalkAgentRouteClassifier/);
  assert.match(pc,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(mobile,/OlliTeamTalkAgentRouteClassifier/);
  assert.match(mobile,/routeClassifier\.classify\(commandText,\{router\}\)/);
});

test('shared Agent dispatch contains only attendance status, attendance history, and pickup history',()=>{
  const pcDispatch=pc.slice(pc.indexOf('async function resolveSharedAgentRouteTurn'),pc.indexOf('async function resolveContextualMakeupTurn'));
  const mobileDispatch=mobile.slice(mobile.indexOf('async function resolveOlliTalkSharedAgentRouteTurn'),mobile.indexOf('async function resolveOlliTalkContextualMakeupTurn'));
  for(const source of [pcDispatch,mobileDispatch]){
    assert.match(source,/case 'attendance_status'/);
    assert.match(source,/case 'attendance_read'/);
    assert.match(source,/case 'pickup_read'/);
    for(const removed of [
      'trial_cancel','makeup_cancel','absence','trial_add','waitlist_add',
      'pickup_add','makeup_add','move_cancel','class_once','timetable_read',
      'schedule_read','batch_write','timetable_admin','timetable_memo'
    ]) assert.doesNotMatch(source,new RegExp("case '"+removed+"'"));
  }
});

test('legacy fallback executors remain as compatibility safety net after rule routes',()=>{
  assert.match(pc,/router\.prepareAction\(commandText/);
  assert.match(pc,/router\.runQuery\(commandText/);
  assert.match(mobile,/router\.prepareAction\(commandText/);
  assert.match(mobile,/router\.runQuery\(commandText/);
});

test('common classifier remains classification-only',()=>{
  const common=fs.readFileSync(path.join(COMMON,'olli-team-talk-agent-route-common.js'),'utf8');
  assert.doesNotMatch(common,/fetch\s*\(/);
  assert.doesNotMatch(common,/supabase/i);
  assert.doesNotMatch(common,/olli_team_chat_action_execute/);
});
