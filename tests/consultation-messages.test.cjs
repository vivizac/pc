'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const core = require('../packages/common/olli-consultation-task-core.js');
// Run the canonical server module with the same self-contained build layout as production.
const os = require('node:os'), path = require('node:path');
const stage = require('../apps/pc/scripts/stage-common.cjs');
const staged = fs.mkdtempSync(path.join(os.tmpdir(),'olli-consultation-server-'));
stage.stageCommon({pcDir:staged});
const server = require(path.join(staged,'api/_lib/consultation-messages.cjs'));
test.after(()=>fs.rmSync(staged,{recursive:true,force:true}));

function snapshot() { return {
  settings:{academy_id:'academy',enabled:true,start_month:'2026-10',revision:1,booking_url:'https://booking.naver.com/booking/13/bizes/123',channel_id:'KA01PF',template_id:'KA01TP',template_confirmed:true,template_body:'#{학원명} #{학생명} #{상담구분}\n#{예약링크}'},
  academy_name:'테스트학원',rules:{elementary:['after_1','every_6','every_12'],kinder:['after_1','every_6','every_12']},progress:{tracking_started_month:'2026-01',completed:{}},
  students:[{id:'student',name:'테스트',division:'kinder',type:'kinder',enrolled_at:'2025-10-31',updated_at:'2026-10-01T00:00:00Z',phone:'01012345678',contact_revision:1}],pending:[]
}; }
const now = new Date('2026-10-20T15:30:00Z');
const env = { SUPABASE_SECRET_KEY:'test-db-key', OLLI_CONSULTATION_SOLAPI_CREDENTIALS:JSON.stringify({apiKey:'test-key',apiSecret:'test-secret'}) };

// This baseline is the known main SHA captured before the change; compares behavior, not source text.
test('first-year selections and annual followups obey configurable policy across 1152 cases',()=>{
  let cases=0;
  for(const type of ['kinder','elementary']) for(const enrollment of ['2024-02-29','2025-10-31','2026-09-30']) for(const month of ['2026-10-21','2026-11-01','2027-02-28','2027-10-01']) for(let mask=0;mask<16;mask++) for(const tracking of ['2026-01','2026-10','']) {
    const rules=['after_1','after_3','every_6','every_12'].filter((_,i)=>mask&(1<<i));
    const effective=rules.length?rules:core.getOlliDefaultConsultationRules(type);
    const enrolled=new Date(enrollment+'T12:00:00'),date=new Date(month+'T12:00:00');
    const student={id:'student',type,enrolled,status:'active'};
    const progress={tracking_started_month:tracking,completed:{}};
    const tasks=core.calculateOlliConsultationTasks(student,{enrolled,now:date,rules:effective,progress});
    const seen=new Set();
    for(const task of tasks){
      assert.ok(!seen.has(task.dueMonth),'duplicate appointment month');seen.add(task.dueMonth);
      if(task.occurrenceMonths<=12) assert.ok(effective.includes(task.ruleKey),'unselected first-year appointment');
      else {
        assert.equal(task.ruleKey,'every_12','post-year appointment must be annual');
        assert.equal(task.occurrenceMonths%12,0,'post-year appointment must fall on anniversary');
      }
    }
    cases++;
  }
  assert.equal(cases,1152);
});

test('Korean month boundary and overlapping six/twelve-month rules',()=>{
  const data=snapshot(),student=data.students[0];
  const tasks=server.pendingTasks(data,student,server.koreaDate(now));
  assert.deepEqual(tasks.map(t=>t.ruleKey),['every_12']);
  assert.equal(server.koreaDate(new Date('2026-10-31T15:01:00Z')).getMonth(),10);
  assert.equal(server.pendingTasks({...data,settings:{...data.settings,start_month:'2026-11'}},student,server.koreaDate(now)).length,0);
});

test('message includes Naver link and approved variables, disables SMS fallback',()=>{
  const data=snapshot(),student=data.students[0];
  const message=server.messageFor(data,student,server.pendingTasks(data,student,server.koreaDate(now)));
  assert.equal(message.kakaoOptions.disableSms,true);
  assert.equal(message.kakaoOptions.variables['#{예약링크}'],data.settings.booking_url);
  assert.match(message.text,/12개월/);
  for(const bad of ['javascript:alert(1)','https://naver.com.evil.test/x','https://naver.com@evil.test/x','https://evil.test/x']) assert.throws(()=>server.messageFor({...data,settings:{...data.settings,booking_url:bad}},student,[]));
});

test('one headquarters API credential serves all academies but does not authorize their channels',()=>{
  assert.deepEqual(server.centralCredentials(env),{apiKey:'test-key',apiSecret:'test-secret'});
  assert.equal(server.centralCredentials({OLLI_CONSULTATION_SOLAPI_CREDENTIALS:JSON.stringify({academy:{apiKey:'x',apiSecret:'y'}})}),null);
});
test('credentials isolated by academy; cron fails closed without a secret',()=>{
  assert.equal(server.credentials('different',env),null);
  assert.equal(server.cronAuthorized('Bearer undefined',{}),false);
  assert.equal(server.cronAuthorized('Bearer secret',{CRON_SECRET:'secret'}),false);
  assert.equal(server.cronAuthorized('Bearer 1234567890123456',{CRON_SECRET:'1234567890123456'}),true);
});

function harness(mode='accept') {
  let sends=0, row=null, data=snapshot();
  const fetchImpl=async(url,options)=>{
    if(url.startsWith('https://api.solapi.com')) {
      sends++; assert.match(options.headers.Authorization,/^HMAC-SHA256 apiKey=test-key,/);
      const payload=JSON.parse(options.body);assert.equal(payload.messages.length,1);
      if(mode==='timeout') throw new Error('timeout');
      if(mode==='gateway') return Response.json({},{status:502});
      if(mode==='reject') return Response.json({failedMessageList:[{statusCode:'3040'}],messageList:[]});
      if(mode==='empty') return Response.json({failedMessageList:[],messageList:[]});
      return Response.json({failedMessageList:[],messageList:[{messageId:'M-test',statusCode:'2000'}]});
    }
    const args=JSON.parse(options.body);const rpc=url.split('/').pop();
    if(rpc.endsWith('_snapshot')) return Response.json([data]);
    if(rpc.endsWith('_channel_resolve')) return Response.json(
      data.settings.academy_id === 'academy' ? [{pf_id:'KA01PF',channel_revision:1}] : []
    );
    if(rpc.endsWith('_reserve')) { if(row)return Response.json(null);row={status:'reserved',args};return Response.json('delivery'); }
    if(rpc.endsWith('_finish')) { row={...row,status:args.p_status,messageId:args.p_message_id};return Response.json(true); }
    throw Error('unexpected RPC '+rpc);
  };
  return {service:server.createService({fetchImpl,env,now:()=>now}),setData:(d)=>{data=d},get sends(){return sends},get row(){return row}};
}

test('concurrent workers and repeated jobs send overlapping tasks exactly once',async()=>{
  const h=harness();await Promise.all([h.service.run(),h.service.run()]);await h.service.run();
  assert.equal(h.sends,1);assert.equal(h.row.status,'submitted');assert.equal(h.row.args.p_due_month,'2026-10');assert.equal(h.row.args.p_task_keys.length,1);
});
for(const [mode,state] of [['timeout','unknown'],['gateway','unknown'],['reject','failed'],['empty','unknown']]) test(mode+' preserves durable deduplication and never retries an ambiguous send',async()=>{
  const h=harness(mode);await h.service.run();await h.service.run();assert.equal(h.sends,1);assert.equal(h.row.status,state);
});
test('disabled automation, completed consultation and missing credentials produce no send',async()=>{
  for(const variant of ['disabled','completed','credentials']) {
    const h=harness();const data=snapshot();
    if(variant==='disabled') data.settings.enabled=false;
    if(variant==='completed') data.progress.completed=Object.fromEntries(server.pendingTasks(data,data.students[0],server.koreaDate(now)).map(t=>[t.key,{completed_month:'2026-10'}]));
    if(variant==='credentials') data.settings.academy_id='other-academy';
    h.setData(data);await h.service.run();assert.equal(h.sends,0,variant);
  }
});

test('refresh polls provider results without sending another notice',async()=>{
  const data=snapshot();data.pending=[{id:'delivery',provider_message_id:'M-test'}];let final;
  const service=server.createService({env,now:()=>now,fetchImpl:async(url,options)=>{
    if(url.startsWith('https://api.solapi.com')) { assert.equal(options.method,'GET');assert.match(url,/messageIds=/);return Response.json({messageList:{'M-test':{statusCode:'4000'}}}); }
    if(url.endsWith('_snapshot'))return Response.json([data]);
    if(url.endsWith('_finish')){final=JSON.parse(options.body).p_status;return Response.json(true);}
    throw Error('refresh must not reserve/send');
  }});
  await service.run({dispatch:false});assert.equal(final,'delivered');
});

test('API refuses previews, unauthenticated cron and invalid owner session before provider calls',async()=>{
  const handler=require(path.join(staged,'api/_lib/consultation-messages-handler.cjs'));
  const before={VERCEL_ENV:process.env.VERCEL_ENV,CRON_SECRET:process.env.CRON_SECRET,SUPABASE_SECRET_KEY:process.env.SUPABASE_SECRET_KEY};
  const originalFetch=global.fetch;let calls=0;
  function response(){return {code:200,setHeader(){},status(n){this.code=n;return this},json(body){this.body=body;return this}};}
  try{
    global.fetch=async(url)=>{calls++;assert.ok(!url.startsWith('https://api.solapi.com'));return Response.json({message:'denied'},{status:403});};
    process.env.SUPABASE_SECRET_KEY='test';process.env.CRON_SECRET='1234567890123456';process.env.VERCEL_ENV='preview';
    let res=response();await handler({method:'GET',headers:{authorization:'Bearer '+process.env.CRON_SECRET}},res);assert.equal(res.code,503);assert.equal(calls,0);
    process.env.VERCEL_ENV='production';res=response();await handler({method:'GET',headers:{}},res);assert.equal(res.code,401);assert.equal(calls,0);
    res=response();await handler({method:'POST',headers:{},body:{academyId:'academy',sessionToken:'invalid',action:'send',studentId:'student'}},res);assert.equal(res.code,403);assert.equal(calls,1);
  }finally{global.fetch=originalFetch;for(const [key,value] of Object.entries(before)) {if(value===undefined) delete process.env[key];else process.env[key]=value;}}
});


test('each division and 1/6/12 month stage selects its own approved template',()=>{
  const data=snapshot();data.settings.template_mode='by_type';data.settings.template_variants={};
  for(const division of ['elementary','kinder'])for(const [ruleKey,months] of [['after_1',1],['every_6',6],['every_12',12]]){
    const key=division+':'+ruleKey;
    data.settings.template_variants[key]={use_common:false,template_id:'TPL-'+key,template_body:key+' #{학생명} #{예약링크}',template_confirmed:true};
  }
  for(const division of ['elementary','kinder'])for(const [ruleKey,months] of [['after_1',1],['every_6',6],['every_12',12]]){
    const student={...data.students[0],division};const tasks=[{ruleKey,label:months+'개월',dueMonth:'2026-10',occurrenceMonths:months}];
    const message=server.messageFor(data,student,tasks);assert.equal(message.kakaoOptions.templateId,'TPL-'+division+':'+ruleKey);assert.ok(message.text.startsWith(division+':'+ruleKey));
  }
  const student=data.students[0],tasks=server.pendingTasks(data,student,server.koreaDate(now));
  assert.equal(server.messageFor(data,student,tasks).kakaoOptions.templateId,'TPL-kinder:every_12');
  data.settings.template_mode='common';assert.equal(server.messageFor(data,student,tasks).kakaoOptions.templateId,data.settings.template_id);
  data.settings.template_mode='by_type';data.settings.template_variants['kinder:every_12'].use_common=true;
  assert.equal(server.messageFor(data,student,tasks).kakaoOptions.templateId,data.settings.template_id);
  data.settings.template_variants['kinder:every_12'].use_common=false;data.settings.template_variants['kinder:every_12'].template_confirmed=false;
  assert.throws(()=>server.messageFor(data,student,tasks),/TEMPLATE_NOT_READY/);
});

test('changing a template never resets the monthly deduplication record',async()=>{
  const h=harness();await h.service.run();const data=snapshot();data.settings.template_mode='by_type';data.settings.template_variants={'kinder:every_12':{use_common:false,template_id:'changed',template_body:'변경 #{학생명}',template_confirmed:true}};
  h.setData(data);await h.service.run();assert.equal(h.sends,1);
});


test('disabled academy rejects direct sends without any provider credentials or provider calls',async()=>{
  const handler=require(path.join(staged,'api/_lib/consultation-messages-handler.cjs'));
  const previous={VERCEL_ENV:process.env.VERCEL_ENV,SUPABASE_SECRET_KEY:process.env.SUPABASE_SECRET_KEY,OLLI_CONSULTATION_SOLAPI_CREDENTIALS:process.env.OLLI_CONSULTATION_SOLAPI_CREDENTIALS};
  const originalFetch=global.fetch;let calls=0;
  try{
    process.env.VERCEL_ENV='production';process.env.SUPABASE_SECRET_KEY='test';delete process.env.OLLI_CONSULTATION_SOLAPI_CREDENTIALS;
    global.fetch=async(url)=>{calls++;assert.ok(url.endsWith('/olli_consultation_messages_manage'));return Response.json({ok:true,settings:{enabled:false}});};
    const res={code:200,setHeader(){},status(value){this.code=value;return this},json(body){this.body=body;return this}};
    await handler({method:'POST',headers:{},body:{academyId:'academy',sessionToken:'session',action:'send',studentId:'student'}},res);
    assert.equal(res.code,409);assert.match(res.body.error,/꺼져/);assert.equal(calls,1);
  }finally{global.fetch=originalFetch;for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('Solapi student name placeholders render Korean particles without modifying approved template',()=>{
  const data=snapshot(), student=data.students[0];
  const tasks=[{ruleKey:'after_1',label:'1개월',dueMonth:'2026-10',occurrenceMonths:1}];
  const cases=[
    ['하정우','#{학생이름_주제}','정우는'],
    ['김지훈','#{학생이름_주제}','지훈은'],
    ['민서','#{학생이름_주격}','민서가'],
    ['민준','#{학생이름_주격}','민준이'],
    ['민서','#{학생이름_목적격}','민서를'],
    ['민준','#{학생이름_목적격}','민준을'],
    ['민서','#{학생이름_함께}','민서와'],
    ['민준','#{학생이름_함께}','민준과'],
    ['민서','#{학생이름_방향}','민서로'],
    ['하늘','#{학생이름_방향}','하늘로'],
    ['민준','#{학생이름_방향}','민준으로']
  ];
  for(const [name,placeholder,expected] of cases){
    data.settings.template_body=placeholder+' 상담 예약을 진행해주세요.';
    const rendered=server.messageFor(data,{...student,name},tasks);
    assert.equal(rendered.kakaoOptions.variables[placeholder],expected);
    assert.equal(rendered.text,expected+' 상담 예약을 진행해주세요.');
    assert.equal(data.settings.template_body,placeholder+' 상담 예약을 진행해주세요.');
  }
  data.settings.template_body='#{학생이름_미지원}';
  assert.throws(()=>server.messageFor(data,student,tasks),/TEMPLATE_BODY_INVALID/);
  data.settings.template_body='#{학생이름_주제}';
  assert.throws(()=>server.messageFor(data,{...student,name:'Alex'},tasks),/STUDENT_NAME_PARTICLE_UNSUPPORTED/);
});

test('consultation Alimtalk never includes school or kindergarten names',()=>{
  const data=snapshot(),student={...data.students[0],name:'하정우',school_name:'한샘초',kindergarten_name:'키즈킹',school:'한샘초',kindergarten:'키즈킹'};
  data.settings.template_body='#{학생이름_주제} 상담 신청 예약 안내\\n#{예약링크}';
  const tasks=[{ruleKey:'after_1',label:'1개월',dueMonth:'2026-10',occurrenceMonths:1}];
  const result=server.messageFor(data,student,tasks);
  assert.match(result.text,/정우는 상담 신청 예약 안내/);
  assert.ok(!result.text.includes('한샘초'));
  assert.ok(!result.text.includes('키즈킹'));
  assert.equal(Object.hasOwn(result.kakaoOptions.variables,'#{학교명}'),false);
  assert.equal(Object.hasOwn(result.kakaoOptions.variables,'#{유치원명}'),false);
  assert.equal(Object.hasOwn(result.kakaoOptions.variables,'#{학생이름_주제}'),true);
});

test('revocation between channel check and reservation prevents provider send',async()=>{
  const data=snapshot();let queries=0,providerCalls=0,reserved=false;
  const service=server.createService({env,now:()=>now,fetchImpl:async(url,options)=>{
    if(url.startsWith('https://api.solapi.com')){providerCalls++;throw Error('Provider must never be called');}
    const rpc=url.split('/').pop();
    if(rpc.endsWith('_snapshot'))return Response.json([data]);
    if(rpc.endsWith('_channel_resolve')){
      queries++;
      return Response.json(queries===1?[{pf_id:'KA01PF',channel_revision:1}]:[]);
    }
    if(rpc.endsWith('_reserve')){reserved=true;return Response.json('reserved-id');}
    throw Error('Unexpected RPC '+rpc);
  }});
  const counts=await service.run();
  assert.equal(reserved,true);
  assert.equal(queries,2);
  assert.equal(providerCalls,0);
  assert.equal(counts.skipped,1);
});

test('cross-academy channel denial prevents reservation and Solapi calls',async()=>{
  const data=snapshot();let reserves=0,sends=0;
  const service=server.createService({env,now:()=>now,fetchImpl:async(url,options)=>{
    if(url.startsWith('https://api.solapi.com')){sends++;throw Error('unauthorized send');}
    const rpc=url.split('/').pop();
    if(rpc.endsWith('_snapshot'))return Response.json([data]);
    if(rpc.endsWith('_channel_resolve'))return Response.json([]);
    if(rpc.endsWith('_reserve')){reserves++;return Response.json('unexpected');}
    throw Error('unexpected RPC '+rpc);
  }});
  const counts=await service.run();
  assert.equal(counts.skipped,1);
  assert.equal(reserves,0);
  assert.equal(sends,0);
});
test('changed channel revision after reservation prevents Solapi send',async()=>{
  const data=snapshot();let resolves=0,sends=0;
  const service=server.createService({env,now:()=>now,fetchImpl:async(url)=>{
    if(url.startsWith('https://api.solapi.com')){sends++;throw Error('send blocked');}
    const rpc=url.split('/').pop();
    if(rpc.endsWith('_snapshot'))return Response.json([data]);
    if(rpc.endsWith('_channel_resolve')){resolves++;return Response.json([{pf_id:'KA01PF',channel_revision:resolves}]);}
    if(rpc.endsWith('_reserve'))return Response.json('reserved-id');
    throw Error('unexpected RPC '+rpc);
  }});
  const counts=await service.run();
  assert.equal(resolves,2);
  assert.equal(sends,0);
  assert.equal(counts.skipped,1);
});
