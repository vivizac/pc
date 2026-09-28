'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MOBILE = path.join(ROOT, 'apps', 'mobile');
const COMMON = path.join(ROOT, 'packages', 'common');

test('Mobile startup does not call the removed memo autosave binding hook', () => {
  const startup = fs.readFileSync(path.join(MOBILE, 'olli-app-startup.js'), 'utf8');
  assert.equal(startup.includes('setupMemoPauseAutoSaveBindings'), false);
  assert.match(startup, /document\.addEventListener\('DOMContentLoaded',\s*async\s*\(\)\s*=>\s*\{/);
  assert.match(startup, /showOlliBootScreen\(\);/);
  assert.match(startup, /await hideOlliBootScreen\(\);/);
});

test('Phone autosave adapter owns memo input lifecycle directly', () => {
  const adapter = fs.readFileSync(path.join(MOBILE, 'olli-observation-autosave-phone-adapter.js'), 'utf8');
  assert.match(adapter, /__olliObservationMemoPhoneAutosaveLifecycleBound/);
  assert.match(adapter, /document\.addEventListener\('input'/);
  assert.match(adapter, /document\.addEventListener\('compositionend'/);
  assert.match(adapter, /document\.addEventListener\('blur'/);
  assert.match(adapter, /handleMemoPauseAutoSaveInput/);
  assert.match(adapter, /handleMemoPauseAutoSaveBlur/);
});

test('Common observation memo core still owns flushMemoAutoSave', () => {
  const common = fs.readFileSync(path.join(COMMON, 'observation-memo-common.js'), 'utf8');
  assert.match(common, /function flushMemoAutoSave\(\)/);
});
