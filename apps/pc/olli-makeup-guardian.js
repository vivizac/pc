/* Guardian makeup registration and confirmation.
 * Reference: original consultation-booking.html + olli-booking-guardian.css.
 * No student roster is sent to the browser before a confirmed guardian-phone match.
 */
(function(global){
  'use strict';
  const root=global.document.getElementById('olliMakeupBooking');
  if(!root)return;
  const slug=String(new URLSearchParams(global.location.search).get('academy')||'');
  const KST='Asia/Seoul';
  const state={
    ready:false,academy:'',phase:'choice',mode:'apply',
    name:'',phone:'',result:null,token:'',student:'',
    snapshot:null,absenceMonth:'',absenceDay:'',absenceOpen:false,
    weekStart:'',weekSlots:[],selectedWeekDay:'',weekLoading:false,loading:false,
    error:'',absences:[],makeups:[],requestKey:''
  };
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:KST,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  function koreaToday(){
    const p=new Intl.DateTimeFormat('en-US',{timeZone:KST,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const x=Object.fromEntries(p.map(v=>[v.type,v.value]));
    return x.year+'-'+x.month+'-'+x.day;
  }
  function afterDays(date,amount){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+amount);return d.toISOString().slice(0,10);}
  function shiftMonth(month,amount){const a=month.split('-').map(Number);return new Date(Date.UTC(a[0],a[1]-1+amount,1)).toISOString().slice(0,7);}
  function mondayOf(date){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);}
  function dateLabel(date){
    if(!date)return '';
    return new Intl.DateTimeFormat('ko-KR',{timeZone:KST,month:'long',day:'numeric',weekday:'short'})
      .format(new Date(date+'T12:00:00Z'));
  }
  function itemKey(x){return [x.date,Number(x.time_slot),x.group].join('|');}
  function detail(x){
    return dateLabel(x.date)+' · '+(x.label?String(x.label):String(x.time_slot)+'시')+
      (x.group==='B'?' · B반':'');
  }
  function message(err){
    const m={
      FORM_INVALID:'학생 정보 또는 선택한 날짜를 확인해 주세요.',
      MATCH_NOT_FOUND:'등록된 학생 이름과 보호자 휴대전화번호가 일치하지 않습니다. 학원에 문의해 주세요.',
      NAME_AMBIGUOUS:'같은 검색어에 해당하는 학생이 여러 명입니다. 학생 이름을 끝까지 입력해 주세요.',
      TOO_MANY_ATTEMPTS:'확인 요청이 많습니다. 잠시 후 다시 시도해 주세요.',
      ACCESS_DENIED:'확인 시간이 만료되었습니다. 학생 확인부터 다시 진행해 주세요.',
      ABSENCE_INVALID:'결석 예정일의 정규 수업을 확인할 수 없습니다. 날짜를 다시 선택해 주세요.',
      MAKEUP_CREDIT_REQUIRED:'보강은 등록된 결석 또는 선택한 결석 예정 횟수만큼 신청할 수 있습니다.',
      SLOT_UNAVAILABLE:'선택한 보강 수업의 빈자리가 없어졌습니다. 다른 시간을 선택해 주세요.',
      SLOT_CONFLICT:'선택한 보강 시간에 이미 다른 수업이 있습니다.',
      REQUEST_CONFLICT:'신청 내용이 변경되었습니다. 다시 확인해 주세요.',
      SERVICE_UNAVAILABLE:'현재 신청 서버를 이용할 수 없습니다. 학원에 문의해 주세요.',
      NETWORK_FAILED:'인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
      ACADEMY_NOT_FOUND:'올바르지 않은 학원 링크입니다. 학원에 문의해 주세요.'
    };
    return m[String(err?.message||'')]||'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
  async function api(action,body={}){
    let response,result;
    try{
      response=await global.fetch('/api/olli-makeup-public',{
        method:'POST',mode:'cors',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action,academy:slug,...body})
      });
      result=await response.json();
    }catch{throw new Error('NETWORK_FAILED');}
    if(!response.ok||result?.ok!==true)throw new Error(result?.code||'SERVICE_UNAVAILABLE');
    return result;
  }
  function failBox(){
    return state.error?'<p class="ogbNotice isError ombError" role="alert">'+esc(state.error)+'</p>':'';
  }
  function shell(title,description,inner){
    root.innerHTML='<div class="ombHeader"><strong>'+esc(state.academy)+'</strong>'+
      '<small>보강 수업 안내</small></div><section class="ogbPanel ombPanel">'+
      '<div class="ogbTitleBand"><h1>'+esc(title)+'</h1></div>'+
      (description?'<p class="ogbMuted">'+esc(description)+'</p>':'')+
      failBox()+inner+'</section><p class="ogbFooter">비비작아이성향미술학원 · 학부모 전용</p>';
  }
  function absenceCalendar(){
    const month=state.absenceMonth;
    const [y,m]=month.split('-').map(Number);
    const first=new Date(Date.UTC(y,m-1,1)),count=new Date(Date.UTC(y,m,0)).getUTCDate();
    const min=koreaToday(),max=afterDays(min,90);
    const active=new Set((state.snapshot?.regular||[]).map(x=>x.date));
    let cells=['일','월','화','수','목','금','토'].map(x=>'<span>'+x+'</span>').join('');
    cells+='<i aria-hidden="true"></i>'.repeat(first.getUTCDay());
    for(let day=1;day<=count;day++){
      const date=month+'-'+String(day).padStart(2,'0');
      const allowed=date>=min&&date<=max&&active.has(date);
      const selected=state.absences.some(x=>x.date===date);
      const focused=state.absenceDay===date;
      cells+='<button type="button" data-action="abs-date" data-date="'+date+'" '+
        (allowed?'':'disabled')+' class="'+(selected||focused?'selected ':'')+
        (active.has(date)?'hasLesson ':'')+
        (new Date(Date.UTC(y,m-1,day)).getUTCDay()===0?'sunday':'')+
        '" aria-pressed="'+(selected||focused)+'">'+day+'</button>';
    }
    return '<div class="ogbMonth">'+
      '<button type="button" aria-label="결석 이전 달" data-action="absence-prev" '+
        (month<=min.slice(0,7)?'disabled':'')+'>‹</button>'+
      '<strong>'+y+'년 '+m+'월</strong>'+
      '<button type="button" aria-label="결석 다음 달" data-action="absence-next" '+
        (shiftMonth(month,1)>max.slice(0,7)?'disabled':'')+'>›</button></div>'+
      '<div class="ogbCalendar ombCalendar" aria-label="결석 예정일 달력">'+cells+'</div>';
  }
  function chosen(kind){
    const isAbs=kind==='absence',list=isAbs?state.absences:state.makeups;
    if(!list.length)return '<p class="ombMuted">아직 선택한 일정이 없습니다.</p>';
    return '<div class="ombDateList">'+list.slice().sort((a,b)=>itemKey(a).localeCompare(itemKey(b)))
      .map(x=>'<span class="ombDateChip '+(isAbs?'isAbsence':'')+'">'+esc(detail(x))+
        '<button type="button" data-action="'+(isAbs?'remove-absence':'remove-makeup')+
        '" data-item="'+esc(itemKey(x))+'" aria-label="선택 해제">×</button></span>').join('')+'</div>';
  }
  function absentList(){
    if(!state.absenceDay)return '<p class="ombMuted">결석 예정 날짜를 선택해 주세요.</p>';
    const already=new Set((state.snapshot?.absences||[]).map(itemKey));
    const lessons=(state.snapshot?.regular||[]).filter(x=>x.date===state.absenceDay);
    return '<h3 class="ogbSubheading">'+esc(dateLabel(state.absenceDay))+' 정규 수업</h3>'+
      '<div class="ogbSlots ombSlots">'+lessons.map(x=>{
        const key=itemKey(x),exists=already.has(key);
        return '<button type="button" data-action="toggle-absence" data-item="'+esc(key)+
          '" class="'+(state.absences.some(s=>itemKey(s)===key)?'selected':'')+
          '" '+(exists?'disabled':'')+' aria-pressed="'+state.absences.some(s=>itemKey(s)===key)+'">'+
          esc(x.label||String(x.time_slot)+'시')+(x.group==='B'?' · B반':'')+
          (exists?' · 결석 등록됨':'')+'</button>';
      }).join('')+'</div>';
  }
  function mobileDayCards(start,weekday,statusLabel){
    const selected=state.selectedWeekDay||koreaToday();
    const max=afterDays(koreaToday(),90);
    const dayPicker='<div class="ombMobileDayPicker" role="group" aria-label="보강 날짜 선택">'+
      weekday.map((name,i)=>{
        const date=afterDays(start,i);
        const disabled=date<koreaToday()||date>max;
        const picked=date===selected;
        return '<button type="button" data-action="select-week-day" data-date="'+date+'" '+
          (disabled?'disabled':'')+' class="ombMobileDay '+(picked?'isCurrent':'')+
          '" aria-pressed="'+picked+'" aria-label="'+esc(dateLabel(date))+'">'+
          '<small>'+name+'</small><strong>'+Number(date.slice(-2))+'</strong></button>';
      }).join('')+'</div>';
    const slots=state.weekSlots.filter(x=>x.date===selected);
    let cards='';
    if(state.weekLoading){
      cards='<p class="ombMobileEmpty" role="status">수업 시간을 확인하고 있습니다.</p>';
    }else if(!slots.length){
      cards='<p class="ombMobileEmpty">이 날짜에는 신청 가능한 수업이 없습니다. 다른 날짜를 선택해 주세요.</p>';
    }else{
      cards=slots.map(slot=>{
        const key=itemKey(slot);
        const picked=state.makeups.some(x=>itemKey(x)===key);
        const status=slot.status||'unavailable';
        const canChoose=status==='available'||picked;
        const title=(slot.label||String(slot.time_slot)+'시')+(slot.group==='B'?' · B반':'');
        return '<button type="button" class="ombMobileClass '+(picked?'isSelected':'is'+status)+
          '" data-action="toggle-week-makeup" data-item="'+esc(key)+'" '+
          (canChoose?'':'disabled')+' aria-pressed="'+picked+'" aria-label="'+
          esc(dateLabel(selected)+' '+title+' '+(picked?'선택됨':statusLabel[status]||'보강 불가'))+'">'+
          '<span class="ombMobileClassTime"><span class="ombMobileClassIcon" aria-hidden="true">'+
          (picked?'✓':'◷')+'</span><strong>'+esc(title)+'</strong></span>'+
          '<span class="ombMobileClassStatus">'+esc(picked?'선택됨':statusLabel[status]||'보강 불가')+'</span>'+
          '</button>';
      }).join('');
    }
    return '<div class="ombMobileWeek" aria-label="모바일 보강 수업 날짜·시간 선택">'+
      dayPicker+'<div class="ombMobileSelectedDate"><strong>'+esc(dateLabel(selected))+
      '</strong></div><div class="ombMobileClassList">'+cards+'</div></div>';
  }
  function weekTimetable(){
    const start=state.weekStart||mondayOf(koreaToday());
    const first=mondayOf(koreaToday());
    const last=mondayOf(afterDays(koreaToday(),90));
    const end=afterDays(start,5);
    const weekday=['월','화','수','목','금','토'];
    const shortLabel=date=>{
      const bits=date.split('-');
      return Number(bits[1])+'/'+Number(bits[2]);
    };
    const heads='<div class="ombWeekNav">'+
      '<button type="button" data-action="week-prev" aria-label="이전 주" '+
        (start<=first?'disabled':'')+'>‹</button>'+
      '<strong>'+esc(dateLabel(start))+' ~ '+esc(dateLabel(end))+'</strong>'+
      '<button type="button" data-action="week-next" aria-label="다음 주" '+
        (start>=last?'disabled':'')+'>›</button></div>';
    const statusLabel={
      available:'보강 가능',prebooked:'선예약 중',unavailable:'보강 불가',
      own:'기존 수업',closed:'휴원',past:'신청 불가'
    };
    const mobile=mobileDayCards(start,weekday,statusLabel);
    const columns=Array.from({length:6},(_,i)=>{
      const date=afterDays(start,i);
      const slots=state.weekSlots.filter(x=>x.date===date);
      const dayDisabled=date<koreaToday()||date>afterDays(koreaToday(),90);
      let body='';
      if(state.weekLoading){
        body='<span class="ombWeekLoading">조회 중</span>';
      }else if(!slots.length){
        body='<span class="ombWeekEmpty">'+(dayDisabled?'신청 불가':'수업 없음')+'</span>';
      }else{
        body=slots.map(slot=>{
          const key=itemKey(slot),chosen=state.makeups.some(x=>itemKey(x)===key);
          const status=slot.status||'unavailable';
          const canChoose=status==='available'||chosen;
          const title=(slot.label||String(slot.time_slot)+'시')+(slot.group==='B'?' · B반':'');
          return '<button type="button" class="ombWeekSlot '+(chosen?'isSelected':'is'+status)+
            '" data-action="toggle-week-makeup" data-item="'+esc(key)+'" '+
            (canChoose?'':'disabled')+' aria-pressed="'+chosen+'" '+
            'aria-label="'+esc(dateLabel(date)+' '+title+' '+(chosen?'선택됨':statusLabel[status]||'보강 불가'))+'">'+
            '<strong>'+esc(title)+'</strong><small>'+
            esc(chosen?'선택됨':statusLabel[status]||'보강 불가')+
            '</small></button>';
        }).join('');
      }
      return '<div class="ombWeekColumn"><div class="ombWeekDayHeader">'+
        '<strong>'+weekday[i]+'</strong><span>'+shortLabel(date)+'</span></div>'+
        '<div class="ombWeekDayBody">'+body+'</div></div>';
    }).join('');
    return heads+mobile+'<div class="ombDesktopWeek"><div class="ombWeekLegend"><span><i class="isAvailable"></i>보강 가능</span>'+
      '<span><i class="isPrebooked"></i>선예약 중</span>'+
      '<span><i class="isUnavailable"></i>보강 불가</span></div>'+
      '<div class="ombWeekScroll" role="region" tabindex="0" aria-label="날짜별 보강 시간표, 가로로 이동할 수 있습니다">'+
      '<div class="ombWeekGrid">'+columns+'</div></div>'+
      '</div><p class="ombMuted">선예약 중은 해당 날짜에 다른 학생의 보강 예약으로 마감된 자리입니다. 다른 주를 확인해 보세요.</p>';
  }
  function credits(){
    const previous=(state.snapshot?.absences||[]).length;
    const used=(state.snapshot?.makeups||[]).filter(x=>x.status!=='cancelled').length;
    return Math.max(0,previous-used+state.absences.length);
  }
  function renderChoice(){
    shell('보강 수업 안내','원하시는 기능을 선택해 주세요.',
      '<div class="ogbChoiceActions">'+
      '<button class="ogbPrimary" type="button" data-action="begin-apply">보강 신청하기</button>'+
      '<button class="ogbSecondary" type="button" data-action="begin-history">보강 확인하기</button>'+
      '</div>');
  }
  function renderIdentity(){
    shell(state.mode==='apply'?'보강 신청하기':'보강 확인하기',
      '학생 이름과 학원에 등록된 학부모 휴대전화번호를 입력해 주세요.',
      '<form class="ogbForm" id="ombIdentifyForm">'+
        '<label>학생 이름 검색<input name="student_name" type="text" required minlength="2" maxlength="60" autocomplete="off" placeholder="학생 이름" value="'+esc(state.name)+'"></label>'+
        '<label>학부모 휴대전화번호<input name="guardian_phone" type="tel" required inputmode="tel" maxlength="15" autocomplete="tel" placeholder="01012345678" value="'+esc(state.phone)+'"></label>'+
        '<button class="ogbPrimary" type="submit" '+(state.loading?'disabled':'')+'>'+
        (state.loading?'확인 중입니다…':'학생 검색하기')+'</button>'+
      '</form>'+
      (state.result?'<div class="ombIdentityResult"><div><strong>'+esc(state.result.student_name)+
        '</strong><br><span>'+esc(state.result.division==='kinder'?'유치부':'초등부')+
        '</span></div><button type="button" data-action="select-student">이 학생 선택</button></div>':'')+
      '<button type="button" class="ombBack" data-action="home">처음으로</button>'+
      '<p class="ombMuted">보호자 번호가 일치하는 학생만 검색됩니다. 등록된 번호가 없다면 학원에 문의해 주세요.</p>');
  }
  function renderApply(){
    const canContinue=(state.absences.length+state.makeups.length)>0&&
      state.makeups.length<=credits()&&!state.loading;
    shell('보강 신청하기','한 주 시간표에서 보강 날짜와 시간을 선택하고, 결석 예정일은 필요할 때 펼쳐 선택해 주세요.',
      '<p class="ombSelectedStudent">'+esc(state.student)+' 학생</p>'+
      '<section class="ombSection">'+
      '<div class="ombSectionTitle"><strong>1. 보강 수업일 선택</strong><small>날짜·시간 복수 선택</small></div>'+
      '<p class="ombMuted">원하시는 주를 이동한 후 보강 가능한 시간을 눌러 주세요. 남은 자리 수는 표시하지 않습니다.</p>'+
      weekTimetable()+
      '<div class="ombSummary"><h2>보강 수업 '+state.makeups.length+'건</h2>'+
      chosen('makeup')+'</div></section>'+
      '<section class="ombSection">'+
      '<button type="button" class="ombAbsenceToggle" data-action="toggle-absence-calendar" aria-expanded="'+state.absenceOpen+
      '" aria-controls="ombAbsenceCalendar"><span><strong>2. 결석 예정일 선택</strong>'+
      '<small>필요한 날짜를 여러 개 선택할 수 있습니다.</small></span>'+
      '<b aria-hidden="true">'+(state.absenceOpen?'−':'+')+'</b></button>'+
      '<div id="ombAbsenceCalendar" '+(state.absenceOpen?'':'hidden')+'>'+
      '<p class="ombMuted">결석할 정규 수업 날짜를 누르면 수업 시간을 선택할 수 있습니다.</p>'+
      (state.absenceOpen?absenceCalendar()+absentList():'')+'</div>'+
      '<div class="ombSummary"><h2>결석 예정 '+state.absences.length+'건</h2>'+
      chosen('absence')+'</div></section>'+
      (state.makeups.length>credits()?'<p class="ogbNotice isError">보강 횟수가 결석 예정·기등록 결석 횟수를 초과했습니다. 결석 예정일을 추가하거나 보강을 줄여 주세요.</p>':'')+
      '<div class="ombMobileSticky" role="group" aria-label="선택 일정 확인">'+
      '<div class="ombMobileStickyCount"><small>선택한 보강</small><strong>'+state.makeups.length+'건</strong></div>'+
      '<button type="button" class="ogbPrimary" data-action="review" '+(canContinue?'':'disabled')+'>선택 일정 확인</button></div>'+
      '<div class="ombActions ombDesktopActions">'+
      '<button type="button" class="ogbPrimary" data-action="review" '+(canContinue?'':'disabled')+'>선택한 일정 확인하기</button>'+
      '<button type="button" class="ogbSecondary" data-action="go-history">보강 확인하기</button>'+
      '</div><button type="button" class="ombBack" data-action="home">처음으로</button>');
  }
  function renderReview(){
    shell('신청 내용 확인','실제 결석 예정일과 보강 수업일이 맞는지 확인해 주세요.',
      '<p class="ombSelectedStudent">'+esc(state.student)+' 학생</p>'+
      '<div class="ombReviewBlock"><h2>결석 예정 '+state.absences.length+'건</h2>'+
      (state.absences.length?'<ul>'+state.absences.map(x=>'<li>'+esc(detail(x))+'</li>').join('')+'</ul>':
        '<p class="ombMuted">신규 결석 예정일 없음</p>')+'</div>'+
      '<div class="ombReviewBlock"><h2>보강 수업 '+state.makeups.length+'건</h2>'+
      (state.makeups.length?'<ul>'+state.makeups.map(x=>'<li>'+esc(detail(x))+'</li>').join('')+'</ul>':
        '<p class="ombMuted">신규 보강 신청 없음</p>')+'</div>'+
      '<p class="ombMuted">신청이 확정되면 올리 시간표에 자동 등록됩니다. 신청일이 아닌 실제 수업일을 확인해 주세요.</p>'+
      '<div class="ombActions"><button type="button" class="ogbPrimary" data-action="confirm" '+
      (state.loading?'disabled':'')+'>'+(state.loading?'서버에 등록 중…':'위 일정으로 신청 확정')+'</button>'+
      '<button type="button" class="ogbSecondary" data-action="edit" '+
      (state.loading?'disabled':'')+'>날짜 다시 선택</button></div>');
  }
  function renderHistory(){
    const entries=(state.snapshot?.makeups||[]).slice().sort((a,b)=>b.date.localeCompare(a.date));
    const statusLabel={scheduled:'보강 예정',completed:'보강 완료',past:'지난 일정',cancelled:'보강 취소'};
    shell('보강 확인하기','신청일은 표시하지 않고 실제 보강 수업 날짜와 시간만 안내합니다.',
      '<p class="ombSelectedStudent">'+esc(state.student)+' 학생</p>'+
      (entries.length?entries.map(x=>'<div class="ombHistoryRow">'+
        '<div class="ombHistoryRowTop"><strong>'+esc(dateLabel(x.date))+'</strong>'+
        '<span class="ombStatus '+esc(x.status)+'">'+esc(statusLabel[x.status]||'보강')+'</span></div>'+
        '<p>'+esc(x.label||String(x.time_slot)+'시')+(x.group==='B'?' · B반':'')+'</p></div>').join(''):
        '<p class="ogbNotice">현재 확인할 보강 수업 내역이 없습니다.</p>')+
      '<div class="ombActions"><button type="button" class="ogbPrimary" data-action="go-apply">보강 신청하기</button></div>'+
      '<button type="button" class="ombBack" data-action="home">처음으로</button>');
  }
  function renderDone(){
    shell('신청이 완료되었습니다','보강·결석 일정이 올리 시간표에 등록되었습니다.',
      '<p class="ogbNotice">선택하신 일정을 서버에 저장했습니다. 일정은 보강 확인 메뉴에서 다시 확인할 수 있습니다.</p>'+
      '<div class="ombActions">'+
      '<button type="button" class="ogbPrimary" data-action="go-history">보강 확인하기</button>'+
      '<button type="button" class="ogbSecondary" data-action="go-apply">추가 일정 신청하기</button>'+
      '</div>');
  }
  function render(){
    if(!state.ready){
      root.innerHTML='<div class="ogbBoot" role="status"><span class="ogbBootSpinner" aria-hidden="true"></span></div>';
      return;
    }
    if(state.phase==='identity')renderIdentity();
    else if(state.phase==='apply')renderApply();
    else if(state.phase==='review')renderReview();
    else if(state.phase==='history')renderHistory();
    else if(state.phase==='done')renderDone();
    else renderChoice();
  }
  function toggle(list,item){
    const key=itemKey(item),index=list.findIndex(x=>itemKey(x)===key);
    if(index>=0)list.splice(index,1);else list.push(item);
    state.requestKey='';
  }
  function findRegular(key){return (state.snapshot?.regular||[]).find(x=>itemKey(x)===key);}
  function findSlot(key){return state.weekSlots.find(x=>itemKey(x)===key);}
  async function loadSnapshot(){
    const s=await api('snapshot',{session_token:state.token});
    state.snapshot=s;
    return s;
  }
  async function chooseStudent(){
    if(!state.result||!state.result.session_token)return;
    state.token=state.result.session_token;
    state.student=state.result.student_name;
    state.error='';state.loading=true;render();
    try{
      await loadSnapshot();
      const month=koreaToday().slice(0,7);
      state.absenceMonth=month;state.weekStart=mondayOf(koreaToday());state.selectedWeekDay=koreaToday();
      state.phase=state.mode==='apply'?'apply':'history';
      state.absences=[];state.makeups=[];state.weekSlots=[];
      state.absenceDay='';state.absenceOpen=false;state.requestKey='';
      if(state.phase==='apply')await loadWeek(state.weekStart);
    }catch(e){
      state.token='';state.error=message(e);
    }finally{state.loading=false;render();}
  }
  async function loadWeek(start){
    state.weekStart=start;
    if(!state.selectedWeekDay||state.selectedWeekDay<start||state.selectedWeekDay>afterDays(start,5))
      state.selectedWeekDay=start;
    state.weekSlots=[];state.weekLoading=true;state.error='';
    render();
    const token=state.token;
    try{
      const result=await api('week',{session_token:token,week_start:start});
      if(state.weekStart!==start||state.token!==token)return;
      const end=afterDays(start,5);
      state.weekSlots=(Array.isArray(result.slots)?result.slots:[])
        .filter(x=>x&&x.date>=start&&x.date<=end);
    }catch(e){
      if(state.weekStart===start&&state.token===token)state.error=message(e);
    }finally{
      if(state.weekStart===start&&state.token===token){
        state.weekLoading=false;render();
      }
    }
  }
  async function submit(){
    if(!state.requestKey)state.requestKey=global.crypto.randomUUID();
    state.loading=true;state.error='';render();
    try{
      await api('submit',{session_token:state.token,request_key:state.requestKey,
        absences:state.absences.map(x=>({date:x.date,time_slot:x.time_slot,group:x.group})),
        makeups:state.makeups.map(x=>({date:x.date,time_slot:x.time_slot,group:x.group}))});
      state.phase='done';state.absences=[];state.makeups=[];
      state.absenceDay='';state.absenceOpen=false;state.requestKey='';
      state.error='';render();
      try{await loadSnapshot();}catch{}
    }catch(e){state.error=message(e);}
    finally{state.loading=false;render();}
  }
  root.addEventListener('submit',async event=>{
    if(event.target?.id!=='ombIdentifyForm')return;
    event.preventDefault();
    if(state.loading)return;
    const data=new FormData(event.target);
    state.name=String(data.get('student_name')||'').trim();
    state.phone=String(data.get('guardian_phone')||'').trim();
    state.result=null;state.loading=true;state.error='';render();
    try{
      state.result=await api('identify',{student_name:state.name,guardian_phone:state.phone});
    }catch(e){state.error=message(e);}
    finally{state.loading=false;render();}
  });
  root.addEventListener('click',event=>{
    const b=event.target.closest('[data-action]');if(!b||state.loading)return;
    const action=b.dataset.action;
    if(action==='home'){
      state.phase='choice';state.token='';state.student='';state.result=null;
      state.absences=[];state.makeups=[];state.weekSlots=[];state.requestKey='';state.error='';
      render();return;
    }
    if(action==='begin-apply'||action==='begin-history'){
      state.mode=action==='begin-apply'?'apply':'history';
      state.phase='identity';state.error='';render();return;
    }
    if(action==='select-student'){void chooseStudent();return;}
    if(action==='go-history'||action==='go-apply'){
      state.phase=action==='go-history'?'history':'apply';state.error='';
      if(action==='go-apply'&&state.token){void loadWeek(state.weekStart||mondayOf(koreaToday()));}
      else render();
      return;
    }
    if(action==='review'){
      if(!state.absences.length&&!state.makeups.length)return;
      if(state.makeups.length>credits())return;
      state.phase='review';state.error='';render();return;
    }
    if(action==='edit'){state.phase='apply';state.requestKey='';render();return;}
    if(action==='confirm'){void submit();return;}
    if(action==='absence-prev'||action==='absence-next'){
      state.absenceMonth=shiftMonth(state.absenceMonth,action.endsWith('prev')?-1:1);
      state.absenceDay='';render();return;
    }
    if(action==='week-prev'||action==='week-next'){
      const next=afterDays(state.weekStart,action==='week-next'?7:-7);
      if(next>=mondayOf(koreaToday())&&next<=mondayOf(afterDays(koreaToday(),90)))void loadWeek(next);
      return;
    }
    if(action==='select-week-day'){
      const date=b.dataset.date;
      if(date>=koreaToday()&&date<=afterDays(koreaToday(),90)&&date>=state.weekStart&&date<=afterDays(state.weekStart,5)){
        state.selectedWeekDay=date;render();
      }
      return;
    }
    if(action==='toggle-absence-calendar'){
      state.absenceOpen=!state.absenceOpen;render();return;
    }
    if(action==='abs-date'){
      state.absenceDay=b.dataset.date;state.error='';render();return;
    }
    if(action==='toggle-absence'){
      const x=findRegular(b.dataset.item);
      if(x&&!(state.snapshot?.absences||[]).some(a=>itemKey(a)===itemKey(x)))
        toggle(state.absences,x);
      render();return;
    }
    if(action==='toggle-week-makeup'){
      const x=findSlot(b.dataset.item);
      if(x && (x.status==='available'||state.makeups.some(s=>itemKey(s)===itemKey(x)))){
        // A student can select only one class group for the same date/time.
        if(!state.makeups.some(s=>itemKey(s)===itemKey(x))){
          state.makeups=state.makeups.filter(s=>
            !(s.date===x.date&&Number(s.time_slot)===Number(x.time_slot)));
        }
        toggle(state.makeups,x);
      }
      render();return;
    }
    if(action==='remove-absence'||action==='remove-makeup'){
      const list=action==='remove-absence'?state.absences:state.makeups;
      const i=list.findIndex(x=>itemKey(x)===b.dataset.item);
      if(i>=0){list.splice(i,1);state.requestKey='';}
      render();
    }
  });
  (async()=>{
    try{
      if(!/^[0-9a-f]{36}$/.test(slug))throw new Error('ACADEMY_NOT_FOUND');
      const info=await api('info');
      state.academy=info.academy_name||'비비작아이성향미술학원';
      state.ready=true;render();
    }catch(e){
      state.ready=true;state.academy='비비작아이성향미술학원';
      shell('보강 신청 안내','학원 링크를 확인해 주세요.',
        '<p class="ogbNotice isError">'+esc(message(e))+'</p>');
    }
  })();
})(window);
