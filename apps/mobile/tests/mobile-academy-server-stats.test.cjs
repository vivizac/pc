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
  assert.match(html, /olli-settings-server-sync\.js\?v=20261108-mobile-server-stats-snapshot-1/);
  assert.match(html, /olli-record-room-navigation\.js\?v=20261108-mobile-server-stats-1/);
  assert.match(dashboardSource, /renderAcademyConsultationList\(localStudents\)/);
});

function readDashboardActiveCount(html) {
  const match = String(html || '').match(/recordAcademyStatLabel">원생수<\/div>[\s\S]*?recordAcademyStatValue">([^<]*)<\/div>/);
  assert.ok(match, 'academy active-count card missing');
  return match[1];
}

function harness(serverRows, rejectServer = false, sharedStore = new Map()) {
  const academy = 'academy-one';
  let academyId = academy;
  let accountId = 'owner-one';
  const localStorage = {
    getItem: key => key === 'olli_account_id_v1' ? accountId : (sharedStore.get(key) || null),
    setItem: (key, value) => sharedStore.set(key, String(value)),
    removeItem: key => sharedStore.delete(key)
  };
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
    localStorage,
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
  return { context, dashboard, normal, store: sharedStore, getWrites: () => writes, getCalls: () => calls, switchAcademy: next => { academyId = next; }, switchAccount: next => { accountId = next; } };
}

test('90 actual and 13 statistics-only students show 103 after first secure fetch without roster mutation', async () => {
  const h = harness();
  h.context.renderRecordAcademyManagementDashboard();
  assert.match(h.dashboard.innerHTML, /서버 통계 확인 중/);
  assert.equal(readDashboardActiveCount(h.dashboard.innerHTML), '—');
  await h.context.refreshMobileAcademyStatsFromServer();
  assert.equal(readDashboardActiveCount(h.dashboard.innerHTML), '103');
  assert.match(h.dashboard.innerHTML, /초등부 60명[\s\S]*?유치부 43명/);
  assert.doesNotMatch(h.dashboard.innerHTML, /통계전용/);
  assert.doesNotMatch(h.dashboard.innerHTML, /서버 통계 확인 중/);
  assert.equal(h.getWrites(), 0);
  assert.equal(h.normal.length, 90);
  assert.equal(h.getCalls(), 1);
  const snapshots = [...h.store.entries()].filter(([key]) => key.startsWith('olli_mobile_academy_stats_snapshot_v1:'));
  assert.equal(snapshots.length, 1);
  const payload = JSON.parse(snapshots[0][1]);
  assert.equal(payload.summary.active, 103);
  assert.equal(payload.summary.activeElementary, 60);
  assert.equal(payload.summary.activeKinder, 43);
  assert.doesNotMatch(snapshots[0][1], /통계전용|재원생|students|normal-/);
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
  assert.doesNotMatch(h.dashboard.innerHTML, /초등부 60명[\s\S]*?유치부 43명/);
});

test('same account and academy restore 103 immediately after relogin, before server responds', async () => {
  const first = harness();
  await first.context.refreshMobileAcademyStatsFromServer();
  const second = harness(null, false, first.store);
  second.context.renderRecordAcademyManagementDashboard();
  assert.equal(readDashboardActiveCount(second.dashboard.innerHTML), '103');
  assert.match(second.dashboard.innerHTML, /마지막 서버 집계 · 최신 확인 중/);
  assert.equal(second.getCalls(), 0);
  assert.equal(second.getWrites(), 0);
  await second.context.refreshMobileAcademyStatsFromServer();
  assert.equal(readDashboardActiveCount(second.dashboard.innerHTML), '103');
});

test('offline reconnect retains last verified 103 without changing operational student roster', async () => {
  const first = harness();
  await first.context.refreshMobileAcademyStatsFromServer();
  const offline = harness(null, true, first.store);
  offline.context.renderRecordAcademyManagementDashboard();
  assert.equal(readDashboardActiveCount(offline.dashboard.innerHTML), '103');
  await offline.context.refreshMobileAcademyStatsFromServer();
  assert.equal(readDashboardActiveCount(offline.dashboard.innerHTML), '103');
  assert.match(offline.dashboard.innerHTML, /서버 통계 조회 실패 · 마지막 서버 집계 표시 중/);
  assert.equal(offline.getWrites(), 0);
});

test('cached totals are isolated by academy and account and never leak to another session', async () => {
  const original = harness();
  await original.context.refreshMobileAcademyStatsFromServer();
  original.switchAcademy('academy-two');
  original.context.renderRecordAcademyManagementDashboard();
  assert.equal(readDashboardActiveCount(original.dashboard.innerHTML), '—');
  original.switchAcademy('academy-one');
  original.switchAccount('other-account');
  original.context.renderRecordAcademyManagementDashboard();
  assert.equal(readDashboardActiveCount(original.dashboard.innerHTML), '—');
});

test('an old-month cache is ignored until the current server data has been verified', async () => {
  const first = harness();
  await first.context.refreshMobileAcademyStatsFromServer();
  for (const [key, value] of first.store.entries()) {
    if (!key.startsWith('olli_mobile_academy_stats_snapshot_v1:')) continue;
    const payload = JSON.parse(value);
    payload.month = '2000-01';
    first.store.set(key, JSON.stringify(payload));
  }
  const next = harness(null, false, first.store);
  next.context.renderRecordAcademyManagementDashboard();
  assert.equal(readDashboardActiveCount(next.dashboard.innerHTML), '—');
});
