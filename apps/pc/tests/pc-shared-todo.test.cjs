const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'pc-student-management.js'), 'utf8');

test('PC academy todo loads shared server tasks', () => {
  assert.match(source, /olli_academy_tasks_list/);
  assert.match(source, /loadServerTodos/);
  assert.match(source, /origin === 'chat'/);
});

test('PC academy todo writes new items to shared task RPCs', () => {
  assert.match(source, /olli_academy_task_create/);
  assert.match(source, /olli_academy_task_set_completed/);
  assert.match(source, /olli_academy_task_delete/);
});

test('PC academy todo refreshes from Olli Talk realtime signals', () => {
  assert.match(source, /watchDomain\('chat'/);
});
