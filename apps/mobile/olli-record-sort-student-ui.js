
(function(){
  const DAYS = ['월','화','수','목','금','토','일'];
  const DAY_NAMES = {0:'일',1:'월',2:'화',3:'수',4:'목',5:'금',6:'토'};
  const SORT_KEY = 'olli_record_sort_settings_v2';
  let studentModalElementaryGroupDraft = '';
  let studentModalPersonalityDraft = '';
  let studentModalScheduleDraft = [];
  let studentModalScheduleOptions = [];
  let studentModalScheduleLoading = false;
  let studentModalScheduleOpen = false;
  let studentModalScheduleDivision = 'elementary';

  function getSortSettings(){
    try { return Object.assign({ enabled:true, criteria:'initial' }, JSON.parse(localStorage.getItem(SORT_KEY) || '{}')); }
    catch(e){ return { enabled:true, criteria:'initial' }; }
  }
  function saveSortSettings(next){ localStorage.setItem(SORT_KEY, JSON.stringify(Object.assign(getSortSettings(), next || {}))); }
  function normalizeDayText(value){ return String(value || '').replace(/요일/g,'').replace(/[·,\/]/g,' ').trim(); }
  function parseDays(value){ const text = normalizeDayText(value); return DAYS.filter(d => text.includes(d)); }
  function daysToText(days){ return (Array.isArray(days) ? days : []).filter(Boolean).join(' · '); }
  function todayKo(){ return DAY_NAMES[(new Date()).getDay()] || '월'; }
  function todayDayIndex(){ const idx = DAYS.indexOf(todayKo()); return idx < 0 ? 0 : idx; }
  function daySortDistance(day){
    const idx = DAYS.indexOf(day);
    if (idx < 0) return 999;
    return (idx - todayDayIndex() + DAYS.length) % DAYS.length;
  }
  function dayRank(student){
    const selected = parseDays(student.lesson_day || student.lessonDay || '');
    if (!selected.length) return 999;
    return Math.min.apply(null, selected.map(daySortDistance));
  }
  function firstHangul(value){
    const name = String(value || '').trim();
    if (!name) return '힣';
    const ch = name.charCodeAt(0);
    if (ch >= 0xAC00 && ch <= 0xD7A3) {
      const choseong = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
      return choseong[Math.floor((ch - 0xAC00) / 588)] || name[0];
    }
    return name[0] || '힣';
  }
  function safeNum(v){ const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 999; }
  function compareBySort(a,b){
    const s = getSortSettings();
    const criterion = s.criteria || 'initial';
    let result = 0;
    if (criterion === 'kindergarten') result = String(a.kindergarten || '').localeCompare(String(b.kindergarten || ''), 'ko');
    if (criterion === 'age') result = safeNum(a.age) - safeNum(b.age);
    if (criterion === 'initial') result = firstHangul(a.name).localeCompare(firstHangul(b.name), 'ko');
    if (criterion === 'lessonDay') result = dayRank(a) - dayRank(b);
    if (result !== 0) return result;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  }
  function statusRank(student){
    try { if (typeof getStudentStatusRank === 'function') return getStudentStatusRank(student); } catch(e){}
    return student && student.status === 'inactive' ? 1 : 0;
  }
  function renderSortIcon(){
    return '<svg viewBox="0 0 28 28" aria-hidden="true">'
      + '<path d="M9.9 4.7h8.1c3.2 0 5 1.8 5 5v8.6c0 3.2-1.8 5-5 5H9.9c-3.2 0-5-1.8-5-5V9.7c0-3.2 1.8-5 5-5Z"></path>'
      + '<circle cx="9.5" cy="10.2" r="1.92" fill="currentColor" stroke="none"></circle>'
      + '<circle cx="9.5" cy="17.7" r="1.58"></circle>'
      + '<path d="M13.9 10.2h5.0"></path>'
      + '<path d="M13.9 17.7h5.0"></path>'
      + '</svg>';
  }
  function renderSortPopup(){
    const s = getSortSettings();
    const chips = [
      ['kindergarten','유치원'], ['age','나이'], ['initial','자음'], ['lessonDay','요일']
    ].map(([key,label]) => '<button type="button" class="recordSortChip '+(s.criteria===key?'active':'')+'" data-sort-criteria="'+key+'">'+label+'</button>').join('');
    return '<div class="recordSortCriteriaTitle">정렬 기준</div><div class="recordSortCriteriaGrid">'+chips+'</div>';
  }
  function installRecordSortButton(){
    const btn = document.getElementById('recordSortBtn');
    const popup = document.getElementById('recordSortPopup');
    if (!btn || !popup || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    function refreshPopup(){
      if (typeof window.refreshRecordSortPopup === 'function') {
        window.refreshRecordSortPopup();
        return;
      }
      if (popup) popup.innerHTML = renderSortPopup();
    }
    refreshPopup();
    btn.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); refreshPopup(); popup.classList.toggle('show'); });
    popup.addEventListener('click', function(ev){
      ev.stopPropagation();
      const legacyChip = ev.target.closest('[data-sort-criteria]');
      if (legacyChip) { saveSortSettings({criteria: legacyChip.dataset.sortCriteria, enabled:true}); refreshPopup(); if (typeof loadRecords === 'function') loadRecords(''); }
    });
    document.addEventListener('click', function(ev){ const wrap = btn.closest('.recordSortWrap'); if (wrap && !wrap.contains(ev.target)) popup.classList.remove('show'); });
  }

  function escapeTeacherHtml(value){
    return String(value || '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
  }
  function renderStudentGroupButtons(containerId, selected, setterName){
    const el = document.getElementById(containerId); if (!el) return;
    const groups = [['1','A'], ['2','B'], ['3','C'], ['4','D'], ['5','E'], ['6','F']];
    el.innerHTML = groups.map(([group,label]) => `<button type="button" class="infoToggleBtn groupIconChoiceBtn ${String(selected||'')===group?'active':''}" onclick="${setterName}('${group}')">${label}</button>`).join('');
  }
  window.__olliPersonalityDropdownOpen = window.__olliPersonalityDropdownOpen || {};
  function getPersonalitySetterName(containerId){
    const map = {
      studentKinderPersonalityToggleRow: 'selectStudentModalPersonality',
      elementaryStudentPersonalityToggleRow: 'selectStudentModalPersonality',
      kinderPersonalityToggleRow: 'selectKinderPersonality',
      elementaryPersonalityToggleRow: 'selectElementaryPersonality'
    };
    return map[containerId] || '';
  }
  function getPersonalitySelectedValue(containerId){
    if (containerId === 'studentKinderPersonalityToggleRow' || containerId === 'elementaryStudentPersonalityToggleRow') return studentModalPersonalityDraft || '';
    if (containerId === 'kinderPersonalityToggleRow') return (kinderInfoDraft && kinderInfoDraft.personality) || '';
    if (containerId === 'elementaryPersonalityToggleRow') return (elementaryInfoDraft && elementaryInfoDraft.personality) || '';
    return '';
  }
  function renderPersonalityButtons(containerId, selected, setterName){
    const el = document.getElementById(containerId); if (!el) return;
    const currentSetterName = setterName || getPersonalitySetterName(containerId);
    const currentSelected = String(selected || getPersonalitySelectedValue(containerId) || '');
    const isOpen = !!window.__olliPersonalityDropdownOpen[containerId];
    const label = currentSelected ? '성향' + currentSelected : '성향';
    const noneOption = '<button type="button" class="infoTeacherOption '+(!currentSelected?'active':'')+'" data-personality-value="" data-personality-container="'+escapeTeacherHtml(containerId)+'" data-personality-setter="'+escapeTeacherHtml(currentSetterName)+'" onclick="handlePersonalityOptionClick(event)">없음</button>';
    const optionButtons = ['A','B','C'].map(value => '<button type="button" class="infoTeacherOption '+(currentSelected===value?'active':'')+'" data-personality-value="'+value+'" data-personality-container="'+escapeTeacherHtml(containerId)+'" data-personality-setter="'+escapeTeacherHtml(currentSetterName)+'" onclick="handlePersonalityOptionClick(event)">성향'+value+'</button>').join('');
    el.innerHTML = '<div class="infoTeacherSelect infoPersonalitySelect '+(isOpen?'open':'')+'"><button type="button" class="infoTeacherSelectBox infoPersonalitySelectBox '+(currentSelected?'':'placeholder')+'" onclick="togglePersonalityDropdown(\''+containerId+'\')"><span>'+escapeTeacherHtml(label)+'</span><i class="infoTeacherArrow" aria-hidden="true"></i></button><div class="infoTeacherDropdown infoPersonalityDropdown">'+noneOption+optionButtons+'</div></div>';
  }
  window.togglePersonalityDropdown = function(containerId){
    window.__olliPersonalityDropdownOpen[containerId] = !window.__olliPersonalityDropdownOpen[containerId];
    renderPersonalityButtons(containerId, getPersonalitySelectedValue(containerId), getPersonalitySetterName(containerId));
  };
  window.handlePersonalityOptionClick = function(event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }
    const btn = event && event.currentTarget ? event.currentTarget : null;
    if (!btn) return;
    const containerId = btn.dataset.personalityContainer || '';
    const value = btn.dataset.personalityValue || '';
    window.__olliPersonalityDropdownOpen[containerId] = false;
    const setter = window[btn.dataset.personalitySetter || ''];
    if (typeof setter === 'function') setter(value);
  };
  window.refreshStudentModalPersonalityDropdowns = function(){
    renderPersonalityButtons('studentKinderPersonalityToggleRow', studentModalPersonalityDraft, 'selectStudentModalPersonality');
    renderPersonalityButtons('elementaryStudentPersonalityToggleRow', studentModalPersonalityDraft, 'selectStudentModalPersonality');
    renderPersonalityButtons('kinderPersonalityToggleRow', (kinderInfoDraft && kinderInfoDraft.personality) || '', 'selectKinderPersonality');
    renderPersonalityButtons('elementaryPersonalityToggleRow', (elementaryInfoDraft && elementaryInfoDraft.personality) || '', 'selectElementaryPersonality');
  };
  function renderStudentGroupMonthButtons(containerId, group, setterName){
    const el = document.getElementById(containerId); if (!el) return;
    const groupKey = String(group || '').trim();
    if (!groupKey) { el.innerHTML = '<div class="infoMonthEmpty">그룹을 먼저 선택해 주세요.</div>'; return; }
    const selected = new Set(getElementaryGroupFeedbackMonths(groupKey));
    el.innerHTML = ELEMENTARY_GROUP_MONTH_VALUES.map(month => '<button type="button" class="infoDayBtn '+(selected.has(month)?'active':'')+'" onclick="'+setterName+'('+month+')">'+month+'월</button>').join('');
  }
  window.selectStudentModalElementaryGroup = function(group){ studentModalElementaryGroupDraft = String(studentModalElementaryGroupDraft || '') === String(group) ? '' : String(group); renderStudentGroupButtons('elementaryStudentGroupToggleRow', studentModalElementaryGroupDraft, 'selectStudentModalElementaryGroup') };
  window.toggleStudentModalElementaryGroupMonth = function(month){ if (!studentModalElementaryGroupDraft) { alert('먼저 그룹을 선택해 주세요.'); return; } toggleElementaryGroupFeedbackMonth(studentModalElementaryGroupDraft, month) };
  window.selectStudentModalPersonality = function(personality){
    studentModalPersonalityDraft = String(studentModalPersonalityDraft || '') === String(personality) ? '' : String(personality);
    window.__olliPersonalityDropdownOpen.studentKinderPersonalityToggleRow = false;
    window.__olliPersonalityDropdownOpen.elementaryStudentPersonalityToggleRow = false;
    renderPersonalityButtons('studentKinderPersonalityToggleRow', studentModalPersonalityDraft, 'selectStudentModalPersonality');
    renderPersonalityButtons('elementaryStudentPersonalityToggleRow', studentModalPersonalityDraft, 'selectStudentModalPersonality');
  };
  window.selectKinderPersonality = function(personality){ kinderInfoDraft.personality = String(kinderInfoDraft.personality || '') === String(personality) ? '' : String(personality); window.__olliPersonalityDropdownOpen.kinderPersonalityToggleRow = false; renderPersonalityButtons('kinderPersonalityToggleRow', kinderInfoDraft.personality, 'selectKinderPersonality'); };

  function studentAddClean(value){ return String(value == null ? '' : value).trim(); }
  function studentAddDayLabel(value){ return DAYS[Number(value)-1] || ''; }
  function studentAddGroupValue(value){ return studentAddClean(value || 'A').toUpperCase() || 'A'; }
  const STUDENT_ADD_HALF_HOUR_SLOTS = Object.freeze({
    elementary:Object.freeze([
      Object.freeze({time:1,label:'1시'}),Object.freeze({time:7,label:'1시 30분'}),
      Object.freeze({time:2,label:'2시'}),Object.freeze({time:8,label:'2시 30분'}),
      Object.freeze({time:3,label:'3시'}),Object.freeze({time:9,label:'3시 30분'}),
      Object.freeze({time:4,label:'4시'}),Object.freeze({time:10,label:'4시 30분'}),
      Object.freeze({time:5,label:'5시'}),Object.freeze({time:11,label:'5시 30분'}),
      Object.freeze({time:6,label:'6시'})
    ]),
    kinder:Object.freeze([
      Object.freeze({time:7,label:'3시 30분'}),Object.freeze({time:4,label:'4시'}),
      Object.freeze({time:8,label:'4시 30분'}),Object.freeze({time:5,label:'5시'}),
      Object.freeze({time:9,label:'5시 30분'})
    ])
  });
  function studentAddIsHalfHourMode(){
    if(typeof window.getOlliKinderTimetableMode==='function'){
      try{return window.getOlliKinderTimetableMode()==='half_hour';}catch(_){}
    }
    try{
      const academyId=studentAddClean(localStorage.getItem('olli_current_academy_id'))||'unscoped';
      const cached=JSON.parse(localStorage.getItem('olli_settings_cache_v2_'+academyId)||'{}');
      return cached.kinderTimetableMode==='half_hour';
    }catch(_){return false;}
  }
  function studentAddSlotAllowed(division,weekday,timeSlot){
    const w=Number(weekday), t=Number(timeSlot);
    if(w<1||w>6) return false;
    if(division==='elementary'&&w===6) return [10,11,12].includes(t);
    if(studentAddIsHalfHourMode()) return (STUDENT_ADD_HALF_HOUR_SLOTS[division]||[]).some(slot=>slot.time===t);
    return division==='kinder'?[4,5].includes(t):(t>=1&&t<=6);
  }
  function studentAddTimeLabel(division,timeSlot,weekday){
    const t=Number(timeSlot);
    if(studentAddIsHalfHourMode()&&!(division==='elementary'&&Number(weekday)===6)){
      const slot=(STUDENT_ADD_HALF_HOUR_SLOTS[division]||[]).find(item=>item.time===t);
      if(slot) return slot.label;
    }
    return t+'시';
  }
  function studentAddSlotOrder(division,weekday,timeSlot){
    if(division==='elementary'&&Number(weekday)===6) return [10,11,12].indexOf(Number(timeSlot));
    if(studentAddIsHalfHourMode()){
      const idx=(STUDENT_ADD_HALF_HOUR_SLOTS[division]||[]).findIndex(item=>item.time===Number(timeSlot));
      return idx>=0?idx:999;
    }
    return Number(timeSlot);
  }
  function studentAddScheduleKey(row){
    return [Number(row?.weekday)||0, Number(row?.time_slot)||0, studentAddGroupValue(row?.class_group)].join('|');
  }
  function studentAddTodayKey(){
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }
  function studentAddTeacherLabel(value){
    const name = studentAddClean(value);
    if (!name) return '';
    if (typeof window.formatTeacherNameWithT === 'function') return window.formatTeacherNameWithT(name);
    return name;
  }
  function studentAddTeacherRaw(value){
    return studentAddClean(value).replace(/선생님/g,'').replace(/담임/g,'').replace(/T$/i,'').trim();
  }
  function studentAddCapacity(weekData, division){
    const raw = division === 'kinder' ? Number(weekData?.kinder_capacity) : Number(weekData?.elementary_capacity);
    return Number.isFinite(raw) && raw > 0 ? raw : 5;
  }
  function studentAddIsElementarySplit(data, weekday, timeSlot, effectiveDate){
    const targetDate = studentAddClean(effectiveDate || studentAddTodayKey()).slice(0,10);
    const periods = Array.isArray(data?.class_split_periods) ? data.class_split_periods : [];
    if (periods.length) {
      return periods.some(row => {
        if (Number(row?.weekday) !== Number(weekday) || Number(row?.time_slot) !== Number(timeSlot)) return false;
        const from = studentAddClean(row?.effective_from).slice(0,10);
        const to = studentAddClean(row?.effective_to).slice(0,10);
        return (!from || from <= targetDate) && (!to || to >= targetDate);
      });
    }
    return (Array.isArray(data?.class_splits) ? data.class_splits : []).some(row =>
      Number(row?.weekday) === Number(weekday) && Number(row?.time_slot) === Number(timeSlot)
    );
  }
  function studentAddIsKinderMerged(data, weekday, timeSlot){
    return (Array.isArray(data?.kinder_class_merges) ? data.kinder_class_merges : []).some(row =>
      Number(row?.weekday) === Number(weekday) && Number(row?.time_slot) === Number(timeSlot)
    );
  }
  function buildStudentAddScheduleOptions(data, division){
    const enrollments = Array.isArray(data?.enrollments) ? data.enrollments : [];
    const assignments = Array.isArray(data?.class_teachers) ? data.class_teachers : [];
    const capacity = studentAddCapacity(data, division);
    const effectiveDate = studentAddTodayKey();
    const halfHour = studentAddIsHalfHourMode();
    const slotMap = new Map();
    const addSlot = (weekday, timeSlot) => {
      const w = Number(weekday), t = Number(timeSlot);
      if (!Number.isFinite(w) || !Number.isFinite(t) || !studentAddSlotAllowed(division,w,t)) return;
      slotMap.set([w,t].join('|'), { weekday:w, time_slot:t });
    };

    assignments.filter(row => studentAddClean(row?.division) === division).forEach(row => addSlot(row?.weekday,row?.time_slot));
    enrollments
      .filter(row => studentAddClean(row?.division) === division && (!row?.status || studentAddClean(row.status).toLowerCase() === 'active'))
      .forEach(row => addSlot(row?.weekday,row?.time_slot));

    if (halfHour) {
      for (let weekday=1; weekday<=6; weekday+=1) {
        if (division==='elementary' && weekday===6) [10,11,12].forEach(timeSlot=>addSlot(weekday,timeSlot));
        else (STUDENT_ADD_HALF_HOUR_SLOTS[division]||[]).forEach(slot=>addSlot(weekday,slot.time));
      }
    } else if (division === 'elementary') {
      for (let weekday = 1; weekday <= 5; weekday += 1) {
        for (let timeSlot = 1; timeSlot <= 6; timeSlot += 1) addSlot(weekday,timeSlot);
      }
      [10,11,12].forEach(timeSlot => addSlot(6,timeSlot));
    } else {
      (Array.isArray(data?.kinder_class_merges) ? data.kinder_class_merges : []).forEach(row => addSlot(row?.weekday,row?.time_slot));
      for (let weekday = 1; weekday <= 6; weekday += 1) [4,5].forEach(timeSlot => addSlot(weekday,timeSlot));
    }

    const options = [];
    Array.from(slotMap.values())
      .sort((a,b) => a.weekday-b.weekday || studentAddSlotOrder(division,a.weekday,a.time_slot)-studentAddSlotOrder(division,b.weekday,b.time_slot))
      .forEach(slot => {
        const split = halfHour ? false : (division === 'elementary'
          ? studentAddIsElementarySplit(data,slot.weekday,slot.time_slot,effectiveDate)
          : !studentAddIsKinderMerged(data,slot.weekday,slot.time_slot));
        const merged = division === 'kinder' && !split;
        const groups = split ? ['A','B'] : ['A'];

        groups.forEach(classGroup => {
          const teacher = assignments.find(row =>
            studentAddClean(row?.division) === division &&
            Number(row?.weekday) === slot.weekday &&
            Number(row?.time_slot) === slot.time_slot &&
            (halfHour ? studentAddGroupValue(row?.class_group) === 'A' : studentAddGroupValue(row?.class_group) === classGroup)
          ) || (halfHour ? assignments.find(row =>
            studentAddClean(row?.division) === division &&
            Number(row?.weekday) === slot.weekday &&
            Number(row?.time_slot) === slot.time_slot
          ) : null);
          const teacherRaw = studentAddTeacherRaw(teacher?.teacher_name);
          const count = enrollments.filter(item =>
            studentAddClean(item?.division) === division &&
            Number(item?.weekday) === slot.weekday &&
            Number(item?.time_slot) === slot.time_slot &&
            (halfHour || studentAddGroupValue(item?.class_group) === classGroup) &&
            (!item?.status || studentAddClean(item.status).toLowerCase() === 'active')
          ).length;
          const classLabel = halfHour ? '' : (division === 'kinder'
            ? (merged ? '합반' : classGroup + '반')
            : (split ? classGroup + '반' : '기본 클래스'));

          options.push({
            division, weekday:slot.weekday, time_slot:slot.time_slot,
            class_group:'A', half_hour:halfHour,
            teacher_name:teacherRaw, teacher_label:studentAddTeacherLabel(teacherRaw),
            class_label:classLabel, count, capacity, full:count >= capacity
          });
        });
      });

    return options;
  }

  function updateStudentAddTeacherReadonly(){
    const el = document.getElementById('studentAddTeacherReadonly');
    if (!el) return;
    const first = studentModalScheduleDraft[0] || null;
    const teacher = studentAddTeacherLabel(first?.teacher_name || '');
    el.textContent = teacher || '담임 미지정';
    el.classList.toggle('isEmpty', !teacher);
  }
  function studentAddScheduleSummaryHtml(){
    if (!studentModalScheduleDraft.length) {
      return '<div class="studentAddScheduleEmpty">수업시간을 선택해 주세요.</div>';
    }
    return studentModalScheduleDraft.map((row,index) => {
      const day = studentAddDayLabel(row.weekday);
      const teacher = studentAddTeacherLabel(row.teacher_name) || '담임 미지정';
      const cls = row.class_label || (row.class_group ? row.class_group + '반' : '');
      return '<div class="studentAddScheduleSummaryItem"><span class="studentAddScheduleOrder">'+(index+1)+'회차</span><span class="studentAddScheduleWhen">'+day+'요일 '+studentAddTimeLabel(studentModalScheduleDivision,row.time_slot,row.weekday)+(cls?' · '+cls:'')+'</span><span class="studentAddScheduleTeacher">'+escapeTeacherHtml(teacher)+'</span></div>';
    }).join('');
  }
  function renderStudentAddScheduleBox(){
    const box = document.getElementById('studentAddScheduleBox');
    if (!box) return;
    const selectedKeys = new Set(studentModalScheduleDraft.map(studentAddScheduleKey));
    const optionsHtml = studentModalScheduleOpen
      ? '<div class="studentAddScheduleOptions">'+(
          studentModalScheduleLoading
            ? '<div class="studentAddScheduleEmpty">시간표를 불러오는 중...</div>'
            : (studentModalScheduleOptions.length
              ? studentModalScheduleOptions.map(option => {
                  const key = studentAddScheduleKey(option);
                  const selected = selectedKeys.has(key);
                  const disabled = option.full && !selected;
                  const day = studentAddDayLabel(option.weekday);
                  const meta = [studentAddTeacherLabel(option.teacher_name) || '담임 미지정', option.class_label, option.count+'/'+option.capacity+'명'].filter(Boolean).join(' · ');
                  return '<button type="button" class="studentAddScheduleOption '+(selected?'active':'')+'" data-student-add-schedule-key="'+key+'" '+(disabled?'disabled':'')+'><span><b>'+day+'요일 '+studentAddTimeLabel(studentModalScheduleDivision,option.time_slot,option.weekday)+'</b><small>'+escapeTeacherHtml(meta)+'</small></span><em>'+(selected?'선택됨':(disabled?'정원 마감':'선택'))+'</em></button>';
                }).join('')
              : '<div class="studentAddScheduleEmpty">선택 가능한 수업시간이 없습니다.</div>')
        )+'</div>'
      : '';

    box.innerHTML =
      '<div class="studentAddScheduleHead"><strong>수업시간</strong><button type="button" class="studentAddScheduleChangeBtn" onclick="toggleStudentAddScheduleOptions()">'+(studentModalScheduleOpen?'닫기':'설정')+'</button></div>'+
      '<div class="studentAddScheduleSummary">'+studentAddScheduleSummaryHtml()+'</div>'+
      optionsHtml;

    box.querySelectorAll('[data-student-add-schedule-key]').forEach(button => {
      button.addEventListener('click', function(event){
        event.preventDefault();
        const key = button.dataset.studentAddScheduleKey || '';
        const option = studentModalScheduleOptions.find(item => studentAddScheduleKey(item) === key);
        if (!option) return;
        const index = studentModalScheduleDraft.findIndex(item => studentAddScheduleKey(item) === key);
        if (index >= 0) {
          studentModalScheduleDraft.splice(index,1);
        } else {
          if (studentModalScheduleDraft.length >= 2) {
            alert('수업시간은 최대 2회차까지 선택할 수 있습니다.');
            return;
          }
          studentModalScheduleDraft.push({ ...option, session_order: studentModalScheduleDraft.length + 1 });
        }
        studentModalScheduleDraft = studentModalScheduleDraft.map((item,i) => ({...item, session_order:i+1}));
        updateStudentAddTeacherReadonly();
        renderStudentAddScheduleBox();
      });
    });
    updateStudentAddTeacherReadonly();
  }
  async function loadStudentAddScheduleOptions(division){
    studentModalScheduleLoading = true;
    renderStudentAddScheduleBox();
    try {
      const service = window.OlliPhoneStudentScheduleService;
      if (!service?.loadWeek) throw new Error('시간표 서비스를 찾지 못했습니다.');
      const weekData = await service.loadWeek(studentAddTodayKey());
      if (studentModalScheduleDivision !== division) return;
      studentModalScheduleOptions = buildStudentAddScheduleOptions(weekData, division);
    } catch (error) {
      console.warn('학생추가 수업시간 불러오기 실패:', error?.message || error);
      studentModalScheduleOptions = [];
    } finally {
      if (studentModalScheduleDivision === division) {
        studentModalScheduleLoading = false;
        renderStudentAddScheduleBox();
      }
    }
  }
  function prepareStudentAddSchedule(division){
    studentModalScheduleDivision = division === 'kinder' ? 'kinder' : 'elementary';
    studentModalScheduleDraft = [];
    studentModalScheduleOptions = [];
    studentModalScheduleOpen = false;
    studentModalScheduleLoading = false;
    updateStudentAddTeacherReadonly();
    renderStudentAddScheduleBox();
    loadStudentAddScheduleOptions(studentModalScheduleDivision);
  }
  window.toggleStudentAddScheduleOptions = function(){
    studentModalScheduleOpen = !studentModalScheduleOpen;
    renderStudentAddScheduleBox();
  };

  function tuneStudentModalGuideTextSource(){
    const ids = [
      'studentNameInput', 'studentYearBadge', 'studentKindergartenInput',
      'studentAgeInput', 'studentSchoolInput', 'studentElementaryAgeInput'
    ];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const field = el.closest('.kinderInfoModalField') || el.closest('.studentInfoDateField');
      const label = field ? field.querySelector(':scope > .modalLabel') : el.previousElementSibling;
      if (label && label.classList && label.classList.contains('modalLabel')) label.remove();
    });
    const ageInput = document.getElementById('studentAgeInput');
    if (ageInput) ageInput.setAttribute('placeholder', '나이');
  }

  function patchStudentModalMarkup(){
    const studentCard = document.querySelector('#studentModal .modalCard');
    if (studentCard && studentCard.dataset.orderedStudentFields !== '1') {
      studentCard.dataset.orderedStudentFields = '1';
      studentCard.innerHTML = '<div class="modalTitle" id="studentModalTitle">학생 등록</div>'
        + '<div class="studentPopupNameTeacherRow">'
        + '<div class="kinderInfoModalField studentPopupNameField"><input id="studentNameInput" placeholder="학생이름" class="modalInput" onkeydown="if(event.key===\'Enter\')confirmStudent()"></div>'
        + '<div id="elementaryStudentPersonalityField" class="kinderInfoModalField studentPopupPersonalityField"><div id="elementaryStudentPersonalityToggleRow" class="infoTeacherToggleRow infoPersonalityToggleRow"></div></div>'
        + '<div id="studentKinderPersonalityField" class="kinderInfoModalField studentPopupPersonalityField" style="display:none;"><div id="studentKinderPersonalityToggleRow" class="infoTeacherToggleRow infoPersonalityToggleRow"></div></div>'
        + '<div class="kinderInfoModalField studentPopupTeacherField"><div id="studentAddTeacherReadonly" class="studentAddTeacherReadonly isEmpty">담임</div></div>'
        + '</div>'
        + '<div id="elementaryStudentGradeClassField" class="studentPopupSchoolRow"><div class="kinderInfoModalField studentPopupSchoolField"><input id="studentSchoolInput" class="modalInput" placeholder="학교"></div><div class="kinderInfoModalField studentPopupGradeField"><input id="studentGradeInput" class="modalInput" type="text" inputmode="numeric" placeholder="학년" onfocus="focusElementaryGradeInput(this)" oninput="syncStudentElementaryAgeFromGrade()" onblur="blurStudentElementaryGradeInput()"></div><div class="kinderInfoModalField studentPopupClassField"><input id="studentElementaryAgeInput" class="modalInput" type="text" inputmode="numeric" placeholder="나이" readonly></div></div>'
        + '<div id="studentKinderBasicField" class="studentPopupKinderBasicRow" style="display:none;"><div class="kinderInfoModalField studentPopupKindergartenField"><input id="studentKindergartenInput" placeholder="유치원" class="modalInput"></div><div class="kinderInfoModalField studentPopupAgeField"><input id="studentAgeInput" type="number" min="1" max="8" placeholder="나이" class="modalInput"></div></div>'
        + '<div class="studentPopupDateOnlyRow">'
        + '<div class="kinderInfoModalField studentPopupYearField"><input id="studentYearBadge" type="number" min="1900" max="2100" inputmode="numeric" placeholder="등록년" class="modalInput"></div>'
        + '<div class="kinderInfoModalField studentPopupMonthField"><input id="studentMonthInput" type="number" min="1" max="12" placeholder="월" class="modalInput"></div>'
        + '<div class="kinderInfoModalField studentPopupDayField"><input id="studentDayInput" type="number" min="1" max="31" placeholder="일" class="modalInput"></div>'
        + '</div>'
        + '<div id="studentAddScheduleBox" class="studentAddScheduleBox"></div>'
        + '<div id="studentElementaryFields"><div id="elementaryStudentGroupField" class="kinderInfoModalField"><div class="modalLabel studentAddGroupLabel">그룹</div><div id="elementaryStudentGroupToggleRow" class="infoToggleRow"></div></div></div>'
        + '<div class="modalActions"><button class="modalBtnCancel" onclick="closeStudentModal()" type="button">취소</button><button onclick="confirmStudent()" class="modalBtnConfirm">추가</button></div>';
    }

    // 초등/유치 학생정보 팝업 DOM은 index.html의 authoritative 구조를 유지합니다.
    const elementaryInfoCard = document.querySelector('#elementaryInfoModal .modalCard');
    if (elementaryInfoCard) elementaryInfoCard.dataset.orderedStudentFields = '1';
    const kinderInfoCard = document.querySelector('#kinderInfoModal .modalCard');
    if (kinderInfoCard) kinderInfoCard.dataset.orderedStudentFields = '1';
    tuneStudentModalGuideTextSource();
  }

  window.olliPatchStudentModalMarkup = patchStudentModalMarkup;
  window.olliPrepareStudentAddExtra = function(targetView){
    patchStudentModalMarkup();
    studentModalElementaryGroupDraft = '';
    studentModalPersonalityDraft = '';
    if (window.__olliPersonalityDropdownOpen) {
      window.__olliPersonalityDropdownOpen.studentKinderPersonalityToggleRow = false;
      window.__olliPersonalityDropdownOpen.elementaryStudentPersonalityToggleRow = false;
    }
    const elementaryFields = document.getElementById('studentElementaryFields');
    const elementaryGradeClassField = document.getElementById('elementaryStudentGradeClassField');
    const studentKinderBasicField = document.getElementById('studentKinderBasicField');
    const elementaryGroupField = document.getElementById('elementaryStudentGroupField');
    const elementaryPersonalityField = document.getElementById('elementaryStudentPersonalityField');
    const studentKinderPersonalityField = document.getElementById('studentKinderPersonalityField');
    if (elementaryFields) elementaryFields.style.display = targetView === 'elementary' ? 'block' : 'none';
    if (elementaryGradeClassField) elementaryGradeClassField.style.display = targetView === 'elementary' ? 'grid' : 'none';
    if (studentKinderBasicField) studentKinderBasicField.style.display = targetView === 'kinder' ? 'grid' : 'none';
    if (elementaryGroupField) elementaryGroupField.style.display = targetView === 'elementary' ? 'block' : 'none';
    if (elementaryPersonalityField) elementaryPersonalityField.style.display = targetView === 'elementary' ? 'block' : 'none';
    if (studentKinderPersonalityField) studentKinderPersonalityField.style.display = targetView === 'kinder' ? 'block' : 'none';
    const schoolInput = document.getElementById('studentSchoolInput');
    const gradeInput = document.getElementById('studentGradeInput');
    const elementaryAgeInput = document.getElementById('studentElementaryAgeInput');
    const kindergartenInput = document.getElementById('studentKindergartenInput');
    const ageInput = document.getElementById('studentAgeInput');
    if (schoolInput) schoolInput.value = '';
    if (gradeInput) gradeInput.value = '';
    if (elementaryAgeInput) elementaryAgeInput.value = '';
    if (kindergartenInput) kindergartenInput.value = '';
    if (ageInput) ageInput.value = '';
    renderStudentGroupButtons('elementaryStudentGroupToggleRow', studentModalElementaryGroupDraft, 'selectStudentModalElementaryGroup');
    renderPersonalityButtons('studentKinderPersonalityToggleRow', studentModalPersonalityDraft, 'selectStudentModalPersonality');
    renderPersonalityButtons('elementaryStudentPersonalityToggleRow', studentModalPersonalityDraft, 'selectStudentModalPersonality');
    prepareStudentAddSchedule(targetView);
  };
  window.olliGetStudentAddExtra = function(type){
    const base = {
      group: type === 'elementary' ? studentModalElementaryGroupDraft : '',
      group_months: type === 'elementary' ? elementaryGroupMonthsToText(getElementaryGroupFeedbackMonths(studentModalElementaryGroupDraft)) : '',
      feedback_months: type === 'elementary' ? elementaryGroupMonthsToText(getElementaryGroupFeedbackMonths(studentModalElementaryGroupDraft)) : '',
      school: type === 'elementary' ? (document.getElementById('studentSchoolInput')?.value || '').trim() : '',
      grade: type === 'elementary' ? normalizeElementaryGradeValue(document.getElementById('studentGradeInput')?.value || '') : '',
      age: type === 'elementary' ? getElementaryAgeFromGrade(normalizeElementaryGradeValue(document.getElementById('studentGradeInput')?.value || '')) : '',
      className: '',
      personality: studentModalPersonalityDraft || '',
      teacher: studentAddTeacherRaw(studentModalScheduleDraft[0]?.teacher_name || ''),
      schedule_pairs: studentModalScheduleDraft.map((item,index) => ({
        weekday: Number(item.weekday),
        time_slot: Number(item.time_slot),
        class_group: studentAddGroupValue(item.class_group),
        session_order: index + 1
      }))
    };
    return base;
  };
  window.olliPrepareInfoExtra = function(type, student){
    patchStudentModalMarkup();
    if (type === 'kinder') {
      kinderInfoDraft.personality = student?.personality || '';
      if (window.__olliPersonalityDropdownOpen) window.__olliPersonalityDropdownOpen.kinderPersonalityToggleRow = false;
      renderPersonalityButtons('kinderPersonalityToggleRow', kinderInfoDraft.personality, 'selectKinderPersonality');
    } else if (type === 'elementary') {
      elementaryInfoDraft.personality = student?.personality || '';
      if (window.__olliPersonalityDropdownOpen) window.__olliPersonalityDropdownOpen.elementaryPersonalityToggleRow = false;
      renderPersonalityButtons('elementaryPersonalityToggleRow', elementaryInfoDraft.personality, 'selectElementaryPersonality');
    }
  };
  window.olliGetInfoExtra = function(type){
    if (type === 'kinder') return { personality: kinderInfoDraft.personality || '' };
    if (type === 'elementary') {
      return {
        personality: elementaryInfoDraft.personality || '',
        group_months: elementaryGroupMonthsToText(getElementaryGroupFeedbackMonths(elementaryInfoDraft.group)),
        feedback_months: elementaryGroupMonthsToText(getElementaryGroupFeedbackMonths(elementaryInfoDraft.group))
      };
    }
    return {};
  };

  document.addEventListener('DOMContentLoaded', function(){
    installRecordSortButton();
    patchStudentModalMarkup();
    document.querySelectorAll('strong').forEach(el => { if ((el.textContent || '').trim() === '수업 장면 ‘1분 피드백’') el.textContent = '1분 피드백'; });
    document.querySelectorAll('*').forEach(el => { if (el.childNodes && el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 && el.textContent.includes('수업장면 1분 피드백')) el.textContent = el.textContent.replace(/수업장면 1분 피드백/g, '1분 피드백'); });
  });
})();
