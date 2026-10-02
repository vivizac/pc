'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const runtime=fs.readFileSync(path.join(root,'api/_lib/olli-agent/runtime.cjs'),'utf8');
const observability=fs.readFileSync(path.join(root,'api/_lib/olli-agent/observability.cjs'),'utf8');
const agentApi=fs.readFileSync(path.join(root,'api/olli-agent.js'),'utf8');

test('all Agents SDK runs are wrapped at the single runtime load boundary',()=>{
  assert.match(runtime,/require\('\.\/observability\.cjs'\)/);
  assert.match(runtime,/run:\s*wrapOlliAgentRun\(agentsSdk\.run\)/);
  assert.doesNotMatch(runtime,/run:\s*agentsSdk\.run/);
});

test('production tracing excludes sensitive generation and tool payload data',()=>{
  assert.match(observability,/traceIncludeSensitiveData:\s*false/);
  assert.match(observability,/workflowName:\s*WORKFLOW_NAME/);
  assert.match(observability,/privacy:\s*'redacted'/);
  assert.match(observability,/delete next\.traceId/);
});

test('eval logs contain structural tool metadata only',()=>{
  assert.match(observability,/argumentKeys:\s*parseArgumentKeys/);
  assert.match(observability,/shape:\s*outputShape/);
  assert.doesNotMatch(observability,/JSON\.stringify\(result\)/);
  assert.doesNotMatch(observability,/JSON\.stringify\(input\)/);
});


test('fallback route outcome endpoint authenticates first and emits only safe structural fields',()=>{
  const contextPos=agentApi.indexOf('loadOlliAgentRequestContext(body)');
  const routePos=agentApi.indexOf("if (mode === 'route_outcome')");
  assert.ok(contextPos>=0);
  assert.ok(routePos>contextPos);
  assert.match(agentApi,/emitRouteOutcomeLog\(\{[\s\S]*?surface:[\s\S]*?outcome:[\s\S]*?routeKey:[\s\S]*?sharedRouteKey:[\s\S]*?classifierAvailable:/);
  assert.match(observability,/const ROUTE_OUTCOMES = new Set\(\['legacy_write', 'legacy_read', 'suggested'\]\)/);
  assert.match(observability,/ROUTE_OUTCOME_LOG_PREFIX \+ JSON\.stringify\(event\)/);
});
