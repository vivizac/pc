const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
let db,room,revision;
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const academy=n=>uid(n), account=n=>uid(100+n), member=n=>uid(200+n);
const sql=async(q,args=[])=> (await db.query(q,args)).rows;
async function rpc(name,args,role='anon'){
  await db.exec(`set role ${role}`);
  try{return (await sql(`select public.olli_shared_chat_${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args))[0].result;}
  finally{await db.exec('reset role');}
}
const chosen=ns=>JSON.stringify(ns.map(n=>({academy_id:academy(n),display_name:['','대천점','상인점','세번째점','외부점'][n]})));
let request=400;
const configure=async(ns,expected=revision,roomId=room,session='owner',req=uid(++request))=>rpc('configure',[session,academy(1),roomId,expected,chosen(ns),req]);
const send=async(session,school,body='안녕하세요',reply=null,targets=[],all=false,client=uid(++request))=>rpc('send',[session,academy(school),room,body,client,reply,targets,all]);
const list=async(session,school)=>rpc('list',[session,academy(school),room,null,100]);

before(async()=>{db=await require('./fixture.cjs').createDB();});
after(async()=>{await db?.close();});

test('release is closed; clients cannot enable it, read tables, or call private helpers',async()=>{
  assert.equal((await rpc('status',['owner',academy(1)])).enabled,false);
  await assert.rejects(configure([1,2]),/아직/);
  await db.exec('set role anon');
  try{
    await assert.rejects(sql('select * from private.olli_shared_chat_messages'),/permission denied/);
    await assert.rejects(sql('update private.olli_shared_chat_release set enabled=true'),/permission denied/);
    await assert.rejects(sql('select private.olli_shared_chat_can_read($1,$2,1)',[account(2),uid(1)]),/permission denied/);
  }finally{await db.exec('reset role');}
  await db.exec('update private.olli_shared_chat_release set enabled=true');
});
test('owner-only setup validates every academy, duplicates, and session',async()=>{
  await assert.rejects(configure([1,2],null,null,'teacherA'),/원장/);
  await assert.rejects(configure([1,2],null,null,'manager'),/원장/);
  await assert.rejects(configure([1,4],null,null),/모두/);
  await assert.rejects(configure([1,2],null,null,'invalid'),/세션/);
  await assert.rejects(configure([1,1],null,null),/중복/);
  await assert.rejects(rpc('configure',['owner',academy(1),null,null,JSON.stringify([
    {academy_id:academy(1),display_name:' 대천점 '},{academy_id:academy(2),display_name:'대천점'}]),uid(++request)]),/중복/);
  const result=await configure([1,2],null,null);
  room=result.room.id;revision=result.room.revision;
  assert.equal(result.room.academies.length,2);
  assert.equal((await list('teacherA',1)).messages[0].message_type,'system');
});
test('retry/idempotency, forged academy, unrelated room/reply, and cross-school chat',async()=>{
  const client=uid(++request);
  const first=await send('teacherA',1,'대천점 메시지',null,[],false,client);
  assert.equal((await send('teacherA',1,'다른 내용',null,[],false,client)).message_id,first.message_id);
  assert.equal((await list('teacherB',2)).messages.at(-1).body,'대천점 메시지');
  await assert.rejects(send('teacherB',1),/멤버십/);
  await assert.rejects(send('outsider',4),/참여/);
  await assert.rejects(rpc('list',['teacherA',academy(1),uid(999),null,50]),/참여/);
  await assert.rejects(send('teacherB',2,'답장',999999),/답장/);
  await assert.rejects(send('teacherA',1,'외부 멘션',null,[member(7)]),/참여하지/);
});
test('deduplicates multi-academy members, mentions and monotonic read receipts by account',async()=>{
  const members=(await rpc('members',['teacherA',academy(1),room])).members;
  assert.equal(members.length,4); // owner, A, B, manager
  assert.equal(members.filter(m=>m.display_name==='동명이인').length,2);
  const result=await send('owner',1,'전체 공지',null,[],true);
  assert.equal((await sql('select count(*)::int n from private.olli_shared_chat_mentions where message_id=$1',[result.message_id]))[0].n,3);
  const messages=(await list('teacherA',1)).messages;
  const latest=messages.at(-1);
  assert.equal(latest.mentions_me,true);
  await rpc('mark_read',['teacherA',academy(1),room,latest.seq]);
  const signalCount=(await sql('select count(*)::int n from private.test_signals'))[0].n;
  await rpc('mark_read',['teacherA',academy(2),room,messages[0].seq]);
  assert.equal((await sql('select count(*)::int n from private.test_signals'))[0].n,signalCount,'old read receipts must not generate a Realtime loop');
  assert.equal((await sql('select last_read_seq from private.olli_shared_chat_reads where account_id=$1',[account(2)]))[0].last_read_seq,latest.seq);
  await assert.rejects(rpc('mark_read',['teacherA',academy(1),room,999999]),/읽을 수/);
});
test('third academy gets only messages after joining, including no hidden parent body',async()=>{
  const old=(await list('owner',1)).messages.at(-1);
  const result=await configure([1,2,3]);revision=result.room.revision;
  const messages=(await list('teacherC',3)).messages;
  assert.equal(messages.length,1);assert.equal(messages[0].message_type,'system');
  await assert.rejects(send('teacherC',3,'숨겨진 기록 답장',old.id),/답장/);
  await send('teacherA',1,'세 학원 공동 대화');
  assert.equal((await list('teacherC',3)).messages.at(-1).body,'세 학원 공동 대화');
  await assert.rejects(configure([1,2,3],revision-1),/변경/);
});
test('rename supports name swaps without reopening history and keeps academy_name',async()=>{
  const before=await sql('select id,joined_after_seq from private.olli_shared_chat_academies where left_at is null order by academy_id');
  const result=await rpc('configure',['owner',academy(1),room,revision,JSON.stringify([
    {academy_id:academy(1),display_name:'상인점'},{academy_id:academy(2),display_name:'대천점'},
    {academy_id:academy(3),display_name:'세번째점'}]),uid(++request)]);
  revision=result.room.revision;
  assert.deepEqual(await sql('select id,joined_after_seq from private.olli_shared_chat_academies where left_at is null order by academy_id'),before);
  assert.equal((await sql('select academy_name from public.academies where id=$1',[academy(1)]))[0].academy_name,'학원1');
});
test('edits/deletes require sender; deleted messages and attachments cannot reappear',async()=>{
  const sent=await send('teacherB',2,'수정 전');
  await assert.rejects(rpc('update_message',['teacherA',academy(1),room,sent.message_id,'훔친 수정',false]),/내 메시지/);
  await rpc('update_message',['teacherB',academy(2),room,sent.message_id,'수정 후',false]);
  assert.equal((await list('teacherA',1)).messages.at(-1).body,'수정 후');
  await rpc('update_message',['teacherB',academy(2),room,sent.message_id,null,true]);
  assert.ok((await list('teacherA',1)).deleted_message_ids.includes(sent.message_id));
});
test('leave revokes access immediately; rejoin gets a fresh epoch; no old records copied',async()=>{
  const old=(await list('teacherC',3)).messages.at(-1);
  await rpc('leave',['owner',academy(3),room,revision]);revision++;
  await assert.rejects(list('teacherC',3),/참여/);
  const after=await send('teacherA',1,'해제 중 대화');
  const result=await configure([1,2,3]);revision=result.room.revision;
  const rejoined=(await list('teacherC',3)).messages;
  assert.equal(rejoined.length,1);
  await assert.rejects(send('teacherC',3,'과거 답장',old.id),/답장/);
  assert.ok(!rejoined.some(m=>m.id===after.message_id));
  await db.exec(`update public.academy_members set status='inactive' where id='${member(5)}'`);
  await assert.rejects(list('teacherB',2),/멤버십/);
});
test('private attachment broker blocks direct clients, outsiders, join history and deleted files',async()=>{
  await assert.rejects(rpc('file_prepare',['owner',academy(1),room,'a.txt','text/plain',4]),/permission denied/);
  const file=await rpc('file_prepare',['owner',academy(1),room,'a.txt','text/plain',4],'service_role');
  await assert.rejects(rpc('file_access',['teacherC',academy(3),room,file.attachment_id,false],'service_role'),/첨부파일/);
  const sent=await rpc('file_commit',['owner',academy(1),room,file.attachment_id,null,[],false],'service_role');
  assert.equal((await rpc('file_access',['teacherC',academy(3),room,file.attachment_id,false],'service_role')).file_size,4);
  const payload=await list('teacherC',3);
  assert.equal(payload.messages.at(-1).attachment.id,file.attachment_id);
  assert.equal(JSON.stringify(payload).includes('storage_path'),false);
  await rpc('update_message',['owner',academy(1),room,sent.message_id,null,true]);
  await assert.rejects(rpc('file_access',['owner',academy(1),room,file.attachment_id,false],'service_role'),/첨부파일/);
});
test('push targets deduplicate endpoints and accounts; service-only claims exclude wrong academies',async()=>{
  for(const [id,school,mem,endpoint] of [[1,1,4,'https://push.test/a'],[2,2,8,'https://push.test/a'],[3,3,6,'https://push.test/c'],[4,4,7,'https://push.test/external']])
    await sql('insert into public.olli_team_chat_push_subscriptions values($1,$2,$3,$4,\'key\',\'auth\',null)',[uid(600+id),academy(school),member(mem),endpoint]);
  const sent=await send('owner',1,'새 메시지');
  await assert.rejects(rpc('push_claim',['owner',academy(1),room,sent.message_id]),/permission denied/);
  await assert.rejects(rpc('push_claim',['teacherC',academy(3),room,sent.message_id],'service_role'),/내 공동/);
  const claims=await rpc('push_claim',['owner',academy(1),room,sent.message_id],'service_role');
  assert.equal(claims.targets.length,2);
  assert.equal(claims.targets.filter(t=>t.endpoint.endsWith('/a')).length,1);
  assert.equal((await rpc('push_claim',['owner',academy(1),room,sent.message_id],'service_role')).targets.length,0);
  assert.ok((await rpc('summary',['teacherC',academy(3),room])).unread_count>0);
});
test('revoked session and inactive academy are checked on every request',async()=>{
  await db.exec("update private.test_sessions set active=false where token='teacherA'");
  await assert.rejects(list('teacherA',1),/세션/);
  await db.exec(`update public.academies set status='inactive' where id='${academy(3)}'`);
  await assert.rejects(list('teacherC',3),/멤버십/);
});
test('restrictive storage rule denies the shared bucket even with a broad permissive rule',async()=>{
  await db.exec(`grant usage on schema storage to anon;grant select,insert on storage.objects to anon;
    create policy test_broad_rule on storage.objects for all to anon using(true) with check(true);
    insert into storage.objects values('olli_shared_chat_files'),('academy_profiles');set role anon;`);
  try{
    assert.equal((await sql('select * from storage.objects')).length,1);
    await assert.rejects(sql("insert into storage.objects values('olli_shared_chat_files')"),/row-level security/);
  }finally{await db.exec('reset role');}
});

test('removing a member registration preserves sent messages and revokes access',async()=>{
  const sent=await send('manager',1,'연결 해제 전에 보낸 메시지');
  await sql('delete from public.academy_members where id=$1',[member(9)]);
  await assert.rejects(list('manager',1),/멤버십/);
  const message=(await list('owner',1)).messages.find(row=>row.id===sent.message_id);
  assert.equal(message.body,'연결 해제 전에 보낸 메시지');
  assert.equal(message.sender_name,'관리자');
  assert.equal(message.sender_member_id,null);
});

test('shared Realtime emits only to current and newly removed academy topics',async t=>{
  const db=await require('./fixture.cjs').createDB();
  t.after(()=>db.close());
  const sql=async(query,params=[])=>(await db.query(query,params)).rows;
  const topics=new Map((await sql(
    "select academy_id, 'olli:' || topic_token as topic from private.olli_realtime_topics"
  )).map(row=>[row.academy_id,row.topic]));
  async function assertSignals(schools){
    const events=await sql('delete from private.test_signals returning *');
    assert.deepEqual(events.map(event=>event.topic).sort(),schools.map(school=>topics.get(academy(school))).sort());
    for(const event of events){
      assert.equal(event.event,'changed');
      assert.equal(event.is_private,false);
      assert.deepEqual(event.payload,{protocol:1,domain:'chat',revision:0});
    }
  }
  await db.exec('update private.olli_shared_chat_release set enabled=true');
  const configure=async(room,revision,requestId,schools)=>(await sql(
    'select public.olli_shared_chat_configure($1,$2,$3,$4,$5,$6) as result',
    ['owner',academy(1),room,revision,schools,uid(requestId)]
  ))[0].result.room;
  const initial=await configure(null,null,700,chosen([1,2,3]));
  await assertSignals([1,2,3]);
  const removed=await configure(initial.id,initial.revision,701,chosen([1,2]));
  await assertSignals([1,2,3]);
  const renamed=await configure(initial.id,removed.revision,702,chosen([1,2]).replace('대천점','대천 새 이름'));
  await assertSignals([1,2]);
  const send=(body,requestId)=>sql("select public.olli_shared_chat_send($1,$2,$3,$4,$5,null,'{}',false)",
    ['teacherA',academy(1),initial.id,body,uid(requestId)]);
  await send('공동 대화',703);
  await assertSignals([1,2]);
  await db.exec(`create or replace function realtime.send(jsonb,text,text,boolean)
    returns void language plpgsql as $$begin raise exception 'transport offline'; end;$$;`);
  await send('신호 전송이 실패해도 보존',704);
  const [saved]=await sql('select public.olli_shared_chat_list($1,$2,$3,null,20) as result',
    ['teacherB',academy(2),initial.id]);
  assert.equal(saved.result.messages.at(-1).body,'신호 전송이 실패해도 보존');
  await db.exec(`create or replace function realtime.send(jsonb,text,text,boolean)
    returns void language sql as $$insert into private.test_signals values($1,$2,$3,$4)$$;`);
  await sql('select public.olli_shared_chat_leave($1,$2,$3,$4)',
    ['owner',academy(2),initial.id,renamed.revision]);
  await assertSignals([1,2]);
});
