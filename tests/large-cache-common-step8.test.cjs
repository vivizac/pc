const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','olli-large-cache-common.js'),'utf8');

function sandbox(){
  const win={};
  win.window=win;
  vm.createContext(win);
  vm.runInContext(source,win);
  return win;
}

test('large cache is a separate IndexedDB namespace',()=>{
  assert.match(source,/DB_NAME='olli_large_cache_v1'/);
  assert.match(source,/STORE='snapshots'/);
  assert.doesNotMatch(source,/olli_phone_attachment_cache_v1/);
});

test('scope key isolates domain account academy and scope',()=>{
  const win=sandbox();
  const key=win.OlliLargeCache.key({
    domain:'attendance_feedback',
    accountId:'account-a',
    academyId:'academy-a',
    scopeId:'student-a'
  });
  assert.equal(key,'attendance_feedback:account-a:academy-a:student-a');
});

test('without IndexedDB the common layer fails soft',async()=>{
  const win=sandbox();
  assert.equal(win.OlliLargeCache.available(),false);
  assert.equal(await win.OlliLargeCache.get({domain:'x',academyId:'a'}),null);
  assert.equal(await win.OlliLargeCache.put({domain:'x',academyId:'a'},{a:1}),false);
  assert.equal(await win.OlliLargeCache.remove({domain:'x',academyId:'a'}),false);
  assert.equal(await win.OlliLargeCache.pruneDomain({domain:'x',academyId:'a'},10),0);
});

test('IndexedDB store supports domain pruning metadata',()=>{
  assert.match(source,/createIndex\('domain_scope','domain_scope'/);
  assert.match(source,/createIndex\('saved_at','saved_at'/);
  assert.match(source,/rows\.sort\(\(a,b\)=>Number\(b\.saved_at/);
  assert.match(source,/rows\.slice\(keep\)/);
});
