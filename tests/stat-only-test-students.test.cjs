'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const dashboardSource = read('apps/pc/pc-student-management.js');
const migration = read('supabase/migrations/20261108042843_stat_only_test_students_13.sql');

test('test enrollments live only in a private statistics table and cannot appear on student rosters', () => {
  assert.match(migration, /create table if not exists private\.olli_stat_test_students/i);
  assert.match(migration, /enable row level security/i);
  assert.doesNotMatch(migration, /^\s*insert\s+into\s+public\.students\b/im);
  assert.doesNotMatch(dashboardSource, /setAllStudents\s*\(\s*.*statOnly/s);
  assert.match(dashboardSource, /const allStudents = students\(\)/);
  assert.match(dashboardSource, /const due = consultationStudents\(allStudents\)/);
});

test('count RPC is session-and-academy scoped and test inserts are idempotent', () => {
  assert.match(migration, /olli_account_id_from_session\(p_session_token\)/);
  assert.match(migration, /m\.academy_id = p_academy_id/);
  assert.match(migration, /m\.account_id = v_account_id/);
  assert.match(migration, /m\.status = 'active'/);
  assert.match(migration, /academy_code = 'VIVI-5578'/);
  assert.match(migration, /generate_series\(1,13\)/);
  assert.match(migration, /on conflict \(academy_id,test_number\) do nothing/);
  assert.match(dashboardSource, /latestContext\.academyId !== academyId/);
  assert.match(dashboardSource, /latestContext\.sessionToken !== context\.sessionToken/);
});

test('PC student management counts the 13 test enrollments without adding them to consultation or roster data', () => {
  const begin = dashboardSource.indexOf('  function renderDashboard() {');
  const end = dashboardSource.indexOf('  // Completed items remain reversible', begin);
  assert.ok(begin >= 0 && end > begin, 'dashboard function boundaries');
  const dashboard = { innerHTML: '' };
  let loadingCalls = 0;
  const base = new Date();
  const student = {
    id: 'real-student', name: '실제학생', type: 'elementary',
    status: 'active', enrolled_at: base.toISOString().slice(0, 10)
  };
  const context = {
    Date,
    document: { activeElement: null, getElementById: (id) =>
      id === 'recordAcademyDashboard' ? dashboard : null },
    students: () => [student],
    statOnlyCountsForCurrentAcademy: () => ({ total: 13, this_year: 13, this_month: 13 }),
    loadStatOnlyCounts: () => { loadingCalls++; return Promise.resolve(true); },
    getStudentEnrollmentDateForStats: () => base,
    isCurrentYearDate: () => true,
    isCurrentMonthYear: () => true,
    getStudentStatus: () => 'active',
    isAcademyManagementActiveStudent: () => true,
    getStudentWithdrawalDateForStats: () => null,
    consultationStudents: (list) => { assert.equal(list.length, 1); return []; },
    buildStatCard: (title, count, sub) => `<div>${title}|${count}|${sub}</div>`,
    renderTodoCard: () => {},
    renderMaterialOrders: () => {},
    loadServerTodos: () => Promise.resolve(true),
    loadMaterialOrders: () => Promise.resolve(true),
    renderConsultationPanel: (due) => { assert.equal(due.length, 0); },
    filter: () => {},
    handleSearch: () => {},
    core: () => ({ state: { academyFilter: 'all', searchValues: { academy: '' } } })
  };
  const render = vm.runInNewContext(dashboardSource.slice(begin, end) + ';renderDashboard', context);
  render();
  assert.equal(loadingCalls, 1);
  assert.match(dashboard.innerHTML, /원생수\|14\|초등부 1명 · 유치부 0명 · 테스트 13명/);
  assert.match(dashboard.innerHTML, /올해 등록\|14\|이달 등록 14명 \(테스트 13명 포함\)/);
  assert.match(dashboard.innerHTML, /월 상담\|0/);
  assert.doesNotMatch(dashboard.innerHTML, /테스트학생0[1-9]/);
});
