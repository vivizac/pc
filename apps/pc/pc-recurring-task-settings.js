/* PC settings: academy-scoped recurring task rules, independent of task instances.
 * Server maintains due tasks; this screen never schedules cron jobs in a browser.
 */
(function(global) {
 'use strict';
 const days=['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];
 let rules=[],scopeKey='',loading=false,error='',editingId='',busy=false;
 function escape(value) {
  return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 }
 function context(){
  let academyId='';
  try{academyId=String(global.OlliStorageCore?.AcademyContext?.getCurrent?.()?.academyId||'').trim();}catch(_){}
  if(!academyId)try{academyId=String(global.settingsGetAcademyId?.()||localStorage.getItem('olli_current_academy_id')||'').trim();}catch(_){}
  let token='';
  try{token=String(localStorage.getItem('olli_account_session_token_v1')||'').trim();}catch(_){}
  return {academyId,token,key:academyId+'|'+token};
 }
 async function rpc(name,params){
  if(typeof global.supabase!=='function')throw Error('서버 연결을 확인해 주세요.');
  const response=await global.supabase('POST','rpc/'+name,params);
  if(!response||response.ok!==true)throw Error(response?.message||'반복 업무 요청을 처리하지 못했습니다.');
  return response;
 }
 function params(ctx){return {p_academy_id:ctx.academyId,p_session_token:ctx.token};}
 async function load(){
  const ctx=context();
  if(!ctx.academyId||!ctx.token)throw Error('현재 학원과 로그인 정보를 확인해 주세요.');
  if(scopeKey!==ctx.key){rules=[];editingId='';scopeKey=ctx.key;}
  loading=true;error='';refresh();
  try{
   const data=await rpc('olli_academy_task_rules_list',params(ctx));
   if(context().key!==ctx.key)return;
   rules=Array.isArray(data.rules)?data.rules:[];
   return rules;
  }catch(e){
   if(context().key===ctx.key)error=e?.message||String(e);
   throw e;
  }finally{if(context().key===ctx.key){loading=false;refresh();}}
 }
 function ruleLabel(r){
  if(r.repeat_kind==='monthly_day')return '매월 '+r.day_of_month+'일';
  if(r.repeat_kind==='weekly_day')return '매주 '+days[Number(r.weekday)] ;
  if(r.repeat_kind==='monthly_weekday')return '매월 '+(Number(r.week_of_month)===0?'마지막':Number(r.week_of_month)+'째')+' '+days[Number(r.weekday)];
  return '별도 설정';
 }
 function options(values,selected){return values.map(([value,label])=>'<option value="'+escape(value)+'"'+(String(value)===String(selected)?' selected':'')+'>'+escape(label)+'</option>').join('');}
 function render(){
  if(scopeKey!==context().key){rules=[];editingId='';scopeKey=context().key;}
  const target=rules.find(r=>r.id===editingId);
  const kind=target?.repeat_kind||'monthly_day';
  const titles=rules.map(r=>'<div class="pcRoutineRule">'
   +'<span class="pcRoutineRuleBullet'+(r.enabled?'':' is-off')+'"></span>'
   +'<div class="pcRoutineRuleInfo"><strong>'+escape(r.text)+'</strong><small>'+escape(ruleLabel(r))+(r.enabled?'':' · 일시 중지')+'</small></div>'
   +'<div class="pcRoutineRuleActions"><button type="button" onclick="pcRoutineTaskEdit(\''+escape(r.id)+'\')">수정</button>'
   +'<button type="button" onclick="pcRoutineTaskToggle(\''+escape(r.id)+'\')">'+(r.enabled?'중지':'사용')+'</button>'
   +'<button class="danger" type="button" onclick="pcRoutineTaskArchive(\''+escape(r.id)+'\')">삭제</button></div></div>').join('');
  return '<div class="pcRoutineSettings">'
   +'<div class="pcRoutineIntro"><div><h2>반복 업무 설정</h2><p>할 일 목록에 자동으로 추가할 업무를 학원별로 설정합니다. 변경한 주기는 다음 발생 일정부터 반영됩니다.</p></div>'
   +'<span class="pcRoutinePill">현재 학원 전용</span></div>'
   +(error?'<div class="pcRoutineError" role="alert">'+escape(error)+'</div>':'')
   +'<div class="pcRoutineColumns"><section class="pcRoutinePanel"><div class="pcRoutinePanelTitle"><h3>등록된 반복 업무</h3><span>'+rules.length+'개</span></div>'
   +(loading?'<div class="pcRoutineLoading">반복 업무를 불러오는 중입니다…</div>':
     titles||'<div class="pcRoutineLoading">등록된 반복 업무가 없습니다. 오른쪽에서 새 업무를 추가해 주세요.</div>')
   +'</section><section class="pcRoutinePanel"><div class="pcRoutinePanelTitle"><h3>'+(target?'반복 업무 수정':'새 반복 업무')+'</h3></div>'
   +'<form id="pcRoutineForm" onsubmit="pcRoutineTaskSave(event)">'
   +'<label class="pcRoutineLabel" for="pcRoutineText">업무 제목</label><input required maxlength="80" id="pcRoutineText" value="'+escape(target?.text||'')+'" placeholder="예: 교육비 안내문 발송" autocomplete="off">'
   +'<label class="pcRoutineLabel" for="pcRoutineKind">반복 주기</label><select id="pcRoutineKind" onchange="pcRoutineTaskKindChanged()">'+options([['monthly_day','매월 지정일'],['weekly_day','매주 지정 요일'],['monthly_weekday','매월 지정 주차·요일']],kind)+'</select>'
   +'<div id="pcRoutineSchedule">'
   +'<div class="pcRoutineScheduleRow" data-routine-kind="monthly_day"><label for="pcRoutineDay">매월</label><select id="pcRoutineDay">'+options(Array.from({length:31},(_,i)=>[i+1,(i+1)+'일']),target?.day_of_month||1)+'</select></div>'
   +'<div class="pcRoutineScheduleRow" data-routine-kind="weekly_day"><label for="pcRoutineWeekday">매주</label><select id="pcRoutineWeekday">'+options(days.map((d,i)=>[i,d]),target?.weekday??5)+'</select></div>'
   +'<div class="pcRoutineScheduleRow" data-routine-kind="monthly_weekday"><label for="pcRoutineWeek">매월</label><select id="pcRoutineWeek">'+options([[1,'첫째'],[2,'둘째'],[3,'셋째'],[4,'넷째'],[0,'마지막']],target?.week_of_month??1)+'</select>'
   +'<label for="pcRoutineMonthWeekday">주</label><select id="pcRoutineMonthWeekday">'+options(days.map((d,i)=>[i,d]),target?.weekday??1)+'</select></div></div>'
   +'<label class="pcRoutineEnabled"><input type="checkbox" id="pcRoutineEnabled"'+(target?.enabled!==false?' checked':'')+'>반복 업무 사용</label>'
   +'<div class="pcRoutineFormActions"><button class="primary" type="submit"'+(busy?' disabled':'')+'>'+(target?'변경 저장':'업무 추가')+'</button>'
   +(target?'<button type="button" onclick="pcRoutineTaskCancel()">취소</button>':'')+'</div></form>'
   +'<p class="pcRoutineHelp">31일이 없는 달에는 말일에 생성합니다. 날짜를 바꾸더라도 이미 생성된 할 일과 완료 기록은 변경되지 않습니다.</p></section></div>'
   +'<div class="pcRoutineFootnote">선생님 급여 지급 업무는 이 목록과 별개로 <b>학원 수입·지출 관리의 급여일 설정</b>을 따릅니다. 실제 푸시 알림 발송 기능은 아닙니다.</div></div>';
 }
 function refresh(){
  if(global.settingsCurrentDetailType!=='recurringTasks')return;
  const root=document.getElementById('settingsDetailBody');
  if(root){root.innerHTML=render();kindChanged();}
 }
 function kindChanged(){
  const kind=document.getElementById('pcRoutineKind')?.value;
  document.querySelectorAll('#pcRoutineSchedule [data-routine-kind]').forEach(el=>{el.hidden=el.dataset.routineKind!==kind;});
 }
 function edit(id){if(busy)return;editingId=String(id);refresh();}
 function cancel(){editingId='';refresh();}
 function readForm(){
  const text=String(document.getElementById('pcRoutineText')?.value||'').trim();
  if(!text||text.length>80)throw Error('업무 제목을 1~80자로 입력해 주세요.');
  const kind=document.getElementById('pcRoutineKind')?.value;
  const day=kind==='monthly_day'?Number(document.getElementById('pcRoutineDay')?.value):null;
  const weekday=kind==='weekly_day'?Number(document.getElementById('pcRoutineWeekday')?.value)
    :kind==='monthly_weekday'?Number(document.getElementById('pcRoutineMonthWeekday')?.value):null;
  const week=kind==='monthly_weekday'?Number(document.getElementById('pcRoutineWeek')?.value):null;
  if(!['monthly_day','weekly_day','monthly_weekday'].includes(kind)
   ||(day!==null&&(day<1||day>31))||(weekday!==null&&(weekday<0||weekday>6))
   ||(week!==null&&![0,1,2,3,4].includes(week)))throw Error('반복 날짜를 확인해 주세요.');
  return {p_task_text:text,p_repeat_kind:kind,p_day_of_month:day,p_weekday:weekday,p_week_of_month:week,
    p_enabled:!!document.getElementById('pcRoutineEnabled')?.checked};
 }
 async function runMutation(name,values){
  if(busy)return;
  const ctx=context();
  if(ctx.key!==scopeKey)throw Error('학원이 변경되었습니다. 목록을 다시 열어 주세요.');
  busy=true;error='';
  try{
   await rpc(name,{...params(ctx),...values});
   if(ctx.key===context().key){editingId='';await load();}
  }catch(e){error=e?.message||String(e);refresh();alert(error);}finally{busy=false;refresh();}
 }
 async function save(ev){
  ev?.preventDefault();
  try{await runMutation('olli_academy_task_rule_save',{...readForm(),p_rule_id:editingId||null});}
  catch(e){error=e?.message||String(e);refresh();alert(error);}
 }
 async function toggle(id){
  const r=rules.find(row=>row.id===id);if(!r)return;
  await runMutation('olli_academy_task_rule_save',{
   p_rule_id:r.id,p_task_text:r.text,p_repeat_kind:r.repeat_kind,p_day_of_month:r.day_of_month,
   p_weekday:r.weekday,p_week_of_month:r.week_of_month,p_enabled:!r.enabled
  });
 }
 async function archive(id){
  const r=rules.find(row=>row.id===id);if(!r||busy)return;
  if(!confirm('“'+r.text+'” 반복 업무를 삭제하시겠습니까?\n이미 생성된 할 일은 삭제되지 않습니다.'))return;
  await runMutation('olli_academy_task_rule_archive',{p_rule_id:id});
 }
 if(typeof settingsDetailData!=='undefined'){
  settingsDetailData.recurringTasks={
   title:'반복 업무 설정',
   instantRender:true,
   html:render,
   beforeOpen:async function(){await load();}
  };
 }
 global.pcRoutineTaskEdit=edit;
 global.pcRoutineTaskCancel=cancel;
 global.pcRoutineTaskKindChanged=kindChanged;
 global.pcRoutineTaskSave=save;
 global.pcRoutineTaskToggle=toggle;
 global.pcRoutineTaskArchive=archive;
 global.OlliPcRecurringTaskSettings={load,render};
})(window);
