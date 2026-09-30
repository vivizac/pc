const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('olli-observation-roster-phone.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('division chips are exclusive switches with no all-view state', () => {
  assert.match(source, /let observationRosterActiveDivision = 'elementary'/);
  assert.match(source, /observationRosterActiveDivision = value/);
  assert.match(source, /getObservationRosterStudentDivision\(student\) === observationRosterActiveDivision/);
  assert.doesNotMatch(source, /new Set\(\['elementary', 'kinder'\]\)/);
  assert.doesNotMatch(source, /size <= 1/);
});

test('entering and returning to roster preserves the active division', () => {
  assert.match(source, /function openObservationNoteFromRecord\(options = \{\}\)/);
  assert.match(source, /setObservationRosterDivision\(division\)/);
  assert.match(source, /setObservationRosterDivision\(currentMemoType\)/);
  assert.match(source, /currentObservationView = observationRosterActiveDivision/);
  assert.match(source, /currentRecordView = observationRosterActiveDivision/);
});


test('observation roster reopens with the last selected division instead of defaulting to elementary', () => {
  assert.match(source, /const OBSERVATION_ROSTER_DIVISION_KEY_PREFIX = 'olli_observation_roster_division_v1'/);
  assert.match(source, /function getObservationRosterSavedDivision\(\)/);
  assert.match(source, /localStorage\.setItem\(getObservationRosterDivisionStorageKey\(\), value\)/);
  assert.match(source, /const savedDivision = getObservationRosterSavedDivision\(\)/);
  assert.match(source, /let division = savedDivision \|\| \(explicitDivision === 'kinder' \|\| explicitDivision === 'elementary'/);
});

test('phone loads the cache-busted observation roster last-division fix', () => {
  assert.match(html, /olli-observation-roster-phone\.js\?v=20260930-observation-roster-teamchat-scroll-1/);
});


test('observation roster search ignores the active division and searches all active students', () => {
  assert.match(source, /let students = getObservationRosterAllStudents\(\)\s*\.filter\(student => isObservationRosterActiveStudent\(student\)\);/);
  assert.match(source, /if \(observationRosterSearchQuery\) \{\s*students = students\.filter\(student => String\(student\?\.name \|\| ''\)\.includes\(observationRosterSearchQuery\)\);\s*\} else \{\s*students = students\.filter\(student => isObservationRosterDivisionVisible\(student\)\);/);
});

test('phone loads the cache-busted observation roster global-search fix', () => {
  assert.match(html, /olli-observation-roster-phone\.js\?v=20260930-observation-roster-teamchat-scroll-1/);
});
