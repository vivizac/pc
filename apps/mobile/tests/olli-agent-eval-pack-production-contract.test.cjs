'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const observability=fs.readFileSync(path.join(root,'api/_lib/olli-agent/observability.cjs'),'utf8');
const evalContracts=fs.readFileSync(path.join(root,'api/_lib/olli-agent/eval-contracts.cjs'),'utf8');

test('production observability evaluates mapped contracts but remains non-blocking',()=>{
  assert.match(observability,/resolveAgentEvalContract/);
  assert.match(observability,/evaluateRunSummary\(summary, contract\)/);
  assert.match(observability,/evaluation && evaluation\.ok === false \? 'warn' : 'info'/);
  assert.ok(
    observability.indexOf('emitEvalLog({') < observability.indexOf('return result;'),
    'eval logging should observe a successful run before returning it'
  );
  assert.doesNotMatch(observability,/throw.*DUPLICATE_TOOL_CALL/);
});

test('eval contracts require one deterministic tool for business agents',()=>{
  assert.match(evalContracts,/maxToolCalls:\s*1/);
  assert.match(evalContracts,/forbidDuplicateTools:\s*true/);
  assert.match(evalContracts,/requireFinalOutput:\s*true/);
  assert.match(evalContracts,/Olli Timetable Read/);
  assert.match(evalContracts,/prepare_attendance_status/);
});

test('representative scenario manifest contains no student names, UUIDs, or message ids',()=>{
  assert.match(evalContracts,/REPRESENTATIVE_SCENARIOS/);
  assert.doesNotMatch(evalContracts,/[가-힣]{2,4}\s*(?:학생|어머|아버|선생)/);
  assert.doesNotMatch(evalContracts,/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  assert.doesNotMatch(evalContracts,/team-chat-message:\d+/);
});
