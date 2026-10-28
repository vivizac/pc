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

// Completed tasks disappear from the checklist after 24 hours without erasing saved data.
test('PC academy todo hides old completed tasks but retains pending and recent completions', () => {
  const now = Date.parse('2026-10-28T12:00:00.000Z');
  const host = { innerHTML: '' };
  const scheduled = [];
  class FixedDate extends Date { static now() { return now; } }
  const app = { OlliPcCore: { state: { section: 'academy' } } };
  const tasks = [
    { id: 'pending', text: '미완료 작업', completed: false, created_at: '2026-10-01T00:00:00.000Z' },
    { id: 'recent', text: '최근 완료', completed: true, completed_at: '2026-10-28T10:00:00.000Z' },
    { id: 'expired', text: '오래된 완료', completed: true, completed_at: '2026-10-20T00:00:00.000Z' },
    { id: 'boundary', text: '경계 완료', completed: true, completed_at: '2026-10-27T12:00:00.000Z' },
    { id: 'legacy', text: '기존 완료', completed: true, created_at: '2026-10-01T00:00:00.000Z' }
  ];
  const documentMock = { getElementById: (id) => id === 'pcAcademyTodoSection' ? host : null };
  const run = new Function('window', 'document', 'getOlliConsultationProgress', 'setTimeout', 'clearTimeout', 'Date', source);
  run(app, documentMock, () => ({ todos: tasks }), (callback, delay) => {
    scheduled.push({ callback, delay });
    return scheduled.length;
  }, () => {}, FixedDate);
  app.OlliPcStudentManagement.renderTodoCard();
  assert.match(host.innerHTML, /미완료 작업/);
  assert.match(host.innerHTML, /최근 완료/);
  assert.doesNotMatch(host.innerHTML, /오래된 완료|경계 완료|기존 완료/);
  assert.match(host.innerHTML, /1개 남음/);
  assert.equal(scheduled.length, 1, 'the visible recent completion gets an expiry timer');
  assert.ok(scheduled[0].delay > 0 && scheduled[0].delay <= 24 * 60 * 60 * 1000);
  assert.equal(tasks.length, 5, 'filtering does not delete or mutate stored tasks');
});
