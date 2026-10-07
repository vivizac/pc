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
    syncingDue: false,
    financeTab: 'expenses',
    expenseHistoryOpen: false,
    expenseHistoryLoading: false,
    expenseHistoryRequestSeq: 0
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
    if(typeof global.callOlliRpc !== 'function') throw new Error('급여 및 지출 기능의 서버 연결을 찾지 못했습니다.');
    return global.callOlliRpc(name,args || {});
  }

  function money(value){
    return Math.max(0,Math.round(Number(value || 0))).toLocaleString('ko-KR') + '원';
  }

  function currencyInputValue(value){
    if(value==null || value==='') return '';
    const digits=String(value).replace(/[^0-9]/g,'');
    if(!digits) return '';
    return Number(digits || 0).toLocaleString('ko-KR');
  }

  function currencyInputAmount(value){
    const digits=String(value == null ? '' : value).replace(/[^0-9]/g,'');
    if(!digits) return NaN;
    return Math.round(Number(digits));
  }

  function formatCurrencyInput(input){
    if(!input) return;
    const formatted=currencyInputValue(input.value);
    if(input.value!==formatted) input.value=formatted;
  }

  function bindCurrencyInput(input){
    if(!input || input.dataset.currencyBound==='1') return;
    input.dataset.currencyBound='1';
    input.addEventListener('input',()=>formatCurrencyInput(input));
    input.addEventListener('blur',()=>formatCurrencyInput(input));
    formatCurrencyInput(input);
  }

  function monthDisplayLabel(value){
    const match=String(value || '').match(/^(\d{4})-(\d{2})$/);
    return match ? Number(match[1])+'년 '+Number(match[2])+'월' : '월 선택';
  }

  function monthPickerBody(year){
    const selected=String(state.month || currentMonthValue()).split('-');
    const selectedYear=Number(selected[0] || year);
    const selectedMonth=Number(selected[1] || 0);
    let months='';
    for(let month=1;month<=12;month+=1){
      const active=Number(year)===selectedYear && month===selectedMonth;
      months+='<button type="button" class="olliPayrollMonthOption'+(active?' is-active':'')+'" data-payroll-month-option="'+month+'">'+month+'월</button>';
    }
    return '<div class="olliPayrollMonthPickerHead">'
      + '<button type="button" data-payroll-year-step="-1" aria-label="이전 연도">‹</button>'
      + '<strong data-payroll-picker-year-label>'+year+'년</strong>'
      + '<button type="button" data-payroll-year-step="1" aria-label="다음 연도">›</button>'
      + '</div><div class="olliPayrollMonthOptions">'+months+'</div>';
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
    if(els.title) els.title.textContent='급여 및 지출 관리';
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
    if(!card) return { grossAmount:0,deductionAmount:0,amount:0,totalHours:0 };
    const monthlySalary = Math.max(0,Number(card.querySelector('[data-payroll-monthly-salary]')?.value || 0));
    const hourlyWage = Math.max(0,Number(card.querySelector('[data-payroll-hourly-wage]')?.value || 0));
    const deductionMode = String(card.querySelector('[data-payroll-deduction-mode]')?.value || 'none');
    let totalHours = 0;
    WEEKDAYS.forEach(day => {
      const input = card.querySelector('[data-payroll-day-hours="'+day.key+'"]');
      const dayHours = Math.max(0,Math.min(24,Number(input?.value || 0)));
      const workdays = Math.max(0,Number(card.dataset['workdays'+day.key] || 0));
      totalHours += workdays * dayHours;
    });
    const grossAmount = monthlySalary > 0 ? Math.round(monthlySalary) : Math.round(totalHours * hourlyWage);
    const deductionAmount = deductionMode==='freelancer_33' ? Math.round(grossAmount*0.033) : 0;
    const amount = Math.max(0,grossAmount-deductionAmount);
    const hoursNode = card.querySelector('[data-payroll-total-hours]');
    const amountNode = card.querySelector('[data-payroll-total-amount]');
    const deductionNode = card.querySelector('[data-payroll-deduction-preview]');
    if(hoursNode) hoursNode.textContent = (Math.round(totalHours*100)/100).toLocaleString('ko-KR') + '시간';
    if(amountNode) amountNode.textContent = money(amount);
    if(deductionNode){
      deductionNode.textContent = deductionMode==='freelancer_33'
        ? '공제 전 '+money(grossAmount)+' · 3.3% 공제 '+money(deductionAmount)
        : '공제 없음 · 공제 전 급여와 실지급액이 같습니다.';
    }
    return {grossAmount,deductionAmount,amount,totalHours};
  }

  function shortMonthDay(value){
    const raw=String(value || '').trim();
    const match=raw.match(/^\d{4}-(\d{2})-(\d{2})$/);
    if(!match) return '';
    return String(Number(match[1]))+'/'+String(Number(match[2]));
  }

  function payrollPeriodLabel(teacher){
    const start=shortMonthDay(teacher?.period_start);
    const end=shortMonthDay(teacher?.period_end);
    return start && end ? start+'~'+end : '';
  }

  function todayDateValue(){
    const now=new Date();
    return now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  }

  function selectedMonthIsFuture(){
    return String(state.month || '') > currentMonthValue();
  }

  function payrollPayDateLabel(teacher){
    const raw=String(teacher?.pay_date || '').trim();
    const match=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!match) return '';
    const label=Number(match[2])+'월 '+Number(match[3])+'일';
    return label+(raw>todayDateValue() ? ' 지급 예정' : ' 지급');
  }

  function payrollAmountLabel(teacher){
    const raw=String(teacher?.pay_date || '').trim();
    return teacher?.is_finalized===true || (raw && raw<=todayDateValue())
      ? '지급 급여'
      : '예상 급여';
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
    const deductionMode = String(teacher?.deduction_mode || 'none')==='freelancer_33' ? 'freelancer_33' : 'none';
    const weekdayHours = normalizedWeekdayHours(teacher?.weekday_hours);
    const workdayCount = Math.max(0,Number(teacher?.workday_count || 0));
    const totalHours = Math.max(0,Number(teacher?.total_hours || 0));
    const totalAmount = Math.max(0,Number(teacher?.total_amount || 0));
    const substituteHours = Math.max(0,Number(teacher?.substitute_hours || 0));
    const substituteSlotCount = Math.max(0,Number(teacher?.substitute_slot_count || 0));
    const finalized = teacher?.is_finalized===true;
    const disabledAttr = finalized ? ' disabled' : '';

    const attrs = WEEKDAYS.map(day => ' data-workdays'+day.key+'="'+workdaysFor(teacher,day.key)+'"').join('');
    const dayInputs = WEEKDAYS.map(day => {
      const count = workdaysFor(teacher,day.key);
      return '<label class="olliPayrollDayField">'
        + '<span class="olliPayrollDayLabel">'+day.label+' <small>'+count+'회</small></span>'
        + '<span class="olliPayrollDayHours"><input inputmode="decimal" min="0" max="24" step="0.5" type="number" value="'+weekdayHours[day.key]+'" data-payroll-day-hours="'+day.key+'"'+disabledAttr+'><span class="olliPayrollUnit">시간</span></span>'
        + '</label>';
    }).join('');

    return '<section class="olliPayrollTeacherCard'+(finalized?' is-finalized':'')+'" data-payroll-teacher-card data-payroll-finalized="'+(finalized?'1':'0')+'" data-teacher-id="'+esc(teacherId)+'"'+attrs+'>'
      + '<div class="olliPayrollTeacherHead"><div><div class="olliPayrollTeacherName">'+esc(name)+(finalized?'<span class="olliPayrollFinalizedBadge">급여 확정</span>':'')+'</div>'
      + '<div class="olliPayrollWorkdays"><strong>'+esc(payrollPayDateLabel(teacher) || (state.month.replace('-', '.')+' 지급'))+'</strong>'
      + (payrollPeriodLabel(teacher)?' · 계산기간 '+esc(payrollPeriodLabel(teacher)):'')
      + ' · 근무 <strong>'+workdayCount+'일</strong>'
      + (substituteHours>0?' · 대체 <strong>'+hours(substituteHours).toLocaleString('ko-KR')+'시간</strong> 포함':'')
      + (finalized?' · 금액 고정':' · 시간표 기준 계산')+'</div></div>'
      + '<span class="olliPayrollSaveState" data-payroll-save-state></span></div>'
      + '<div class="olliPayrollFieldGrid">'
      + '<label class="olliPayrollField"><span>월급</span><div class="olliPayrollInputWrap"><input inputmode="numeric" min="0" step="10000" type="number" value="'+monthlySalary+'" data-payroll-monthly-salary'+disabledAttr+'><span>원</span></div></label>'
      + '<label class="olliPayrollField"><span>시급</span><div class="olliPayrollInputWrap"><input inputmode="numeric" min="0" step="100" type="number" value="'+wage+'" data-payroll-hourly-wage'+disabledAttr+'><span>원</span></div></label>'
      + '<label class="olliPayrollField"><span>급여일</span><select data-payroll-payday'+disabledAttr+'>'+paydayOptions(payday)+'</select></label>'
      + '<label class="olliPayrollField olliPayrollDeductionField"><span>공제 방식</span><select data-payroll-deduction-mode'+disabledAttr+'>'
      + '<option value="none"'+(deductionMode==='none'?' selected':'')+'>공제 없음</option>'
      + '<option value="freelancer_33"'+(deductionMode==='freelancer_33'?' selected':'')+'>프리랜서 3.3%</option>'
      + '</select></label>'
      + '</div>'
      + '<div class="olliPayrollDayTitle">요일별 근무시간</div>'
      + '<div class="olliPayrollDayGrid">'+dayInputs+'</div>'
      + '<div class="olliPayrollSummary"><div><span>총 근무시간</span><strong data-payroll-total-hours>'+hours(totalHours).toLocaleString('ko-KR')+'시간</strong></div>'
      + '<div><span>'+esc(payrollAmountLabel(teacher))+'</span><strong data-payroll-total-amount>'+money(totalAmount)+'</strong></div></div>'
      + '<div class="olliPayrollDeductionPreview" data-payroll-deduction-preview>'
      + (deductionMode==='freelancer_33'
        ? '공제 전 '+money(Number(teacher?.gross_amount || 0))+' · 3.3% 공제 '+money(Number(teacher?.deduction_amount || 0))
        : '공제 없음 · 공제 전 급여와 실지급액이 같습니다.')
      + '</div>'
      + '<button class="olliPayrollSaveButton" type="button" data-payroll-save'+disabledAttr+'>'+(finalized?'확정됨':'저장')+'</button>'
      + '</section>';
  }

  function financePayrollPayload(){
    const payload=state.payload || {};
    return payload.payroll && typeof payload.payroll==='object' ? payload.payroll : payload;
  }

  function financeExpensePayload(){
    const payload=state.payload || {};
    return payload.expenses && typeof payload.expenses==='object'
      ? payload.expenses
      : {items:[],total_amount:0,missing_monthly_count:0};
  }

  function expenseCategoryLabel(value){
    return ({
      rent:'월세',
      maintenance:'관리비',
      franchise_royalty:'가맹·로열티',
      materials:'재료비',
      tax_accounting:'세무·기장료',
      advertising:'광고',
      program:'프로그램·구독',
      other:'기타'
    })[String(value || '')] || '지출';
  }

  function expenseModeText(item){
    const mode=String(item?.recurrence_mode || '');
    const entered=item?.is_entered===true;
    const valueMonth=String(item?.value_month || '');
    if(mode==='monthly') return entered ? '이번 달 입력' : '미입력';
    if(mode==='one_time') return '이번 달만';
    if(entered && valueMonth && valueMonth!==state.month) return valueMonth.replace('-', '.')+'부터 유지';
    return entered ? '매달 유지' : '미설정';
  }

  function renderExpenseItem(item){
    const itemId=String(item?.item_id || '');
    const systemKey=String(item?.system_key || '');
    const category=String(item?.category || 'other');
    const recurrence=String(item?.recurrence_mode || 'recurring');
    const startMonth=String(item?.start_month || state.month || '');
    const name=String(item?.name || expenseCategoryLabel(category)).trim() || expenseCategoryLabel(category);
    const entered=item?.is_entered===true;
    const amount=entered ? Math.max(0,Math.round(Number(item?.amount || 0))) : '';
    const custom=!systemKey && !!itemId;
    const revision=Math.max(0,Number(item?.revision || 0));
    const missing=recurrence==='monthly' && !entered;
    const endLabel=recurrence==='one_time' ? '삭제' : '종료';
    const materialMode=systemKey==='materials'
      ? '<select class="olliExpenseRecurrenceSelect" data-expense-recurrence aria-label="재료비 입력 방식">'
        + '<option value="recurring"'+(recurrence==='recurring'?' selected':'')+'>매달 유지</option>'
        + '<option value="monthly"'+(recurrence==='monthly'?' selected':'')+'>이번 달 입력</option>'
        + '</select>'
      : '<span>'+esc(expenseModeText(item))+'</span>';

    return '<div class="olliExpenseRow'+(missing?' is-missing':'')+'" data-expense-row'
      +' data-item-id="'+esc(itemId)+'"'
      +' data-system-key="'+esc(systemKey)+'"'
      +' data-category="'+esc(category)+'"'
      +' data-recurrence="'+esc(recurrence)+'"'
      +' data-start-month="'+esc(startMonth)+'"'
      +' data-revision="'+esc(revision)+'"'
      +' data-custom="'+(custom?'1':'0')+'">'
      + '<div class="olliExpenseRowMain">'
      + (custom
        ? '<input class="olliExpenseNameInput" type="text" maxlength="80" value="'+esc(name)+'" data-expense-name aria-label="지출 항목 이름">'
        : '<div class="olliExpenseName">'+esc(name)+'</div>')
      + '<div class="olliExpenseMeta"><span>'+esc(expenseCategoryLabel(category))+'</span>'+materialMode+'</div>'
      + '</div>'
      + '<div class="olliExpenseAmountWrap">'
      + '<input class="olliExpenseAmountInput" inputmode="numeric" maxlength="13" type="text" autocomplete="off"'
      + ' value="'+esc(currencyInputValue(amount))+'" placeholder="'+(missing?'미입력':'금액')+'" data-expense-amount>'
      + '<span>원</span></div>'
      + '<div class="olliExpenseRowActions">'
      + '<button type="button" class="olliExpenseSaveButton" data-expense-save>저장</button>'
      + (custom?'<button type="button" class="olliExpenseEndButton" data-expense-end>'+endLabel+'</button>':'')
      + '</div>'
      + '</div>';
  }

  function renderExpenseSection(){
    const expenses=financeExpensePayload();
    const items=Array.isArray(expenses.items) ? expenses.items : [];
    const basicOrder={rent:10,maintenance:20,materials:30,franchise_royalty:40,tax_accounting:50};
    const basic=items.filter(item=>String(item?.system_key || ''))
      .sort((a,b)=>(basicOrder[String(a?.system_key || '')] || 999)-(basicOrder[String(b?.system_key || '')] || 999));
    const custom=items.filter(item=>!String(item?.system_key || ''));
    const missing=Math.max(0,Number(expenses.missing_monthly_count || 0));
    return '<section class="olliExpenseSection" data-expense-section>'
      + '<div class="olliExpenseSectionHead"><div><div class="olliExpenseSectionTitle">운영 지출</div>'
      + '<div class="olliExpenseSectionText">월세처럼 유지되는 비용은 다음 달에도 이어집니다. 재료비는 매달 유지 또는 이번 달 입력 방식으로 선택할 수 있습니다.</div></div>'
      + '<div class="olliExpenseHeadSide"><div class="olliExpenseTotal"><span>운영 지출</span><strong>'+money(expenses.total_amount || 0)+'</strong></div>'
      + '<button type="button" class="olliExpenseHistoryToggle'+(state.expenseHistoryOpen?' is-active':'')+'" data-expense-history-toggle>변경 기록</button></div></div>'
      + (missing?'<div class="olliExpenseMissingNotice">이번 달 아직 입력하지 않은 월별 지출이 <strong>'+missing+'개</strong> 있습니다. 현재 총액에는 포함되지 않습니다.</div>':'')
      + '<div class="olliExpenseGroup"><div class="olliExpenseGroupTitle">기본 지출</div>'
      + (basic.length?basic.map(renderExpenseItem).join(''):'<div class="olliExpenseEmpty">기본 지출 항목을 불러오지 못했습니다.</div>')
      + '</div>'
      + '<div class="olliExpenseGroup"><div class="olliExpenseGroupTitle">추가 지출</div>'
      + (custom.length?custom.map(renderExpenseItem).join(''):'<div class="olliExpenseEmpty compact">추가한 광고·프로그램·기타 지출이 없습니다.</div>')
      + '<div class="olliExpenseAddActions">'
      + '<button type="button" data-expense-add="advertising">+ 광고 추가</button>'
      + '<button type="button" data-expense-add="program">+ 프로그램 추가</button>'
      + '<button type="button" data-expense-add="other">+ 기타 지출</button>'
      + '</div><div data-expense-add-form></div></div>'
      + '<div class="olliExpenseHistoryPanel'+(state.expenseHistoryOpen?' is-open':'')+'" data-expense-history-panel>'
      + (state.expenseHistoryOpen?'<div class="olliExpenseHistoryLoading">변경 기록을 불러오는 중...</div>':'')
      + '</div>'
      + '</section>';
  }

  function expenseAddPreset(kind){
    if(kind==='advertising') return {title:'광고 추가',category:'advertising',recurrence:'recurring',namePlaceholder:'예: 당근 광고'};
    if(kind==='program') return {title:'프로그램·구독 추가',category:'program',recurrence:'recurring',namePlaceholder:'예: Adobe'};
    return {title:'기타 지출 추가',category:'other',recurrence:'one_time',namePlaceholder:'예: 프린터 구입'};
  }

  function showExpenseAddForm(kind){
    const target=detailElements().body?.querySelector('[data-expense-add-form]');
    if(!target) return;
    const preset=expenseAddPreset(kind);
    const recurrenceField=preset.category==='other'
      ? '<label><span>방식</span><select data-expense-new-recurrence><option value="one_time">이번 달만</option><option value="recurring">매달 유지</option><option value="monthly">매월 입력</option></select></label>'
      : '';
    target.innerHTML='<div class="olliExpenseAddForm" data-expense-add-card data-category="'+preset.category+'" data-default-recurrence="'+preset.recurrence+'">'
      + '<div class="olliExpenseAddTitle">'+preset.title+'</div>'
      + '<div class="olliExpenseAddGrid">'
      + '<label><span>항목 이름</span><input type="text" maxlength="80" placeholder="'+preset.namePlaceholder+'" data-expense-new-name></label>'
      + '<label><span>금액</span><div class="olliExpenseAddAmount"><input type="text" inputmode="numeric" maxlength="13" autocomplete="off" placeholder="0" data-expense-new-amount><span>원</span></div></label>'
      + recurrenceField
      + '</div><div class="olliExpenseAddFooter">'
      + '<button type="button" class="secondary" data-expense-add-cancel>취소</button>'
      + '<button type="button" class="primary" data-expense-add-save>추가</button>'
      + '</div></div>';
    const card=target.querySelector('[data-expense-add-card]');
    target.querySelector('[data-expense-add-cancel]')?.addEventListener('click',()=>{ target.innerHTML=''; });
    target.querySelector('[data-expense-add-save]')?.addEventListener('click',()=>createExpenseItem(card));
    bindCurrencyInput(target.querySelector('[data-expense-new-amount]'));
    target.querySelector('[data-expense-new-name]')?.focus();
  }

  function newExpenseRequestId(){
    if(global.crypto?.randomUUID) return global.crypto.randomUUID();
    const bytes=new Uint8Array(16);
    if(global.crypto?.getRandomValues) global.crypto.getRandomValues(bytes);
    else for(let i=0;i<bytes.length;i+=1) bytes[i]=Math.floor(Math.random()*256);
    bytes[6]=(bytes[6]&15)|64;
    bytes[8]=(bytes[8]&63)|128;
    const hex=[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
    return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  }

  function expenseMutationId(node,key,kind){
    if(!node) return newExpenseRequestId();
    const prefix=kind==='end'
      ? '__olliExpenseEnd'
      : (kind==='restore' ? '__olliExpenseRestore' : '__olliExpenseSave');
    if(node[prefix+'Key']!==key || !node[prefix+'Id']){
      node[prefix+'Key']=key;
      node[prefix+'Id']=newExpenseRequestId();
    }
    return node[prefix+'Id'];
  }

  function clearExpenseMutationId(node,kind){
    if(!node) return;
    const prefix=kind==='end'
      ? '__olliExpenseEnd'
      : (kind==='restore' ? '__olliExpenseRestore' : '__olliExpenseSave');
    delete node[prefix+'Key'];
    delete node[prefix+'Id'];
  }

  async function handleExpenseConflict(payload,node,kind){
    if(!payload?.conflict) return false;
    clearExpenseMutationId(node,kind);
    await loadOverview();
    alert(payload?.message || '다른 기기에서 지출 내용이 변경되었습니다. 최신 값을 다시 불러왔습니다.');
    return true;
  }

  async function createExpenseItem(card){
    if(!card || !isOwner()) return false;
    const name=String(card.querySelector('[data-expense-new-name]')?.value || '').trim();
    const rawAmount=String(card.querySelector('[data-expense-new-amount]')?.value || '').trim();
    const category=String(card.dataset.category || '').trim();
    const recurrence=String(card.querySelector('[data-expense-new-recurrence]')?.value || card.dataset.defaultRecurrence || '').trim();
    if(!name){ alert('지출 항목 이름을 입력해 주세요.'); return false; }
    if(rawAmount===''){ alert('금액을 입력해 주세요.'); return false; }
    const amount=currencyInputAmount(rawAmount);
    if(!Number.isFinite(amount) || amount<0 || amount>1000000000){ alert('지출 금액을 확인해 주세요.'); return false; }
    const requestKey=['new',category,recurrence,state.month,name,amount].join('|');
    const requestId=expenseMutationId(card,requestKey,'save');
    const button=card.querySelector('[data-expense-add-save]');
    if(button){button.disabled=true;button.textContent='추가 중';}
    try{
      const payload=await rpc('olli_academy_expense_save',{
        p_session_token:sessionToken(),
        p_academy_id:academyId(),
        p_request_id:requestId,
        p_expected_revision:0,
        p_item_id:null,
        p_system_key:null,
        p_category:category,
        p_name:name,
        p_recurrence_mode:recurrence,
        p_start_month:monthDateValue(state.month),
        p_month:monthDateValue(state.month),
        p_amount:amount,
        p_note:null
      });
      if(await handleExpenseConflict(payload,card,'save')) return false;
      if(!payload?.ok) throw new Error(payload?.message || '지출 항목을 추가하지 못했습니다.');
      const reloaded=await loadOverview();
      if(!reloaded) return false;
      clearExpenseMutationId(card,'save');
      return true;
    }catch(error){
      alert('지출 항목 추가 실패\n'+(error?.message || error));
      return false;
    }finally{
      if(button){button.disabled=false;button.textContent='추가';}
    }
  }

  async function saveExpenseRow(row){
    if(!row || !isOwner()) return false;
    const rawAmount=String(row.querySelector('[data-expense-amount]')?.value || '').trim();
    if(rawAmount===''){ alert('금액을 입력해 주세요.'); return false; }
    const amount=currencyInputAmount(rawAmount);
    if(!Number.isFinite(amount) || amount<0 || amount>1000000000){ alert('지출 금액을 확인해 주세요.'); return false; }

    const itemId=String(row.dataset.itemId || '').trim();
    const systemKey=String(row.dataset.systemKey || '').trim();
    const custom=row.dataset.custom==='1';
    const revision=Math.max(0,Number(row.dataset.revision || 0));
    const category=String(row.dataset.category || '').trim();
    const recurrence=String(row.querySelector('[data-expense-recurrence]')?.value || row.dataset.recurrence || '').trim();
    const startMonth=String(row.dataset.startMonth || state.month).trim();
    const name=custom
      ? String(row.querySelector('[data-expense-name]')?.value || '').trim()
      : '';
    const saveButton=row.querySelector('[data-expense-save]');
    if(custom && !name){ alert('지출 항목 이름을 입력해 주세요.'); return false; }

    const requestKey=[
      'save',itemId,systemKey,revision,category,recurrence,startMonth,state.month,name,amount
    ].join('|');
    const requestId=expenseMutationId(row,requestKey,'save');

    if(saveButton){saveButton.disabled=true;saveButton.textContent='저장 중';}
    try{
      const payload=await rpc('olli_academy_expense_save',{
        p_session_token:sessionToken(),
        p_academy_id:academyId(),
        p_request_id:requestId,
        p_expected_revision:revision,
        p_item_id:itemId || null,
        p_system_key:systemKey || null,
        p_category:category,
        p_name:name,
        p_recurrence_mode:recurrence,
        p_start_month:monthDateValue(startMonth),
        p_month:monthDateValue(state.month),
        p_amount:amount,
        p_note:null
      });
      if(await handleExpenseConflict(payload,row,'save')) return false;
      if(!payload?.ok) throw new Error(payload?.message || '지출 금액을 저장하지 못했습니다.');
      const reloaded=await loadOverview();
      if(!reloaded) return false;
      clearExpenseMutationId(row,'save');
      return true;
    }catch(error){
      alert('지출 저장 실패\n'+(error?.message || error));
      return false;
    }finally{
      if(saveButton){saveButton.disabled=false;saveButton.textContent='저장';}
    }
  }

  async function endExpenseItem(row){
    if(!row || !isOwner() || row.dataset.custom!=='1') return false;
    const itemId=String(row.dataset.itemId || '').trim();
    const revision=Math.max(0,Number(row.dataset.revision || 0));
    const name=String(row.querySelector('[data-expense-name]')?.value || '지출 항목').trim() || '지출 항목';
    const recurrence=String(row.dataset.recurrence || '');
    const question=recurrence==='one_time'
      ? name+' 항목을 목록에서 삭제할까요?\n저장 기록은 보존됩니다.'
      : name+' 항목을 '+state.month+'부터 종료할까요?\n이전 달 기록은 그대로 유지됩니다.';
    if(!global.confirm(question)) return false;

    const requestKey=['end',itemId,revision,state.month].join('|');
    const requestId=expenseMutationId(row,requestKey,'end');
    const button=row.querySelector('[data-expense-end]');
    if(button){button.disabled=true;button.textContent='처리 중';}
    try{
      const payload=await rpc('olli_academy_expense_item_end',{
        p_session_token:sessionToken(),
        p_academy_id:academyId(),
        p_request_id:requestId,
        p_expected_revision:revision,
        p_item_id:itemId,
        p_end_month:monthDateValue(state.month)
      });
      if(await handleExpenseConflict(payload,row,'end')) return false;
      if(!payload?.ok) throw new Error(payload?.message || '지출 항목을 종료하지 못했습니다.');
      const reloaded=await loadOverview();
      if(!reloaded) return false;
      clearExpenseMutationId(row,'end');
      return true;
    }catch(error){
      alert('지출 항목 처리 실패\n'+(error?.message || error));
      return false;
    }finally{
      if(button){button.disabled=false;button.textContent=recurrence==='one_time'?'삭제':'종료';}
    }
  }

  function expenseHistoryTime(value){
    const raw=String(value || '').trim();
    if(!raw) return '';
    const date=new Date(raw);
    if(Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('ko-KR',{
      month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'
    });
  }

  function expenseHistoryAmount(stateValue){
    if(!stateValue || stateValue.effective_amount==null) return null;
    const amount=Number(stateValue.effective_amount);
    return Number.isFinite(amount) ? money(amount) : null;
  }

  function expenseHistorySummary(item){
    const type=String(item?.event_type || '');
    const before=item?.before_state && typeof item.before_state==='object' ? item.before_state : null;
    const after=item?.after_state && typeof item.after_state==='object' ? item.after_state : null;
    const beforeName=String(before?.name || '');
    const afterName=String(after?.name || beforeName || '지출 항목');
    const beforeAmount=expenseHistoryAmount(before);
    const afterAmount=expenseHistoryAmount(after);

    if(type==='create') return afterName+' 추가'+(afterAmount?' · '+afterAmount:'');
    if(type==='end') return afterName+' 종료';
    if(type==='restore') return afterName+' 이전 상태로 복구';

    const parts=[];
    if(beforeName && afterName && beforeName!==afterName){
      parts.push(beforeName+' → '+afterName);
    }else{
      parts.push(afterName);
    }
    if(beforeAmount!==afterAmount){
      parts.push((beforeAmount || '미입력')+' → '+(afterAmount || '미입력'));
    }else if(afterAmount){
      parts.push(afterAmount);
    }
    return parts.join(' · ');
  }

  function renderExpenseHistoryEvents(events){
    const list=Array.isArray(events) ? events : [];
    if(!list.length){
      return '<div class="olliExpenseHistoryEmpty">이 달에 저장된 변경 기록이 없습니다.</div>';
    }
    return list.map(item=>{
      const canRestore=item?.can_restore===true;
      const eventId=String(item?.event_id || '');
      const revision=Math.max(0,Number(item?.current_revision || 0));
      const meta=[String(item?.actor_name || '원장'),expenseHistoryTime(item?.created_at)].filter(Boolean).join(' · ');
      return '<div class="olliExpenseHistoryRow">'
        + '<div class="olliExpenseHistoryRowMain"><div class="olliExpenseHistorySummary">'+esc(expenseHistorySummary(item))+'</div>'
        + '<div class="olliExpenseHistoryMeta">'+esc(meta)+'</div></div>'
        + (canRestore
          ? '<button type="button" class="olliExpenseRestoreButton" data-expense-restore data-event-id="'+esc(eventId)+'" data-revision="'+esc(revision)+'">이전 상태로 복구</button>'
          : '')
        + '</div>';
    }).join('');
  }

  async function loadExpenseHistory(){
    if(!state.expenseHistoryOpen) return false;
    const panel=detailElements().body?.querySelector('[data-expense-history-panel]');
    if(!panel) return false;
    const month=state.month;
    const requestSeq=++state.expenseHistoryRequestSeq;
    state.expenseHistoryLoading=true;
    panel.classList.add('is-open');
    panel.innerHTML='<div class="olliExpenseHistoryLoading">변경 기록을 불러오는 중...</div>';
    try{
      const payload=await rpc('olli_academy_expense_history',{
        p_session_token:sessionToken(),
        p_academy_id:academyId(),
        p_month:monthDateValue(month),
        p_item_id:null,
        p_limit:50
      });
      if(!payload?.ok) throw new Error(payload?.message || '변경 기록을 불러오지 못했습니다.');
      if(!state.expenseHistoryOpen || state.month!==month || state.expenseHistoryRequestSeq!==requestSeq) return false;
      const currentPanel=detailElements().body?.querySelector('[data-expense-history-panel]');
      if(!currentPanel) return false;
      currentPanel.innerHTML='<div class="olliExpenseHistoryHead"><strong>'+esc(month.replace('-', '.'))+' 변경 기록</strong><span>가장 최근 변경부터 안전하게 복구할 수 있습니다.</span></div>'
        + renderExpenseHistoryEvents(payload.events);
      currentPanel.querySelectorAll('[data-expense-restore]').forEach(button=>{
        button.addEventListener('click',()=>restoreExpenseHistory(button));
      });
      return true;
    }catch(error){
      const currentPanel=detailElements().body?.querySelector('[data-expense-history-panel]');
      if(currentPanel && state.expenseHistoryOpen && state.month===month && state.expenseHistoryRequestSeq===requestSeq){
        currentPanel.innerHTML='<div class="olliExpenseHistoryEmpty">변경 기록을 불러오지 못했습니다.<br><small>'+esc(error?.message || error)+'</small></div>';
      }
      return false;
    }finally{
      if(state.expenseHistoryRequestSeq===requestSeq) state.expenseHistoryLoading=false;
    }
  }

  function toggleExpenseHistory(){
    state.expenseHistoryOpen=!state.expenseHistoryOpen;
    const body=detailElements().body;
    const panel=body?.querySelector('[data-expense-history-panel]');
    const button=body?.querySelector('[data-expense-history-toggle]');
    button?.classList.toggle('is-active',state.expenseHistoryOpen);
    if(!panel) return;
    panel.classList.toggle('is-open',state.expenseHistoryOpen);
    if(!state.expenseHistoryOpen){
      state.expenseHistoryRequestSeq+=1;
      state.expenseHistoryLoading=false;
      panel.innerHTML='';
      return;
    }
    loadExpenseHistory();
  }

  async function restoreExpenseHistory(button){
    if(!button || !isOwner()) return false;
    const eventId=String(button.dataset.eventId || '').trim();
    const revision=Math.max(0,Number(button.dataset.revision || 0));
    if(!eventId) return false;
    if(!global.confirm('이 변경 직전 상태로 복구할까요?\n복구 자체도 변경 기록에 남습니다.')) return false;

    const requestKey=['restore',eventId,revision].join('|');
    const requestId=expenseMutationId(button,requestKey,'restore');
    button.disabled=true;
    button.textContent='복구 중';
    try{
      const payload=await rpc('olli_academy_expense_restore',{
        p_session_token:sessionToken(),
        p_academy_id:academyId(),
        p_request_id:requestId,
        p_expected_revision:revision,
        p_event_id:eventId
      });
      if(await handleExpenseConflict(payload,button,'restore')) return false;
      if(!payload?.ok) throw new Error(payload?.message || '지출 변경을 복구하지 못했습니다.');
      const reloaded=await loadOverview();
      if(!reloaded) return false;
      clearExpenseMutationId(button,'restore');
      return true;
    }catch(error){
      alert('지출 복구 실패\n'+(error?.message || error));
      return false;
    }finally{
      button.disabled=false;
      button.textContent='이전 상태로 복구';
    }
  }

  function bindExpenseEvents(body){
    if(!body) return;
    body.querySelectorAll('[data-expense-row]').forEach(row=>{
      bindCurrencyInput(row.querySelector('[data-expense-amount]'));
      row.querySelector('[data-expense-save]')?.addEventListener('click',()=>saveExpenseRow(row));
      row.querySelector('[data-expense-end]')?.addEventListener('click',()=>endExpenseItem(row));
    });
    body.querySelectorAll('[data-expense-add]').forEach(button=>{
      button.addEventListener('click',()=>showExpenseAddForm(String(button.dataset.expenseAdd || 'other')));
    });
    body.querySelector('[data-expense-history-toggle]')?.addEventListener('click',toggleExpenseHistory);
  }

  function renderFinanceSummary(){
    const payload=state.payload || {};
    const expenses=financeExpensePayload();
    const expenseTotal=Math.max(0,Number(payload.expense_total_amount || expenses.total_amount || 0));
    const payrollTotal=Math.max(0,Number(payload.payroll_total_amount || 0));
    const total=Math.max(0,Number(payload.total_amount || (expenseTotal+payrollTotal)));
    const missingMonthly=Math.max(0,Number(expenses.missing_monthly_count || 0));
    const parts=String(state.month || '').split('-');
    const monthLabel=parts.length===2 ? Number(parts[0])+'년 '+Number(parts[1])+'월' : '이번 달';
    const future=selectedMonthIsFuture();
    const totalLabel=missingMonthly>0
      ? (future?'현재 입력 기준 예상 총지출':'현재 입력 기준 총지출')
      : (future?'예상 총지출':'총지출');
    const completionText=missingMonthly>0
      ? '월별 지출 미입력 '+missingMonthly+'건'
      : (future?'현재 설정 기준 예상 금액':'월별 지출 입력 완료');

    return '<section class="olliFinanceSummary'+(missingMonthly>0?' is-incomplete':' is-complete')+'" data-finance-summary>'
      + '<div class="olliFinanceSummaryHero"><span>'+esc(monthLabel)+' '+totalLabel+'</span><strong>'+money(total)+'</strong>'
      + '<div class="olliFinanceSummaryStatus">'+esc(completionText)+'</div></div>'
      + '<div class="olliFinanceSummaryBreakdown">'
      + '<div><span>운영 지출'+(future?' · 예상':'')+'</span><strong>'+money(expenseTotal)+'</strong></div>'
      + '<div><span>선생님 급여'+(future?' · 예상':'')+'</span><strong>'+money(payrollTotal)+'</strong></div>'
      + '</div></section>';
  }

  function renderPayrollWarnings(payroll){
    const warnings=(Array.isArray(payroll?.warnings) ? payroll.warnings : [])
      .filter(item=>String(item?.type || '')!=='historical_payroll_unfinalized');
    if(!warnings.length) return '';
    return '<div class="olliPayrollWarnings">'
      + warnings.map(item=>'<div class="olliPayrollWarning">'+esc(item?.message || '대체근무 급여 설정을 확인해 주세요.')+'</div>').join('')
      + '</div>';
  }

  function renderPayrollSection(payroll,teachers){
    return '<section class="olliFinancePayrollSection">'
      + '<div class="olliPayrollIntro"><div class="olliPayrollIntroTitle">선생님 급여</div>'
      + '<div class="olliPayrollIntroText">선택한 달에 실제 지급되는 급여를 보여줍니다. 지급 전에는 예상 금액, 지급 후에는 고정된 금액을 표시합니다.</div></div>'
      + renderPayrollWarnings(payroll)
      + (teachers.length ? teachers.map(renderTeacherCard).join('') : '<div class="olliPayrollEmpty">급여를 설정할 선생님이 없습니다.</div>')
      + '</section>';
  }

  function financeTabHtml(){
    const active=state.financeTab==='payroll' ? 'payroll' : 'expenses';
    return '<div class="olliFinanceTabs" role="tablist" aria-label="급여 및 지출 보기">'
      + '<button type="button" role="tab" class="'+(active==='expenses'?'is-active':'')+'" aria-selected="'+(active==='expenses'?'true':'false')+'" data-finance-tab="expenses">운영 지출</button>'
      + '<button type="button" role="tab" class="'+(active==='payroll'?'is-active':'')+'" aria-selected="'+(active==='payroll'?'true':'false')+'" data-finance-tab="payroll">선생님 급여</button>'
      + '</div>';
  }

  function setFinanceTab(tab,body){
    const next=tab==='payroll' ? 'payroll' : 'expenses';
    state.financeTab=next;
    const root=body || detailElements().body;
    if(!root) return;
    root.querySelectorAll('[data-finance-tab]').forEach(button=>{
      const active=String(button.dataset.financeTab || '')===next;
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-selected',active?'true':'false');
    });
    root.querySelector('.olliFinanceExpensesColumn')?.classList.toggle('is-active',next==='expenses');
    root.querySelector('.olliFinancePayrollColumn')?.classList.toggle('is-active',next==='payroll');
  }

  function bindFinanceTabs(body){
    if(!body) return;
    body.querySelectorAll('[data-finance-tab]').forEach(button=>{
      button.addEventListener('click',()=>setFinanceTab(String(button.dataset.financeTab || ''),body));
    });
    setFinanceTab(state.financeTab,body);
  }

  function renderMonthPickerYear(panel,year){
    if(!panel) return;
    const safeYear=Math.max(2000,Math.min(2100,Math.round(Number(year) || Number(String(state.month || currentMonthValue()).slice(0,4)))));
    panel.dataset.pickerYear=String(safeYear);
    panel.innerHTML=monthPickerBody(safeYear);
  }

  function bindMonthPicker(body){
    if(!body) return;
    const field=body.querySelector('.olliPayrollMonthField');
    const toggle=field?.querySelector('[data-payroll-month-toggle]');
    const panel=field?.querySelector('[data-payroll-month-picker]');
    if(!field || !toggle || !panel) return;

    toggle.addEventListener('click',()=>{
      const open=panel.hidden;
      if(open){
        renderMonthPickerYear(panel,Number(String(state.month || currentMonthValue()).slice(0,4)));
      }
      panel.hidden=!open;
      toggle.setAttribute('aria-expanded',open?'true':'false');
      field.classList.toggle('is-picker-open',open);
    });

    panel.addEventListener('click',(event)=>{
      const yearStep=event.target.closest('[data-payroll-year-step]');
      if(yearStep){
        const nextYear=Number(panel.dataset.pickerYear || String(state.month).slice(0,4))
          + Number(yearStep.dataset.payrollYearStep || 0);
        renderMonthPickerYear(panel,nextYear);
        return;
      }
      const monthButton=event.target.closest('[data-payroll-month-option]');
      if(!monthButton) return;
      const year=Math.max(2000,Math.min(2100,Number(panel.dataset.pickerYear || 0)));
      const month=Math.max(1,Math.min(12,Number(monthButton.dataset.payrollMonthOption || 0)));
      const next=year+'-'+String(month).padStart(2,'0');
      panel.hidden=true;
      toggle.setAttribute('aria-expanded','false');
      field.classList.remove('is-picker-open');
      if(next!==state.month){
        state.month=next;
        loadOverview();
      }
    });
  }

  function render(){
    const els = detailElements();
    if(!els.body) return;
    const payload = state.payload || {};
    const payroll = financePayrollPayload();
    const teachers = Array.isArray(payroll.teachers) ? payroll.teachers : [];
    const month = String(payload.month || payroll.month || state.month || currentMonthValue()).slice(0,7);
    state.month = /^\d{4}-\d{2}$/.test(month) ? month : currentMonthValue();
    const pickerYear = Number(String(state.month || currentMonthValue()).slice(0,4));

    els.body.innerHTML = '<div class="olliPayrollPage">'
      + '<div class="olliFinanceTop">'
      + '<div class="olliPayrollMonthField"><span>조회 월</span>'
      + '<input class="olliPayrollNativeMonth" type="month" value="'+esc(state.month)+'" data-payroll-month>'
      + '<button type="button" class="olliPayrollMonthToggle" data-payroll-month-toggle aria-haspopup="dialog" aria-expanded="false"><span>'+esc(monthDisplayLabel(state.month))+'</span><i aria-hidden="true"></i></button>'
      + '<div class="olliPayrollMonthPicker" data-payroll-month-picker data-picker-year="'+pickerYear+'" hidden>'+monthPickerBody(pickerYear)+'</div>'
      + '</div>'
      + renderFinanceSummary()
      + '</div>'
      + financeTabHtml()
      + '<div class="olliFinanceColumns">'
      + '<div class="olliFinanceExpensesColumn'+(state.financeTab==='expenses'?' is-active':'')+'">'+renderExpenseSection()+'</div>'
      + '<div class="olliFinancePayrollColumn'+(state.financeTab==='payroll'?' is-active':'')+'">'+renderPayrollSection(payroll,teachers)+'</div>'
      + '</div>'
      + '</div>';

    els.body.querySelector('[data-payroll-month]')?.addEventListener('change',function(event){
      const next = String(event.target.value || '').trim();
      if(/^\d{4}-\d{2}$/.test(next) && next !== state.month){
        state.month = next;
        loadOverview();
      }
    });

    bindMonthPicker(els.body);
    bindFinanceTabs(els.body);
    bindExpenseEvents(els.body);
    if(state.expenseHistoryOpen) loadExpenseHistory();

    els.body.querySelectorAll('[data-payroll-teacher-card]').forEach(card => {
      card.querySelectorAll('[data-payroll-monthly-salary],[data-payroll-hourly-wage],[data-payroll-day-hours]').forEach(input => {
        input.addEventListener('input',()=>calculateCard(card));
      });
      card.querySelector('[data-payroll-deduction-mode]')?.addEventListener('change',()=>calculateCard(card));
      card.querySelector('[data-payroll-save]')?.addEventListener('click',()=>saveTeacher(card));
      calculateCard(card);
    });
  }

  async function loadOverview(){
    const els = openDetailShell();
    if(!els || state.loading) return false;
    if(!isOwner()){
      els.body.innerHTML='<div class="olliPayrollEmpty">급여 및 지출 관리는 원장만 확인할 수 있습니다.</div>';
      return false;
    }
    const academy = academyId();
    const token = sessionToken();
    if(!academy || !token){
      els.body.innerHTML='<div class="olliPayrollEmpty">로그인 정보 또는 현재 학원을 확인해 주세요.</div>';
      return false;
    }
    state.loading=true;
    els.body.innerHTML='<div class="settingsLoadingText">급여와 지출 정보를 불러오고 있습니다...</div>';
    try{
      const payload=await rpc('olli_academy_finance_overview',{
        p_session_token:token,
        p_academy_id:academy,
        p_month:monthDateValue(state.month)
      });
      if(!payload?.ok) throw new Error(payload?.message || '급여와 지출 정보를 불러오지 못했습니다.');
      state.payload=payload;
      render();
      return true;
    }catch(error){
      els.body.innerHTML='<div class="olliPayrollEmpty">급여와 지출 정보를 불러오지 못했습니다.<br><small>'+esc(error?.message || error)+'</small></div>';
      return false;
    }finally{
      state.loading=false;
    }
  }

  async function saveTeacher(card){
    if(!card || !isOwner()) return false;
    if(card.dataset.payrollFinalized==='1') return false;
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
    const deductionMode=String(card.querySelector('[data-payroll-deduction-mode]')?.value || 'none')==='freelancer_33'
      ? 'freelancer_33'
      : 'none';
    if(button){button.disabled=true;button.textContent='저장 중';}
    if(status) status.textContent='';
    try{
      const payload=await rpc('olli_teacher_payroll_setting_upsert_v3',{
        p_session_token:sessionToken(),
        p_academy_id:academyId(),
        p_teacher_member_id:teacherId,
        p_monthly_salary:monthlySalary,
        p_hourly_wage:wage,
        p_payday:payday,
        p_weekday_hours:weekdayHours,
        p_deduction_mode:deductionMode,
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
    await syncDueNotifications();
    return loadOverview();
  }

  function isPayrollMessage(item){
    if(String(item?.message_type || '').trim() !== 'ai') return false;
    if(String(item?.sender_name || '').trim() !== '올리') return false;
    const body=String(item?.body || '').trim();
    const notificationId=String(item?.client_message_id || '').trim();
    return /^\d{1,2}월 \d{1,2}일 급여 지급 안내(?:\n|$)/.test(body)
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notificationId);
  }

  function statementDayNumber(value){
    const match=String(value || '').match(/^\d{4}-\d{2}-(\d{2})$/);
    return match ? String(Number(match[1])) : '';
  }

  function statementHours(value){
    const n=Math.max(0,Number(value || 0));
    return (Math.round(n*100)/100).toLocaleString('ko-KR');
  }

  function payrollStatementRows(days,type){
    const source=Array.isArray(days) ? days : [];
    const groups=WEEKDAYS.map(day=>{
      const rows=source.filter(item=>Number(item?.weekday)===Number(day.key))
        .sort((a,b)=>String(a?.date || '').localeCompare(String(b?.date || '')));
      if(!rows.length) return '';
      const workedRows=type==='regular'
        ? rows.filter(item=>String(item?.status || '')==='normal' && Number(item?.hours || 0)>0)
        : rows.filter(item=>Number(item?.hours || 0)>0);
      const totalHours=workedRows.reduce((sum,item)=>sum+Math.max(0,Number(item?.hours || 0)),0);
      const dateHtml=rows.map(item=>{
        const dayNumber=statementDayNumber(item?.date);
        const status=String(item?.status || '');
        if(type==='regular' && status==='holiday'){
          return '<span class="olliPayrollStatementDate holiday" aria-label="'+dayNumber+'일 공휴일">'+dayNumber+'</span>';
        }
        if(type==='regular' && status==='absent'){
          return '<span class="olliPayrollStatementDate absent" aria-label="'+dayNumber+'일 결근일">'+dayNumber+'</span>';
        }
        return '<span class="olliPayrollStatementDate">'+dayNumber+'</span>';
      }).join('');
      return '<div class="olliPayrollStatementWorkRow">'
        + '<strong>'+day.label+'요일</strong>'
        + '<div class="olliPayrollStatementDates">'+dateHtml+'</div>'
        + '<span class="olliPayrollStatementWorkTotal">'+workedRows.length+'회 · '+statementHours(totalHours)+'시간</span>'
        + '</div>';
    }).filter(Boolean).join('');
    return groups || '<div class="olliPayrollStatementEmpty">해당 근무가 없습니다.</div>';
  }

  function closePayrollStatement(){
    document.querySelectorAll('.olliPayrollStatementOverlay').forEach(node=>node.remove());
  }

  function renderPayrollStatementModal(payload){
    const statement=payload?.statement && typeof payload.statement==='object' ? payload.statement : {};
    const payDate=String(statement.pay_date || '');
    const payMatch=payDate.match(/^\d{4}-(\d{2})-(\d{2})$/);
    const payLabel=payMatch ? Number(payMatch[1])+'월 '+Number(payMatch[2])+'일' : '급여';
    const teacherName=String(statement.teacher_name || '선생님').trim() || '선생님';
    const periodStart=shortMonthDay(statement.period_start);
    const periodEnd=shortMonthDay(statement.period_end);
    const payType=String(statement.pay_type || 'hourly');
    const deductionMode=String(statement.deduction_mode || 'none');
    const gross=Math.max(0,Number(statement.gross_amount || 0));
    const deduction=Math.max(0,Number(statement.deduction_amount || 0));
    const net=Math.max(0,Number(statement.net_amount || 0));
    const totalHours=Math.max(0,Number(statement.total_hours || 0));
    const hourlyWage=Math.max(0,Number(statement.hourly_wage || 0));
    const monthlySalary=Math.max(0,Number(statement.monthly_salary || 0));

    closePayrollStatement();
    const overlay=document.createElement('div');
    overlay.className='olliPayrollStatementOverlay';
    overlay.innerHTML='<section class="olliPayrollStatementPanel" role="dialog" aria-modal="true" aria-label="'+esc(payLabel+' 지급 급여명세서')+'">'
      + '<div class="olliPayrollStatementHead">'
      + '<div><div class="olliPayrollStatementTitle">'+esc(payLabel)+' 지급 급여명세서</div>'
      + '<div class="olliPayrollStatementSub">'+esc(teacherName)+(periodStart&&periodEnd?' · 계산기간 '+esc(periodStart+'~'+periodEnd):'')+'</div></div>'
      + '<button type="button" class="olliPayrollStatementClose" aria-label="닫기">×</button></div>'
      + '<div class="olliPayrollStatementScroll">'
      + '<div class="olliPayrollStatementSection"><h3>정기근무</h3>'
      + payrollStatementRows(statement.regular_days,'regular')+'</div>'
      + '<div class="olliPayrollStatementSection"><h3>대체근무</h3>'
      + payrollStatementRows(statement.substitute_days,'substitute')+'</div>'
      + '<div class="olliPayrollStatementSection totals"><h3>급여 계산</h3>'
      + (payType==='monthly'
        ? '<div class="olliPayrollStatementCalcLine"><span>월급</span><strong>'+money(monthlySalary || gross)+'</strong></div>'
        : '<div class="olliPayrollStatementCalcLine"><span>총 '+statementHours(totalHours)+'시간 × '+money(hourlyWage)+' (시급)</span><strong>'+money(gross)+'</strong></div>')
      + (deductionMode==='freelancer_33'
        ? '<div class="olliPayrollStatementCalcLine"><span>프리랜서 3.3% 공제</span><strong>- '+money(deduction)+'</strong></div>'
        : '')
      + '<div class="olliPayrollStatementPay"><span>당일 지급 급여</span><strong>'+money(net)+'</strong></div>'
      + '</div>'
      + '<div class="olliPayrollStatementGuide">'
      + '<span class="olliPayrollStatementGuideItem"><i class="holiday"></i>공휴일</span>'
      + '<span class="olliPayrollStatementGuideItem"><i class="absent"></i>결근일</span>'
      + '</div>'
      + '</div></section>';
    overlay.addEventListener('click',event=>{
      if(event.target===overlay || event.target.closest('.olliPayrollStatementClose')) closePayrollStatement();
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(()=>overlay.classList.add('show'));
    overlay.querySelector('.olliPayrollStatementClose')?.focus();
  }

  async function openPayrollStatement(notificationId,button){
    const id=String(notificationId || '').trim();
    if(!id) return false;
    const original=button?.textContent || '급여명세서 보기';
    if(button){button.disabled=true;button.textContent='불러오는 중';}
    try{
      const payload=await rpc('olli_teacher_payroll_statement_get',{
        p_session_token:sessionToken(),
        p_academy_id:academyId(),
        p_notification_id:id
      });
      if(!payload?.ok) throw new Error(payload?.message || '급여명세서를 불러오지 못했습니다.');
      renderPayrollStatementModal(payload);
      return true;
    }catch(error){
      console.warn('급여명세서 확인 실패:',error);
      alert(error?.message || '급여명세서를 불러오지 못했습니다.');
      return false;
    }finally{
      if(button){button.disabled=false;button.textContent=original;}
    }
  }

  function createTeamChatPayrollButton(item,platform){
    if(!isPayrollMessage(item)) return null;
    const wrap=document.createElement('div');
    wrap.className='olliPayrollTalkCard '+(platform==='pc'?'pc':'mobile');
    const button=document.createElement('button');
    button.type='button';
    button.className='olliPayrollTalkButton';
    button.textContent='급여명세서 보기';
    button.addEventListener('click',()=>openPayrollStatement(
      String(item?.client_message_id || '').trim(),
      button
    ));
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
