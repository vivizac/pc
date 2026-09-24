const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'olli-team-chat-delta-common.js'), 'utf8');

function sandbox() {
  const storage = new Map();
  const win = {
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    console
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(source, win);
  return { win, storage };
}

test('checkpoint is scoped by academy and account', () => {
  const { win } = sandbox();
  const api = win.OlliTeamChatDelta;
  const a = { academyId:'academy-a', accountId:'account-a' };
  const b = { academyId:'academy-a', accountId:'account-b' };
  assert.equal(api.writeCheckpoint(a,{messageId:10,changeId:20}),true);
  assert.deepEqual({ ...api.readCheckpoint(a) }, { messageId:10, changeId:20 });
  assert.equal(api.readCheckpoint(b),null);
});

test('applyToPayload removes deleted ids and lets changed rows replace cached rows', () => {
  const { win } = sandbox();
  const api = win.OlliTeamChatDelta;
  const base = {
    ok:true, academy_id:'a', current_member_id:'m',
    messages:[
      {id:1,body:'old-1'},
      {id:2,body:'old-2',action:{status:'pending'}},
      {id:3,body:'old-3'}
    ]
  };
  const delta = {
    academyId:'a',
    newMessages:[{id:4,body:'new-4'}],
    changedMessages:[{id:2,body:'old-2',action:{status:'completed'}}],
    deletedMessageIds:[3]
  };
  const next = api.applyToPayload(base,delta,{maxMessages:500});
  assert.deepEqual(Array.from(next.messages).map(x=>x.id),[1,2,4]);
  assert.equal(next.messages[1].action.status,'completed');
});

test('applyToArchive keeps newest-first order and cap', () => {
  const { win } = sandbox();
  const api = win.OlliTeamChatDelta;
  const base={ok:true,academy_id:'a',messages:[{id:3},{id:2},{id:1}]};
  const next=api.applyToArchive(base,{
    academyId:'a',newMessages:[{id:4}],changedMessages:[],deletedMessageIds:[2]
  },{maxMessages:3});
  assert.deepEqual(Array.from(next.messages).map(x=>x.id),[4,3,1]);
});

test('baseline reads heads without requesting history', async () => {
  const { win } = sandbox();
  const calls=[];
  const checkpoint=await win.OlliTeamChatDelta.createBaseline({
    academyId:'a',sessionToken:'s',
    rpc:async(name,params)=>{
      calls.push({name,params});
      return {ok:true,baseline:true,latest_message_id:55,latest_change_id:9,next_message_id:55,next_change_id:9,new_messages:[],changed_messages:[],deleted_message_ids:[],change_types:[]};
    }
  });
  assert.deepEqual({ ...checkpoint },{messageId:55,changeId:9});
  assert.equal(calls.length,1);
  assert.equal(calls[0].params.p_after_message_id,null);
  assert.equal(calls[0].params.p_after_change_id,null);
});

test('pull pages both cursors and consolidates mutations', async () => {
  const { win } = sandbox();
  let call=0;
  const result=await win.OlliTeamChatDelta.pull({
    academyId:'a',sessionToken:'s',checkpoint:{messageId:10,changeId:3},
    rpc:async()=>{
      call+=1;
      if(call===1)return {
        ok:true,baseline:false,latest_message_id:13,latest_change_id:5,
        next_message_id:12,next_change_id:4,has_more_messages:true,has_more_changes:true,
        new_messages:[{id:11},{id:12}],changed_messages:[{id:8,action:{status:'done'}}],
        deleted_message_ids:[7],change_types:['action_mutated']
      };
      return {
        ok:true,baseline:false,latest_message_id:13,latest_change_id:5,
        next_message_id:13,next_change_id:5,has_more_messages:false,has_more_changes:false,
        new_messages:[{id:13}],changed_messages:[{id:9,unread_count:0}],
        deleted_message_ids:[6],change_types:['read_state']
      };
    }
  });
  assert.equal(call,2);
  assert.deepEqual({ ...result.checkpoint },{messageId:13,changeId:5});
  assert.deepEqual(Array.from(result.newMessages).map(x=>x.id),[11,12,13]);
  assert.deepEqual(Array.from(result.changedMessages).map(x=>x.id),[8,9]);
  assert.deepEqual(Array.from(result.deletedMessageIds),[6,7]);
  assert.equal(result.complete,true);
});

test('stale context aborts before cursor can be accepted', async () => {
  const { win } = sandbox();
  let current=true;
  await assert.rejects(
    win.OlliTeamChatDelta.pull({
      academyId:'a',sessionToken:'s',checkpoint:{messageId:1,changeId:1},
      isCurrent:()=>current,
      rpc:async()=>{
        current=false;
        return {ok:true,latest_message_id:2,latest_change_id:1,next_message_id:2,next_change_id:1,has_more_messages:false,has_more_changes:false,new_messages:[{id:2}],changed_messages:[],deleted_message_ids:[],change_types:[]};
      }
    }),
    /context changed/
  );
});
