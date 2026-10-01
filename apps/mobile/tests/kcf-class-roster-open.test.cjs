const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const runtime = fs.readFileSync('kcf-auto-mode-runtime.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('Class roster opens for owner or manager when teacher context is valid but the academy has no teacher assignments', () => {
  assert.match(runtime, /next\.__kcfTeacherContextLoaded = !!context/);
  assert.match(runtime, /function canUseUnassignedManagementRoster\(week\)[\s\S]*?week\.__kcfTeacherContextLoaded !== true[\s\S]*?assignments\.length[\s\S]*?role === 'owner' \|\| role === 'manager'/);
  assert.match(runtime, /allowUnassignedManagementRoster = canUseUnassignedManagementRoster\(week\)/);
  assert.match(runtime, /queueItemMatchesCurrentMember\(next, \{ allowUnassignedManagementRoster: allowUnassignedManagementRoster \}\)/);
  assert.match(runtime, /return opts\.allowUnassignedManagementRoster === true && !feedbackTeacherMemberId/);
});

test('Class roster fallback does not activate when teacher context failed to load', () => {
  assert.match(runtime, /if \(!week \|\| week\.__kcfTeacherContextLoaded !== true\) return false/);
});

test('mobile entry busts cached Class and QuickNote runtimes after the fix', () => {
  assert.match(html, /kcf-auto-mode-runtime\.js\?v=20261001-class-roster-fix-1/);
  assert.match(html, /kinder-feedback\.js\?v=20261001-class-roster-fix-1/);
});
