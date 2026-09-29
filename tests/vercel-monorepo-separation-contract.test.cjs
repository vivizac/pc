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

test('Production roots are the app-specific monorepo roots', () => {
  assert.equal(contract.cutover_status, 'completed');
  assert.equal(contract.projects.pc.current_repository, 'vivizac/pc');
  assert.equal(contract.projects.mobile.current_repository, 'vivizac/pc');
  assert.equal(contract.projects.pc.current_root, 'apps/pc');
  assert.equal(contract.projects.mobile.current_root, 'apps/mobile');
  assert.notEqual(contract.projects.pc.current_root, contract.projects.mobile.current_root);
});

test('both app builds require packages/common outside their Root Directory', () => {
  assert.equal(contract.projects.pc.requires_outside_root_source_access, true);
  assert.equal(contract.projects.mobile.requires_outside_root_source_access, true);
  assert.equal(contract.projects.pc.common_source, 'packages/common');
  assert.equal(contract.projects.mobile.common_source, 'packages/common');
});

test('legacy Mobile repository is history only, not the current deployment source', () => {
  assert.equal(contract.projects.mobile.source_history_repository, 'vivizac/mobile');
  assert.match(contract.projects.mobile.source_history_role, /history only/i);
  assert.ok(contract.operating_rules.some(rule => /Do not restore raw GitHub runtime rewrites/i.test(rule)));
});

test('app-root static deployments publish from the app directory itself', () => {
  const pc = JSON.parse(fs.readFileSync('apps/pc/vercel.json','utf8'));
  const mobile = JSON.parse(fs.readFileSync('apps/mobile/vercel.json','utf8'));
  assert.equal(pc.outputDirectory, '.');
  assert.equal(mobile.outputDirectory, '.');
  assert.equal(pc.buildCommand, 'node scripts/stage-common.cjs');
  assert.equal(mobile.buildCommand, 'node scripts/stage-common.cjs');
});
