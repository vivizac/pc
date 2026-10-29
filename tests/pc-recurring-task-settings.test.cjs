'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'apps/pc/pc-recurring-task-settings.js'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/pc/pc-recurring-task-settings.css'),'utf8');
const html=fs.readFileSync(path.join(root,'apps/pc/index.html'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261029215300_academy_recurring_task_settings.sql'),'utf8');

test('PC settings menu links to owner-only repeating tasks detail, not mobile',()=>{
 assert.match(html,/<section class="settingsSection" data-owner-only="true">[\s\S]*?openSettingsDetail\('recurringTasks'\)/);
 assert.match(html,/pc-recurring-task-settings\.js\?v=20261029-academy-rules-1/);
 assert.match(html,/pc-recurring-task-settings\.css\?v=20261029-academy-rules-1/);
 assert.match(css,/\.pcRoutineColumns\{display:grid/);
 assert.match(css,/\.pcRoutineScheduleRow\[hidden\]\{display:none!important\}/);
});

test('server preserves 12 original primary-academy seeds; no default task rules for other academies',()=>{
 const original=fs.readFileSync(path.join(root,'supabase/migrations/20261028055746_academy_task_lifecycle_and_recurring.sql'),'utf8');
 assert.match(original,/a\.academy_code='VIVI-5578' and a\.academy_name='비비작아이성향미술학원'/);
 assert.match(original,/on conflict \(academy_id,rule_key\) do nothing/);
 assert.match(migration,/update private\.olli_academy_task_rules\s+set repeat_kind='weekly_day'/);
 assert.match(migration,/set repeat_kind='monthly_weekday',weekday=1,week_of_month=1/);
 assert.doesNotMatch(migration,/insert into private\.olli_academy_task_rules\s*\(academy_id,rule_key,task_text,repeat_kind,day_of_month,active_from\)\s*select a\.id/);
 assert.match(migration,/where r\.enabled and r\.archived_at is null/);
 assert.match(migration,/last_generated_on=v_due/);
 assert.match(migration,/date_trunc\('week',v_rule\.last_generated_on\)=date_trunc\('week',v_due\)/);
 assert.match(migration,/not completed or coalesce\(completed_at,created_at\)>now\(\)-interval '24 hours'/);
});

test('rule RPCs enforce active academy owner membership; archive never deletes task instances',()=>{
 for(const name of ['olli_academy_task_rules_list','olli_academy_task_rule_save','olli_academy_task_rule_archive']){
  const match=migration.match(new RegExp('create or replace function public\\.'+name+'\\([\\s\\S]*?\\$function\\$;'));
  assert.ok(match,name+' must be defined');
  assert.match(match[0],/olli_account_id_from_session\(p_session_token\)/);
  assert.match(match[0],/m\.account_id=v_account and m\.academy_id=p_academy_id/);
  assert.match(match[0],/m\.status='active' and m\.role='owner'/);
  assert.match(match[0],/a\.status='active' and a\.deleted_at is null/);
 }
 assert.match(migration,/set enabled=false,archived_at=now\(\)/);
 const archiveSql=migration.slice(migration.indexOf('create or replace function public.olli_academy_task_rule_archive'));
 assert.doesNotMatch(archiveSql,/delete from public\.olli_academy_tasks/i);
 assert.match(migration,/r\.repeat_kind<>'teacher_payday'/);
 assert.match(migration,/grant execute on function public\.olli_academy_task_rule_save/);
});

function setup(){
 let academyId='academy-A';
 const calls=[];
 const node={innerHTML:''};
 const rulesByAcademy={
  'academy-A':[{id:'11111111-1111-4111-8111-111111111111',text:'교육비 안내문 발송',
     repeat_kind:'monthly_day',day_of_month:1,weekday:null,week_of_month:null,enabled:true},
    {id:'22222222-2222-4222-8222-222222222222',text:'수업 준비',
     repeat_kind:'weekly_day',day_of_month:null,weekday:5,week_of_month:null,enabled:true}],
  'academy-B':[]
 };
 const elements={'settingsDetailBody':node,'pcRoutineText':{value:'교재 주문'},
  'pcRoutineKind':{value:'monthly_day'},'pcRoutineDay':{value:'10'},
  'pcRoutineWeekday':{value:'5'},'pcRoutineMonthWeekday':{value:'1'},
  'pcRoutineWeek':{value:'1'},'pcRoutineEnabled':{checked:true}};
 const window={
  OlliStorageCore:{AcademyContext:{getCurrent:()=>({academyId})}},
  supabase:async(method,url,params)=>{
   calls.push({method,url,params});
   const key=params.p_academy_id;
   if(url.endsWith('rules_list'))return {ok:true,rules:rulesByAcademy[key]||[]};
   if(url.endsWith('rule_save'))return {ok:true,id:params.p_rule_id||'created'};
   if(url.endsWith('rule_archive'))return {ok:true,id:params.p_rule_id};
   throw Error('Unknown RPC '+url);
  }
 };
 const context={window,document:{getElementById:id=>elements[id]||null,querySelectorAll:()=>[]},
  localStorage:{getItem:key=>key==='olli_account_session_token_v1'?'token-A':''},
  settingsDetailData:{},settingsCurrentDetailType:'recurringTasks',
  alert(){},confirm(){return true}};
 vm.runInNewContext(source,context);
 return {window,context,node,calls,setAcademyId:v=>{academyId=v;},elements};
}
test('separate academy-scoped listing and preserve original monthly + weekly captions',async()=>{
 const app=setup();
 await app.context.settingsDetailData.recurringTasks.beforeOpen();
 assert.match(app.node.innerHTML,/교육비 안내문 발송/);
 assert.match(app.node.innerHTML,/매월 1일/);
 assert.match(app.node.innerHTML,/매주 금요일/);
 assert.equal(app.calls[0].params.p_academy_id,'academy-A');
 app.setAcademyId('academy-B');
 await app.context.settingsDetailData.recurringTasks.beforeOpen();
 assert.doesNotMatch(app.node.innerHTML,/<div class="pcRoutineRule">[\s\S]*?교육비 안내문 발송/);
 assert.match(app.node.innerHTML,/등록된 반복 업무가 없습니다/);
 assert.equal(app.calls[1].params.p_academy_id,'academy-B');
});

test('create/edit and toggle call secure RPC, never mutate instance tasks',async()=>{
 const app=setup();
 await app.context.settingsDetailData.recurringTasks.beforeOpen();
 await app.window.pcRoutineTaskSave({preventDefault(){}});
 const saved=app.calls.find(c=>c.url.endsWith('rule_save'));
 assert.equal(saved.params.p_academy_id,'academy-A');
 assert.equal(saved.params.p_task_text,'교재 주문');
 assert.equal(saved.params.p_day_of_month,10);
 assert.equal(saved.params.p_rule_id,null);
 assert.equal(app.calls.some(c=>c.url.endsWith('task_delete')),false);
 await app.window.pcRoutineTaskToggle('11111111-1111-4111-8111-111111111111');
 const toggled=app.calls.filter(c=>c.url.endsWith('rule_save')).at(-1);
 assert.equal(toggled.params.p_enabled,false);
 assert.equal(toggled.params.p_rule_id,'11111111-1111-4111-8111-111111111111');
});
