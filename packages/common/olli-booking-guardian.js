/* Public academy-wide guardian booking site. All session credentials remain in memory,
 * never in URL, analytics, localStorage or cookies. No external scripts or pixels.
 */
(function(global){
 'use strict';
 const root=global.document.getElementById('olliGuardianBooking');
 if(!root)return;
 const KST='Asia/Seoul';
 const slug=String(new URLSearchParams(global.location.search).get('academy')||'');
 const state={phase:'identify',name:'',phone:'',challengeId:'',
   session:'',month:'',day:'',start:'',slots:[],reservation:null,canReschedule:false,
   canCancel:false,loading:false,message:'',error:'',expiresAt:0};
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
    OTP_INVALID:'인증번호가 올바르지 않거나 만료되었습니다. 다시 확인해 주세요.',
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
  return '<header class="ogbBrand"><strong>OLLI</strong><span>학원 상담 예약</span></header>';
 }
 function identifyHtml(){
  return '<section class="ogbPanel"><div class="ogbEyebrow">상담 예약</div><h1>학생 정보를 확인할게요</h1>'+
   '<p class="ogbMuted">올리에 등록된 학생 이름과 보호자 휴대전화번호를 입력해 주세요.</p>'+
   '<form id="ogbIdentify" class="ogbForm" autocomplete="off">'+
   '<label>학생 이름<input name="student_name" type="text" maxlength="60" required placeholder="학생의 이름" autocomplete="off" value="'+esc(state.name)+'"></label>'+
   '<label>보호자 휴대전화번호<input name="guardian_phone" type="tel" inputmode="tel" maxlength="15" required placeholder="01012345678" autocomplete="tel" value="'+esc(state.phone)+'"></label>'+
   '<p class="ogbNote"><strong>비비작 채널 알림톡을 받고 계신 휴대전화번호를 입력해 주세요.</strong> 올리에 등록된 번호로 인증문자가 발송됩니다. 이름과 전화번호만으로는 예약이 열리지 않으며 인증번호 확인이 필요합니다.</p>'+
   '<button class="ogbPrimary" type="submit" '+(state.loading?'disabled':'')+'>'+(state.loading?'확인 중…':'인증번호 받기')+'</button>'+
   '</form></section>';
 }
 function otpHtml(){
  return '<section class="ogbPanel"><div class="ogbEyebrow">보호자 확인</div><h1>인증번호를 입력해 주세요</h1>'+
    '<p class="ogbMuted">올리에 등록된 보호자 번호로 6자리 문자를 전송합니다. 도착하지 않는다면 학원에 등록된 연락처를 확인해 주세요.</p>'+
    '<form id="ogbVerify" class="ogbForm"><label>6자리 인증번호<input name="otp" type="text" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required placeholder="인증번호 6자리"></label>'+
    '<button type="submit" class="ogbPrimary" '+(state.loading?'disabled':'')+'>'+(state.loading?'확인 중…':'본인 확인')+'</button></form>'+
    '<button type="button" class="ogbTextBtn" data-action="restart">다시 입력하기</button></section>';
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
     const disabled=day<today()||day>maxDate();
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
   if(!state.slots.length)return '<p class="ogbMuted">선택한 날짜에 예약 가능한 시간이 없습니다. 다른 날짜를 선택해 주세요.</p>';
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
  const res=state.reservation;
  const modifying=state.phase==='change';
  return '<section class="ogbPanel"><div class="ogbEyebrow">'+(res?'예약 확인':'상담 일정 선택')+'</div>'+
   '<h1>'+(modifying?'상담 일정 변경':res?'예약이 완료되었습니다':'상담 날짜를 골라 주세요')+'</h1>'+
   (res?reservationHtml():'')+
   (res&&!modifying?'<p class="ogbMuted">예약을 변경하거나 취소하려면 아래 버튼을 선택해 주세요.</p>'+
     '<div class="ogbActions">'+(state.canReschedule?'<button type="button" class="ogbPrimary" data-action="change">예약 변경</button>':'')+
     (state.canCancel?'<button type="button" class="ogbSecondary" data-action="cancel">예약 취소</button>':'')+'</div>':
     '<p class="ogbMuted">원하는 날짜를 누르면 예약 가능한 시간을 확인할 수 있습니다.</p>'+
     calendarHtml()+
     '<h2 class="ogbSubheading">'+(state.day?esc(label(state.day))+' · 시간 선택':'예약 시간 선택')+'</h2>'+
     slotsHtml()+
     '<div class="ogbActions"><button class="ogbPrimary" type="button" data-action="commit" '+(!state.start||state.loading?'disabled':'')+'>'+
       (state.loading?'처리 중…':modifying?'변경 저장':'상담 예약하기')+'</button>'+
       (modifying?'<button type="button" class="ogbSecondary" data-action="back">돌아가기</button>':'')+'</div>'
   )+
   '<button type="button" class="ogbTextBtn" data-action="restart">학생 확인 처음부터</button></section>';
 }
 function render(){
   const content=state.phase==='identify'?identifyHtml():
       state.phase==='otp'?otpHtml():bookingHtml();
   root.innerHTML=header()+content+(state.error?info(state.error,'error'):'')+
    (state.message?info(state.message):'')+
    '<footer class="ogbFooter">예약이 어려우시다면 학원으로 문의해 주세요.</footer>';
 }
 function reset(){
   state.session='';state.challengeId='';state.reservation=null;state.slots=[];
   state.start='';state.day='';state.phase='identify';state.error='';state.message='';
   render();
 }
 async function loadSnapshot(){
   const r=await api('/api/olli-booking',{action:'snapshot',token:state.session});
   state.reservation=r.reservation||null;
   state.canReschedule=r.can_reschedule===true;state.canCancel=r.can_cancel===true;
   state.phase='booking';state.day='';state.start='';state.slots=[];
   state.month=state.reservation?koreaDate(new Date(state.reservation.start_at)).date.slice(0,7):today().slice(0,7);
 }
 async function available(date){
   state.day=date;state.start='';state.loading=true;state.error='';state.message='';
   render();
   try{
     const r=await api('/api/olli-booking',{action:'slots',token:state.session,date});
     if(state.day!==date)return;
     state.slots=Array.isArray(r.slots)?r.slots:[];
   }catch(err){state.slots=[];state.error=explain(err.message);}
   finally{state.loading=false;render();}
 }
 async function mutate(){
   const editing=state.phase==='change';
   if(!state.start||state.loading)return;
   const action=editing?'reschedule':'reserve';
   if(!global.confirm((editing?'변경한':'선택한')+' 일정으로 상담 예약을 저장하시겠습니까?'))return;
   const payload={action,token:state.session,start_at:state.start,request_key:global.crypto.randomUUID()};
   if(editing)payload.reservation_id=state.reservation?.id;
   state.loading=true;state.error='';state.message='';render();
   try{
     await api('/api/olli-booking',payload);
     await loadSnapshot();
     state.message=editing?'예약 시간을 변경했습니다.':'상담 예약이 완료되었습니다.';
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
     await loadSnapshot();state.message='예약을 취소했습니다.';
   }catch(e){state.error=explain(e.message);}
   finally{state.loading=false;render();}
 }
 root.addEventListener('submit',async event=>{
   event.preventDefault();if(state.loading)return;
   const form=event.target;
   if(form.id==='ogbIdentify'){
     const data=new global.FormData(form);
     state.name=String(data.get('student_name')||'').trim();
     state.phone=String(data.get('guardian_phone')||'').trim();
     state.loading=true;state.error='';state.message='';render();
     try{
       const r=await api('/api/olli-booking-public',{action:'begin',academy:slug,
         student_name:state.name,guardian_phone:state.phone});
       state.challengeId=r.challenge_id;state.phase='otp';
     }catch(e){state.error=explain(e.message);}
     finally{state.loading=false;render();}
   }
   if(form.id==='ogbVerify'){
     const code=String(new global.FormData(form).get('otp')||'').trim();
     state.loading=true;state.error='';render();
     try{
       const r=await api('/api/olli-booking-public',{action:'verify',
         challenge_id:state.challengeId,code});
       state.session=r.session_token;
       await loadSnapshot();
     }catch(e){state.error=explain(e.message);}
     finally{state.loading=false;render();}
   }
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
   case 'change':state.phase='change';state.start='';state.day='';state.slots=[];render();break;
   case 'back':state.phase='booking';state.start='';state.day='';state.slots=[];render();break;
   case 'commit':await mutate();break;
   case 'cancel':await cancel();break;
   }
 });
 if(!/^[0-9a-f]{36}$/.test(slug)){state.error='올바른 학원 상담 예약 주소가 아닙니다.';}
 state.month=today().slice(0,7);
 render();
 global.OlliGuardianBooking=Object.freeze({parseAcademy:()=>slug});
})(window);
