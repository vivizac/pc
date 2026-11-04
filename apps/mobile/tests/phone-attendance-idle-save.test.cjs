const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('olli-attendance-phone-adapter.js', 'utf8');

function harness(initialStatus = '') {
  const requests = [];
  const serverStatuses = new Map();
  const toasts = [];
  const callbacks = new Map();
  let nextTimerId = 1;
  let rendered = 0;
  let academyId = 'academy-1';
  let sessionToken = 'session-1';
  const today = new Date();
  const day = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
  let store = {};
  const student = { id: 'student-1', name: '학생', type: 'kinder' };
  if (initialStatus) serverStatuses.set('4|A', initialStatus === 'attended' ? 'present' : initialStatus);
  if (initialStatus) store = { [day]: { [student.id]: {
    student_id: student.id, status: initialStatus,
    sessions: { regular: { '4|A': { status: initialStatus, server_synced: true } } }
  } } };
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function makeButton(status) {
    const classes = new Set(['recordAttendanceLeadBtn', status || 'blank']);
    const attributes = {};
    const button = {
      classList: {
        contains: c => classes.has(c),
        add: (...c) => c.forEach(x => classes.add(x)),
        remove: (...c) => c.forEach(x => classes.delete(x))
      },
      setAttribute(name, value) { attributes[name] = value; },
      removeAttribute(name) { delete attributes[name]; },
      getAttribute(name) { return attributes[name]; },
      classes
    };
    return button;
  }
  const button = makeButton(initialStatus);
  const global = {
    currentRecordView: 'kinder',
    OlliAttendanceData: {
      currentAcademyId: () => academyId,
      currentSessionToken: () => sessionToken,
      getCachedMonth: () => null,
      getCachedWeek: () => null,
      loadWeek: async () => ({ enrollments: [], one_time_sessions: [] }),
      loadMonth: async () => Array.from(serverStatuses, ([session, status]) => {
        const [time_slot, class_group] = session.split('|');
        return {
          student_id: student.id, session_date: day, session_kind: 'register_override',
          register_session_kind: 'regular', register_status: status,
          time_slot: Number(time_slot), class_group
        };
      }),
      invalidateMonth() {},
      invalidateWeek() {},
      legacyPairs: () => []
    },
    supabase: async (method, route, params) => {
      requests.push({method, route, params});
      const result = global.rpcResponse ? await global.rpcResponse(method, route, params) : {ok:true};
      if (result?.ok !== false && route === 'rpc/olli_schedule_set_attendance_session_status_v2') {
        serverStatuses.set(params.p_time_slot + '|' + params.p_class_group, params.p_status);
      }
      return result;
    },
    getAllStudents: () => [student],
    getStudentStatus: () => 'active',
    readRecordDailyAttendanceStore: () => clone(store),
    writeRecordDailyAttendanceStore: value => { store = clone(value); },
    showPushToast: text => toasts.push(text),
    alert: text => toasts.push(text),
    renderKinderRecords: () => { rendered++; },
    document: { getElementById: () => null },
    setTimeout: (fn, ms) => { const id = nextTimerId++; callbacks.set(id, {fn, ms}); return id; },
    clearTimeout: id => callbacks.delete(id),
    addEventListener() {}
  };
  vm.runInNewContext(source, {window: global, Date, console, setTimeout, clearTimeout});
  const event = {
    target: { closest: selector => selector === '.recordAttendanceLeadBtn' ? button : null },
    currentTarget: button,
    preventDefault() {}, stopPropagation() {}
  };
  async function tap(slot = 4, group = 'A') {
    await global.OlliPhoneAttendanceAdapter.toggleTodayAttendance(event, student.id, 'regular', slot, group);
  }
  async function fire(ms) {
    const match = [...callbacks.entries()].filter(([id, t]) => ms == null || t.ms === ms).sort((a,b)=>a[0]-b[0])[0];
    assert.ok(match, 'expected pending timer');
    callbacks.delete(match[0]);
    match[1].fn();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
  }
  const status = (slot = '4|A') => store?.[day]?.[student.id]?.sessions?.regular?.[slot]?.status || '';
  return {global, tap, fire, requests, toasts, button, callbacks, status,
    get rendered(){return rendered},
    get store(){return clone(store)},
    setAcademyId(id){academyId=id},
    setSessionToken(token){sessionToken=token}
  };
}

test('two fast taps change absent → blank → attended with only one server write', async () => {
  const h = harness('absent');
  await h.tap();
  assert.equal(h.status(), '');
  await h.tap();
  assert.equal(h.status(), 'attended');
  assert.equal(h.button.classes.has('attended'), true);
  assert.equal(h.requests.length, 0, 'no early RPC');
  assert.equal(h.callbacks.size, 1, 'previous debounce timer cancelled');
  assert.equal(h.rendered, 0, 'student names and ages must not be remounted');
  await h.fire(450);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].route, 'rpc/olli_schedule_set_attendance_session_status_v2');
  assert.equal(h.requests[0].params.p_status, 'present');
  assert.equal(h.status(), 'attended');
  assert.equal(h.button.getAttribute('aria-busy'), undefined);
  assert.equal(h.rendered, 0);
});

test('multiple students/sessions would not share an attendance save key', () => {
  assert.match(source, /attendanceSaveKey\(academyId, student\.id, targetDateKey, kind, target\.timeSlot, target\.classGroup\)/);
  assert.match(source, /JSON\.stringify\(\[academyId, String\(studentId\), day, kind, Number\(slot\)/);
});

test('queued clicks during in-flight save never overlap RPCs or overwrite latest preview', async () => {
  const h = harness('');
  let resolveFirst;
  h.global.rpcResponse = () => new Promise(resolve => { resolveFirst = resolve; });
  await h.tap(); // attended
  await h.fire(450);
  assert.equal(h.requests.length, 1);
  await h.tap(); // absent while present RPC is active
  assert.equal(h.status(), 'absent');
  await h.fire(450); // should not make second request yet
  assert.equal(h.requests.length, 1);
  resolveFirst({ok:true});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.status(), 'absent', 'late first acknowledgement must not stamp newer preview as saved');
  assert.equal(h.button.getAttribute('aria-busy'), 'true');
  h.global.rpcResponse = () => ({ok:true});
  await h.fire(0);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests.map(r => r.params.p_status), ['present', 'absent']);
  assert.equal(h.status(), 'absent');
  assert.equal(h.store[Object.keys(h.store)[0]]['student-1'].sessions.regular['4|A'].server_synced, true);
});

test('failed write rolls back to last confirmed exact-session snapshot', async () => {
  const h = harness('absent');
  h.global.rpcResponse = async () => { throw new Error('network offline'); };
  await h.tap();
  await h.tap();
  assert.equal(h.status(), 'attended');
  await h.fire(450);
  assert.equal(h.status(), 'absent');
  assert.equal(h.button.classes.has('absent'), true);
  assert.equal(h.requests.length, 1);
  assert.match(h.toasts[0], /network offline/);
  assert.equal(h.rendered, 0);
});

test('pending state survives card-free local painting without reconstructing age text', async () => {
  const h = harness('attended');
  await h.tap(); // absent
  assert.equal(h.button.classes.has('absent'), true);
  assert.equal(h.button.getAttribute('aria-busy'), 'true');
  assert.equal(h.rendered, 0);
  await h.tap(); // blank
  await h.tap(); // attended
  assert.equal(h.rendered, 0);
  assert.equal(h.callbacks.size, 1);
  await h.fire(450);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].params.p_status, 'present');
});

test('server status-only updates patch icon attributes without replacing kindergarten age labels', () => {
  assert.match(source, /function patchAttendanceIconsWithoutListRebuild\(list, nextHtml\)/);
  assert.match(source, /snapshot\.innerHTML !== template\.innerHTML/);
  assert.match(source, /oldIcons\.forEach\(\(icon, index\) => icon\.replaceWith\(nextIcons\[index\]\.cloneNode\(true\)\)\)/);
  assert.match(source, /if \(!canReuse \|\| !patchAttendanceIconsWithoutListRebuild\(list, nextHtml\)\) list\.innerHTML = nextHtml/);
  assert.match(source, /if \(icon\.getAttribute\('aria-busy'\) === 'true'\) return/);
});
