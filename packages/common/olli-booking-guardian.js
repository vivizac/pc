/* Public academy-wide guardian booking site. All session credentials remain in memory,
 * never in URL, analytics, localStorage or cookies. No external scripts or pixels.
 */
(function(global){
 'use strict';
 const root=global.document.getElementById('olliGuardianBooking');
 if(!root)return;
 const KST='Asia/Seoul';
 const slug=String(new URLSearchParams(global.location.search).get('academy')||'');
 const state={phase:'booking',name:'',phone:'',
   session:'',month:'',day:'',start:'',slots:[],reservation:null,canReschedule:false,
   canCancel:false,loading:false,message:'',error:'',expiresAt:0,
   academyName:'',weeks:[2,3],weekdays:[1,2,3,4,5],slotStatus:'idle',demo:false};
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function koreaDate(date=new Date()){
  const p=new Intl.DateTimeFormat('en-US',{timeZone:KST,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const m=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return {date:m.year+'-'+m.month+'-'+m.day,hm:m.hour+':'+m.minute};
 }
 const today=()=>koreaDate().date;
 function maxDate(){const d=new Date(today()+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+120);return d.toISOString().slice(0,10);}
 function monthShift(month,n){const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1+n,1)).toISOString().slice(0,7);}
 function label(date){if(!date)return '';const [y,m,d]=date.split('-').map(Number);return new Intl.DateTimeFormat('ko-KR',{timeZone:KST,month:'long',day:'numeric',weekday:'short'}).format(new Date(Date.UTC(y,m-1,d,3)));}
 function info(text,kind=''){return '<p class="ogbNotice '+(kind==='error'?'isError':'')+'" role="status">'+esc(text)+'</p>';}
 async function api(endpoint,body){
  const res=await global.fetch(endpoint,{method:'POST',mode:'same-origin',credentials:'omit',
    cache:'no-store',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)});
  const result=await res.json().catch(()=>({}));
  if(!res.ok||result?.ok!==true)throw new Error(result.code||'REQUEST_FAILED');
  return result;
 }
 function explain(code){
  const map={
    FORM_INVALID:'입력한 학생 정보와 연락처를 확인해 주세요.',
    DATABASE_NOT_CONFIGURED:'상담 예약 서버가 연결되지 않았습니다. 학원에 문의해 주세요.',
    ACADEMY_NOT_FOUND:'학원 예약 링크가 올바르지 않습니다. 학원에 문의해 주세요.',
    DEMO_NOT_BOOKABLE:'화면 확인용 미리보기에서는 실제 예약이 저장되지 않습니다.',
    MATCH_NOT_FOUND:'학생 이름 또는 보호자 휴대전화번호가 올바르지 않습니다. 다시 입력해 주세요.',
    TOO_MANY_ATTEMPTS:'예약 시도가 많습니다. 잠시 후 다시 시도해 주세요.',
    ACCESS_DENIED:'인증이 만료되었습니다. 학생 확인부터 다시 진행해 주세요.',
    SLOT_UNAVAILABLE:'해당 시간은 다른 예약으로 마감되었습니다. 다른 시간을 선택해 주세요.',
    BOOKING_INVALID:'예약 가능 기간이나 시간을 다시 확인해 주세요.',
    SERVER_NOT_CONFIGURED:'예약 서비스 연결 준비 중입니다. 학원에 문의해 주세요.',
    AUTH_NOT_CONFIGURED:'인증 서비스 준비 중입니다. 학원에 문의해 주세요.',
    BOOKING_NOT_AVAILABLE:'일시적으로 예약 정보를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.',
    BOOKING_CONFLICT:'예약 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.'
  };return map[code]||'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
 }
 function header(){
  return '<header class="ogbBrand"><strong>'+esc(state.academyName||'학원명 확인 중')+'</strong><span>상담 예약</span></header>';
 }
 function contactHtml(){
  if(state.session)return '';
  return '<div class="ogbContact">'+
   '<label>학생 이름<input name="student_name" type="text" maxlength="60" required placeholder="학생 이름" autocomplete="off" value="'+esc(state.name)+'"></label>'+
   '<label>보호자 휴대전화번호<input name="guardian_phone" type="tel" inputmode="tel" maxlength="15" required placeholder="01012345678" autocomplete="tel" value="'+esc(state.phone)+'"></label>'+
   '<p class="ogbNote">비비작 채널 알림톡을 받고 계신 휴대전화번호를 입력해 주세요.</p></div>';
 }
 function allowedDay(day){
  const [y,m,n]=day.split('-').map(Number);
  const dt=new Date(Date.UTC(y,m-1,n));
  const iso=(dt.getUTCDay()+6)%7+1;
  const first=new Date(Date.UTC(y,m-1,1));
  const week=Math.floor((n-1+(first.getUTCDay()+6)%7)/7)+1;
  return state.weeks.includes(week)&&state.weekdays.includes(iso);
 }
 function firstBookableMonth(){
  const base=new Date(today()+'T00:00:00Z');
  for(let i=0;i<=120;i++){
   const next=new Date(base);next.setUTCDate(base.getUTCDate()+i);
   const day=next.toISOString().slice(0,10);
   if(allowedDay(day))return day.slice(0,7);
  }
  return today().slice(0,7);
 }
 function calendarHtml(){
   const [y,m]=state.month.split('-').map(Number);
   const days=new Date(Date.UTC(y,m,0)).getUTCDate();
   const pad=(new Date(Date.UTC(y,m-1,1)).getUTCDay()+6)%7;
   const heads=['월','화','수','목','금','토','일'].map(d=>'<span>'+d+'</span>').join('');
   const blanks=Array.from({length:pad},()=>'<i aria-hidden="true"></i>').join('');
   let cells='';
   for(let n=1;n<=days;n++){
     const day=state.month+'-'+String(n).padStart(2,'0');
     const disabled=day<today()||day>maxDate()||!allowedDay(day);
     cells+='<button type="button" data-date="'+day+'" '+(disabled?'disabled':'')+
      ' class="'+(state.day===day?'selected':'')+'" aria-pressed="'+(state.day===day)+'">'+n+'</button>';
   }
   return '<div class="ogbMonth"><button type="button" data-action="prev" aria-label="이전 달" '+(state.month<=today().slice(0,7)?'disabled':'')+'>‹</button>'+
     '<strong>'+esc(state.month.slice(0,4))+'년 '+Number(state.month.slice(5))+'월</strong>'+
     '<button type="button" data-action="next" aria-label="다음 달" '+(monthShift(state.month,1)>maxDate().slice(0,7)?'disabled':'')+'>›</button></div>'+
     '<div class="ogbCalendar" aria-label="예약 날짜 선택">'+heads+blanks+cells+'</div>';
 }
 function slotsHtml(){
   if(!state.day)return '<p class="ogbMuted">먼저 상담 날짜를 선택해 주세요.</p>';
   if(state.loading)return '<p class="ogbMuted">예약 가능한 시간을 확인하는 중입니다.</p>';
   if(state.slotStatus==='error')return '<p class="ogbMuted">예약 시간 정보를 불러오지 못했습니다. 아래 오류 안내를 확인해 주세요.</p>';
   if(!state.slots.length)return '<p class="ogbMuted">이 날짜에는 예약 가능한 시간이 없습니다. 다른 예약 가능일을 선택해 주세요.</p>';
   return '<div class="ogbSlots">'+state.slots.map(slot=>{
     const d=koreaDate(new Date(slot.start_at));
     return '<button type="button" data-start="'+esc(slot.start_at)+'" class="'+(state.start===slot.start_at?'selected':'')+
       '" aria-pressed="'+(state.start===slot.start_at)+'">'+d.hm+'</button>';
   }).join('')+'</div>';
 }
 function reservationHtml(){
  const r=state.reservation;if(!r)return '';
  const d=koreaDate(new Date(r.start_at));
  return '<div class="ogbReserved"><strong>현재 예약</strong><p>'+esc(label(d.date))+' · '+esc(d.hm)+'</p></div>';
 }
 function bookingHtml(){
  const res=state.reservation,modifying=state.phase==='change';
  return '<section class="ogbPanel"><div class="ogbEyebrow">상담 예약</div>'+
   '<h1>'+(modifying?'상담 일정 변경':res?'예약이 완료되었습니다':'상담 예약')+'</h1>'+
   (state.demo?'<p class="ogbPreviewNote">화면 확인용 미리보기입니다. 표시된 시간은 예시이며 예약은 저장되지 않습니다.</p>':'')+
   (res?reservationHtml():'')+
   (res&&!modifying?'<p class="ogbMuted">예약을 변경하거나 취소하려면 아래 버튼을 선택해 주세요.</p>'+
     '<div class="ogbActions">'+(state.canReschedule?'<button type="button" class="ogbPrimary" data-action="change">예약 변경</button>':'')+
     (state.canCancel?'<button type="button" class="ogbSecondary" data-action="cancel">예약 취소</button>':'')+'</div>':
     contactHtml()+
     '<h2 class="ogbSubheading ogbSectionHeading">날짜 선택</h2>'+
     '<p class="ogbCalendarHint">학원에서 정한 상담 요일만 선택할 수 있습니다.</p>'+
     calendarHtml()+
     '<h2 class="ogbSubheading">'+(state.day?esc(label(state.day))+' · 시간 선택':'시간 선택')+'</h2>'+
     slotsHtml()+
     '<div class="ogbActions"><button class="ogbPrimary" type="button" data-action="commit" '+(!state.start||state.loading?'disabled':'')+'>'+
       (state.loading?'처리 중…':modifying?'변경 저장':'상담 예약하기')+'</button>'+
       (modifying?'<button type="button" class="ogbSecondary" data-action="back">돌아가기</button>':'')+'</div>'
   )+
   (res?'<button type="button" class="ogbTextBtn" data-action="restart">다른 상담 예약하기</button>':'')+
   '</section>';
 }
 function render(){
   root.innerHTML=header()+(state.phase==='invalid'?
    '<section class="ogbPanel"><h1>상담 예약 주소를 확인해 주세요</h1></section>':bookingHtml())+
    (state.error?info(state.error,'error'):'')+(state.message?info(state.message):'')+
    '<footer class="ogbFooter">예약이 어려우시다면 학원으로 문의해 주세요.</footer>';
 }
 function reset(){
   state.session='';state.name='';state.phone='';state.reservation=null;state.slots=[];
   state.start='';state.day='';state.month=firstBookableMonth();state.phase='booking';state.slotStatus='idle';
   state.error='';state.message='';render();
 }
 async function loadSnapshot(){
   const r=await api('/api/olli-booking',{action:'snapshot',token:state.session});
   state.reservation=r.reservation||null;
   state.canReschedule=r.can_reschedule===true;state.canCancel=r.can_cancel===true;
   state.phase='booking';state.day='';state.start='';state.slots=[];state.slotStatus='idle';
   state.month=state.reservation?koreaDate(new Date(state.reservation.start_at)).date.slice(0,7):today().slice(0,7);
 }
 async function available(date){
   state.day=date;state.start='';state.loading=true;state.slotStatus='loading';state.error='';state.message='';
   render();
   try{
     const r=state.session?
      await api('/api/olli-booking',{action:'slots',token:state.session,date}):
      await api('/api/olli-booking-public',{action:'slots',academy:slug,date});
     if(state.day!==date)return;
     state.slots=Array.isArray(r.slots)?r.slots:[];state.slotStatus='loaded';
   }catch(err){state.slots=[];state.slotStatus='error';state.error=explain(err.message);}
   finally{state.loading=false;render();}
 }
 async function mutate(){
   const editing=state.phase==='change';
   if(!state.start||state.loading)return;
   if(!state.session){
     const name=root.querySelector('[name="student_name"]');
     const phone=root.querySelector('[name="guardian_phone"]');
     if(!name?.reportValidity()||!phone?.reportValidity())return;
     state.name=name.value.trim();state.phone=phone.value.trim();
     if(!state.name||!state.phone)return;
   }
   if(!global.confirm((editing?'변경한':'선택한')+' 일정으로 상담 예약을 저장하시겠습니까?'))return;
   const payload={action:editing?'reschedule':'reserve',start_at:state.start,
     request_key:global.crypto.randomUUID()};
   state.loading=true;state.error='';state.message='';render();
   try{
     if(!state.session){
       const r=await api('/api/olli-booking-public',{
         ...payload,academy:slug,student_name:state.name,guardian_phone:state.phone});
       state.session=r.session_token;
       await loadSnapshot();
       state.message=r.existing?'이미 예약된 상담이 있습니다. 예약 내용을 확인해 주세요.':
         '상담 예약이 완료되었습니다.';
     }else{
       payload.token=state.session;
       if(editing)payload.reservation_id=state.reservation?.id;
       await api('/api/olli-booking',payload);
       await loadSnapshot();
       state.message=editing?'예약 시간을 변경했습니다.':'상담 예약이 완료되었습니다.';
     }
   }catch(e){state.error=explain(e.message);}
   finally{state.loading=false;render();}
 }
 async function cancel(){
   if(!state.reservation||!state.canCancel||state.loading)return;
   if(!global.confirm('현재 상담 예약을 취소하시겠습니까?'))return;
   state.loading=true;state.error='';render();
   try{
     await api('/api/olli-booking',{action:'cancel',token:state.session,
       reservation_id:state.reservation.id,request_key:global.crypto.randomUUID()});
     await loadSnapshot();
     // A fresh booking after cancellation must match name and phone again.
     state.session='';state.name='';state.phone='';state.month=firstBookableMonth();
     state.message='예약을 취소했습니다.';
   }catch(e){state.error=explain(e.message);}
   finally{state.loading=false;render();}
 }
 root.addEventListener('input',event=>{
  if(event.target?.name==='student_name')state.name=event.target.value;
  if(event.target?.name==='guardian_phone')state.phone=event.target.value;
 });
 root.addEventListener('click',async event=>{
   const node=event.target.closest('[data-action],[data-date],[data-start]');
   if(!node||state.loading)return;
   if(node.hasAttribute('data-date')){await available(node.dataset.date);return;}
   if(node.hasAttribute('data-start')){state.start=node.dataset.start;render();return;}
   switch(node.dataset.action){
   case 'restart':reset();break;
   case 'prev':state.month=monthShift(state.month,-1);state.day='';state.start='';state.slots=[];render();break;
   case 'next':state.month=monthShift(state.month,1);state.day='';state.start='';state.slots=[];render();break;
   case 'change':state.phase='change';state.start='';state.day='';state.slots=[];state.slotStatus='idle';render();break;
   case 'back':state.phase='booking';state.start='';state.day='';state.slots=[];render();break;
   case 'commit':await mutate();break;
   case 'cancel':await cancel();break;
   }
 });
 if(!/^[0-9a-f]{36}$/.test(slug)){state.phase='invalid';state.error='올바른 학원 상담 예약 주소가 아닙니다.';}
 state.month=today().slice(0,7);
 render();
 if(state.phase!=='invalid'){
  api('/api/olli-booking-public',{action:'info',academy:slug}).then(r=>{
    state.academyName=String(r.academy_name||'').trim();
    state.weeks=Array.isArray(r.weeks)?r.weeks:[2,3];
    state.weekdays=Array.isArray(r.weekdays)?r.weekdays:[1,2,3,4,5];
    state.demo=r.demo===true;
    if(!state.day&&!state.reservation)state.month=firstBookableMonth();
    render();
  }).catch(e=>{state.academyName='학원명 확인 불가';state.error=explain(e.message);render();});
 }

 global.OlliGuardianBooking=Object.freeze({parseAcademy:()=>slug});
})(window);
