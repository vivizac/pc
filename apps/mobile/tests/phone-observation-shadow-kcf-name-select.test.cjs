const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const observationCssPath = path.join(root, 'olli-observation-roster-phone.css');
const baseCssPath = path.join(root, 'olli-phone-base.css');
const finalOverridesPath = path.join(root, 'olli-phone-final-overrides.css');
const adapterPath = path.join(root, 'olli-feedback-registration-phone-adapter.js');
const indexPath = path.join(root, 'index.html');
const vercelPath = path.join(root, 'vercel.json');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('phone feedback adapter parses as JavaScript', () => {
  execFileSync(process.execPath, ['--check', adapterPath], { stdio: 'pipe' });
});

test('observation memo slide has a left-side shadow while entering and leaving', () => {
  const css = read(observationCssPath);
  assert.match(css, /#studentMemoScreen\.observation-editor-slide-enter,\s*#studentMemoScreen\.observation-editor-slide-leave\s*\{\s*box-shadow:-18px 0 36px rgba\(0,0,0,\.14\);\s*\}/);
});

test('legacy final override layer and one-minute feedback hamburger offset are removed', () => {
  assert.equal(fs.existsSync(finalOverridesPath), false);
  const css = read(baseCssPath);
  assert.doesNotMatch(css, /#kinderChatFeedbackScreen\s+\.kcfRecordBtn\s+svg\s*\{[^}]*transform\s*:/s);
});

test('phone adapter no longer duplicates direct-name student selection', () => {
  const adapter = read(adapterPath);
  assert.doesNotMatch(adapter, /consumeTypedStudentFirstLine/);
  assert.doesNotMatch(adapter, /getActiveStudentsByName/);
  assert.doesNotMatch(adapter, /captureSubmitContext/);
  assert.match(adapter, /Shared feedback execution stays in PC canonical sources/);
});

test('phone loads the canonical common registration owner before its phone-only adapter', () => {
  const html = read(indexPath);
  const commonIndex = html.indexOf('olli-feedback-registration-runtime.js');
  const adapterIndex = html.indexOf('olli-feedback-registration-phone-adapter.js');
  assert.ok(commonIndex >= 0 && adapterIndex > commonIndex);

  const vercel = read(vercelPath);
  assert.match(vercel, /"source":"\/olli-feedback-registration-runtime\.js"/);
  assert.match(vercel, /vivizac\/pc\/main\/olli-feedback-registration-runtime\.js/);
});
