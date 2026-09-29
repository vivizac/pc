const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('olli-observation-roster-phone.js', 'utf8');

test('kinder school sort uses kindergarten while elementary keeps school sort', () => {
  assert.match(source, /getObservationRosterStudentDivision\(student\) === 'kinder'[\s\S]*student\?\.kindergarten \|\| student\?\.school/);
  assert.match(source, /typeof getRecordSortSchoolValue === 'function'/);
});

test('kinder grade button sorts by age while elementary keeps grade sort', () => {
  assert.match(source, /getObservationRosterStudentDivision\(student\) === 'kinder'[\s\S]*student\?\.age/);
  assert.match(source, /typeof getRecordSortGradeValue === 'function'/);
  assert.match(source, /criterion === 'grade'[\s\S]*getObservationRosterNumber\(getObservationRosterGradeValue\(a\)\)/);
});

test('visible sort button labels stay school and grade', () => {
  assert.match(source, /\['school', '학교'\]/);
  assert.match(source, /\['grade', '학년'\]/);
});
