const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','olli-feedback-sync-common.js'),'utf8');

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

test('checkpoint is isolated by academy account and student',()=>{
  const {win}=sandbox();
  const api=win.OlliFeedbackSync;
  const a={academyId:'academy-a',accountId:'account-a',studentId:'student-1'};
  const b={academyId:'academy-a',accountId:'account-a',studentId:'student-2'};
  assert.equal(api.writeCheckpoint(a,{eventId:9}),true);
  assert.deepEqual({...api.readCheckpoint(a)},{eventId:9});
  assert.equal(api.readCheckpoint(b),null);
});

test('baseline captures current feedback event head only',async()=>{
  const {win}=sandbox();
  const calls=[];
  const checkpoint=await win.OlliFeedbackSync.createBaseline({
    academyId:'a',studentId:'s1',studentName:'학생',sessionToken:'token',
    rpc:async(name,params)=>{
      calls.push({name,params});
      return{
        ok:true,baseline:true,academy_id:'a',student_id:'s1',student_name:'학생',
        latest_event_id:12,next_event_id:12,has_more:false,
        records:[],deleted_records:[],change_types:[]
      };
    }
  });
  assert.deepEqual({...checkpoint},{eventId:12});
  assert.equal(calls.length,1);
  assert.equal(calls[0].params.p_after_event_id,null);
});

test('pull pages event cursor and keeps latest row for a record',async()=>{
  const {win}=sandbox();
  let call=0;
  const result=await win.OlliFeedbackSync.pull({
    academyId:'a',studentId:'s1',studentName:'학생',sessionToken:'token',checkpoint:{eventId:3},
    rpc:async()=>{
      call+=1;
      if(call===1)return{
        ok:true,academy_id:'a',student_id:'s1',student_name:'학생',
        latest_event_id:7,next_event_id:5,has_more:true,
        records:[
          {source_table:'feedbacks',record_id:'10',row:{id:10,content:'old',date:'2026-09-20',is_deleted:false}},
          {source_table:'fail_feedbacks',record_id:'g1',row:{id:'g1',content:'growth',date:'2026-09-21',is_deleted:false}}
        ],
        deleted_records:[],change_types:['updated']
      };
      return{
        ok:true,academy_id:'a',student_id:'s1',student_name:'학생',
        latest_event_id:7,next_event_id:7,has_more:false,
        records:[
          {source_table:'feedbacks',record_id:'10',row:{id:10,content:'new',date:'2026-09-22',is_deleted:false}}
        ],
        deleted_records:[{source_table:'summary_feedbacks',record_id:'30'}],change_types:['updated','deleted']
      };
    }
  });
  assert.equal(call,2);
  assert.deepEqual({...result.checkpoint},{eventId:7});
  assert.equal(result.records.find(x=>x.sourceTable==='feedbacks'&&x.recordId==='10').row.content,'new');
  assert.equal(result.deletedRecords.length,1);
  assert.equal(result.complete,true);
});

test('applyToData merges all feedback tables and removes tombstones',()=>{
  const {win}=sandbox();
  const api=win.OlliFeedbackSync;
  const base={
    feedbacks:[
      {id:'feedbacks_10',rowId:'10',sourceTable:'feedbacks',content:'old',createdAt:'2026-09-20',row:{id:10,source_table:'feedbacks'}},
      {id:'fail_feedbacks_g1',rowId:'g1',sourceTable:'fail_feedbacks',content:'growth',createdAt:'2026-09-19',row:{id:'g1',source_table:'fail_feedbacks'}}
    ],
    summaries:[
      {id:'summary_feedbacks_30',rowId:'30',sourceTable:'summary_feedbacks',content:'summary',createdAt:'2026-09-18',row:{id:30,source_table:'summary_feedbacks'}}
    ]
  };
  const next=api.applyToData(base,{
    records:[
      {sourceTable:'feedbacks',recordId:'10',row:{id:10,content:'new',date:'2026-09-23',is_deleted:false}},
      {sourceTable:'fail_feedbacks',recordId:'g2',row:{id:'g2',content:'new growth',date:'2026-09-22',is_deleted:false}}
    ],
    deletedRecords:[{sourceTable:'summary_feedbacks',recordId:'30'}]
  });
  assert.deepEqual(Array.from(next.feedbacks).map(x=>x.id),['feedbacks_10','fail_feedbacks_g2','fail_feedbacks_g1']);
  assert.equal(next.feedbacks[0].content,'new');
  assert.equal(next.summaries.length,0);
});

test('soft-deleted row payload is ignored even if returned accidentally',()=>{
  const {win}=sandbox();
  const item=win.OlliFeedbackSync.normalizeRecord({
    sourceTable:'feedbacks',recordId:'10',
    row:{id:10,content:'hidden',is_deleted:true}
  });
  assert.equal(item,null);
});

test('stale context aborts pull before checkpoint can be accepted',async()=>{
  const {win}=sandbox();
  let current=true;
  await assert.rejects(
    win.OlliFeedbackSync.pull({
      academyId:'a',studentId:'s1',studentName:'학생',sessionToken:'token',checkpoint:{eventId:1},
      isCurrent:()=>current,
      rpc:async()=>{
        current=false;
        return{
          ok:true,academy_id:'a',student_id:'s1',student_name:'학생',
          latest_event_id:2,next_event_id:2,has_more:false,
          records:[],deleted_records:[],change_types:[]
        };
      }
    }),
    /context changed/
  );
});
