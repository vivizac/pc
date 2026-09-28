'use strict';

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

test('Mobile Production stays on the legacy repository until the self-contained preview is verified', () => {
  assert.equal(contract.projects.mobile.current_repository, 'vivizac/mobile');
  assert.equal(contract.projects.mobile.target_repository, 'vivizac/pc');
  assert.match(contract.projects.mobile.source_bridge, /self-contained apps\/mobile snapshot/i);
  assert.ok(contract.cutover_rules.some(rule => /Keep current Mobile repository deployment active/i.test(rule)));
});

test('Mobile monorepo build contract requires packages/common to be reachable outside apps/mobile', () => {
  assert.equal(contract.projects.mobile.requires_outside_root_source_access, true);
  assert.ok(contract.cutover_rules.some(rule => /outside-root source access/i.test(rule)));
});

test('raw bridge removal is gated by stable Production deployments', () => {
  assert.ok(contract.cutover_rules.some(rule => /Remove raw GitHub bridges only after both Production deployments are stable/i.test(rule)));
});
