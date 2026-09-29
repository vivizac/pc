'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const appStartup = fs.readFileSync(path.join(ROOT, 'apps', 'pc', 'olli-app-startup.js'), 'utf8');
const commonMemo = fs.readFileSync(path.join(ROOT, 'packages', 'common', 'observation-memo-common.js'), 'utf8');

test('PC startup does not call the removed memo autosave binding hook', () => {
  assert.equal(appStartup.includes('setupMemoPauseAutoSaveBindings'), false);
});

test('PC startup still keeps memo flush and boot dismissal paths', () => {
  assert.match(appStartup, /window\.addEventListener\('beforeunload', flushMemoAutoSave\)/);
  assert.match(appStartup, /showOlliBootScreen\(\);/);
  assert.match(appStartup, /await hideOlliBootScreen\(\);/);
  assert.match(commonMemo, /function flushMemoAutoSave\(\)/);
});
