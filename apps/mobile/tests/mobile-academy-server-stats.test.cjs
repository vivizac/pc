const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const dashboardSource = fs.readFileSync('olli-settings-server-sync.js', 'utf8');
const navigationSource = fs.readFileSync('olli-record-room-navigation.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('mobile dashboard has an independent secure server stats source and is wired on entry', () => {
  assert.match(dashboardSource, /ServerAdapter\.read\(spec, \{ academyId \}, \{ limit: 5000 \}\)/);
  assert.match(navigationSource, /refreshMobileAcademyStatsFromServer\(\)/);
  assert.match(html, /olli-settings-server-sync\.js\?v=20261108-mobile-server-stats-1/);
  assert.match(html, /olli-record-room-navigation\.js\?v=20261108-mobile-server-stats-1/);
  assert.match(dashboardSource, /renderAcademyConsultationList\(localStudents\)/);
});

function harness(serverRows, rejectServer = false) {
  const academy = 'academy-one';
  let academyId = academy;
  let writes = 0;
  let calls = 0;
  const now = new Date();
  const enrolledAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-08`;
  const normal = Array.from({ length: 90 }, (_, i) => ({
    id: `normal-${i}`,
    name: `재원생${i}`,
    academy_id: academy,
    type: i < 53 ? 'elementary' : 'kinder',
    status: 'active',
    enrolled_at: enrolledAt
  }));
  const remote = serverRows || normal.map(row => ({ ...row, division: row.type })).concat(
    Array.from({ length: 13 }, (_, i) => ({
      id: `stats-${i}`, name: `통계전용${i}`,
      academy_id: academy, division: i < 7 ? 'elementary' : 'kinder',
      status: 'active', is_stat_only: true, enrolled_at: enrolledAt
    }))
  );
  const dashboard = { innerHTML: '' };
  const context = {
    window: { OlliStorageCore: {
      FeatureRegistry: { require: feature => ({ feature }) },
      ServerAdapter: { read: async () => { calls++; if (rejectServer) throw new Error('offline'); return remote; } }
    }},
    document: { readyState: 'loading', addEventListener() {}, getElementById: id => id === 'recordAcademyDashboard' ? dashboard : null },
    getOlliCurrentAcademyId: () => academyId,
    getAllStudents: () => normal.slice(),
    getPendingStudentStatusMap: () => ({}),
    normalizeStudentObject: item => ({ ...item, type: item.type || item.division }),
    isOlliSoftDeletedRow: row => row.is_deleted === true,
    getStudentStatus: student => student.status,
    getEnrolledAtFromStudent: student => student.enrolled_at,
    getDueConsultationRuleLabelsForStudent: () => [],
    escapeHtml: value => String(value),
    escapeJsSingleQuote: value => String(value),
    currentRecordView: 'academy',
    setAllStudents: () => { writes++; throw new Error('Statistics must not alter student cache'); },
    console: { warn() {} },
    setTimeout() {}
  };
  vm.createContext(context);
  vm.runInContext(dashboardSource, context, { filename: 'olli-settings-server-sync.js' });
  return { context, dashboard, normal, getWrites: () => writes, getCalls: () => calls, switchAcademy: next => { academyId = next; } };
}

test('90 real students plus 13 server-only tests show 103 total and no roster mutation', async () => {
  const h = harness();
  h.context.renderRecordAcademyManagementDashboard();
  assert.match(h.dashboard.innerHTML, /서버 통계 확인 중/);
  assert.match(h.dashboard.innerHTML, /원생수[\s\S]*?90/);
  await h.context.refreshMobileAcademyStatsFromServer();
  assert.match(h.dashboard.innerHTML, /원생수[\s\S]*?103/);
  assert.match(h.dashboard.innerHTML, /초등부 60명 · 유치부 43명/);
  assert.doesNotMatch(h.dashboard.innerHTML, /통계전용/);
  assert.doesNotMatch(h.dashboard.innerHTML, /서버 통계 확인 중/);
  assert.equal(h.getWrites(), 0);
  assert.equal(h.normal.length, 90);
  assert.equal(h.getCalls(), 1);
});

test('server failure identifies local fallback without modifying students', async () => {
  const h = harness(null, true);
  await h.context.refreshMobileAcademyStatsFromServer();
  assert.match(h.dashboard.innerHTML, /서버 통계 조회 실패 · 로컬 수치 표시 중/);
  assert.match(h.dashboard.innerHTML, /원생수[\s\S]*?90/);
  assert.equal(h.getWrites(), 0);
});

test('a stale server response cannot overwrite the current academy stats', async () => {
  const h = harness();
  h.switchAcademy('different-academy');
  h.context.renderRecordAcademyManagementDashboard();
  assert.match(h.dashboard.innerHTML, /서버 통계 확인 중/);
  // No value from another academy is reused as server statistics.
  assert.doesNotMatch(h.dashboard.innerHTML, /초등부 60명 · 유치부 43명/);
});
