const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const editor = fs.readFileSync('olli-phone-student-schedule-editor.js', 'utf8');
const runtime = fs.readFileSync('olli-student-schedule-runtime.js', 'utf8');

test('Mobile editor resolves elementary A/B state with effectiveDate and canonical periods', () => {
  assert.match(editor, /function\s+isElementarySplit\s*\([^)]*effectiveDate[^)]*\)/);
  assert.match(editor, /class_split_periods/);
  assert.match(editor, /isElementarySplit\([^)]*effectiveDate/);
});

test('Mobile schedule Realtime invalidates week cache even when no student modal is open', async () => {
  let watcher = null;
  let weekReads = 0;
  const storage = new Map([
    ['olli_current_academy_id','academy-a'],
    ['olli_account_session_token_v1','session-a']
  ]);
  const localStorage = {
    getItem:key => storage.has(key) ? storage.get(key) : null,
    setItem:(key,value) => storage.set(key,String(value)),
    removeItem:key => storage.delete(key)
  };
  const document = {
    getElementById() { return null; }
  };
  const win = {
    console:{ warn(){} },
    localStorage,
    document,
    addEventListener(){},
    dispatchEvent(){},
    CustomEvent:function CustomEvent(type,init){this.type=type;this.detail=init&&init.detail;},
    OlliRealtime:{
      watchDomain(domain,fn) {
        assert.equal(domain,'schedule');
        watcher = fn;
        return {};
      }
    },
    getOlliCurrentAcademyId(){ return 'academy-a'; },
    async supabase(method,name) {
      if (name === 'rpc/olli_schedule_apply_due') return {ok:true};
      if (name === 'rpc/olli_schedule_week') {
        weekReads += 1;
        return {ok:true,week_start:'2026-09-28',enrollments:[],class_split_periods:[]};
      }
      if (name === 'rpc/olli_schedule_kinder_class_layouts') return {ok:true,merged_slots:[]};
      if (name === 'rpc/olli_schedule_class_teacher_context') return {ok:true,assignments:[],teachers:[]};
      return {ok:true};
    }
  };
  win.window = win;
  const sandbox = {
    window:win,
    localStorage,
    document,
    CustomEvent:win.CustomEvent,
    Date,
    console:win.console
  };
  vm.createContext(sandbox);
  vm.runInContext(runtime, sandbox);

  assert.equal(typeof watcher, 'function');
  await win.OlliPhoneStudentScheduleService.loadWeek('2026-09-28','academy-a');
  await win.OlliPhoneStudentScheduleService.loadWeek('2026-09-28','academy-a');
  assert.equal(weekReads, 1, 'second read should come from cache before a realtime signal');

  const applied = await watcher({ academyId:'academy-a', isCurrent:()=>true });
  assert.equal(applied, true);

  await win.OlliPhoneStudentScheduleService.loadWeek('2026-09-28','academy-a');
  assert.equal(weekReads, 2, 'schedule realtime must invalidate cached weeks even with the modal closed');
});


test('Mobile editor stops reading legacy class_splits directly after the v2 contract lands', () => {
  assert.doesNotMatch(editor, /data\s*&&\s*data\.class_splits/);
});
