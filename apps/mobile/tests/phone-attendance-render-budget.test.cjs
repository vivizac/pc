const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const navigation = fs.readFileSync('olli-record-room-navigation.js', 'utf8');
const adapter = fs.readFileSync('olli-attendance-phone-adapter.js', 'utf8');
const startup = fs.readFileSync('olli-app-startup.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

// Exercise the real student-list branches with a fake DOM and stubbed network.
function exerciseRoster(view, { changed = false, localOnly = false } = {}) {
  const events = [];
  const begin = navigation.indexOf('async function loadRecords(name, options = {}) {');
  const end = navigation.indexOf('  const academyId = requireOlliAcademyId(', begin);
  assert.ok(begin >= 0 && end > begin);
  const body = navigation.slice(begin, end) + '\n  return;\n}';
  const makeLoader = new Function('events', 'view', 'changed', `
    let currentRecordView = view, currentObservationView = view;
    const window = { __olliRecordListLoadToken: 0,
      OlliPhoneAttendanceAdapter: {
        hydrateLocalAttendanceSnapshot: (date, options) => { events.push('hydrate:'+options.render); return true },
        afterRecordListLoaded: (division, name, options) => { events.push('after:'+options.renderLocal); return true }
      }
    };
    const document = { getElementById: () => ({ children: [] }) };
    const getOlliCurrentAcademyId = () => 'academy-test';
    const renderElementaryRecords = () => events.push('elementary-render');
    const renderKinderRecords = () => events.push('kinder-render');
    const loadStudentsFromSupabase = async () => { events.push('server-refresh'); return {changed} };
    const updateRecordHeaderUI = () => events.push('header');
    const hydrateRecordAttendanceLocalSnapshot = (options) => window.OlliPhoneAttendanceAdapter.hydrateLocalAttendanceSnapshot(new Date(), options);
    ${body}
    return loadRecords;
  `);
  return makeLoader(events, view, changed)('', { localOnly }).then(() => events);
}

test('cached elementary and kinder display local attendance in exactly one initial paint', async () => {
  for (const view of ['elementary','kinder']) {
    const events = await exerciseRoster(view, {changed:false});
    assert.deepEqual(events, ['hydrate:false', view+'-render', 'server-refresh', 'after:false']);
  }
});

test('real student changes still repaint once after server sync', async () => {
  for (const view of ['elementary','kinder']) {
    const events = await exerciseRoster(view, {changed:true});
    assert.deepEqual(events, ['hydrate:false', view+'-render', 'server-refresh', view+'-render', 'after:false']);
  }
});

test('localOnly screen restore never waits for server data', async () => {
  const events = await exerciseRoster('elementary', {localOnly:true});
  assert.deepEqual(events, ['hydrate:false', 'elementary-render']);
});

test('server attendance sync and startup guard remain connected', () => {
  assert.match(adapter, /Promise\.all\(\[\s*syncCurrentMonth\(new Date\(\), \{ render: true, skipLocal: true \}\),\s*syncTodaySchedule\(new Date\(\), \{ render: true, skipLocal: true \}\)/);
  assert.match(startup, /refreshOlliVisibleViewsAfterStudentServerRefresh\(result\)/);
  assert.match(startup, /studentRefresh\?\.changed === true \|\| !recordList\?\.children\?\.length/);
  for (const file of ['olli-record-room-navigation.js', 'olli-attendance-phone-adapter.js', 'olli-app-startup.js']) {
    assert.match(html, new RegExp(file.replace(/\./g,'\\.')+'\\?v=20261011-roster-render-budget-1'));
  }
});
