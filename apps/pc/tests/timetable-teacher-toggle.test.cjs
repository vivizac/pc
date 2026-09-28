const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const js = fs.readFileSync('pc-timetable.js', 'utf8');
const css = fs.readFileSync('pc-timetable.css', 'utf8');

test('teacher pickers use compact toggles instead of inline teacher grids', () => {
  assert.ok(js.includes('function teacherToggleHtml'));
  assert.ok(js.includes('olliTtTeacherToggleRow'));
  assert.ok(js.includes("label: '클래스 담임'"));
  assert.ok(js.includes("label: '당일 담당'"));
  assert.ok(js.includes('data-tt-class-teacher'));
  assert.ok(js.includes('data-tt-daily-teacher'));
});

test('teacher toggle menus open upward without changing dialog layout height', () => {
  assert.ok(css.includes('.olliTtTeacherToggleMenu'));
  assert.ok(css.includes('bottom: calc(100% + 8px)'));
  assert.ok(css.includes('position: absolute'));
  assert.ok(css.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'));
});

test('teacher save paths remain unchanged', () => {
  assert.ok(js.includes('service.setClassTeacher'));
  assert.ok(js.includes('service.setTeacherOverride'));
});
