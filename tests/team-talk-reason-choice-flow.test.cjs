'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobileCss=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.css'),'utf8');
const pcCss=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.css'),'utf8');
const runtime=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/runtime.cjs'),'utf8');
const migration=fs.readFileSync(
  path.join(root,'supabase/migrations/20261007113000_team_chat_reason_choice_action.sql'),
  'utf8'
);

function block(source,startMarker,endMarker){
  const start=source.indexOf(startMarker);
  const end=source.indexOf(endMarker,start+startMarker.length);
  assert.ok(start>=0, 'missing start marker: '+startMarker);
  assert.ok(end>start, 'missing end marker: '+endMarker);
  return source.slice(start,end);
}

test('reason selection is a persisted action type with dedicated send/select RPCs',()=>{
  assert.match(migration,/'choose_reason'::text/);
  assert.match(migration,/function public\.olli_team_chat_send_reason_choice/);
  assert.match(migration,/function public\.olli_team_chat_action_select_reason/);
  assert.match(migration,/set action_type='choose_reason'/);
  assert.match(migration,/status='completed'/);
  assert.match(migration,/'selectedReason'/);
  assert.match(migration,/if v_type='choose_reason'/);
  assert.doesNotMatch(
    block(migration,'create or replace function public.olli_team_chat_action_select_reason','create or replace function private.olli_team_chat_action_display_label'),
    /update public\.olli_team_chat_messages\s+set body/
  );
});

test('mobile reason choice never creates a user chat message or re-enters natural-language AI routing',()=>{
  const submit=block(
    mobile,
    'async function submitOlliTalkPendingReasonText',
    'function openOlliTalkPendingReasonInput'
  );
  assert.match(submit,/olli_team_chat_action_select_reason/);
  assert.match(submit,/resolveOlliTalkPendingReasonDirectTurn/);
  assert.doesNotMatch(submit,/olli_team_chat_send['"]/);
  assert.doesNotMatch(submit,/resolveOlliTalkAiTurn/);

  const direct=block(
    mobile,
    'async function resolveOlliTalkPendingReasonDirectTurn',
    'async function submitOlliTalkPendingReasonText'
  );
  assert.match(direct,/continueOlliTalkBatchReasonChoice/);
  assert.doesNotMatch(direct,/resolveOlliTalkAiTurn\(reason/);
});

test('PC reason choice bypasses composer sendMessage and natural-language AI routing',()=>{
  const submit=block(
    pc,
    'async function submitPendingReasonText',
    'function openPendingReasonInput'
  );
  assert.match(submit,/olli_team_chat_action_select_reason/);
  assert.match(submit,/resolvePendingReasonDirectTurn/);
  assert.doesNotMatch(submit,/sendMessage\(/);
  assert.doesNotMatch(submit,/resolveAiTurn\(/);

  const direct=block(
    pc,
    'async function resolvePendingReasonDirectTurn',
    'async function submitPendingReasonText'
  );
  assert.match(direct,/continueBatchReasonChoice/);
  assert.doesNotMatch(direct,/resolveAiTurn\(reason/);
});

test('pending reason controls belong to the Olli action card and completed value remains as one selected control',()=>{
  for(const source of [mobile,pc]){
    assert.match(source,/action_type[^\n]*choose_reason|choose_reason[^\n]*action_type/);
    assert.match(source,/reasonChoice/);
    assert.match(source,/selectedChoice/);
    assert.match(source,/olli_team_chat_send_reason_choice/);
  }
  assert.match(mobile,/card\.appendChild\(createOlliTalkPendingTextInputButton\(action\)\)/);
  assert.match(pc,/card\.appendChild\(makePendingTextInputButton\(action\)\)/);
  assert.match(mobileCss,/\.olliTalkBetaActionCard\.reasonChoice \.olliTalkBetaPendingInput\{\s*margin:0;/);
  assert.match(pcCss,/\.olliPcTeamTalkActionCard\.reasonChoice \.olliPcTeamTalkPendingInput\{margin:0\}/);
  assert.match(pcCss,/\.olliPcTeamTalkActionButton\.selectedChoice:disabled\{background:#818284/);
});

test('server reason provenance accepts completed reason actions while keeping old user-message compatibility',()=>{
  assert.match(runtime,/async function validatePersistedReasonChoiceMessage/);
  assert.match(runtime,/action_type\|\|''\)\.trim\(\)!=='choose_reason'/);
  assert.match(runtime,/String\(action\?\.status\|\|''\)\.trim\(\)!=='completed'/);
  assert.match(runtime,/normalizeReason\(String\(action\?\.display_label/);
  assert.match(runtime,/if\(selected\) return selected;/);
  assert.match(runtime,/validatePickupSourceMessage/);
});

test('batch reasons continue deterministically after selection',()=>{
  assert.match(mobile,/commands\[reasonIndex\]\.reason=reason/);
  assert.match(mobile,/commands\[reasonIndex\]\.reasonMessageId=Number\(reasonMessageId/);
  assert.match(mobile,/return resolveOlliTalkBatchAgentTurn\(/);
  assert.match(pc,/commands\[reasonIndex\]\.reason=reason/);
  assert.match(pc,/return resolveBatchAgentTurn\(/);
  assert.match(migration,/v_target='batch_write'/);
});
