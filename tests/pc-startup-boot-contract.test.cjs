'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const rootStartup = fs.readFileSync(path.join(ROOT, 'olli-app-startup.js'), 'utf8');
const appStartup = fs.readFileSync(path.join(ROOT, 'apps', 'pc', 'olli-app-startup.js'), 'utf8');
const commonMemo = fs.readFileSync(path.join(ROOT, 'packages', 'common', 'observation-memo-common.js'), 'utf8');

test('PC startup does not call the removed memo autosave binding hook', () => {
  assert.equal(rootStartup.includes('setupMemoPauseAutoSaveBindings'), false);
  assert.equal(appStartup.includes('setupMemoPauseAutoSaveBindings'), false);
});

test('legacy-root and apps/pc startup stay byte-identical during the cutover bridge', () => {
  assert.equal(rootStartup, appStartup);
});

test('PC startup still keeps memo flush and boot dismissal paths', () => {
  assert.match(rootStartup, /window\.addEventListener\('beforeunload', flushMemoAutoSave\)/);
  assert.match(rootStartup, /showOlliBootScreen\(\);/);
  assert.match(rootStartup, /await hideOlliBootScreen\(\);/);
  assert.match(commonMemo, /function flushMemoAutoSave\(\)/);
});
