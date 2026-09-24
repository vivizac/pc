const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','olli-materials-sync-common.js'),'utf8');

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

test('checkpoint is isolated by account and academy',()=>{
  const {win}=sandbox();
  const api=win.OlliMaterialsSync;
  const a={academyId:'academy-a',accountId:'account-a'};
  const b={academyId:'academy-a',accountId:'account-b'};
  assert.equal(api.writeCheckpoint(a,{eventId:7}),true);
  assert.deepEqual({...api.readCheckpoint(a)},{eventId:7});
  assert.equal(api.readCheckpoint(b),null);
});

test('baseline captures current event head only',async()=>{
  const {win}=sandbox();
  const calls=[];
  const checkpoint=await win.OlliMaterialsSync.createBaseline({
    academyId:'a',sessionToken:'s',
    rpc:async(name,params)=>{
      calls.push({name,params});
      return{
        ok:true,baseline:true,academy_id:'a',
        current_member_id:'m',current_role:'owner',can_process:true,
        summary:{requested:1,on_hold:0,ordered:0,arrived:0},
        latest_event_id:12,next_event_id:12,has_more:false,
        items:[],deleted_request_ids:[],change_types:[]
      };
    }
  });
  assert.deepEqual({...checkpoint},{eventId:12});
  assert.equal(calls.length,1);
  assert.equal(calls[0].params.p_after_event_id,null);
});

test('pull pages forward event cursor and deduplicates changed requests',async()=>{
  const {win}=sandbox();
  let call=0;
  const result=await win.OlliMaterialsSync.pull({
    academyId:'a',sessionToken:'s',checkpoint:{eventId:5},
    rpc:async()=>{
      call+=1;
      if(call===1)return{
        ok:true,academy_id:'a',current_member_id:'m',current_role:'owner',can_process:true,
        summary:{requested:2,on_hold:0,ordered:0,arrived:0},
        latest_event_id:8,next_event_id:7,has_more:true,
        items:[{id:'r1',status:'requested',revision:2},{id:'r2',status:'requested',revision:1}],
        deleted_request_ids:[],change_types:['status_changed']
      };
      return{
        ok:true,academy_id:'a',current_member_id:'m',current_role:'owner',can_process:true,
        summary:{requested:1,on_hold:0,ordered:1,arrived:0},
        latest_event_id:8,next_event_id:8,has_more:false,
        items:[{id:'r1',status:'ordered',revision:3}],
        deleted_request_ids:['r3'],change_types:['status_changed','deleted']
      };
    }
  });
  assert.equal(call,2);
  assert.deepEqual({...result.checkpoint},{eventId:8});
  assert.equal(result.items.find(x=>x.id==='r1').revision,3);
  assert.deepEqual(Array.from(result.deletedRequestIds),['r3']);
  assert.equal(result.summary.ordered,1);
  assert.equal(result.complete,true);
});

test('applyToPayload uses authoritative summary, replaces rows, removes tombstones and keeps list order',()=>{
  const {win}=sandbox();
  const api=win.OlliMaterialsSync;
  const base={
    ok:true,academy_id:'a',current_member_id:'m',current_role:'owner',can_process:true,
    summary:{requested:2,on_hold:0,ordered:1,arrived:0},
    items:[
      {id:'r1',status:'requested',needed_on:'2026-10-10',created_at:'2026-09-20T00:00:00Z',revision:1},
      {id:'r2',status:'requested',needed_on:null,created_at:'2026-09-22T00:00:00Z',revision:1},
      {id:'r3',status:'ordered',needed_on:null,created_at:'2026-09-21T00:00:00Z',revision:1}
    ]
  };
  const next=api.applyToPayload(base,{
    academyId:'a',currentMemberId:'m',currentRole:'owner',canProcess:true,
    summary:{requested:1,on_hold:0,ordered:1,arrived:0},
    items:[{id:'r1',status:'ordered',needed_on:'2026-10-10',created_at:'2026-09-20T00:00:00Z',revision:2}],
    deletedRequestIds:['r2']
  },{maxItems:300});
  assert.deepEqual(Array.from(next.items).map(x=>x.id),['r1','r3']);
  assert.equal(next.items[1].revision,2);
  assert.equal(next.summary.requested,1);
});

test('stale academy/session context aborts pull',async()=>{
  const {win}=sandbox();
  let current=true;
  await assert.rejects(
    win.OlliMaterialsSync.pull({
      academyId:'a',sessionToken:'s',checkpoint:{eventId:1},
      isCurrent:()=>current,
      rpc:async()=>{
        current=false;
        return{
          ok:true,academy_id:'a',current_member_id:'m',current_role:'teacher',can_process:false,
          summary:{requested:0,on_hold:0,ordered:0,arrived:0},
          latest_event_id:2,next_event_id:2,has_more:false,
          items:[],deleted_request_ids:[],change_types:[]
        };
      }
    }),
    /context changed/
  );
});
