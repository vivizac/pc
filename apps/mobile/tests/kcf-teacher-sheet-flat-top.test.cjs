const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('kcf-teacher-sheet.css', 'utf8');
const js = fs.readFileSync('kcf-teacher-sheet.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('Class mode sheet has a square top edge and no handle', () => {
  assert.match(css, /\.kcfTeacherSheet \{[\s\S]*?border-radius:0;/);
  assert.doesNotMatch(css, /\.kcfTeacherSheetHandle/);
  assert.doesNotMatch(js, /kcfTeacherSheetHandle/);
});

test('Class mode sheet assets are cache busted', () => {
  assert.match(html, /kcf-teacher-sheet\.css\?v=20261001-flat-top-1/);
  assert.match(html, /kcf-teacher-sheet\.js\?v=20261001-flat-top-1/);
});
