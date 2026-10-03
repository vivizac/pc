'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname,'..');
const pc = fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile = fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const schedule = fs.readFileSync(path.join(root,'packages/common/olli-command-schedule-common.js'),'utf8');
const migration = fs.readFileSync(
  path.join(root,'supabase/migrations/20261003022400_team_chat_makeup_group_choice.sql'),
  'utf8'
);

test('schedule returns a typed class-group choice instead of asking for typed A/B text', () => {
  assert.match(schedule,/code:'class_group_required'/);
  assert.match(schedule,/intent:'choose_makeup_group'/);
  assert.match(schedule,/allowedClassGroups:target\.choices\.slice\(\)/);
  assert.doesNotMatch(
    schedule,
    /A반 또는 B반을 명령에 같이 적어 주세요/
  );
});

test('PC and Mobile persist makeup group choice with its dedicated RPC', () => {
  for (const source of [pc,mobile]) {
    assert.match(source,/actionType==='choose_makeup_group'/);
    assert.match(source,/olli_team_chat_send_makeup_group_choice/);
    assert.match(source,/olli_team_chat_action_select_makeup_group/);
  }
});

test('PC and Mobile render A/B buttons for choose_makeup_group without calling AI', () => {
  const pcStart=pc.indexOf('async function handleMakeupGroupChoice');
  const pcEnd=pc.indexOf('function makeActionCard',pcStart);
  const pcHandler=pc.slice(pcStart,pcEnd);
  assert.ok(pcStart>=0 && pcEnd>pcStart);
  assert.match(pcHandler,/olli_team_chat_action_select_makeup_group/);
  assert.doesNotMatch(pcHandler,/interpretOlliSystemLanguage|resolveAiReply|\/api\/olli-agent|\/api\/chat/);
  assert.match(pc,/clean\(action\?\.action_type\)==='choose_makeup_group'/);
  assert.match(pc,/\['A','B'\]\.forEach/);

  const mobileStart=mobile.indexOf('async function handleOlliTalkMakeupGroupChoice');
  const mobileEnd=mobile.indexOf('function createOlliTalkActionCard',mobileStart);
  const mobileHandler=mobile.slice(mobileStart,mobileEnd);
  assert.ok(mobileStart>=0 && mobileEnd>mobileStart);
  assert.match(mobileHandler,/olli_team_chat_action_select_makeup_group/);
  assert.doesNotMatch(mobileHandler,/interpretOlliTalkSystemLanguage|resolveOlliTalkAiReply|\/api\/olli-agent|\/api\/chat/);
  assert.match(mobile,/action\?\.action_type \|\| ''\)\.trim\(\)==='choose_makeup_group'/);
  assert.match(mobile,/\['A','B'\]\.forEach/);
});

test('database choice action is non-executable until a valid group converts it to add_makeup', () => {
  assert.match(migration,/'choose_makeup_group'::text/);
  assert.match(migration,/olli_team_chat_send_makeup_group_choice/);
  assert.match(migration,/olli_team_chat_action_select_makeup_group/);
  assert.match(migration,/v_action\.action_type <> 'choose_makeup_group'/);
  assert.match(migration,/set action_type='add_makeup'/);
  assert.match(migration,/'classGroup',v_group/);
  assert.match(migration,/where upper\(btrim\(item\.value\)\)=v_group/);
  assert.match(migration,/olli_account_id_from_session/);
  assert.match(migration,/m\.account_id=v_account_id/);
});
