const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const timetable = fs.readFileSync('pc-timetable.js', 'utf8');
const service = fs.readFileSync('pc-timetable-service.js', 'utf8');
const registration = fs.readFileSync('pc-student-class-routing.js', 'utf8');

test('PC timetable split resolver requires an actual target date', () => {
  assert.match(timetable, /function\s+isClassSplit\s*\([^)]*(targetDate|sessionDate|date)[^)]*\)/);
  assert.match(timetable, /class_split_periods/);
});

test('PC split and merge service contracts send an effective date', () => {
  assert.match(service, /async\s+function\s+splitClass\s*\([^)]*effectiveDate[^)]*\)/);
  assert.match(service, /async\s+function\s+mergeClass\s*\([^)]*effectiveDate[^)]*\)/);
  assert.match(service, /effective_date\s*:\s*[^,}\n]+/);
});

test('PC split and merge actions pass the clicked cell date to the service', () => {
  const splitBlock = timetable.match(/async\s+function\s+splitClass\s*\(\)\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
  const mergeBlock = timetable.match(/async\s+function\s+mergeClass\s*\(\)\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
  assert.match(splitBlock, /service\.splitClass\([^)]*(effectiveDate|date)/);
  assert.match(mergeBlock, /service\.mergeClass\([^)]*(effectiveDate|date)/);
});

test('PC registration resolves elementary split state with the registration effective date', () => {
  assert.match(registration, /function\s+isElementarySplit\s*\([^)]*effectiveDate[^)]*\)/);
  assert.match(registration, /class_split_periods/);
  assert.match(registration, /isElementarySplit\([^)]*effectiveDate/);
});
