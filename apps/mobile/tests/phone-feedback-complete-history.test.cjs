'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const archiveCode = fs.readFileSync(path.join(root, 'elementary-analysis-phone-adapter.js'), 'utf8');
const boardCode = fs.readFileSync(path.join(root, 'olli-record-room-navigation.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'expected source section ' + start);
  return source.slice(a, b);
}

const archiveSource = between(archiveCode,
  'const memoFeedbackArchiveFullHistory',
  'function formatElementaryRecordLabel');
const boardSource = between(boardCode,
  'const OLLI_RECORD_FEEDBACK_PAGE_SIZE',
  'async function loadRecords(name, options = {})');

function student() {
  return { id:'student-1', name:'Sample student', type:'elementary' };
}

function row(id, prefix = 'test') {
  return {
    id, student_id:'student-1', student_name:'Sample student',
    content:prefix + ' feedback ' + id,
    feedback_type:'growth', date:'2026-11-04',
    created_at:'2026-11-04T09:00:00Z'
  };
}

function createArchiveHarness(options = {}) {
  const disk = new Map();
  const log = [];
  let failedWrites = !!options.failedWrites;
  let ignoredWrites = !!options.ignoredWrites;
  let activeAcademy = 'academy-a';
  let reader = options.reader || (async () => []);
  const storage = {
    getItem:key => disk.has(key) ? disk.get(key) : null,
    setItem(key,value) {
      if (failedWrites) {
        const error = new Error('quota exceeded');
        error.name = 'QuotaExceededError';
        throw error;
      }
      if (!ignoredWrites) disk.set(key,String(value));
    },
    removeItem(key) { disk.delete(key); }
  };
  const scope = {
    MEMO_FEEDBACK_ARCHIVE_PREFIX:'feedback-',
    localStorage:storage,
    window:{
      loadOlliFeedbackRowsSecure:(table,s,limit)=>reader(table,s,limit),
      recordOlliFeedbackStorageCheck:(...args)=>log.push(args)
    },
    console:{warn() {}},
    isSupabaseConfigured:()=>true,
    getOlliCurrentAcademyId:()=>activeAcademy,
    filterOlliActiveRows:rows=>rows,
    getOlliFeedbackStorageErrorReason:error=> error?.name === 'FeedbackStorageReadbackMismatch' ? 'readback_mismatch' : 'quota_exceeded'
  };
  vm.createContext(scope);
  vm.runInContext(archiveSource + '\nwindow.__archive = {read:getMemoFeedbackArchiveItems,write:setMemoFeedbackArchiveItems,add:addMemoFeedbackArchiveItem,load:loadMemoFeedbackArchiveItemsFromSupabase};', scope);
  return {
    disk, log, api:scope.window.__archive,
    setReader:fn=>{reader=fn;},
    setAcademy:id=>{activeAcademy=id;},
    failWrites:value=>{failedWrites=!!value;},
    ignoreWrites:value=>{ignoredWrites=!!value;}
  };
}

test('per-student archive retrieves all 200 rows while storing only 80 confirmed rows for offline use', async () => {
  const calls = [];
  const harness = createArchiveHarness({
    reader:async (table,s,limit) => {
      calls.push({table,limit});
      return table === 'feedbacks'
        ? Array.from({length:200},(_,i)=>row(300 - i))
        : Array.from({length:15},(_,i)=>row(15 - i,'growth'));
    }
  });
  const items = await harness.api.load(student());
  assert.equal(items.length,215);
  assert.equal(harness.api.read(student()).length,215,'UI must use full in-memory history');
  assert.equal(JSON.parse(harness.disk.get('feedback-student-1')).length,80,
    'offline cache is bounded independently of the visible server history');
  assert.deepEqual(calls.map(c=>c.limit),[5000,5000]);
});

test('local unsynced records are never trimmed when the confirmed offline cache is bounded', () => {
  const h = createArchiveHarness();
  const pending = Array.from({length:85},(_,i)=>({id:'draft-'+i,content:'draft '+i,createdAt:'2026-11-04T10:00:00Z'}));
  const confirmed = Array.from({length:180},(_,i)=>({
    id:i+1,content:'saved',sourceTable:'feedbacks',row:{id:i+1}
  }));
  h.api.write(student(),[...pending,...confirmed]);
  const persisted = JSON.parse(h.disk.get('feedback-student-1'));
  assert.equal(persisted.length,165);
  assert.equal(persisted.filter(item=>!item.sourceTable).length,85);
  assert.equal(h.api.read(student()).length,265);
});

test('a failed or partial RPC cannot replace existing local feedback or unsynced records', async () => {
  const h = createArchiveHarness();
  const prior = [{id:'unsynced',content:'keep local draft'}];
  h.api.write(student(),prior);
  const snapshot = h.disk.get('feedback-student-1');
  h.setReader(async table => {
    if(table === 'fail_feedbacks') throw new Error('temporary network failure');
    return [row(1)];
  });
  await assert.rejects(h.api.load(student()),/보관함 서버 조회 실패/);
  assert.equal(h.disk.get('feedback-student-1'),snapshot);
  assert.equal(h.api.read(student()).length,1);

  h.setReader(async table => table === 'feedbacks'
    ? Array.from({length:5000},(_,i)=>row(9000 - i)) : []);
  await assert.rejects(h.api.load(student()),/조회 결과가 불완전/);
  assert.equal(h.disk.get('feedback-student-1'),snapshot);
  assert.equal(h.api.read(student())[0].id,'unsynced');
});

test('successful server refresh keeps all unconfirmed local items alongside verified rows', async () => {
  const h = createArchiveHarness({reader:async table => table === 'feedbacks'?[row(7)]:[]});
  h.api.add(student(),'unsaved original text');
  const result = await h.api.load(student());
  assert.equal(result.length,2);
  assert.ok(result.some(item=>item.content==='unsaved original text'));
  const offline = JSON.parse(h.disk.get('feedback-student-1'));
  assert.ok(offline.some(item=>item.content==='unsaved original text'));
});

test('localStorage quota failure preserves both previous disk data and new full in-memory history', () => {
  const h = createArchiveHarness();
  h.api.write(student(),[{id:'old',content:'old data'}]);
  const oldSnapshot = h.disk.get('feedback-student-1');
  h.failWrites(true);
  assert.doesNotThrow(()=>h.api.write(student(),[{id:'new',content:'new data'}]));
  assert.equal(h.disk.get('feedback-student-1'),oldSnapshot);
  assert.equal(h.api.read(student())[0].id,'new');
  assert.ok(h.log.some(v=>v[0]==='elementary_feedback_archive' && v[2]==='failed'));
});

test('silently ignored iOS localStorage writes are recorded, with no loss of visible history', () => {
  const h = createArchiveHarness({ignoredWrites:true});
  h.api.write(student(),[{id:'new',content:'recovered server text'}]);
  assert.equal(h.disk.size,0);
  assert.equal(h.api.read(student())[0].id,'new');
  assert.ok(h.log.some(v=>v[0]==='elementary_feedback_archive' && v[3]?.reason==='readback_mismatch'));
});

test('offline snapshot retains newest-first item ordering when local drafts are interleaved', () => {
  const h = createArchiveHarness();
  h.api.write(student(),[
    {id:2,content:'new',sourceTable:'feedbacks',row:{id:2}},
    {id:'pending',content:'local draft'},
    {id:1,content:'old',sourceTable:'feedbacks',row:{id:1}}
  ]);
  assert.deepEqual(JSON.parse(h.disk.get('feedback-student-1')).map(x=>x.id),[2,'pending',1]);
});

test('academy switch before RPC resolves cannot apply obsolete history', async () => {
  const h = createArchiveHarness({reader:async () => {h.setAcademy('academy-b');return [row(1)];}});
  h.api.write(student(),[{id:'pending',content:'old local'}]);
  await assert.rejects(h.api.load(student()),/학원이 변경/);
  assert.equal(h.api.read(student())[0].id,'pending');
});

function createBoardHarness(items) {
  let calls = [];
  let reader = async (method, path) => {
    assert.equal(method,'GET');
    calls.push(path);
    const cursor = path.match(/&id=lt\.([^&]+)/);
    const before = cursor ? Number(decodeURIComponent(cursor[1])) : Infinity;
    return items.filter(item=>Number(item.id) < before).slice(0,500);
  };
  const scope = {supabase:(method,path)=>reader(method,path)};
  vm.createContext(scope);
  vm.runInContext(boardSource + '\nthis.readPages=loadOlliRecordFeedbackPages;',scope);
  return {readPages:scope.readPages,calls,setReader:fn=>{reader=fn;}};
}

test('record board loads 1,201 feedbacks through 3 keyset pages, without skipping older students', async () => {
  const rows = Array.from({length:1201},(_,i)=>row(1201-i));
  const h = createBoardHarness(rows);
  const result = await h.readPages('feedbacks?academy_id=eq.test');
  assert.equal(result.length,1201);
  assert.equal(new Set(result.map(x=>x.id)).size,1201);
  assert.equal(result.at(-1).id,1);
  assert.equal(h.calls.length,3);
  assert.match(h.calls[1],/id=lt\.702/);
  assert.doesNotMatch(boardCode,/academy_id=eq\.\$\{encodeURIComponent\(academyId\)\}&order=id.desc&limit=500/);
});

test('failed later page throws rather than claiming partial history is complete', async () => {
  const rows = Array.from({length:600},(_,i)=>row(600-i));
  const h = createBoardHarness(rows);
  let requests=0;
  h.setReader(async ()=>{requests++;if(requests===2)throw Error('network interrupted');return rows.slice(0,500);});
  await assert.rejects(h.readPages('feedbacks?academy_id=eq.test'),/network interrupted/);
  assert.equal(requests,2);
});

test('record board abandons obsolete screen requests without painting outdated results', async () => {
  const rows = Array.from({length:700},(_,i)=>row(700-i));
  const h = createBoardHarness(rows);
  let active=true;
  h.setReader(async ()=>{active=false;return rows.slice(0,500);});
  assert.equal(await h.readPages('feedbacks?academy_id=eq.test',()=>active),null);
  assert.match(boardCode,/requestStillCurrent\(\) \|\| rawData === null/);
});

test('versioned mobile entry includes changed archive and record board scripts', () => {
  assert.match(html,/elementary-analysis-phone-adapter\.js\?v=20261104-feedback-full-history-1/);
  assert.match(html,/olli-record-room-navigation\.js\?v=20261104-feedback-full-history-1/);
});
