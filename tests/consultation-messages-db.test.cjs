'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const localRequire=createRequire(path.join(__dirname,'consultation-messages/package.json'));
const {PGlite}=localRequire('@electric-sql/pglite');
const academy='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002';
const student='10000000-0000-0000-0000-000000000001',student2='10000000-0000-0000-0000-000000000002';

function currentMonth(){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).formatToParts(new Date());return p.find(x=>x.type==='year').value+'-'+p.find(x=>x.type==='month').value;}

test('isolated PostgreSQL migration, access controls, current-student filter and durable claims',async(t)=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table public.academies(id uuid primary key,academy_name text,status text,deleted_at timestamptz);
 create table public.students(id uuid primary key,academy_id uuid,name text,division text,enrolled_at date,status text,is_deleted boolean,deleted_at timestamptz,updated_at timestamptz);
 create table public.academy_members(academy_id uuid,account_id uuid,status text,role text);
 create table public.academy_settings(academy_id uuid,consultation_rules jsonb,consultation_progress jsonb);
 create function public.olli_account_id_from_session(token text) returns uuid language sql as $$ select case token when 'owner' then '20000000-0000-0000-0000-000000000001'::uuid when 'teacher' then '20000000-0000-0000-0000-000000000002'::uuid when 'manager' then '20000000-0000-0000-0000-000000000003'::uuid else null end $$;
 grant usage on schema public to anon,authenticated,service_role;
 grant select on academies,students,academy_settings to service_role;
 insert into academies values('${academy}','학원','active',null),('${other}','다른학원','active',null);
 insert into academy_members values('${academy}','20000000-0000-0000-0000-000000000001','active','owner'),('${academy}','20000000-0000-0000-0000-000000000002','active','teacher'),('${academy}','20000000-0000-0000-0000-000000000003','active','manager');
 insert into students values('${student}','${academy}','테스트','kinder','2025-10-01','active',false,null,'2026-10-01T00:00:00Z'),('${student2}','${other}','다른학원학생','kinder','2025-10-01','active',false,null,'2026-10-01T00:00:00Z');
 insert into academy_settings values('${academy}','["every_6","every_12"]','{"completed":{}}');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261020150403_consultation_alimtalk.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261020155449_consultation_message_templates.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261020231237_consultation_message_usage_switch.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261021144500_consultation_channel_registry.sql'),'utf8'));
 // Explicit HQ approval; older channel_id alone never becomes authorized.
 const channelId='30000000-0000-0000-0000-000000000001';
 await db.query("insert into olli_consultation_channels(id,pf_id,channel_name,channel_type,approval_state) values($1,'KA01PF','테스트 채널','headquarters','approved')",[channelId]);
 await db.query("insert into olli_consultation_channel_assignments(academy_id,channel_id,approval_state) values($1,$2,'approved')",[academy,channelId]);
 await db.query("insert into olli_consultation_channel_templates(channel_id,template_id,template_body,approval_state) values($1,'KA01TP',$2,'approved')",[channelId,'#{학생명}\\n#{예약링크}']);
 await db.query("insert into olli_consultation_message_settings(academy_id,selected_channel_id,channel_mode) values($1,$2,'headquarters')",[academy,channelId]);
 async function manage(token,action='load',data={},id=academy){return (await db.query('select public.olli_consultation_messages_manage($1,$2,$3,$4) as result',[token,id,action,JSON.stringify(data)])).rows[0].result;}
 const settings={enabled:true,booking_url:'https://booking.naver.com/booking/13/bizes/123',channel_id:'KA01PF',template_id:'KA01TP',template_body:'#{학생명}\n#{예약링크}',template_confirmed:true};
 const tasks=['id:'+student+'|every_6|'+currentMonth(),'id:'+student+'|every_12|'+currentMonth()];
 const params=[academy,student,currentMonth(),JSON.stringify(tasks),1,1,'2026-10-01T00:00:00Z','["every_6","every_12"]','{"completed":{}}'];
 async function reserve(args=params){return (await db.query('select public.olli_consultation_messages_reserve($1,$2,$3,$4,$5,$6,$7,$8,$9) as id',args)).rows[0].id;}
 await t.test('session membership required and cross-academy access rejected',async()=>{
   await db.exec('set role anon');
   for(const token of ['bad','teacher','manager'])await assert.rejects(manage(token));
   await assert.rejects(manage('owner','load',{},other));
   const loaded=await manage('owner');assert.equal(loaded.students.length,1);
   await assert.rejects(db.query('select * from olli_consultation_message_contacts'));
   await assert.rejects(db.query('select public.olli_consultation_messages_snapshot(null)'));
   await db.exec('reset role');
 });
 await t.test('approved template and safe Naver URL required before enabling',async()=>{
   await assert.rejects(manage('owner','settings',{...settings,template_confirmed:false}));
   await assert.rejects(manage('owner','settings',{...settings,booking_url:'https://naver.com.evil.test/x'}));
   await assert.rejects(manage('owner','settings',{...settings,template_body:'#{잘못된변수}'}));
   const saved=await manage('owner','settings',settings);assert.equal(saved.settings.enabled,true);assert.equal(saved.settings.start_month,currentMonth());
   params[4]=saved.settings.revision;
 });
 await t.test('contacts scoped to active academy and confirmation required by worker',async()=>{
   await assert.rejects(manage('owner','contact',{student_id:student2,phone:'01012345678',confirmed:true}));
   await assert.rejects(manage('owner','contact',{student_id:student,phone:'123',confirmed:true}));
   await manage('owner','contact',{student_id:student,phone:'010-1234-5678',confirmed:false});
   await db.exec('set role service_role');
   let data=(await db.query('select public.olli_consultation_messages_snapshot(null) as data')).rows[0].data;assert.equal(data[0].students.length,0);
   assert.equal(await reserve(),null);await db.exec('reset role');
   await manage('owner','contact',{student_id:student,phone:'01012345678',confirmed:true});params[5]=2;
 });
 await t.test('paused, withdrawn, soft deleted students cannot reserve; stale contact/config/progress rejected',async()=>{
   for(const patch of ["status='paused'","status='withdrawn'","is_deleted=true","deleted_at=now()"]){
     await db.exec('update students set '+patch+` where id='${student}'`);
     await db.exec('set role service_role');assert.equal(await reserve(),null);await db.exec('reset role');
     await db.exec(`update students set status='active',is_deleted=false,deleted_at=null where id='${student}'`);
   }
   await db.exec('set role service_role');
   const staleConfig=params.slice();staleConfig[4]=999;assert.equal(await reserve(staleConfig),null);
   const staleContact=params.slice();staleContact[5]=999;assert.equal(await reserve(staleContact),null);
   const staleProgress=params.slice();staleProgress[8]='{"completed":{"changed":true}}';assert.equal(await reserve(staleProgress),null);
   const completed=params.slice();completed[8]=JSON.stringify({completed:{[tasks[0]]:{completed_month:currentMonth()}}});
   await db.exec('reset role');await db.query('update academy_settings set consultation_progress=$1',[completed[8]]);await db.exec('set role service_role');assert.equal(await reserve(completed),null);await db.exec('reset role');
   await db.query('update academy_settings set consultation_progress=$1',['{"completed":{}}']);
 });
 let id;
 await t.test('unique monthly reservation survives result ambiguity and terminal status cannot regress',async()=>{
   await db.exec('set role service_role');
   const claimed=await Promise.all([reserve(),reserve()]);assert.equal(claimed.filter(Boolean).length,1);id=claimed.find(Boolean);
   assert.equal((await db.query("select olli_consultation_messages_finish($1,'unknown',null,'CHECK_PROVIDER_CONSOLE') as ok",[id])).rows[0].ok,true);
   assert.equal(await reserve(),null);
   await db.query("select olli_consultation_messages_finish($1,'delivered','M-test','4000')",[id]);
   assert.equal((await db.query("select olli_consultation_messages_finish($1,'submitted',null,null) as ok",[id])).rows[0].ok,false);
   await db.exec('reset role');
 });
 await t.test('turning off preserves contacts/history and original records',async()=>{
   const disabled=await manage('owner','settings',{...settings,enabled:false});assert.equal(disabled.deliveries.length,1);assert.equal(disabled.students[0].phone,'01012345678');
   const saved=(await db.query('select consultation_rules,consultation_progress from academy_settings')).rows[0];assert.deepEqual(saved,{consultation_rules:['every_6','every_12'],consultation_progress:{completed:{}}});
   assert.equal((await db.query("select count(*)::int n from students")).rows[0].n,2);
   const secure=await db.query("select relname,relrowsecurity from pg_class where relname in ('olli_consultation_message_settings','olli_consultation_message_contacts','olli_consultation_message_deliveries')");assert.ok(secure.rows.every(x=>x.relrowsecurity));
 });
 await t.test('common and per-stage templates persist, validate approval, and survive older clients',async()=>{
   const variant={use_common:false,template_id:'KINDER-1',template_body:'유치부 첫 상담 #{학생명}',template_confirmed:true};
   let result=await manage('owner','settings',{...settings,template_mode:'by_type',template_variants:{'kinder:after_1':variant}});
   assert.equal(result.settings.template_mode,'by_type');assert.equal(result.settings.template_variants['kinder:after_1'].template_id,'KINDER-1');
   await assert.rejects(manage('owner','settings',{...settings,template_mode:'by_type',template_variants:{'kinder:after_1':{...variant,template_confirmed:false}}}));
   await assert.rejects(manage('owner','settings',{...settings,template_mode:'by_type',template_variants:{'unknown:after_1':variant}}));
   await assert.rejects(manage('owner','settings',{...settings,template_mode:'by_type',template_variants:[]}));
   result=await manage('owner','settings',{...settings,template_mode:'common'});
   assert.equal(result.settings.template_variants['kinder:after_1'].template_body,variant.template_body);
   result=await manage('owner','settings',settings); // Existing clients omit the new fields.
   assert.equal(result.settings.template_mode,'common');assert.equal(result.settings.template_variants['kinder:after_1'].template_id,'KINDER-1');
   assert.equal(result.students[0].phone,'01012345678');assert.equal(result.deliveries.length,1);
 });
 await t.test('one academy opting out preserves its data and does not disable another academy',async()=>{
   await db.query("insert into olli_consultation_message_settings(academy_id,enabled) values($1,true)",[other]);
   await db.query("update olli_consultation_message_settings set template_body='다른 기기에서 저장한 안내문' where academy_id=$1",[academy]);
   const off=await manage('owner','disable',{});
   assert.equal(off.settings.template_body,'다른 기기에서 저장한 안내문');
   assert.equal(off.settings.enabled,false);assert.equal(off.students[0].phone,'01012345678');assert.equal(off.deliveries.length,1);
   assert.equal(off.settings.template_variants['kinder:after_1'].template_id,'KINDER-1');
   const otherRow=(await db.query('select enabled from olli_consultation_message_settings where academy_id=$1',[other])).rows[0];assert.equal(otherRow.enabled,true);
 });
 await db.close();
});
