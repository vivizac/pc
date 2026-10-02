'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const repoRoot=path.resolve(__dirname,'../../..');
const migration=fs.readFileSync(
  path.join(repoRoot,'supabase/migrations/20261002070047_team_chat_attendance_status_agent_action.sql'),
  'utf8'
);
const safety=fs.readFileSync(
  path.join(repoRoot,'apps/mobile/api/_lib/olli-agent/confirmation-safety.cjs'),
  'utf8'
);

test('production confirmation contract keeps prepare and execute as separate phases',()=>{
  const send=migration.indexOf('CREATE OR REPLACE FUNCTION public.olli_team_chat_send_action');
  const execute=migration.indexOf('CREATE OR REPLACE FUNCTION public.olli_team_chat_action_execute');
  assert.ok(execute>=0);
  assert.ok(send>=0);
  assert.doesNotMatch(migration.slice(send),/perform\s+public\.olli_team_chat_action_execute/i);
});

test('failure path cannot be reported as completed',()=>{
  const okGuard=migration.indexOf("if coalesce((v_result->>'ok')::boolean,false) is not true then");
  const failUpdate=migration.indexOf("set status='failed'",okGuard);
  const completeUpdate=migration.indexOf("set status='completed'",okGuard);
  assert.ok(okGuard>=0);
  assert.ok(failUpdate>okGuard);
  assert.ok(completeUpdate>okGuard);
});

test('safety manifest records production attention codes without personal identifiers',()=>{
  assert.match(safety,/CONFIRMATION_STALE_SOT_REJECTED/);
  assert.match(safety,/CONFIRMATION_NON_PENDING_EXECUTION/);
  assert.doesNotMatch(safety,/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  assert.doesNotMatch(safety,/team-chat-message:\d+/);
});
