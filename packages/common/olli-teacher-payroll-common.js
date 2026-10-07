(function(global){
  'use strict';

  const WEEKDAYS = [
    { key:'1', label:'월' },
    { key:'2', label:'화' },
    { key:'3', label:'수' },
    { key:'4', label:'목' },
    { key:'5', label:'금' },
    { key:'6', label:'토' }
  ];

  const state = {
    month: currentMonthValue(),
    payload: null,
    loading: false,
    syncingDue: false
  };

  function currentMonthValue(){
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  }

  function monthDateValue(value){
    const raw = String(value || state.month || currentMonthValue()).trim();
    return /^\d{4}-\d{2}$/.test(raw) ? raw + '-01' : currentMonthValue() + '-01';
  }

  function esc(value){
    if(typeof global.settingsEscapeHtml === 'function') return global.settingsEscapeHtml(value);
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];
    });
  }

  function academyId(){
    if(typeof global.settingsGetAcademyId === 'function') return String(global.settingsGetAcademyId() || '').trim();
    return String(localStorage.getItem('olli_current_academy_id') || '').trim();
  }

  function sessionToken(){
    if(typeof global.getOlliSettingsSessionToken === 'function') return String(global.getOlliSettingsSessionToken() || '').trim();
    return String(localStorage.getItem('olli_account_session_token_v1') || '').trim();
  }

  function role(){
    if(typeof global.getOlliCurrentRole === 'function') return String(global.getOlliCurrentRole() || '').trim();
    return String(localStorage.getItem('olli_current_member_role') || '').trim();
  }

  function isOwner(){
    return role() === 'owner' || role() === 'super_admin';
  }

  async function rpc(name,args){
    if(typeof global.callOlliRpc !== 'function') throw new Error('급여 기능의 서버 연결을 찾지 못했습니다.');
    return global.callOlliRpc(name,args || {});
  }

  function money(value){
    return Math.max(0,Math.round(Number(value || 0))).toLocaleString('ko-KR') + '원';
  }

  function hours(value){
    const n = Number(value || 0);
    return Number.isFinite(n) ? (Math.round(n * 100) / 100) : 0;
  }

  function detailElements(){
    return {
      detail:document.getElementById('settingsDetailScreen'),
      settings:document.getElementById('settingsPageScreen'),
      title:document.getElementById('settingsDetailTitlePill'),
      body:document.getElementById('settingsDetailBody')
    };
  }

  function openDetailShell(){
    const els = detailElements();
    if(!els.detail || !els.body) return null;
    if(typeof global.olliPcSettingsLayoutBeforeOpenDetail === 'function'){
      try{ global.olliPcSettingsLayoutBeforeOpenDetail('teacherPayroll'); }catch(_){}
    }
    if(els.settings) els.settings.style.display='flex';
    if(els.title) els.title.textContent='선생님 급여 계산';
    els.detail.style.display='flex';
    els.detail.style.position='fixed';
    els.detail.style.inset='0';
    els.detail.style.transform='translateX(0)';
    els.detail.style.opacity='1';
    els.detail.style.pointerEvents='auto';
    els.detail.style.zIndex='130100';
    if(typeof global.olliPcSettingsLayoutAfterOpenDetail === 'function'){
      try{ global.olliPcSettingsLayoutAfterOpenDetail('teacherPayroll'); }catch(_){}
    }
    return els;
  }

  function emptyWeekdayHours(){
    return {'1':0,'2':0,'3':0,'4':0,'5':0,'6':0};
  }

  function normalizedWeekdayHours(value){
    const source = value && typeof value === 'object' ? value : {};
    const result = emptyWeekdayHours();
    WEEKDAYS.forEach(day => {
      const n = Number(source[day.key] || 0);
      result[day.key] = Number.isFinite(n) ? Math.max(0,Math.min(24,n)) : 0;
    });
    return result;
  }

  function workdaysFor(teacher,dayKey){
    const source = teacher?.weekday_workdays && typeof teacher.weekday_workdays === 'object'
      ? teacher.weekday_workdays
      : {};
    return Math.max(0,Number(source[dayKey] || 0));
  }

  function calculateCard(card){
    if(!card) return { amount:0,totalHours:0 };
    const monthlySalary = Math.max(0,Number(card.querySelector('[data-payroll-monthly-salary]')?.value || 0));
    const hourlyWage = Math.max(0,Number(card.querySelector('[data-payroll-hourly-wage]')?.value || 0));
    let totalHours = 0;
    WEEKDAYS.forEach(day => {
      const input = card.querySelector('[data-payroll-day-hours="'+day.key+'"]');
      const dayHours = Math.max(0,Math.min(24,Number(input?.value || 0)));
      const workdays = Math.max(0,Number(card.dataset['workdays'+day.key] || 0));
      totalHours += workdays * dayHours;
    });
    const amount = monthlySalary > 0 ? Math.round(monthlySalary) : Math.round(totalHours * hourlyWage);
    const hoursNode = card.querySelector('[data-payroll-total-hours]');
    const amountNode = card.querySelector('[data-payroll-total-amount]');
    if(hoursNode) hoursNode.textContent = (Math.round(totalHours*100)/100).toLocaleString('ko-KR') + '시간';
    if(amountNode) amountNode.textContent = money(amount);
    return {amount,totalHours};
  }

  function paydayOptions(selected){
    const value = Math.max(1,Math.min(31,Number(selected || 15)));
    let html='';
    for(let day=1;day<=31;day+=1){
      html += '<option value="'+day+'"'+(day===value?' selected':'')+'>'+day+'일</option>';
    }
    return html;
  }

  function renderTeacherCard(teacher){
    const teacherId = String(teacher?.teacher_member_id || '');
    const name = String(teacher?.teacher_name || '선생님').trim() || '선생님';
    const monthlySalary = Math.max(0,Number(teacher?.monthly_salary || 0));
    const wage = Math.max(0,Number(teacher?.hourly_wage || 0));
    const payday = Math.max(1,Math.min(31,Number(teacher?.payday || 15)));
    const weekdayHours = normalizedWeekdayHours(teacher?.weekday_hours);
    const workdayCount = Math.max(0,Number(teacher?.workday_count || 0));
    const totalHours = Math.max(0,Number(teacher?.total_hours || 0));
    const totalAmount = Math.max(0,Number(teacher?.total_amount || 0));

    const attrs = WEEKDAYS.map(day => ' data-workdays'+day.key+'="'+workdaysFor(teacher,day.key)+'"').join('');
    const dayInputs = WEEKDAYS.map(day => {
      const count = workdaysFor(teacher,day.key);
      return '<label class="olliPayrollDayField">'
        + '<span class="olliPayrollDayLabel">'+day.label+' <small>'+count+'회</small></span>'
        + '<input inputmode="decimal" min="0" max="24" step="0.5" type="number" value="'+weekdayHours[day.key]+'" data-payroll-day-hours="'+day.key+'">'
        + '<span class="olliPayrollUnit">시간</span>'
        + '</label>';
    }).join('');

    return '<section class="olliPayrollTeacherCard" data-payroll-teacher-card data-teacher-id="'+esc(teacherId)+'"'+attrs+'>'
      + '<div class="olliPayrollTeacherHead"><div><div class="olliPayrollTeacherName">'+esc(name)+'</div>'
      + '<div class="olliPayrollWorkdays">이번 달 출근 <strong>'+workdayCount+'일</strong> · 시간표 자동 계산</div></div>'
      + '<span class="olliPayrollSaveState" data-payroll-save-state></span></div>'
      + '<div class="olliPayrollFieldGrid">'
      + '<label class="olliPayrollField"><span>월급</span><div class="olliPayrollInputWrap"><input inputmode="numeric" min="0" step="10000" type="number" value="'+monthlySalary+'" data-payroll-monthly-salary><span>원</span></div></label>'
      + '<label class="olliPayrollField"><span>시급</span><div class="olliPayrollInputWrap"><input inputmode="numeric" min="0" step="100" type="number" value="'+wage+'" data-payroll-hourly-wage><span>원</span></div></label>'
      + '<label class="olliPayrollField"><span>급여일</span><select data-payroll-payday>'+paydayOptions(payday)+'</select></label>'
      + '</div>'
      + '<div class="olliPayrollDayTitle">요일별 근무시간</div>'
      + '<div class="olliPayrollDayGrid">'+dayInputs+'</div>'
      + '<div class="olliPayrollSummary"><div><span>총 근무시간</span><strong data-payroll-total-hours>'+hours(totalHours).toLocaleString('ko-KR')+'시간</strong></div>'
      + '<div><span>예상 급여</span><strong data-payroll-total-amount>'+money(totalAmount)+'</strong></div></div>'
      + '<button class="olliPayrollSaveButton" type="button" data-payroll-save>저장</button>'
      + '</section>';
  }

  function render(){
    const els = detailElements();
    if(!els.body) return;
    const payload = state.payload || {};
    const teachers = Array.isArray(payload.teachers) ? payload.teachers : [];
    const month = String(payload.month || state.month || currentMonthValue()).slice(0,7);
    state.month = /^\d{4}-\d{2}$/.test(month) ? month : currentMonthValue();

    els.body.innerHTML = '<div class="olliPayrollPage">'
      + '<div class="olliPayrollIntro"><div class="olliPayrollIntroTitle">시간표를 기준으로<br>한 달 급여를 계산합니다.</div>'
      + '<div class="olliPayrollIntroText">같은 날 수업이 여러 개여도 출근은 1일로 계산합니다. 휴원일과 날짜별 대체 담임도 자동 반영됩니다.</div></div>'
      + '<label class="olliPayrollMonthField"><span>계산 월</span><input type="month" value="'+esc(state.month)+'" data-payroll-month></label>'
      + (teachers.length ? teachers.map(renderTeacherCard).join('') : '<div class="olliPayrollEmpty">급여를 설정할 선생님이 없습니다.</div>')
      + '</div>';

    els.body.querySelector('[data-payroll-month]')?.addEventListener('change',function(event){
      const next = String(event.target.value || '').trim();
      if(/^\d{4}-\d{2}$/.test(next) && next !== state.month){
        state.month = next;
        loadOverview();
      }
    });

    els.body.querySelectorAll('[data-payroll-teacher-card]').forEach(card => {
      card.querySelectorAll('[data-payroll-monthly-salary],[data-payroll-hourly-wage],[data-payroll-day-hours]').forEach(input => {
        input.addEventListener('input',()=>calculateCard(card));
      });
      card.querySelector('[data-payroll-save]')?.addEventListener('click',()=>saveTeacher(card));
      calculateCard(card);
    });
  }

  async function loadOverview(){
    const els = openDetailShell();
    if(!els || state.loading) return false;
    if(!isOwner()){
      els.body.innerHTML='<div class="olliPayrollEmpty">선생님 급여 설정은 원장만 확인할 수 있습니다.</div>';
      return false;
    }
    const academy = academyId();
    const token = sessionToken();
    if(!academy || !token){
      els.body.innerHTML='<div class="olliPayrollEmpty">로그인 정보 또는 현재 학원을 확인해 주세요.</div>';
      return false;
    }
    state.loading=true;
    els.body.innerHTML='<div class="settingsLoadingText">급여 정보를 계산하고 있습니다...</div>';
    try{
      const payload=await rpc('olli_teacher_payroll_overview',{
        p_session_token:token,
        p_academy_id:academy,
        p_month:monthDateValue(state.month)
      });
      if(!payload?.ok) throw new Error(payload?.message || '급여 정보를 불러오지 못했습니다.');
      state.payload=payload;
      render();
      return true;
    }catch(error){
      els.body.innerHTML='<div class="olliPayrollEmpty">급여 정보를 불러오지 못했습니다.<br><small>'+esc(error?.message || error)+'</small></div>';
      return false;
    }finally{
      state.loading=false;
    }
  }

  async function saveTeacher(card){
    if(!card || !isOwner()) return false;
    const teacherId=String(card.dataset.teacherId || '').trim();
    if(!teacherId) return false;
    const button=card.querySelector('[data-payroll-save]');
    const status=card.querySelector('[data-payroll-save-state]');
    const weekdayHours=emptyWeekdayHours();
    WEEKDAYS.forEach(day=>{
      weekdayHours[day.key]=Math.max(0,Math.min(24,Number(card.querySelector('[data-payroll-day-hours="'+day.key+'"]')?.value || 0)));
    });
    const monthlySalary=Math.max(0,Math.round(Number(card.querySelector('[data-payroll-monthly-salary]')?.value || 0)));
    const wage=Math.max(0,Math.round(Number(card.querySelector('[data-payroll-hourly-wage]')?.value || 0)));
    const payday=Math.max(1,Math.min(31,Math.round(Number(card.querySelector('[data-payroll-payday]')?.value || 15))));
    if(button){button.disabled=true;button.textContent='저장 중';}
    if(status) status.textContent='';
    try{
      const payload=await rpc('olli_teacher_payroll_setting_upsert_v2',{
        p_session_token:sessionToken(),
        p_academy_id:academyId(),
        p_teacher_member_id:teacherId,
        p_monthly_salary:monthlySalary,
        p_hourly_wage:wage,
        p_payday:payday,
        p_weekday_hours:weekdayHours,
        p_month:monthDateValue(state.month)
      });
      if(!payload?.ok) throw new Error(payload?.message || '급여 설정을 저장하지 못했습니다.');
      if(status) status.textContent='저장됨';
      await loadOverview();
      await syncDueNotifications();
      return true;
    }catch(error){
      if(status) status.textContent='저장 실패';
      alert('급여 설정 저장 실패\n'+(error?.message || error));
      return false;
    }finally{
      if(button){button.disabled=false;button.textContent='저장';}
    }
  }

  async function open(){
    openDetailShell();
    return loadOverview();
  }

  function isPayrollMessage(item){
    if(!isOwner()) return false;
    if(String(item?.message_type || '').trim() !== 'ai') return false;
    if(String(item?.sender_name || '').trim() !== '올리') return false;
    const body=String(item?.body || '').trim();
    const notificationId=String(item?.client_message_id || '').trim();
    return /^오늘은 .+선생님 \d{1,2}월 급여일 입니다\.$/.test(body)
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notificationId);
  }

  function createTeamChatPayrollButton(item,platform){
    if(!isPayrollMessage(item)) return null;
    const wrap=document.createElement('div');
    wrap.className='olliPayrollTalkCard '+(platform==='pc'?'pc':'mobile');
    const button=document.createElement('button');
    button.type='button';
    button.className='olliPayrollTalkButton';
    button.textContent='선생님 급여';
    button.dataset.revealed='0';
    button.addEventListener('click',async function(){
      if(button.dataset.revealed==='1'){
        button.dataset.revealed='0';
        button.textContent='선생님 급여';
        return;
      }
      button.disabled=true;
      const original='선생님 급여';
      button.textContent='확인 중';
      try{
        const payload=await rpc('olli_teacher_payroll_notification_amount_get',{
          p_session_token:sessionToken(),
          p_academy_id:academyId(),
          p_notification_id:String(item.client_message_id || '').trim()
        });
        if(!payload?.ok) throw new Error(payload?.message || '급여 금액을 확인하지 못했습니다.');
        button.textContent=money(payload.amount);
        button.dataset.revealed='1';
      }catch(error){
        console.warn('선생님 급여 금액 확인 실패:',error);
        button.textContent=original;
        button.dataset.revealed='0';
      }finally{
        button.disabled=false;
      }
    });
    wrap.appendChild(button);
    return wrap;
  }

  async function syncDueNotifications(){
    if(state.syncingDue || !isOwner()) return false;
    const academy=academyId();
    const token=sessionToken();
    if(!academy || !token) return false;
    state.syncingDue=true;
    try{
      const payload=await rpc('olli_teacher_payroll_due_sync',{
        p_session_token:token,
        p_academy_id:academy
      });
      return payload?.ok===true;
    }catch(error){
      console.warn('급여일 알림 동기화 실패:',error?.message || error);
      return false;
    }finally{
      state.syncingDue=false;
    }
  }

  global.openOlliTeacherPayrollSettings=open;
  global.OlliTeacherPayroll={
    open,
    loadOverview,
    syncDueNotifications,
    isPayrollMessage,
    createTeamChatPayrollButton
  };

  function startup(){
    if(!isOwner()) return;
    global.setTimeout(()=>{ syncDueNotifications(); },1200);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',startup,{once:true});
  else startup();
})(window);
