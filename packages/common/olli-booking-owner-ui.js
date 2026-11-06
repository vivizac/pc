/* Shared Olli consultation booking management UI — PC wide, mobile essentials.
 * Owner-only RPC. No duplicate booking store or consultation feedback creation.
 */
(function (global) {
 'use strict';
 const state={mode:'pc',root:null,month:'',view:'calendar',selectedDay:'',rows:[],settings:null,error:'',busy:false,loading:false,ready:false,entryObserver:null,mobileScope:'',mobileCacheAt:0,mobileRequest:0,mobileNeedsRefresh:false,mobileRenderDeferred:false,slotDate:'',slotChoices:[],slotRequest:0,manualStudents:[],manualStudentId:'',publicUrl:''};
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
 async function manualManage(action,options={}){
   const c=auth();
   return rpc('olli_booking_staff_manual_manage',{
     p_session_token:c.sessionToken,p_academy_id:c.academyId,p_action:action,
     p_student_id:options.studentId||null,p_start_at:options.startAt||null,
     p_request_key:options.requestKey||null
   });
 }
 async function intakeManage({name,age,visitType,startAt,requestKey}){
   const c=auth();
   return rpc('olli_booking_staff_intake_create',{
     p_session_token:c.sessionToken,p_academy_id:c.academyId,
     p_child_name:name,p_age_years:age,p_visit_type:visitType,
     p_start_at:startAt,p_request_key:requestKey
   });
 }
 async function settingsSave(settings,expectedRevision){
   const c=auth();
   return rpc('olli_booking_settings_manage',{p_session_token:c.sessionToken,p_academy_id:c.academyId,
     p_action:'save',p_data:{...settings,expected_revision:expectedRevision}});
 }
 async function available(date,{manual=false}={}){
   const c=auth();
   return rpc(manual?'olli_booking_staff_manual_slots':'olli_booking_list_slots',{
     p_session_token:c.sessionToken,p_academy_id:c.academyId,p_date:date
   });
 }
 const uniqueId=()=>global.crypto?.randomUUID?.()||'';
 function filteredRows(){
   let list=state.rows;
   if(state.mode==='mobile'){
     if(state.view==='today')list=list.filter(r=>kstParts(r.start_at).ymd===today());
     if(state.view==='week'){
       const base=new Date(today()+'T00:00:00Z');const start=new Date(base);start.setUTCDate(start.getUTCDate()-start.getUTCDay());
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
   const todayRows=confirmed.filter(r=>kstParts(r.start_at).ymd===today());
   const todayN=todayRows.length;
   const newN=confirmed.filter(r=>r.kind==='intake').length;
   const unbooked=dueUnbooked();
   const monthLabel=state.mode==='pc'?'이달의 예약':'이번 달 예약';
   if(state.mode==='mobile'){
     // Counts are separated using the same confirmed bookings as the totals.
     const todayNewN=todayRows.filter(r=>r.kind==='intake').length;
     // The due list is for registered students, never new intake inquiries.
     // An unavailable due list must remain unknown instead of showing zero.
     const unbookedN=unbooked===null?'—':unbooked.length;
     const items=[
       ['이번 달 예약',confirmed.length,confirmed.length-newN,newN],
       ['오늘 상담',todayN,todayN-todayNewN,todayNewN],
       ['신규 상담·체험',newN,0,newN],
       ['이번 달 미예약 대상',unbookedN,unbookedN,unbooked===null?'—':0]
     ];
     return '<div class="recordAcademyStatGrid obmMobileStatGrid">'+items.map(([label,value,regular,intake])=>
       '<div class="recordAcademyStatCard"><div class="recordAcademyStatLabel">'+escapeHtml(label)+'</div>'+
       '<div class="recordAcademyStatBody"><div class="recordAcademyStatValue">'+escapeHtml(value)+'</div>'+
       '<div class="recordAcademySplitLegend obmMobileStatBreakdown" aria-label="'+
       escapeHtml('재원생 '+regular+'명, 신규생 '+intake+'명')+'">'+
       '<span>재원생 <b>'+escapeHtml(regular)+'</b></span>'+
       '<span>신규생 <b>'+escapeHtml(intake)+'</b></span>'+
       '</div></div></div>'
     ).join('')+'</div>';
   }
   return '<div class="obmStats"><div><strong>'+confirmed.length+'</strong><span>'+monthLabel+'</span></div><div><strong>'+todayN+'</strong><span>오늘 상담</span></div><div><strong>'+newN+'</strong><span>신규생 상담</span></div>'+
    (unbooked===null?'':'<div><strong>'+unbooked.length+'</strong><span>이번 달 미예약 대상</span></div>')+'</div>';
 }
 function calendarHtml(){
   const [y,m]=state.month.split('-').map(Number);
   const days=new Date(Date.UTC(y,m,0)).getUTCDate();
   const padding=new Date(Date.UTC(y,m-1,1)).getUTCDay();
   const byDay=new Map();
   // This view already receives the owner's authenticated month-scoped booking
   // rows. Cancellations are not appointments, and no extra RPC is necessary.
   state.rows.filter(r=>r.status==='confirmed'&&r.start_at).forEach(r=>{
     const parts=kstParts(r.start_at);
     if(!byDay.has(parts.ymd))byDay.set(parts.ymd,[]);
     byDay.get(parts.ymd).push({
       name:String(r.name||'학생')+(r.kind==='intake'&&r.visit_type==='trial'?' · 체험':''),
       time:parts.hm
     });
   });
   const heads=['일','월','화','수','목','금','토'].map(s=>'<span class="obmDayHead">'+s+'</span>').join('');
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
 function bookingTypeLabel(row){
   return row.kind==='intake'
     ?(row.visit_type==='trial'?'체험수업':'신규 상담')
     :'재원생 정기 상담';
 }
 function bookingsHtml(){
   const rows=filteredRows();
   if(!rows.length)return '<div class="obmEmptyMessage">'+(state.selectedDay?'선택한 날짜에':'해당 기간에')+' 예약된 상담이 없습니다.</div>';
   const safe=rows.slice().sort((a,b)=>String(a.start_at).localeCompare(String(b.start_at)));
   return '<div class="obmRows">'+safe.map(r=>{
     const date=kstParts(r.start_at);
     const identity=state.mode==='mobile'
       ?'<div class="obmRowIdentity"><strong>'+escapeHtml(r.name)+'</strong>'+
         '<span class="obmRowType">'+bookingTypeLabel(r)+'</span></div>'+
         (r.status==='cancelled'?'<span class="obmRowCancelledLabel">취소됨</span>':'')
       :'<strong>'+escapeHtml(r.name)+'</strong>'+
         '<span>'+bookingTypeLabel(r)+
         (r.status==='cancelled'?' · 취소됨':'')+'</span>';
     return '<article class="obmRow"><div class="obmRowTime"><strong><span class="obmRowDate">'+escapeHtml(dateLabel(date.ymd).replace(/\s+\(/g,'('))+'</span> <span class="obmRowClock">'+escapeHtml(date.hm)+'</span></strong></div>'+
       '<div class="obmRowMain">'+identity+
       '</div><div class="obmRowActions">'+
       (r.status==='confirmed'?'<button type="button" data-action="edit" data-id="'+escapeHtml(r.id)+'">변경</button><button type="button" data-action="cancel" data-id="'+escapeHtml(r.id)+'">취소</button>':'<span class="obmCancelled">취소 기록</span>')+
       '</div></article>';
   }).join('')+'</div>';
 }
 function settingsHtml(){
   const s=state.settings;if(!s)return '<div class="obmEmptyMessage">학원별 예약 설정을 불러오지 못했습니다.</div>';
   const list=(arr,key,names)=>names.map(([n,name])=>'<label class="obmOption"><input type="checkbox" data-settings-array="'+key+'" value="'+n+'" '+(arr.includes(n)?'checked':'')+'><span>'+name+'</span></label>').join('');
   const mobileReminder=state.mode==='mobile'
     ?'<div class="obmSettingGroup"><strong>당일 상담 알림</strong><p>상담이 있는 날 오전 10시에 푸시 알림을 받습니다. 알림 권한을 허용하면 설치한 올리 앱 아이콘에도 오늘 상담 건수가 표시됩니다.</p><button type="button" data-action="enable-consultation-reminder">상담 알림 켜기</button></div>'
     :'';
   return '<form class="obmSettings" data-settings-form><p class="obmHint">이 학원에서만 적용되는 예약 운영 기준입니다. PC·모바일에서 동일하게 반영됩니다.</p>'+mobileReminder+
   '<div class="obmSettingGroup"><strong>예약 기간</strong><div class="obmOptionRow">'+list(s.weeks,'weeks',[[1,'첫째 주'],[2,'둘째 주'],[3,'셋째 주'],[4,'넷째 주'],[5,'다섯째 주'],[6,'여섯째 주']])+'</div></div>'+
   '<div class="obmSettingGroup"><strong>운영 요일</strong><div class="obmOptionRow">'+list(s.weekdays,'weekdays',[[1,'월'],[2,'화'],[3,'수'],[4,'목'],[5,'금'],[6,'토'],[7,'일']])+'</div></div>'+
   '<div class="obmSettingGroup obmTimeGrid"><label>시작 시각<input name="start_time" type="time" value="'+escapeHtml(s.start_time.slice(0,5))+'" required></label><label>종료 시각<input name="end_time" type="time" value="'+escapeHtml(s.end_time.slice(0,5))+'" required></label><label>예약 간격<select name="slot_minutes"><option value="15" '+(s.slot_minutes===15?'selected':'')+'>15분</option><option value="30" '+(s.slot_minutes===30?'selected':'')+'>30분</option><option value="60" '+(s.slot_minutes===60?'selected':'')+'>60분</option></select></label></div>'+
   '<div class="obmSettingGroup"><label class="obmSwitch"><input name="allow_parent_reschedule" type="checkbox" '+(s.allow_parent_reschedule?'checked':'')+'>학부모 예약 변경 허용</label><label class="obmSwitch"><input name="allow_parent_cancel" type="checkbox" '+(s.allow_parent_cancel?'checked':'')+'>학부모 예약 취소 허용</label></div>'+
   '<div class="obmFormActions"><button type="submit" class="obmPrimary">설정 저장</button></div></form>';
 }

 // Owner-only local read mirror. This is never a write queue or source of
 // truth: all changes still require successful server RPCs first.
 const OWNER_CACHE_PREFIX='olli_booking_owner_month_snapshot_v1:';
 const OWNER_CACHE_MAX_AGE_MS=30*86400000;
 const OWNER_CACHE_MAX_BYTES=950000;
 const ownerMemoryCache=new Map();
 function ownerSnapshotKey(academyId,month){
   return OWNER_CACHE_PREFIX+String(academyId||'')+':'+String(month||'');
 }
 function readOwnerSnapshot(scope,month){
   if(!isOwner()||!scope?.academyId||!scope?.sessionToken||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month||''))return null;
   const key=ownerSnapshotKey(scope.academyId,month);
   let saved=ownerMemoryCache.get(key);
   if(!saved){try{saved=JSON.parse(localStorage.getItem(key)||'null')}catch{return null;}}
   if(saved?.version!==1||saved.academyId!==scope.academyId||saved.month!==month
     ||!Number.isFinite(saved.savedAt)||saved.savedAt>Date.now()+60000
     ||Date.now()-saved.savedAt>OWNER_CACHE_MAX_AGE_MS
     ||!Array.isArray(saved.rows)||!saved.settings||typeof saved.settings!=='object')return null;
   if(saved.rows.some(r=>!r||typeof r!=='object'||typeof r.id!=='string'
      ||typeof r.start_at!=='string'||!Number.isFinite(Date.parse(r.start_at))
      ||r.status!=='confirmed'&&r.status!=='cancelled'))return null;
   ownerMemoryCache.set(key,saved);
   return saved;
 }
 function saveOwnerSnapshot(scope,month,rows,settings){
   if(!scope?.academyId||!Array.isArray(rows)||!settings||typeof settings!=='object')return;
   const safeRows=rows.map(r=>({
     id:String(r.id||''),
     student_id:r.student_id||null,
     intake_id:r.intake_id||null,
     name:String(r.name||''),
     kind:r.kind==='intake'?'intake':'regular',
     visit_type:r.kind==='intake'&&r.visit_type==='trial'?'trial':'consultation',
     age_years:Number.isInteger(r.age_years)?r.age_years:null,
     status:r.status,
     start_at:String(r.start_at||''),
     end_at:String(r.end_at||'')
   }));
   if(safeRows.some(r=>!r.id||!Number.isFinite(Date.parse(r.start_at))
     ||r.status!=='confirmed'&&r.status!=='cancelled'))return;
   const snapshot={version:1,academyId:scope.academyId,month,
     rows:safeRows,settings,savedAt:Date.now()};
   let serialized;
   try{serialized=JSON.stringify(snapshot)}catch{return;}
   if(serialized.length>OWNER_CACHE_MAX_BYTES)return;
   const key=ownerSnapshotKey(scope.academyId,month);
   ownerMemoryCache.set(key,snapshot);
   try{localStorage.setItem(key,serialized)}
   catch(_){/* Keep memory-only last good snapshot. Never clear app storage. */}
 }
 function showOwnerSnapshot(){
   const scope=ctx();
   const saved=readOwnerSnapshot(scope,state.month);
   state.mobileScope=scope.academyId;
   state.mobileCacheAt=saved?.savedAt||0;
   state.rows=saved?.rows||[];
   state.settings=saved?.settings||null;
   state.ready=Boolean(saved);
   state.error='';
 }
 function hasActiveBookingModal(){
   return state.mode==='mobile'&&Boolean(state.root?.querySelector('[data-modal-host] .obmModalBackdrop'));
 }
 async function refreshMobileBooking(){
   const scope=ctx(),month=state.month,request=++state.mobileRequest;
   const same=()=>state.mode==='mobile'&&request===state.mobileRequest
     &&state.month===month&&state.mobileScope===scope.academyId
     &&ctx().academyId===scope.academyId&&ctx().sessionToken===scope.sessionToken&&isOwner();
   if(!scope.academyId||!scope.sessionToken||!isOwner())return false;
   state.loading=true;state.error='';
   if(!hasActiveBookingModal())render();
   let success=false;
   try{
     const result=await manage('list',{month});
     if(!same())return false;
     if(result?.ok!==true||!Array.isArray(result.appointments)||!result.settings)
       throw new Error('상담 예약 데이터를 확인하지 못했습니다.');
     const appointments=result.appointments;
     // Save only a complete, authenticated server response for the current
     // academy and month. A partial or failed request never destroys the mirror.
     state.rows=appointments;
     state.settings=result.settings;
     state.ready=true;
     state.mobileCacheAt=Date.now();
     saveOwnerSnapshot(scope,month,appointments,result.settings);
     if(month===currentMonth()){
       const count=confirmedTodayCount(appointments);
       rememberMobileShortcutCount(scope.academyId,today(),count);
       updateMobileShortcutBadge(count);
     }
     success=true;
     state.mobileNeedsRefresh=false;
   }catch(e){
     if(same()){
       // Preserve last known-good local data on offline/transient errors.
       state.error=state.ready?'최신 상담 정보를 확인하지 못했습니다. 저장된 데이터를 표시합니다.':
         String(e?.message||'상담 예약 서버 연결 실패');
     }
   }finally{
     if(same()){
       state.loading=false;
       if(!hasActiveBookingModal())render();
       else state.mobileRenderDeferred=true;
     }
   }
   return success;
 }
 function render(){
   const root=state.root;if(!root)return;
   const mobileTitle=state.mode==='mobile'
     ?'<button type="button" class="obmMobileBack" data-action="back" aria-label="뒤로가기" title="뒤로가기"><span class="memoRosterBackIcon" aria-hidden="true"></span></button>'+
       '<h2 class="obmMobileHeading">상담 현황</h2>'+
       '<button type="button" class="obmMobileAdd" data-action="add-manual" aria-label="상담일정 추가" title="상담일정 추가" '+(state.ready?'':'disabled')+'><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>'
     :'';
   let header=state.mode==='mobile'
     ?'<div class="obmHeader obmMobileHeader">'+mobileTitle+'</div>'
     :'<div class="obmHeader obmHeaderPc"><div class="obmHeaderButtons"><button type="button" data-action="refresh" aria-label="예약 내역 새로고침">새로고침</button></div></div>';
   let tabs=state.mode==='pc'
     ?[['calendar','캘린더'],['list','예약 목록'],['settings','예약 설정']]
     :[['today','오늘'],['week','이번 주'],['list','전체 예약'],['settings','설정']];
   const nav='<div class="obmTabs" role="tablist" aria-label="상담 현황 보기">'+tabs.map(([v,txt])=>
      '<button type="button" role="tab" aria-selected="'+(state.view===v)+'" class="'+(state.view===v?'active':'')+'" data-view="'+v+'">'+txt+'</button>').join('')+'</div>';
   const months='<div class="obmMonth"><button type="button" data-action="month-prev" aria-label="이전 달">‹</button><strong>'+escapeHtml(state.month)+'</strong><button type="button" data-action="month-next" aria-label="다음 달">›</button></div>';
   const error=state.error?'<div class="obmError" role="alert">'+escapeHtml(state.error)+'</div>':'';
   const pcCalendar=state.mode==='pc'&&state.view==='calendar';
   const stats=state.mode==='mobile'?(state.ready?renderStats():
       '<div class="recordAcademyStatGrid obmMobileStatGrid obmStatsPending">'+
       ['이번 달 예약','오늘 상담','신규 상담·체험','이번 달 미예약 대상'].map(label=>
         '<div class="recordAcademyStatCard"><div class="recordAcademyStatLabel">'+label+
         '</div><div class="recordAcademyStatBody"><div class="recordAcademyStatValue">—</div></div></div>'
       ).join('')+'</div>')
     :state.view==='settings'?'':state.ready&&!state.loading?renderStats():'';
   const bookingList='<div class="obmListHeader"><strong>'+(state.selectedDay&&state.mode==='pc'?escapeHtml(dateLabel(state.selectedDay)):'예약 목록')+'</strong>'+
     (state.selectedDay&&state.mode==='pc'?'<button type="button" data-action="clear-day">날짜 선택 해제</button>':'')+'</div>'+bookingsHtml();
   const content=state.mode==='mobile'
     ?state.view==='settings'
       ?(state.ready?settingsHtml()+'<div class="obmShortcutsSetup"><button type="button" data-action="shortcut-setup">아이폰 아침 브리핑 연결</button></div>':'<div class="obmEmptyMessage">설정을 확인 중입니다.</div>')
       :state.ready?bookingList:
        '<div class="obmEmptyMessage">'+(state.loading?'상담 정보를 확인 중입니다.':'상담 데이터를 아직 저장하지 않았습니다. 온라인에서 한 번 열면 다음부터 바로 표시됩니다.')+'</div>'
     :state.loading?'<div class="obmEmptyMessage">예약 정보를 불러오는 중입니다.</div>'
     :!state.ready?'<div class="obmEmptyMessage">상담 예약 정보를 연결하지 못했습니다. 서버 설정과 로그인 상태를 확인해 주세요.</div>'
     :state.view==='settings'?settingsHtml()
     :(state.mode==='pc'?'':stats)+(pcCalendar?calendarHtml():'')+(pcCalendar?'':bookingList);
   // PC toolbar is unchanged. Mobile capsule follows the stat cards.
   const canAdd=state.ready&&!state.loading;
    const pcManual=state.mode==='pc'
      ?'<button class="obmPcAddManual" type="button" data-action="add-manual" '+(canAdd?'':'disabled')+'>+ 재원생 상담</button>'+
       '<button class="obmPcAddIntake" type="button" data-action="add-intake" '+(canAdd?'':'disabled')+'>+ 신규 상담</button>'
      :'';
   const toolbar=state.mode==='pc'
     ? '<div class="obmPcToolbar">'+stats+'<div class="obmPcTools">'+pcManual+months+nav+header+'</div></div>'
     : header+months+stats+nav;
   const mobileStatus=state.mode==='mobile'&&state.loading&&state.ready
     ?'<div class="obmSyncStatus" role="status">저장된 상담 데이터를 표시 중 · 최신 정보 확인 중</div>':'';

   // The PC copy button is in the fixed title bar. Show the URL below only when issued,
   // so clipboard-denied users can still select/copy it manually.
   const footer=state.mode==='pc'
     ? (state.publicUrl?'<div class="obmFooter"><p class="obmLinkAddress">'+escapeHtml(state.publicUrl)+'</p></div>':'')
     : '<div class="obmFooter"><div class="obmLinkRow"><span>알림톡 승인 템플릿에 등록할 <strong>학원 통합 예약 링크</strong>입니다. 학생별 링크를 발급하지 않습니다.</span><button type="button" data-action="copy-public-link">통합 링크 복사</button></div>'+(state.publicUrl?'<p class="obmLinkAddress">'+escapeHtml(state.publicUrl)+'</p>':'')+'</div>';
   root.innerHTML='<div class="obmLayout">'+toolbar+mobileStatus+error+content+footer+
     '</div><div class="obmModalHost" data-modal-host></div>';
 }
 async function refresh(){
   if(state.mode==='mobile')return refreshMobileBooking();
   if(state.loading)return;
   const initialCtx=ctx();
   state.loading=true;state.error='';render();
   try{
     const result=await manage();
     if(ctx().academyId!==initialCtx.academyId||ctx().sessionToken!==initialCtx.sessionToken)return;
     if(result?.ok!==true)throw Error('예약 데이터를 읽지 못했습니다.');
     state.rows=Array.isArray(result.appointments)?result.appointments:[];
     state.settings=result.settings||null;state.ready=true;
     if(state.mode==='mobile'&&state.month===currentMonth()){
       const count=confirmedTodayCount(state.rows),academyId=ctx().academyId;
       rememberMobileShortcutCount(academyId,today(),count);
       updateMobileShortcutBadge(count);
     }
   }catch(e){state.ready=false;state.rows=[];state.settings=null;state.error=e.message||'예약 서버 오류';}
   finally{state.loading=false;render();}
 }
 function mount(node,mode){
   state.mode=mode;state.root=node;state.view=mode==='mobile'?'today':'calendar';
   state.month=currentMonth();state.selectedDay='';state.ready=false;state.error='';
   if(mode==='mobile'){state.mobileRequest++;showOwnerSnapshot();state.loading=false;}
   if(!node.dataset.obmBound){
     node.dataset.obmBound='true';
     node.addEventListener('click',click);
     node.addEventListener('submit',submit);
     node.addEventListener('change',change);
     node.addEventListener('input',input);
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
   const bookedDate=kstParts(row.start_at).ymd;
   const maxDate=new Date(Date.parse(today()+'T00:00:00Z')+120*86400000).toISOString().slice(0,10);
   state.slotDate=bookedDate>=today()?bookedDate:today();
   host.innerHTML='<div class="obmModalBackdrop" data-action="dismiss"><div class="obmModal" role="dialog" aria-modal="true" aria-label="상담 일정 변경"><h3>상담 시간 변경</h3><p>'+escapeHtml(row.name)+' · 현재 '+escapeHtml(dateLabel(bookedDate))+' '+escapeHtml(kstParts(row.start_at).hm)+'</p><label>날짜 선택<input type="date" data-slot-date min="'+today()+'" max="'+maxDate+'" value="'+state.slotDate+'"></label><label>가능 시간<select data-slot-time><option value="">시간 조회 중</option></select></label><p class="obmSlotError" data-slot-error role="status"></p><div class="obmFormActions"><button type="button" data-action="dismiss">닫기</button><button type="button" class="obmPrimary" data-action="save-reschedule" data-id="'+escapeHtml(id)+'">변경 저장</button></div></div></div>';
   await loadSlotChoices(state.slotDate,{manual:true});
 }
 async function openManualBooking(){
   if(state.busy||!state.ready)return;
   const root=state.root,host=root?.querySelector('[data-modal-host]');
   if(!host)return;
   const scope=ctx();
   state.busy=true;state.manualStudents=[];state.manualStudentId='';
   const manualTitle=state.mode==='pc'?'재원생 상담':'상담일정 추가';
   host.innerHTML='<div class="obmModalBackdrop"><div class="obmModal" role="dialog" aria-modal="true" aria-label="'+escapeHtml(manualTitle)+'"><h3>'+escapeHtml(manualTitle)+'</h3><p>재원생을 불러오고 있습니다.</p></div></div>';
   try{
     const result=await manualManage('students');
     if(root!==state.root||ctx().academyId!==scope.academyId||ctx().sessionToken!==scope.sessionToken)return;
     if(result?.ok!==true)throw new Error('재원생 목록을 불러오지 못했습니다.');
     const students=Array.isArray(result.students)?result.students:[];
     state.manualStudents=students;
     const selectedDate=state.selectedDay&&state.selectedDay>=today()?state.selectedDay:today();
     const maxDate=new Date(Date.parse(today()+'T00:00:00Z')+120*86400000).toISOString().slice(0,10);
     host.innerHTML='<div class="obmModalBackdrop" data-action="dismiss"><div class="obmModal" role="dialog" aria-modal="true" aria-label="'+escapeHtml(manualTitle)+'"><h3>'+escapeHtml(manualTitle)+'</h3><p>원장님이 직접 재원생의 상담 시간을 등록합니다. 예약 설정에 맞는 빈 시간만 표시됩니다.</p>'+
       '<label>학생 이름 검색<input type="search" data-manual-search placeholder="학생 이름을 입력해 검색" autocomplete="off" aria-label="학생 이름 검색" aria-controls="obmManualSearchResults" aria-expanded="false"><input type="hidden" data-manual-student value=""><div id="obmManualSearchResults" class="obmStudentMatches" data-manual-results role="listbox" aria-label="검색된 학생" hidden></div></label>'+
       '<label>날짜 선택<input type="date" data-slot-date min="'+today()+'" max="'+maxDate+'" value="'+selectedDate+'"></label>'+
       '<label>가능 시간<select data-slot-time><option value="">시간 조회 중</option></select></label><p class="obmSlotError" data-slot-error role="status"></p>'+
       (!students.length?'<p>등록 가능한 재원생이 없습니다.</p>':'')+
       '<div class="obmFormActions"><button type="button" data-action="dismiss">닫기</button><button type="button" class="obmPrimary" data-action="save-manual" '+(!students.length?'disabled':'')+'>일정 추가</button></div></div></div>';
     await loadSlotChoices(selectedDate,{manual:true});
   }catch(err){
     if(root===state.root&&ctx().academyId===scope.academyId&&ctx().sessionToken===scope.sessionToken){
       state.error=err?.message||'상담일정 추가 화면을 열지 못했습니다.';
       render();
     }
   }finally{state.busy=false;}
 }
 async function loadSlotChoices(date,{manual=false}={}){
   const select=state.root?.querySelector('[data-slot-time]');
   if(!select)return;
   const request=++state.slotRequest;
   select.innerHTML='<option value="">시간 조회 중</option>';
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')){
     select.innerHTML='<option value="">날짜를 먼저 선택해 주세요</option>';return;
   }
   try{
     const result=await available(date,{manual});
     if(request!==state.slotRequest||!select.isConnected
       ||state.root?.querySelector('[data-slot-date]')?.value!==date)return;
     if(result?.ok!==true||!Array.isArray(result.slots))
       throw new Error('예약 시간 조회 결과가 올바르지 않습니다.');
     select.innerHTML='<option value="">시간 선택</option>';
     for(const slot of result.slots){
       const option=el('option','',kstParts(slot.start_at).hm);
       option.value=slot.start_at;select.appendChild(option);
     }
     if(select.options.length===1)
       select.options[0].textContent='빈 상담 시간이 없습니다 · 다른 날짜를 선택해 주세요';
   }catch(e){
     if(request!==state.slotRequest||!select.isConnected)return;
     select.innerHTML='<option value="">시간 조회 실패 · 날짜를 다시 선택해 주세요</option>';
     state.error=String(e?.message||'상담 시간 조회 실패');
     const alertNode=state.root?.querySelector('.obmModal [data-slot-error]');
     if(alertNode)alertNode.textContent=state.error;
   }
 }
 function manualStudentMatches(query){
   const container=state.root?.querySelector('[data-manual-results]');
   const search=state.root?.querySelector('[data-manual-search]');
   if(!container||!search)return;
   const term=String(query||'').trim().toLocaleLowerCase('ko-KR');
   if(!term){container.innerHTML='';container.hidden=true;search.setAttribute('aria-expanded','false');return;}
   const matches=state.manualStudents.filter(student=>
     String(student.name||'').toLocaleLowerCase('ko-KR').includes(term)).slice(0,20);
   container.innerHTML=matches.length?matches.map(student=>
     '<button type="button" class="obmStudentMatch" role="option" data-action="pick-manual-student" data-student-id="'+escapeHtml(student.id)+'">'+
      '<strong>'+escapeHtml(student.name)+'</strong>'+
      (student.school||student.grade?'<small>'+escapeHtml([student.school,student.grade].filter(Boolean).join(' · '))+'</small>':'')+
     '</button>').join(''):'<p class="obmStudentNoMatch">검색 결과가 없습니다.</p>';
   container.hidden=false;search.setAttribute('aria-expanded','true');
 }
 async function copyPublicLink(node){
   if(state.busy)return;
   state.busy=true;
   const originalLabel=node?.textContent;
   const showProgress=state.mode==='pc';
   if(node){node.disabled=true;if(showProgress)node.textContent='복사 중...';}
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
   finally{state.busy=false;if(node?.isConnected){node.disabled=false;if(showProgress)node.textContent=originalLabel;}}
 }
 async function click(e){
   if(!(e.target instanceof Element))return;
   const node=e.target.closest('[data-action],[data-view],[data-day]');
   if(!node||!state.root.contains(node))return;
   if(node.matches('[data-day]')){state.selectedDay=node.dataset.day;if(state.mode==='pc')state.view='list';render();return;}
   if(node.matches('[data-view]')){state.view=node.dataset.view;state.selectedDay='';render();return;}
   const action=node.dataset.action;
   if(action==='back'){close();return;}
   if(action==='copy-public-link'){await copyPublicLink(node);return;}
    if(action==='shortcut-setup'&&state.mode==='mobile'){global.OlliShortcutBriefing?.open?.();return;}
   if(action==='dismiss'){
     // Delegated clicks from inputs/labels bubble through the backdrop.
     // Dismiss only when the backdrop itself is the direct click target,
     // or when the user explicitly chooses the modal's Close button.
     const onBackdrop=node.classList.contains('obmModalBackdrop')&&e.target===node;
     const onCloseButton=node.matches('button[data-action="dismiss"]');
     if(onBackdrop||onCloseButton){
       const host=state.root.querySelector('[data-modal-host]');
       if(host)host.innerHTML='';
       if(state.mode==='mobile'){
         if(state.mobileRenderDeferred){state.mobileRenderDeferred=false;render();}
         if(state.mobileNeedsRefresh){state.mobileNeedsRefresh=false;void refresh();}
       }
     }
     return;
   }
   if(action==='month-prev'||action==='month-next'){
     state.month=plusMonth(state.month,action==='month-next'?1:-1);
     state.selectedDay='';
     if(state.mode==='mobile'){state.mobileRequest++;showOwnerSnapshot();}
     void refresh();return;
   }
   if(action==='refresh'){void refresh();return;}
   if(action==='clear-day'){state.selectedDay='';render();return;}
   if(action==='add-manual'){await openManualBooking();return;}
   if(action==='enable-consultation-reminder'){
     if(state.mode!=='mobile')return;
     const enable=global.OlliTalkPush?.ensureSubscription;
     if(typeof enable!=='function'){
       global.alert('이 기기에서는 올리 모바일 푸시 알림을 켤 수 없습니다.');
       return;
     }
     const enabled=await enable({interactive:true});
     if(enabled){
       void global.OlliConsultationReminders?.refresh?.({force:true});
       global.alert('상담 알림이 켜졌습니다. 예약된 상담이 있는 날 오전 10시에 알림을 받습니다.');
     }
     return;
   }
   if(action==='pick-manual-student'){
     const selected=state.manualStudents.find(s=>String(s.id)===node.dataset.studentId);
     const search=state.root?.querySelector('[data-manual-search]');
     const hidden=state.root?.querySelector('[data-manual-student]');
     if(selected&&search&&hidden){
       state.manualStudentId=String(selected.id);
       hidden.value=state.manualStudentId;
       search.value=String(selected.name||'');
       manualStudentMatches('');
     }
     return;
   }
   if(action==='edit'){await editBooking(node.dataset.id);return;}
   if(action==='save-manual'){
     if(state.busy)return;
     const studentId=state.root.querySelector('[data-manual-student]')?.value;
     const startAt=state.root.querySelector('[data-slot-time]')?.value;
     if(!studentId||!startAt){global.alert('학생과 상담 시간을 모두 선택해 주세요.');return;}
     if(!global.confirm('선택한 학생의 상담일정을 추가하시겠습니까?'))return;
     const scope=ctx();
     state.busy=true;node.disabled=true;
     try{
       const requestKey=uniqueId();if(!requestKey)throw new Error('요청 식별키 생성 실패');
       const result=await manualManage('create',{studentId,startAt,requestKey});
       if(result?.ok!==true)throw new Error('상담일정 저장이 확인되지 않았습니다.');
       if(ctx().academyId!==scope.academyId||ctx().sessionToken!==scope.sessionToken)return;
       state.month=kstParts(startAt).ymd.slice(0,7);
       state.selectedDay='';
       await refresh();
       global.alert('상담일정을 추가했습니다.');
     }catch(err){
       if(ctx().academyId===scope.academyId&&ctx().sessionToken===scope.sessionToken){
         const msg=String(err?.message||'');
         global.alert(/23505|23P01|duplicate|overlap|exclusion|SLOT_NOT_AVAILABLE/i.test(msg)
           ?'해당 학생의 기존 예약이 있거나 선택한 시간이 이미 예약되었습니다. 날짜와 시간을 다시 확인해 주세요.'
           :msg||'상담일정을 저장하지 못했습니다.');
         await refresh();
       }
     }finally{state.busy=false;if(node.isConnected)node.disabled=false;}
     return;
   }
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
   if(dateInput)void loadSlotChoices(dateInput.value,{
     manual:Boolean(dateInput.closest('[aria-label="상담일정 추가"],[aria-label="상담 일정 변경"]'))
   });
 }
 function input(e){
   const search=e.target.closest('[data-manual-search]');
   if(!search)return;
   state.manualStudentId='';
   const chosen=state.root?.querySelector('[data-manual-student]');
   if(chosen)chosen.value='';
   manualStudentMatches(search.value);
 }

 let mobileShortcutVisible=false;
 let mobileShortcutRequestId=0;
 let mobileShortcutScopeKey='';
 let mobileShortcutPendingScope='';
 let mobileShortcutLastRequestAt=0;
 const MOBILE_SHORTCUT_CACHE_PREFIX='olli_booking_today_count_v1:';
 const MOBILE_SHORTCUT_RESUME_THROTTLE_MS=20000;
 const MOBILE_SHORTCUT_REVALIDATE_MS=300000;
 const mobileShortcutMemoryCache=new Map();
 function shortcutScope(academyId,day){return String(academyId||'')+'|'+String(day||'');}
 function readMobileShortcutCount(academyId,day){
   if(!academyId||!day)return null;
   const memory=mobileShortcutMemoryCache.get(shortcutScope(academyId,day));
   if(memory)return memory;
   try{
     const saved=JSON.parse(localStorage.getItem(MOBILE_SHORTCUT_CACHE_PREFIX+academyId)||'null');
     if(saved?.day!==day||!Number.isSafeInteger(saved.count)||saved.count<0)return null;
     mobileShortcutMemoryCache.set(shortcutScope(academyId,day),saved);
     return saved;
   }catch{return null;}
 }
 function rememberMobileShortcutCount(academyId,day,count){
   if(!academyId||!day||!Number.isSafeInteger(count)||count<0)return;
   const saved={day,count,checkedAt:Date.now()};
   mobileShortcutMemoryCache.set(shortcutScope(academyId,day),saved);
   try{
     localStorage.setItem(MOBILE_SHORTCUT_CACHE_PREFIX+academyId,JSON.stringify(saved));
   }catch{/* Session-local memory remains available when device storage is blocked. */}
 }
 function confirmedTodayCount(rows){
   const day=today();
   return rows.filter(row=>row?.status==='confirmed'&&row.start_at&&kstParts(row.start_at).ymd===day).length;
 }
 function updateMobileShortcutBadge(count){
   if(!Number.isSafeInteger(count)||count<0)return;
   const entry=document.querySelector('[data-olli-booking-entry]');
   const badge=entry?.querySelector('[data-olli-booking-count]');
   if(!badge)return;
   const value=String(count);
   if(badge.textContent!==value)badge.textContent=value;
   const label='오늘의 상담 예약 현황, 오늘 예약 '+value+'건. 예약 현황 열기';
   if(entry.getAttribute('aria-label')!==label)entry.setAttribute('aria-label',label);
 }
 async function refreshMobileShortcutCount({minIntervalMs=0}={}){
   const dashboard=document.getElementById('recordAcademyDashboard');
   if(!dashboard?.classList.contains('show')||!isOwner()||document.body.classList.contains('olliPcApp'))return;
   const scope=ctx(),day=today(),key=shortcutScope(scope.academyId,day);
   if(!scope.academyId||!scope.sessionToken)return;
   if(mobileShortcutPendingScope===key)return;
   const now=Date.now();
   if(mobileShortcutScopeKey===key && minIntervalMs>0
      && mobileShortcutLastRequestAt>0 && now-mobileShortcutLastRequestAt<minIntervalMs)return;
   mobileShortcutScopeKey=key;
   mobileShortcutLastRequestAt=now;
   mobileShortcutPendingScope=key;
   const requestId=++mobileShortcutRequestId;
   try{
     const result=await manage('list',{month:day.slice(0,7)});
     if(requestId!==mobileShortcutRequestId || ctx().academyId!==scope.academyId
        || ctx().sessionToken!==scope.sessionToken || today()!==day)return;
     if(result?.ok!==true||!Array.isArray(result.appointments))throw new Error('예약 건수 조회 실패');
     const count=confirmedTodayCount(result.appointments);
     rememberMobileShortcutCount(scope.academyId,day,count);
     updateMobileShortcutBadge(count);
   }catch(_error){
     // Local-first: a failed refresh must NEVER blank a previously shown count.
   }finally{
     if(requestId===mobileShortcutRequestId)mobileShortcutPendingScope='';
   }
 }
 function syncMobileShortcut(){
   if(document.body.classList.contains('olliPcApp'))return;
   const dashboard=document.getElementById('recordAcademyDashboard');
   if(!dashboard?.classList.contains('show')){
     if(mobileShortcutVisible){mobileShortcutRequestId++;mobileShortcutPendingScope='';}
     mobileShortcutVisible=false;
     return;
   }
   if(!isOwner())return;
   const scope=ctx(),day=today(),key=shortcutScope(scope.academyId,day);
   const scopeChanged=mobileShortcutScopeKey!==key;
   const inserted=insertMobileShortcut();
   if(inserted && !scopeChanged){
     // Student dashboard innerHTML was replaced. The new card already contains
     // the local count; a DOM-only replacement must not start a new RPC.
     const saved=readMobileShortcutCount(scope.academyId,day);
     if(!saved||Date.now()-saved.checkedAt>=MOBILE_SHORTCUT_REVALIDATE_MS)
       void refreshMobileShortcutCount({minIntervalMs:MOBILE_SHORTCUT_REVALIDATE_MS});
   }
   if(!mobileShortcutVisible||scopeChanged){
     mobileShortcutVisible=true;
     mobileShortcutScopeKey=key;
     void refreshMobileShortcutCount();
   }
 }
 function insertMobileShortcut(){
   if(!isOwner())return false;
   const dashboard=document.getElementById('recordAcademyDashboard');
   // PC student management uses the consultation-records topbar, not this card.
   if(document.body.classList.contains('olliPcApp'))return false;
   if(!dashboard||!dashboard.classList.contains('show')||dashboard.querySelector('[data-olli-booking-entry]'))return false;
   const grid=dashboard.querySelector('.recordAcademyStatGrid');
   if(!grid||grid.children.length!==4)return false;
   const scope=ctx(),saved=readMobileShortcutCount(scope.academyId,today());
   const count=saved?String(saved.count):'–';
   const entry=el('button','obmAcademyEntry');
   entry.type='button';entry.dataset.olliBookingEntry='true';
   entry.innerHTML='<span><strong>오늘의 상담 예약 현황</strong><small>오늘·이번 주 일정 및 예약 관리</small></span><span class="obmAcademyEntryCount" data-olli-booking-count aria-label="오늘 상담 예약 건수">'+count+'</span>';
   if(saved)entry.setAttribute('aria-label','오늘의 상담 예약 현황, 오늘 예약 '+count+'건. 예약 현황 열기');
   entry.addEventListener('click',()=>open('mobile'));
   // Two-column stats: the fifth cell is directly below '올해 등록'.
   grid.appendChild(entry);
   return true;
 }

 let bookingRealtimeWatcher=null;
 let bookingListenersReady=false;
 let mobileLastForegroundRefresh=0;
 function mobileBookingVisible(){
   return state.mode==='mobile'&&state.root?.id==='olliBookingMobileOverlay'
     &&state.root.isConnected&&!state.root.hidden&&isOwner();
 }
 function requestMobileBookingRefresh(){
   if(!mobileBookingVisible())return;
   if(state.mobileScope!==ctx().academyId){
     state.mobileRequest++;
     showOwnerSnapshot();
     render();
   }
   if(state.busy||hasActiveBookingModal()){state.mobileNeedsRefresh=true;return;}
   void refreshMobileBooking();
 }
 function initBookingRealtime(){
   if(document.body.classList.contains('olliPcApp'))return;
   if(!bookingRealtimeWatcher&&typeof global.OlliRealtime?.watchDomain==='function'){
     // Extends the existing academy session channel; booking rows are never
     // published in the broadcast.
     bookingRealtimeWatcher=global.OlliRealtime.watchDomain('booking',async ({academyId,isCurrent})=>{
       if(!isOwner()||academyId!==ctx().academyId)return true;
       if(!mobileBookingVisible()){
         void refreshMobileShortcutCount({minIntervalMs:0});
         void global.OlliConsultationReminders?.refresh?.({force:true});
         return true;
       }
       if(state.busy||hasActiveBookingModal()){
         state.mobileNeedsRefresh=true;
         return true;
       }
       const updated=await refreshMobileBooking();
       if(updated)void global.OlliConsultationReminders?.refresh?.({force:true});
       return updated&&isCurrent();
     });
   }
   if(bookingListenersReady)return;
   bookingListenersReady=true;
   const resumeBooking=()=>{
     if(document.hidden||!mobileBookingVisible())return;
     if(Date.now()-mobileLastForegroundRefresh<20000)return;
     mobileLastForegroundRefresh=Date.now();
     requestMobileBookingRefresh();
   };
   document.addEventListener('visibilitychange',resumeBooking);
   global.addEventListener?.('focus',resumeBooking);
   global.addEventListener?.('online',resumeBooking);
   global.addEventListener?.('olli:booking-changed',requestMobileBookingRefresh);
   global.addEventListener?.('olli:realtime-status',event=>{
     if(!mobileBookingVisible())return;
     if(event?.detail?.academyId!==ctx().academyId){
       state.mobileRequest++;
       showOwnerSnapshot();
       render();
       void refreshMobileBooking();
     }
   });
 }
 function initMobileShortcut(){
   initBookingRealtime();
   const root=document.getElementById('recordAcademyDashboard');
   if(!root||state.entryObserver)return;
   state.entryObserver=new MutationObserver(()=>syncMobileShortcut());
   state.entryObserver.observe(root,{attributes:true,attributeFilter:['class'],childList:true});
   const resume=()=>{
     if(document.hidden)return;
     const dashboard=document.getElementById('recordAcademyDashboard');
     if(dashboard?.classList.contains('show')){
       syncMobileShortcut();
       void refreshMobileShortcutCount({minIntervalMs:MOBILE_SHORTCUT_RESUME_THROTTLE_MS});
     }
   };
   document.addEventListener('visibilitychange',resume);
   global.addEventListener?.('focus',resume);
   // Local admin changes can request fresh data without waiting for a timer.
   global.addEventListener?.('olli:booking-changed',()=>{void refreshMobileShortcutCount();});
   syncMobileShortcut();
 }
 global.OlliBookingDashboard=Object.freeze({open,close,refresh,copyPublicLink,initMobileShortcut});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initMobileShortcut,{once:true});
 else initMobileShortcut();
})(window);
