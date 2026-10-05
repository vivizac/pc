'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const migration=fs.readFileSync(
  path.join(root,'supabase/migrations/20261005153000_team_chat_action_display_labels.sql'),
  'utf8'
);

test('Team Chat list exposes one derived display_label without exposing full action_payload',()=>{
  assert.match(migration,/private\.olli_team_chat_action_display_label/);
  assert.match(migration,/'display_label'\s*,\s*private\.olli_team_chat_action_display_label/);
  assert.doesNotMatch(migration,/'action_payload'\s*,\s*ac\.action_payload/);
});

test('choice completion labels include the actual persisted selection',()=>{
  for(const token of [
    'selectedClassGroup','dateExpression','targetDateExpression','timeSlot','targetTimeSlot',
    'studentName','division','choiceKey'
  ]){
    assert.match(migration,new RegExp(token));
  }
  assert.match(migration,/반 선택/);
  assert.match(migration,/유치부 선택/);
  assert.match(migration,/초등부 선택/);
  assert.match(migration,/일정 선택/);
  assert.match(migration,/\|\|' 선택'/);
});

test('final successful actions use operation-specific completion labels',()=>{
  for(const label of ['등록 완료','삭제 완료','취소 완료','변경 완료','결석 처리 완료']){
    assert.match(migration,new RegExp(label));
  }
  assert.match(migration,/add_makeup/);
  assert.match(migration,/delete_timetable_memo/);
  assert.match(migration,/cancel_makeup/);
  assert.match(migration,/update_makeup/);
  assert.match(migration,/mark_absent/);
});

test('PC and Mobile render server display_label first and never fall back to generic 처리 완료',()=>{
  for(const source of [pc,mobile]){
    assert.match(source,/display_label/);
    assert.match(source,/status\s*===?\s*['"]completed['"][^\n]*return ['"]완료['"]/);
    assert.doesNotMatch(source,/completed['"]\)\s*return ['"]처리 완료['"]/);
  }
});
