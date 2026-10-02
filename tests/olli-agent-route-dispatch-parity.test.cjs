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

test('shared classifier is staged and loaded before platform Team Chat runtimes',()=>{
  for(const manifest of [pcManifest,mobileManifest]){
    assert.ok(manifest.files.includes('olli-team-talk-agent-route-common.js'));
  }
  assert.ok(pos(pcHtml,'olli-command-router-common.js')>=0);
  assert.ok(pos(pcHtml,'olli-team-talk-agent-route-common.js')>pos(pcHtml,'olli-command-router-common.js'));
  assert.ok(pos(pcHtml,'pc-team-talk.js')>pos(pcHtml,'olli-team-talk-agent-route-common.js'));

  assert.ok(pos(mobileHtml,'olli-command-router-common.js')>=0);
  assert.ok(pos(mobileHtml,'olli-team-talk-agent-route-common.js')>=0);
  assert.ok(pos(mobileHtml,'olli-talk-beta.js')>pos(mobileHtml,'olli-team-talk-agent-route-common.js'));
});

test('PC and Mobile AI turns classify once through the shared route SOT',()=>{
  assert.match(pc,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(pc,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(pc,/async function resolveSharedAgentRouteTurn/);

  assert.match(mobile,/window\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(mobile,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(mobile,/async function resolveOlliTalkSharedAgentRouteTurn/);
});

test('duplicated candidate if-chain is gone from the active AI dispatch functions',()=>{
  const pcStart=pc.indexOf('async function resolveAiTurn(');
  const pcEnd=pc.indexOf('function updateComposerState',pcStart);
  const pcTurn=pc.slice(pcStart,pcEnd);
  assert.doesNotMatch(pcTurn,/const attendanceStatusCandidate=parseAttendanceStatusAgentCandidate/);
  assert.doesNotMatch(pcTurn,/const timetableReadCandidate=parseTimetableReadAgentCandidate/);

  const mobileStart=mobile.indexOf('async function resolveOlliTalkAiTurn(');
  const mobileEnd=mobile.indexOf('function getOlliTalkMentionMessageText',mobileStart);
  const mobileTurn=mobile.slice(mobileStart,mobileEnd);
  assert.doesNotMatch(mobileTurn,/const attendanceStatusCandidate=parseOlliTalkAttendanceStatusAgentCandidate/);
  assert.doesNotMatch(mobileTurn,/const timetableReadCandidate=parseOlliTalkTimetableReadAgentCandidate/);
});

test('existing pending, legacy fallback, and general AI boundaries remain intact',()=>{
  assert.match(pc,/state\.pendingActionReason/);
  assert.match(pc,/router\.prepareAction\(commandText/);
  assert.match(pc,/router\.runQuery\(commandText/);
  assert.match(pc,/fetch\('\/api\/chat'/);

  assert.match(mobile,/olliTalkPendingActionReason/);
  assert.match(mobile,/router\.prepareAction\(commandText/);
  assert.match(mobile,/router\.runQuery\(commandText/);
  assert.match(mobile,/fetch\('\/api\/chat'/);
});

test('batch continuation remains platform-local and unchanged in ownership',()=>{
  assert.match(pc,/__batchAgent/);
  assert.match(pc,/applyBatchClarification/);
  assert.match(mobile,/__batchAgent/);
  assert.match(mobile,/applyOlliTalkBatchClarification/);
});

test('Mobile-only adapters stay outside the common classifier dispatch',()=>{
  const start=mobile.indexOf('async function resolveOlliTalkAiTurn(');
  const end=mobile.indexOf("if(router && typeof router.prepareAction==='function')",start);
  const active=mobile.slice(start,end);
  const dispatch=active.indexOf('resolveOlliTalkSharedAgentRouteTurn');
  const draft=active.indexOf('parseOlliTalkMakeupAddDraftCandidate',dispatch);
  const studentInfo=active.indexOf('resolveOlliTalkStudentInfoCommand',dispatch);
  assert.ok(dispatch>=0);
  assert.ok(draft>dispatch);
  assert.ok(studentInfo>draft);
});

test('reason-required routes fall through when the shared candidate lacks a reason',()=>{
  const pcStart=pc.indexOf('async function resolveSharedAgentRouteTurn');
  const pcEnd=pc.indexOf('async function resolveAiTurn',pcStart);
  const pcDispatch=pc.slice(pcStart,pcEnd);
  assert.match(pcDispatch,/case 'trial_cancel':[\s\S]*?if \(!clean\(parsed\?\.reason\)\) return null/);
  assert.match(pcDispatch,/case 'makeup_cancel':[\s\S]*?if \(!clean\(parsed\?\.reason\)\) return null/);
  assert.match(pcDispatch,/case 'absence':[\s\S]*?if \(!clean\(parsed\?\.reason\)\) return null/);

  const mobileStart=mobile.indexOf('async function resolveOlliTalkSharedAgentRouteTurn');
  const mobileEnd=mobile.indexOf('async function resolveOlliTalkAiTurn',mobileStart);
  const mobileDispatch=mobile.slice(mobileStart,mobileEnd);
  assert.match(mobileDispatch,/case 'trial_cancel':[\s\S]*?return null/);
  assert.match(mobileDispatch,/case 'makeup_cancel':[\s\S]*?return null/);
  assert.match(mobileDispatch,/case 'absence':[\s\S]*?return null/);
});

test('common classifier remains classification-only',()=>{
  const common=fs.readFileSync(path.join(COMMON,'olli-team-talk-agent-route-common.js'),'utf8');
  assert.doesNotMatch(common,/fetch\s*\(/);
  assert.doesNotMatch(common,/supabase/i);
  assert.doesNotMatch(common,/olli_team_chat_action_execute/);
});
