'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname,'..');
const pc = fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile = fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const schedule = fs.readFileSync(path.join(root,'packages/common/olli-command-schedule-common.js'),'utf8');
const makeupMigration = fs.readFileSync(
  path.join(root,'supabase/migrations/20261003022400_team_chat_makeup_group_choice.sql'),
  'utf8'
);
const trialMigration = fs.readFileSync(
  path.join(root,'supabase/migrations/20261003024500_team_chat_trial_group_choice.sql'),
  'utf8'
);
const waitlistMigration = fs.readFileSync(
  path.join(root,'supabase/migrations/20261003030000_team_chat_waitlist_group_choice.sql'),
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

test('PC and Mobile persist makeup, trial, and waitlist group choices with dedicated RPCs', () => {
  for (const source of [pc,mobile]) {
    assert.match(source,/actionType==='choose_makeup_group'/);
    assert.match(source,/actionType==='choose_trial_group'/);
    assert.match(source,/actionType==='choose_waitlist_group'/);
    assert.match(source,/olli_team_chat_send_makeup_group_choice/);
    assert.match(source,/olli_team_chat_send_trial_group_choice/);
    assert.match(source,/olli_team_chat_send_waitlist_group_choice/);
    assert.match(source,/olli_team_chat_action_select_makeup_group/);
    assert.match(source,/olli_team_chat_action_select_trial_group/);
    assert.match(source,/olli_team_chat_action_select_waitlist_group/);
  }
});

test('PC and Mobile render A/B buttons for makeup, trial, and waitlist choices without calling AI', () => {
  const pcStart=pc.indexOf('async function handleSessionGroupChoice');
  const pcEnd=pc.indexOf('function makeActionCard',pcStart);
  const pcHandler=pc.slice(pcStart,pcEnd);
  assert.ok(pcStart>=0 && pcEnd>pcStart);
  assert.match(pcHandler,/olli_team_chat_action_select_makeup_group/);
  assert.match(pcHandler,/olli_team_chat_action_select_trial_group/);
  assert.match(pcHandler,/olli_team_chat_action_select_waitlist_group/);
  assert.doesNotMatch(pcHandler,/interpretOlliSystemLanguage|resolveAiReply|\/api\/olli-agent|\/api\/chat/);
  assert.match(pc,/\['choose_makeup_group','choose_trial_group','choose_waitlist_group'\]\.includes/);
  assert.match(pc,/\['A','B'\]\.forEach/);

  const mobileStart=mobile.indexOf('async function handleOlliTalkSessionGroupChoice');
  const mobileEnd=mobile.indexOf('function createOlliTalkActionCard',mobileStart);
  const mobileHandler=mobile.slice(mobileStart,mobileEnd);
  assert.ok(mobileStart>=0 && mobileEnd>mobileStart);
  assert.match(mobileHandler,/olli_team_chat_action_select_makeup_group/);
  assert.match(mobileHandler,/olli_team_chat_action_select_trial_group/);
  assert.match(mobileHandler,/olli_team_chat_action_select_waitlist_group/);
  assert.doesNotMatch(mobileHandler,/interpretOlliTalkSystemLanguage|resolveOlliTalkAiReply|\/api\/olli-agent|\/api\/chat/);
  assert.match(mobile,/\['choose_makeup_group','choose_trial_group','choose_waitlist_group'\]\.includes/);
  assert.match(mobile,/\['A','B'\]\.forEach/);
});

test('database makeup choice is non-executable until a valid group converts it to add_makeup', () => {
  assert.match(makeupMigration,/'choose_makeup_group'::text/);
  assert.match(makeupMigration,/olli_team_chat_send_makeup_group_choice/);
  assert.match(makeupMigration,/olli_team_chat_action_select_makeup_group/);
  assert.match(makeupMigration,/v_action\.action_type <> 'choose_makeup_group'/);
  assert.match(makeupMigration,/set action_type='add_makeup'/);
  assert.match(makeupMigration,/'classGroup',v_group/);
  assert.match(makeupMigration,/where upper\(btrim\(item\.value\)\)=v_group/);
  assert.match(makeupMigration,/olli_account_id_from_session/);
  assert.match(makeupMigration,/m\.account_id=v_account_id/);
});

test('database trial choice is non-executable until a valid group converts it to add_trial', () => {
  assert.match(trialMigration,/'choose_trial_group'::text/);
  assert.match(trialMigration,/olli_team_chat_send_trial_group_choice/);
  assert.match(trialMigration,/olli_team_chat_action_select_trial_group/);
  assert.match(trialMigration,/v_action\.action_type <> 'choose_trial_group'/);
  assert.match(trialMigration,/set action_type='add_trial'/);
  assert.match(trialMigration,/'classGroup',v_group/);
  assert.match(trialMigration,/where upper\(btrim\(item\.value\)\)=v_group/);
  assert.match(trialMigration,/olli_account_id_from_session/);
  assert.match(trialMigration,/m\.account_id=v_account_id/);
});

test('database waitlist choice is non-executable until a valid group converts it to add_waitlist', () => {
  assert.match(waitlistMigration,/'choose_waitlist_group'::text/);
  assert.match(waitlistMigration,/olli_team_chat_send_waitlist_group_choice/);
  assert.match(waitlistMigration,/olli_team_chat_action_select_waitlist_group/);
  assert.match(waitlistMigration,/v_action\.action_type <> 'choose_waitlist_group'/);
  assert.match(waitlistMigration,/set action_type='add_waitlist'/);
  assert.match(waitlistMigration,/'targetClassGroup',v_group/);
  assert.match(waitlistMigration,/where upper\(btrim\(item\.value\)\)=v_group/);
  assert.match(waitlistMigration,/olli_account_id_from_session/);
  assert.match(waitlistMigration,/m\.account_id=v_account_id/);
});
