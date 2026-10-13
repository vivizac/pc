const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const css = fs.readFileSync('kcf-auto-mode.css', 'utf8');
const js = fs.readFileSync('olli-feedback-registration-phone-adapter.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('dedicated editing keeps original QuickNote page painted beneath its sheet', () => {
  const start = css.indexOf('body.kcfDedicatedEditSheetOpen #kcfPersistentTopLayer,');
  const stop = css.indexOf('html.kcfDedicatedEditViewportLocked', start);
  const block = css.slice(start, stop);
  assert.ok(start >= 0 && stop > start);
  assert.doesNotMatch(block, /visibility:hidden|opacity:0/);
  assert.match(block, /pointer-events:none/);
});

test('both editing sheets fill the visual viewport without a secondary absolute offset', () => {
  const overlayBlock = css.slice(css.indexOf('.phoneKcfLiveEditOverlay,'),
    css.indexOf('.phoneKcfLiveEditOverlay {'));
  const sheetBlock = css.slice(css.indexOf('.phoneKcfLiveEditSheet,'),
    css.indexOf('.phoneKcfLiveEditHandle,'));
  assert.match(overlayBlock, /display:flex/);
  assert.match(overlayBlock, /padding-top:clamp/);
  assert.match(sheetBlock, /position:relative/);
  assert.match(sheetBlock, /height:100%/);
  assert.doesNotMatch(sheetBlock, /position:absolute|transform:translate|top:var\(--olli-phone-guide-top\)/);
  assert.match(css, /\.phoneKcfRecordEditOverlay\.show \{/);
});

test('both edit screens offer a cancellable top-strip escape hatch', () => {
  assert.match(js, /event\.target === overlay && !phoneKcfLiveEditContext\?\.submitting/);
  assert.match(js, /event\.target === overlay && !phoneKcfRecordEditContext\?\.submitting/);
  assert.match(js, /cancelPhoneKcfRecordEditSheet\(\)/);
  assert.match(js, /closePhoneKcfLiveEditSheet\(\)/);
});

test('new visible editor styles are cache-busted together', () => {
  assert.match(html, /kcf-auto-mode\.css\?v=20261013-sheet-bottom-fill-1/);
  assert.match(html, /olli-feedback-registration-phone-adapter\.js\?v=20261013-sheet-bottom-fill-1/);
});
