const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('Agents SDK dependencies are pinned and Node 24 is explicit for the mobile server', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.engines?.node, '24.x');
  assert.equal(pkg.dependencies?.['@openai/agents'], '0.18.0');
  assert.equal(pkg.dependencies?.zod, '4.6.5');
});

test('independent olli-agent endpoint keeps diagnostics isolated from the existing chat endpoint', () => {
  const endpoint = read('api/olli-agent.js');
  const chat = read('api/chat.js');

  assert.match(endpoint, /\['probe', 'privacy_probe', 'schedule_probe', 'records_probe', 'availability_probe', 'attendance_probe'\]\.includes\(mode\)/);
  assert.match(endpoint, /mode === 'privacy_probe'/);
  assert.match(endpoint, /mode === 'schedule_probe'/);
  assert.match(endpoint, /mode === 'records_probe'/);
  assert.match(endpoint, /mode === 'availability_probe'/);
  assert.match(endpoint, /mode === 'attendance_probe'/);
  assert.match(endpoint, /runAttendanceProbe/);
  assert.match(endpoint, /runScheduleAvailabilityProbe/);
  assert.match(endpoint, /loadOlliAgentRequestContext/);
  assert.match(endpoint, /runFoundationProbe/);
  assert.doesNotMatch(chat, /@openai\/agents/);
  assert.doesNotMatch(chat, /api\/olli-agent/);
});

test('request context validates Team Talk AI access and current member before an agent run', () => {
  const context = read('api/_lib/olli-agent/request-context.cjs');

  assert.match(context, /olli_team_talk_settings_get/);
  assert.match(context, /ai_enabled !== true/);
  assert.match(context, /olli_team_chat_members/);
  assert.match(context, /current_member_id/);
  assert.match(context, /toAgentRunContext/);
});

test('session token remains server-local and is not copied into the model run context', () => {
  const context = read('api/_lib/olli-agent/request-context.cjs');
  const match = context.match(/function toAgentRunContext[\s\S]*?module\.exports/);
  assert.ok(match, 'toAgentRunContext block is required');
  assert.doesNotMatch(match[0], /sessionToken:/);
  assert.match(match[0], /academyId:/);
  assert.match(match[0], /memberId:/);
});

test('foundation runtime loads Agents SDK dynamically and keeps foundation probe tool-free', () => {
  const runtime = read('api/_lib/olli-agent/runtime.cjs');

  assert.match(runtime, /import\('@openai\/agents'\)/);
  assert.match(runtime, /import\('zod'\)/);
  assert.match(runtime, /agentsSdk\.tool/);
  assert.match(runtime, /tools: \[\]/);
  assert.match(runtime, /OLLI_AGENT_READY/);
  assert.match(runtime, /MIN_NODE_MAJOR = 22/);
});
