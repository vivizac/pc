const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const runtime = fs.readFileSync('apps/pc/pc-student-info-card-runtime.js', 'utf8');
const loader = fs.readFileSync('apps/pc/pc-start-page.js', 'utf8');
const htmlEntry = fs.readFileSync('apps/pc/index.html', 'utf8');
const exportHook = '  global.loadOlliStudentAuthoritativeSchedule =';
assert.ok(runtime.includes(exportHook), 'student-info runtime export anchor should remain');
const source = runtime.replace(exportHook, '  global.__pcStudentInfoLayoutTest = { kinderCardHtml, elementaryCardHtml };\n' + exportHook);
const win = {};
vm.runInNewContext(source, {
  window: win,
  document: { readyState: 'loading', addEventListener() {} }
});
const student = { name: '테스트', feedback_teacher: '송지원', __olli_authoritative_enrollments: [], __olli_authoritative_pickups: [] };
const kinderHtml = win.__pcStudentInfoLayoutTest.kinderCardHtml(student);

test('PC kinder student info has four cells on each of exactly two basic-info rows', () => {
  const matches = [...kinderHtml.matchAll(/<div class="pcStudentInfoGrid4">/g)];
  assert.equal(matches.length, 2);
  const firstRow = kinderHtml.slice(matches[0].index, matches[1].index);
  const secondRow = kinderHtml.slice(matches[1].index, kinderHtml.indexOf('<input id="kinderLessonDayInput"'));
  assert.deepEqual(
    [...firstRow.matchAll(/id="([^"]+)"/g)].map(m => m[1]),
    ['kinderInfoNameInput', 'kinderKindergartenInput', 'kinderAgeInput', 'pcStudentInfoFeedbackTeacher']
  );
  assert.deepEqual(
    [...secondRow.matchAll(/id="([^"]+)"/g)].map(m => m[1]),
    ['kinderInfoYearInput', 'kinderInfoMonthInput', 'kinderInfoDayInput', 'kinderPersonalityToggleRow']
  );
  assert.match(secondRow, /pcStudentInfoDateYearField"><span class="pcStudentInfoInlineDateLabel" aria-hidden="true">등록일<\/span><input/);
  assert.doesNotMatch(kinderHtml, /pcStudentInfoDateRow/);
  assert.match(kinderHtml, /id="kinderLessonDayInput"/);
});
test('PC student form keeps the existing profile saving bindings and elementary fields', () => {
  assert.match(runtime, /readDateInputs\(division === 'kinder' \? 'kinderInfo' : 'elementaryInfo'\)/);
  assert.match(runtime, /getElementById\('kinderInfoYearInput'\)/);
  assert.match(runtime, /getElementById\('kinderPersonalityToggleRow'\)|id="kinderPersonalityToggleRow"/);
  const elementary = win.__pcStudentInfoLayoutTest.elementaryCardHtml(student);
  assert.match(elementary, /id="elementaryGradeInput"/);
  assert.match(elementary, /pcStudentInfoDateRow/);
});
test('PC kinder two-row design preserves personality and inline date sizing', () => {
  assert.match(runtime, /pcStudentInfoGrid4\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(runtime, /pcStudentInfoGrid4 \.infoPersonalityToggleRow/);
  assert.match(runtime, /pcStudentInfoDateYearField \.modalInput\{padding-left:51px;text-align:left;/);
});
test('PC student information runtime and its loader have fresh cache versions', () => {
  assert.match(loader, /pc-student-info-card-runtime\.js\?v=20261014-kinder-info-two-row-1/);
  assert.match(htmlEntry, /pc-start-page\.js\?v=20261014-kinder-info-two-row-1/);
});
