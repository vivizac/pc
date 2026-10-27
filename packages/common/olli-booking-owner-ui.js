/* Shared Olli consultation booking management UI — PC wide, mobile essentials.
 * Owner-only RPC. No duplicate booking store or consultation feedback creation.
 */
(function (global) {
 'use strict';
 const state={mode:'pc',root:null,month:'',view:'calendar',selectedDay:'',rows:[],settings:null,error:'',busy:false,loading:false,ready:false,entryObserver:null,slotDate:'',slotChoices:[],publicUrl:''};
 const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const currentMonth=()=>{const p=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).formatToParts(new Date());const m=Object.fromEntries(p.map(v=>[v.type,v.value]));return m.year+'-'+m.month;};
 function kstParts(date){
   const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(date));
   const m=Object.fromEntries(parts.map(p=>[p.type,p.value]));
   return {ymd:m.year+'-'+m.month+'-'+m.day,hm:m.hour+':'+m.minute};
 }
 const today=()=>kstParts(Date.now()).ymd;
 const dateLabel=d=>{const [y,m,day]=d.split('-').map(Number);return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'short'}).format(new Date(Date.UTC(y,m-1,day,3)));};
 function plusMonth(ym,offset){const [y,m]=ym.split('-').map(Number);return new Date(Date.UTC(y,m-1+offset,1)).toISOString().slice(0,7);}
 function ctx(){return {academyId:String(localStorage.getItem('olli_current_academy_id')||''),sessionToken:String(localStorage.getItem('olli_account_session_token_v1')||'')};}
 function isOwner(){return Boolean(global.OlliConsultationMessages?.isOwner?.());}
 function auth(){const c=ctx();if(!isOwner()||!c.academyId||!c.sessionToken)throw new Error('상담 예약 관리는 원장 계정에서만 사용할 수 있습니다.');return c;}
 async function rpc(functionName,params){
   if(typeof global.callOlliRpc!=='function')throw new Error('올리 상담 예약 서버에 연결할 수 없습니다.');
   return global.callOlliRpc(functionName,params);
 }
 async function manage(action='list',options={}){
   const c=auth();
   return rpc('olli_booking_staff_manage',{
     p_session_token:c.sessionToken,p_academy_id:c.academyId,p_action:action,
     p_month:action==='list'?(options.month||state.month):null,p_reservation_id:options.reservationId||null,
     p_start_at:options.startAt||null,p_request_key:options.requestKey||null
   });
 }
 async function settingsSave(settings,expectedRevision){
   const c=auth();
   return rpc('olli_booking_settings_manage',{p_session_token:c.sessionToken,p_academy_id:c.academyId,
     p_action:'save',p_data:{...settings,expected_revision:expectedRevision}});
 }
 async function available(date){
   const c=auth();
   return rpc('olli_booking_list_slots',{p_session_token:c.sessionToken,p_academy_id:c.academyId,p_date:date});
 }
 const uniqueId=()=>global.crypto?.randomUUID?.()||'';
 function filteredRows(){
   let list=state.rows;
   if(state.mode==='mobile'){
     if(state.view==='today')list=list.filter(r=>kstParts(r.start_at).ymd===today());
     if(state.view==='week'){
       const base=new Date(today()+'T00:00:00Z');const start=new Date(base);start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
       const a=start.toISOString().slice(0,10);const end=new Date(start);end.setUTCDate(start.getUTCDate()+7);const b=end.toISOString().slice(0,10);
       list=list.filter(r=>{const d=kstParts(r.start_at).ymd;return d>=a&&d<b;});
     }
   } else if(state.selectedDay)list=list.filter(r=>kstParts(r.start_at).ymd===state.selectedDay);
   return list;
 }
 function dueUnbooked(){
   if(state.month!==currentMonth()||typeof global.getThisMonthConsultationDueStudents!=='function'||typeof global.getAcademyManagementStudentsForStats!=='function')return null;
   try{
     const all=global.getThisMonthConsultationDueStudents(global.getAcademyManagementStudentsForStats())||[];
     const booked=new Set(state.rows.filter(x=>x.status==='confirmed').map(x=>String(x.student_id||'')));
     return all.filter(x=>x?.id&&!booked.has(String(x.id)));
   }catch{return null;}
 }
 function renderStats(){
   const confirmed=state.rows.filter(r=>r.status==='confirmed');
   const todayN=confirmed.filter(r=>kstParts(r.start_at).ymd===today()).length;
   const newN=confirmed.filter(r=>r.kind==='intake').length;
   const unbooked=dueUnbooked();
   return '<div class="obmStats"><div><strong>'+confirmed.length+'</strong><span>이번 달 예약</span></div><div><strong>'+todayN+'</strong><span>오늘 상담</span></div><div><strong>'+newN+'</strong><span>신규생 상담</span></div>'+
    (unbooked===null?'':'<div><strong>'+unbooked.length+'</strong><span>이번 달 미예약 대상</span></div>')+'</div>';
 }
 function calendarHtml(){
   const [y,m]=state.month.split('-').map(Number);
   const days=new Date(Date.UTC(y,m,0)).getUTCDate();
   const padding=(new Date(Date.UTC(y,m-1,1)).getUTCDay()+6)%7;
   const byDay=new Map();
   // This view already receives the owner's authenticated month-scoped booking
   // rows. Cancellations are not appointments, and no extra RPC is necessary.
   state.rows.filter(r=>r.status==='confirmed'&&r.start_at).forEach(r=>{
     const parts=kstParts(r.start_at);
     if(!byDay.has(parts.ymd))byDay.set(parts.ymd,[]);
     byDay.get(parts.ymd).push({name:String(r.name||'학생'),time:parts.hm});
   });
   const heads=['월','화','수','목','금','토','일'].map(s=>'<span class="obmDayHead">'+s+'</span>').join('');
   let cells=Array.from({length:padding},()=>'<span class="obmEmpty" aria-hidden="true"></span>').join('');
   for(let day=1;day<=days;day++){
     const d=state.month+'-'+String(day).padStart(2,'0');
     const appointments=(byDay.get(d)||[]).sort((a,b)=>a.time.localeCompare(b.time)||a.name.localeCompare(b.name));
     const cards=appointments.map(a=>'<span class="obmCalBooking" title="'+escapeHtml(a.time+' '+a.name)+'">'
       +'<span class="obmCalBookingTime">'+escapeHtml(a.time)+'</span>'
       +'<strong class="obmCalBookingName">'+escapeHtml(a.name)+'</strong></span>').join('');
     cells+='<button class="obmCalDay'+(d===today()?' isToday':'')+(d===state.selectedDay?' selected':'')
       +'" type="button" data-day="'+d+'" aria-pressed="'+(d===state.selectedDay)+'">'
       +'<span class="obmCalDate">'+day+'</span>'+cards+'</button>';
   }
   return '<div class="obmCalendar" aria-label="월간 상담 예약 달력">'+heads+cells+'</div>';
 }
 function bookingsHtml(){
   let rows=filteredRows();
   if(!rows.length)return '<div class="obmEmptyMessage">'+(state.selectedDay?'선택한 날짜에':'해당 기간에')+' 예약된 상담이 없습니다.</div>';
   const safe=rows.slice().sort((a,b)=>String(a.start_at).localeCompare(String(b.start_at)));
   return '<div class="obmRows">'+safe.map(r=>{
     const date=kstParts(r.start_at);
     return '<article class="obmRow"><div class="obmRowTime"><strong><span class="obmRowDate">'+escapeHtml(dateLabel(date.ymd).replace(/\s+\(/g,'('))+'</span> <span class="obmRowClock">'+escapeHtml(date.hm)+'</span></strong></div>'+
       '<div class="obmRowMain"><strong>'+escapeHtml(r.name)+'</strong><span>'+ (r.kind==='intake'?'신규 상담':'재원생 정기 상담')+
       (r.status==='cancelled'?' · 취소됨':'')+'</span></div><div class="obmRowActions">'+
       (r.status==='confirmed'?'<button type="button" data-action="edit" data-id="'+escapeHtml(r.id)+'">변경</button><button type="button" data-action="cancel" data-id="'+escapeHtml(r.id)+'">취소</button>':'<span class="obmCancelled">취소 기록</span>')+
       '</div></article>';
   }).join('')+'</div>';
 }
 function settingsHtml(){
   const s=state.settings;if(!s)return '<div class="obmEmptyMessage">학원별 예약 설정을 불러오지 못했습니다.</div>';
   const list=(arr,key,names)=>names.map(([n,name])=>'<label class="obmOption"><input type="checkbox" data-settings-array="'+key+'" value="'+n+'" '+(arr.includes(n)?'checked':'')+'><span>'+name+'</span></label>').join('');
   return '<form class="obmSettings" data-settings-form><p class="obmHint">이 학원에서만 적용되는 예약 운영 기준입니다. PC·모바일에서 동일하게 반영됩니다.</p>'+
   '<div class="obmSettingGroup"><strong>예약 기간</strong><div class="obmOptionRow">'+list(s.weeks,'weeks',[[1,'첫째 주'],[2,'둘째 주'],[3,'셋째 주'],[4,'넷째 주'],[5,'다섯째 주'],[6,'여섯째 주']])+'</div></div>'+
   '<div class="obmSettingGroup"><strong>운영 요일</strong><div class="obmOptionRow">'+list(s.weekdays,'weekdays',[[1,'월'],[2,'화'],[3,'수'],[4,'목'],[5,'금'],[6,'토'],[7,'일']])+'</div></div>'+
   '<div class="obmSettingGroup obmTimeGrid"><label>시작 시각<input name="start_time" type="time" value="'+escapeHtml(s.start_time.slice(0,5))+'" required></label><label>종료 시각<input name="end_time" type="time" value="'+escapeHtml(s.end_time.slice(0,5))+'" required></label><label>예약 간격<select name="slot_minutes"><option value="15" '+(s.slot_minutes===15?'selected':'')+'>15분</option><option value="30" '+(s.slot_minutes===30?'selected':'')+'>30분</option><option value="60" '+(s.slot_minutes===60?'selected':'')+'>60분</option></select></label></div>'+
   '<div class="obmSettingGroup"><label class="obmSwitch"><input name="allow_parent_reschedule" type="checkbox" '+(s.allow_parent_reschedule?'checked':'')+'>학부모 예약 변경 허용</label><label class="obmSwitch"><input name="allow_parent_cancel" type="checkbox" '+(s.allow_parent_cancel?'checked':'')+'>학부모 예약 취소 허용</label></div>'+
   '<div class="obmFormActions"><button type="submit" class="obmPrimary">설정 저장</button></div></form>';
 }
 function render(){
   const root=state.root;if(!root)return;
   const mobileTitle=state.mode==='mobile'?'<div><h2>상담 현황</h2><p>학원 상담 예약과 일정</p></div>':'';
   let header='<div class="obmHeader'+(state.mode==='pc'?' obmHeaderPc':'')+'">'+mobileTitle+'<div class="obmHeaderButtons">'+
    (state.mode==='mobile'?'<button type="button" data-action="close" aria-label="상담 현황 닫기">닫기</button>':'')+
    '<button type="button" data-action="refresh" aria-label="예약 내역 새로고침">새로고침</button></div></div>';
   let tabs=state.mode==='pc'
     ?[['calendar','캘린더'],['list','예약 목록'],['settings','예약 설정']]
     :[['today','오늘'],['week','이번 주'],['list','전체 예약'],['settings','설정']];
   const nav='<div class="obmTabs" role="tablist" aria-label="상담 현황 보기">'+tabs.map(([v,txt])=>
      '<button type="button" role="tab" aria-selected="'+(state.view===v)+'" class="'+(state.view===v?'active':'')+'" data-view="'+v+'">'+txt+'</button>').join('')+'</div>';
   const months='<div class="obmMonth"><button type="button" data-action="month-prev" aria-label="이전 달">‹</button><strong>'+escapeHtml(state.month)+'</strong><button type="button" data-action="month-next" aria-label="다음 달">›</button></div>';
   const error=state.error?'<div class="obmError" role="alert">'+escapeHtml(state.error)+'</div>':'';
   const content=state.loading?'<div class="obmEmptyMessage">예약 정보를 불러오는 중입니다.</div>'
    : !state.ready?'<div class="obmEmptyMessage">상담 예약 정보를 연결하지 못했습니다. 서버 설정과 로그인 상태를 확인해 주세요.</div>'
    : state.view==='settings'?settingsHtml()
    :renderStats()+(state.mode==='pc'&&state.view==='calendar'?calendarHtml():'')+
     '<div class="obmListHeader"><strong>'+(state.selectedDay&&state.mode==='pc'?escapeHtml(dateLabel(state.selectedDay)):'예약 목록')+'</strong>'+
       (state.selectedDay&&state.mode==='pc'?'<button type="button" data-action="clear-day">날짜 선택 해제</button>':'')+'</div>'+
       bookingsHtml();
   root.innerHTML='<div class="obmLayout">'+header+nav+(state.view==='settings'?'':months)+error+content+
    '<div class="obmFooter"><div class="obmLinkRow"><span>알림톡 승인 템플릿에 등록할 <strong>학원 통합 예약 링크</strong>입니다. 학생별 링크를 발급하지 않습니다.</span><button type="button" data-action="copy-public-link">통합 링크 복사</button></div>'+ (state.publicUrl ? '<p class="obmLinkAddress">'+escapeHtml(state.publicUrl)+'</p>':'')+'</div>'+
    '</div><div class="obmModalHost" data-modal-host></div>';
 }
 async function refresh(){
   if(state.loading)return;
   const initialCtx=ctx();
   state.loading=true;state.error='';render();
   try{
     const result=await manage();
     if(ctx().academyId!==initialCtx.academyId||ctx().sessionToken!==initialCtx.sessionToken)return;
     if(result?.ok!==true)throw Error('예약 데이터를 읽지 못했습니다.');
     state.rows=Array.isArray(result.appointments)?result.appointments:[];
     state.settings=result.settings||null;state.ready=true;
     if(state.mode==='mobile'&&state.month===currentMonth())updateMobileShortcutBadge(confirmedTodayCount(state.rows));
   }catch(e){state.ready=false;state.rows=[];state.settings=null;state.error=e.message||'예약 서버 오류';}
   finally{state.loading=false;render();}
 }
 function mount(node,mode){
   state.mode=mode;state.root=node;state.view=mode==='mobile'?'today':'calendar';
   state.month=currentMonth();state.selectedDay='';state.ready=false;state.error='';
   if(!node.dataset.obmBound){
     node.dataset.obmBound='true';
     node.addEventListener('click',click);
     node.addEventListener('submit',submit);
     node.addEventListener('change',change);
   }
   render();void refresh();
 }
 function open(mode){
   if(!isOwner())return false;
   if(mode==='mobile'){
     let overlay=document.getElementById('olliBookingMobileOverlay');
     if(!overlay){overlay=el('section','olliBookingMobileOverlay');overlay.id='olliBookingMobileOverlay';overlay.setAttribute('aria-label','상담 현황');document.body.appendChild(overlay);}
     overlay.hidden=false;mount(overlay,'mobile');return true;
   }
   // 상담기록 내부 상담예약현황 탭에서만 열립니다.
   const panel=document.getElementById('olliConsultationBookingPanel');if(!panel)return false;
   panel.hidden=false;mount(panel,'pc');return true;
 }
 function close(){const overlay=document.getElementById('olliBookingMobileOverlay');if(overlay)overlay.hidden=true;}
 function alertError(message){state.error=message;render();}
 async function submit(e){
   const form=e.target.closest('[data-settings-form]');if(!form)return;
   e.preventDefault();if(state.busy)return;state.busy=true;
   try{
     const weeks=[...form.querySelectorAll('[data-settings-array="weeks"]:checked')].map(x=>Number(x.value));
     const weekdays=[...form.querySelectorAll('[data-settings-array="weekdays"]:checked')].map(x=>Number(x.value));
     const data={weeks,weekdays,start_time:form.elements.start_time.value,end_time:form.elements.end_time.value,
        slot_minutes:Number(form.elements.slot_minutes.value),
        allow_parent_reschedule:form.elements.allow_parent_reschedule.checked,
        allow_parent_cancel:form.elements.allow_parent_cancel.checked};
     if(!weeks.length||!weekdays.length||data.start_time>=data.end_time){throw new Error('예약 주차·요일·운영 시간을 확인해 주세요.');}
     await settingsSave(data,state.settings.revision);
     await refresh();state.view='settings';render();global.alert('예약 설정을 저장했습니다.');
   }catch(err){alertError(err?.message||'설정 저장 실패');}
   finally{state.busy=false;}
 }
 async function editBooking(id){
   const row=state.rows.find(x=>x.id===id&&x.status==='confirmed');if(!row)return;
   const host=state.root.querySelector('[data-modal-host]');
   if(!host)return;
   state.slotDate=kstParts(row.start_at).ymd;
   host.innerHTML='<div class="obmModalBackdrop" data-action="dismiss"><div class="obmModal" role="dialog" aria-modal="true" aria-label="상담 일정 변경"><h3>상담 시간 변경</h3><p>'+escapeHtml(row.name)+' · 현재 '+escapeHtml(dateLabel(state.slotDate))+' '+escapeHtml(kstParts(row.start_at).hm)+'</p><label>날짜 선택<input type="date" data-slot-date value="'+state.slotDate+'"></label><label>가능 시간<select data-slot-time><option value="">시간 조회 중</option></select></label><div class="obmFormActions"><button type="button" data-action="dismiss">닫기</button><button type="button" class="obmPrimary" data-action="save-reschedule" data-id="'+escapeHtml(id)+'">변경 저장</button></div></div></div>';
   await loadSlotChoices(state.slotDate);
 }
 async function loadSlotChoices(date){
   const select=state.root?.querySelector('[data-slot-time]');if(!select)return;
   select.innerHTML='<option value="">조회 중</option>';
   try{
     const result=await available(date);
     const slots=result?.slots;
     select.innerHTML='<option value="">시간 선택</option>';
     for(const slot of Array.isArray(slots)?slots:[]){
       const option=el('option','',kstParts(slot.start_at).hm);
       option.value=slot.start_at;select.appendChild(option);
     }
     if(select.options.length===1)select.options[0].textContent='예약 가능한 시간이 없습니다';
   }catch(e){select.innerHTML='<option value="">시간 조회 실패</option>';alertError(e.message);}
 }
 async function click(e){
   if(!(e.target instanceof Element))return;
   const node=e.target.closest('[data-action],[data-view],[data-day]');
   if(!node||!state.root.contains(node))return;
   if(node.matches('[data-day]')){state.selectedDay=node.dataset.day;render();return;}
   if(node.matches('[data-view]')){state.view=node.dataset.view;state.selectedDay='';render();return;}
   const action=node.dataset.action;
   if(action==='close'){close();return;}
   if(action==='copy-public-link'){
     if(state.busy)return;
     state.busy=true;node.disabled=true;
     try{
       const c=auth();
       const response=await global.fetch('/api/olli-booking-public',{
         method:'POST',credentials:'omit',cache:'no-store',
         headers:{'Content-Type':'application/json'},
         body:JSON.stringify({action:'public-link',academy_id:c.academyId,session_token:c.sessionToken})
       });
       const payload=await response.json();
       if(!response.ok||payload.ok!==true||!/^https:\/\//.test(payload.url||''))throw new Error('학원 통합 예약 링크를 발급하지 못했습니다.');
       if(ctx().academyId!==c.academyId||ctx().sessionToken!==c.sessionToken)throw new Error('학원 또는 로그인 계정이 변경되었습니다.');
       state.publicUrl=payload.url;
       render();
       if(!global.navigator?.clipboard?.writeText)throw new Error('클립보드 권한이 없습니다. 아래 주소를 직접 복사해 주세요.');
       await global.navigator.clipboard.writeText(payload.url);
       global.alert('학원 통합 예약 링크를 복사했습니다.');
     }catch(err){state.error=err.message||'통합 링크를 복사하지 못했습니다.';render();}
     finally{state.busy=false;}
     return;
   }
   if(action==='dismiss'){
     if(node.dataset.action==='dismiss' && (node.classList.contains('obmModalBackdrop') ||node.tagName==='BUTTON')){
       state.root.querySelector('[data-modal-host]').innerHTML='';
     }return;
   }
   if(action==='month-prev'||action==='month-next'){state.month=plusMonth(state.month,action==='month-next'?1:-1);state.selectedDay='';void refresh();return;}
   if(action==='refresh'){void refresh();return;}
   if(action==='clear-day'){state.selectedDay='';render();return;}
   if(action==='edit'){await editBooking(node.dataset.id);return;}
   if(action==='save-reschedule'){
     if(state.busy)return;const time=state.root.querySelector('[data-slot-time]')?.value;
     if(!time){global.alert('새 상담 시간을 선택해 주세요.');return;}
     const id=node.dataset.id;if(!global.confirm('선택한 시간으로 상담 일정을 변경하시겠습니까?'))return;
     state.busy=true;
     try{
       const key=uniqueId();if(!key)throw Error('요청 식별키 생성 실패');
       await manage('reschedule',{reservationId:id,startAt:time,requestKey:key});
       state.root.querySelector('[data-modal-host]').innerHTML='';
       const changedMonth=kstParts(time).ymd.slice(0,7);
       if(changedMonth!==state.month)state.month=changedMonth;
       await refresh();
     }catch(err){global.alert(err.message||'예약 변경에 실패했습니다.');await refresh();}
     finally{state.busy=false;}
     return;
   }
   if(action==='cancel'){
     if(state.busy)return;
     const row=state.rows.find(x=>x.id===node.dataset.id);if(!row)return;
     if(!global.confirm(row.name+' 상담 예약을 취소하시겠습니까?'))return;
     state.busy=true;
     try{const key=uniqueId();if(!key)throw Error('요청 식별키 생성 실패');
       await manage('cancel',{reservationId:row.id,requestKey:key});await refresh();}
     catch(err){global.alert(err.message||'예약 취소에 실패했습니다.');await refresh();}
     finally{state.busy=false;}
   }
 }
 function change(e){
   const dateInput=e.target.closest('[data-slot-date]');
   if(dateInput)void loadSlotChoices(dateInput.value);
 }

 let mobileShortcutVisible=false;
 let mobileShortcutRequestId=0;
 function confirmedTodayCount(rows){
   const day=today();
   return rows.filter(row=>row?.status==='confirmed'&&row.start_at&&kstParts(row.start_at).ymd===day).length;
 }
 function updateMobileShortcutBadge(count){
   const entry=document.querySelector('[data-olli-booking-entry]');
   const badge=entry?.querySelector('[data-olli-booking-count]');
   if(!badge)return;
   badge.textContent=String(count);
   entry.setAttribute('aria-label','오늘의 상담 예약 현황, 오늘 예약 '+count+'건. 예약 현황 열기');
 }
 async function refreshMobileShortcutCount(){
   const dashboard=document.getElementById('recordAcademyDashboard');
   if(!dashboard?.classList.contains('show')||!isOwner())return;
   const requestId=++mobileShortcutRequestId;
   const scope=ctx();
   try{
     const result=await manage('list',{month:currentMonth()});
     if(requestId!==mobileShortcutRequestId||ctx().academyId!==scope.academyId||ctx().sessionToken!==scope.sessionToken)return;
     if(result?.ok!==true||!Array.isArray(result.appointments))throw new Error('예약 건수 조회 실패');
     updateMobileShortcutBadge(confirmedTodayCount(result.appointments));
   }catch(_error){
     if(requestId!==mobileShortcutRequestId)return;
     const badge=dashboard.querySelector('[data-olli-booking-count]');
     if(badge)badge.textContent='–';
   }
 }
 function syncMobileShortcut(){
   if(document.body.classList.contains('olliPcApp'))return;
   const dashboard=document.getElementById('recordAcademyDashboard');
   if(!dashboard?.classList.contains('show')){
     mobileShortcutVisible=false;
     mobileShortcutRequestId++;
     return;
   }
   const inserted=insertMobileShortcut();
   if(!mobileShortcutVisible||inserted){
     mobileShortcutVisible=true;
     void refreshMobileShortcutCount();
   }
 }
 function insertMobileShortcut(){
   if(!isOwner())return;
   const dashboard=document.getElementById('recordAcademyDashboard');
   // PC 학생관리의 상담예약현황 바로가기는 제거하고 상담기록 탭으로 이동.
   if(document.body.classList.contains('olliPcApp'))return;
   if(!dashboard||!dashboard.classList.contains('show')||dashboard.querySelector('[data-olli-booking-entry]'))return;
   const entry=el('button','obmAcademyEntry');
   entry.type='button';entry.dataset.olliBookingEntry='true';
   entry.innerHTML='<span><strong>오늘의 상담 예약 현황</strong><small>오늘·이번 주 일정 및 예약 관리</small></span><span class="obmAcademyEntryCount" data-olli-booking-count aria-label="오늘 상담 예약 건수">–</span>';
   entry.addEventListener('click',()=>open('mobile'));
   // Two-column stats: the fifth cell is directly below the third card ('올해 등록').
   const grid=dashboard.querySelector('.recordAcademyStatGrid');
   if(!grid||grid.children.length!==4)return;
   grid.appendChild(entry);
   return true;
 }
 function initMobileShortcut(){
   const root=document.getElementById('recordAcademyDashboard');
   if(!root||state.entryObserver)return;
   state.entryObserver=new MutationObserver(()=>syncMobileShortcut());
   state.entryObserver.observe(root,{attributes:true,attributeFilter:['class'],childList:true});
   syncMobileShortcut();
 }
 global.OlliBookingDashboard=Object.freeze({open,close,refresh,initMobileShortcut});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initMobileShortcut,{once:true});
 else initMobileShortcut();
})(window);
