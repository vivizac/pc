const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const contract = JSON.parse(fs.readFileSync('deploy/vercel-projects.json','utf8'));

test('PC and Mobile use different Vercel project IDs', () => {
  assert.notEqual(contract.projects.pc.vercel_project_id, contract.projects.mobile.vercel_project_id);
  assert.equal(contract.projects.pc.deploy_independently, true);
  assert.equal(contract.projects.mobile.deploy_independently, true);
});

test('monorepo target roots remain app-specific', () => {
  assert.equal(contract.projects.pc.target_root, 'apps/pc');
  assert.equal(contract.projects.mobile.target_root, 'apps/mobile');
  assert.notEqual(contract.projects.pc.target_root, contract.projects.mobile.target_root);
});

test('Mobile production stays on the legacy repository until its monorepo root is self-contained', () => {
  assert.equal(contract.projects.mobile.current_repository, 'vivizac/mobile');
  assert.equal(contract.projects.mobile.target_repository, 'vivizac/pc');
  assert.match(contract.projects.mobile.source_bridge, /gitlink/i);
  assert.ok(contract.cutover_rules.some(rule => /Keep current Mobile repository deployment active/i.test(rule)));
});

test('raw bridge removal is explicitly gated by both production deployments', () => {
  assert.ok(contract.cutover_rules.some(rule => /Remove raw GitHub bridges only after both Production deployments are stable/i.test(rule)));
});
