const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','olli-snapshot-revision-common.js'),'utf8');

function sandbox(){
  const storage=new Map();
  const win={
    localStorage:{
      getItem:key=>storage.get(key)||null,
      setItem:(key,value)=>storage.set(key,String(value)),
      removeItem:key=>storage.delete(key)
    }
  };
  win.window=win;
  vm.createContext(win);
  vm.runInContext(source,win);
  return{win,storage};
}

test('checkpoint is isolated by account academy and snapshot key',()=>{
  const {win}=sandbox();
  const api=win.OlliSnapshotRevision;
  const a={academyId:'a',accountId:'u',snapshotKey:'students'};
  const b={academyId:'a',accountId:'u',snapshotKey:'consultation_surveys'};
  assert.equal(api.writeCheckpoint(a,'students',5),true);
  assert.deepEqual({...api.readCheckpoint(a)},{markerName:'students',revision:5});
  assert.equal(api.readCheckpoint(b),null);
});

test('matching marker skips snapshot load',async()=>{
  const {win}=sandbox();
  const api=win.OlliSnapshotRevision;
  const ctx={academyId:'a',accountId:'u',snapshotKey:'students'};
  api.writeCheckpoint(ctx,'students',7);
  let loads=0;
  const result=await api.syncSnapshot({
    ...ctx,markerName:'students',sessionToken:'token',
    rpc:async()=>({ok:true,protocol:1,academy_id:'a',markers:{students:{kind:'revision',value:7,coverage:'students_snapshot_via_schedule_revision'}}}),
    loadSnapshot:async()=>{loads+=1;return{changed:false}}
  });
  assert.equal(loads,0);
  assert.equal(result.skipped,true);
});

test('marker mismatch loads snapshot then advances checkpoint',async()=>{
  const {win}=sandbox();
  const api=win.OlliSnapshotRevision;
  const ctx={academyId:'a',accountId:'u',snapshotKey:'consultation_surveys'};
  api.writeCheckpoint(ctx,'consultation',2);
  let loads=0;
  const result=await api.syncSnapshot({
    ...ctx,markerName:'consultation',sessionToken:'token',
    rpc:async()=>({ok:true,protocol:1,academy_id:'a',markers:{consultation:{kind:'revision',value:3,coverage:'consultation_snapshot_revision'}}}),
    loadSnapshot:async()=>{loads+=1;return{success:true,changed:true}}
  });
  assert.equal(loads,1);
  assert.equal(result.changed,true);
  assert.equal(api.readCheckpoint(ctx).revision,3);
});

test('marker is captured before snapshot and concurrent future revision is not skipped',async()=>{
  const {win}=sandbox();
  const api=win.OlliSnapshotRevision;
  const ctx={academyId:'a',accountId:'u',snapshotKey:'students'};
  let serverRevision=10;
  const result=await api.syncSnapshot({
    ...ctx,markerName:'students',sessionToken:'token',
    rpc:async()=>({ok:true,protocol:1,academy_id:'a',markers:{students:{kind:'revision',value:serverRevision,coverage:'students_snapshot_via_schedule_revision'}}}),
    loadSnapshot:async()=>{serverRevision=11;return{changed:true}}
  });
  assert.equal(result.applied,true);
  assert.equal(api.readCheckpoint(ctx).revision,10);
});

test('missing manifest falls back to full snapshot without manufacturing checkpoint',async()=>{
  const {win}=sandbox();
  const api=win.OlliSnapshotRevision;
  const ctx={academyId:'a',accountId:'u',snapshotKey:'students'};
  let loads=0;
  const result=await api.syncSnapshot({
    ...ctx,markerName:'students',sessionToken:'token',
    rpc:async()=>{throw new Error('Could not find the function public.olli_sync_manifest in the schema cache PGRST202')},
    loadSnapshot:async()=>{loads+=1;return{changed:false}}
  });
  assert.equal(loads,1);
  assert.equal(result.fallback,true);
  assert.equal(api.readCheckpoint(ctx),null);
});

test('failed or stale snapshot never advances checkpoint',async()=>{
  const {win}=sandbox();
  const api=win.OlliSnapshotRevision;
  const ctx={academyId:'a',accountId:'u',snapshotKey:'consultation_settings'};
  const result=await api.syncSnapshot({
    ...ctx,markerName:'consultation',sessionToken:'token',
    rpc:async()=>({ok:true,protocol:1,academy_id:'a',markers:{consultation:{kind:'revision',value:4,coverage:'consultation_snapshot_revision'}}}),
    loadSnapshot:async()=>({success:false,error:'failed'})
  });
  assert.equal(result.applied,false);
  assert.equal(api.readCheckpoint(ctx),null);
});
