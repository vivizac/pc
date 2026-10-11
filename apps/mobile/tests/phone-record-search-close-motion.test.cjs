const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const js = fs.readFileSync(require('node:path').join(__dirname, '..', 'olli-record-search-controls.js'), 'utf8');
const css = fs.readFileSync(require('node:path').join(__dirname, '..', 'olli-record-search-controls.css'), 'utf8');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');

test('record search close runs only once and does not refetch an empty search', () => {
  const close = js.split('function closeSearch(event) {')[1]?.split('async function searchRecords() {')[0] || '';
  assert.match(close, /if \(!screen\?\.classList\.contains\('record-search-open'\)\) return/);
  assert.match(close, /if \(hadQuery \|\| \(list && !list\.children\.length\)\)/);
  assert.match(close, /void loadRecords\('', \{ localOnly:true \}\)/);
  assert.doesNotMatch(close, /\bloadRecords\(''\);/);
});
test('keyboard closure waits for utility-row geometry before list fade', () => {
  assert.match(js, /recordSearchListReturnTimer = setTimeout\(finishRecordSearchListReturn, 240\)/);
  assert.match(js, /recordSearchListReturnFallback = setTimeout\(finishRecordSearchListReturn, 900\)/);
  assert.match(js, /if \(!keyboardOpen && closingNow\) \{\s*screen\.classList\.remove\('record-keyboard-closing'\);\s*scheduleRecordSearchListReturn\(\)/);
  assert.match(js, /beforeFocus:function\(\) \{\s*cancelRecordSearchListReturn\(\)/);
  assert.match(css, /#recordRoomScreen\.record-search-list-restoring #recordList \{\s*opacity:0;/);
});
test('record search CSS and JS versions agree', () => {
  assert.match(html, /olli-record-search-controls\.js\?v=20261011-search-close-smooth-1/);
  assert.match(html, /olli-record-search-controls\.css\?v=20261011-search-close-smooth-1/);
});
