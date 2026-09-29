
(function(){
  const DAYS = ['월','화','수','목','금','토','일'];
  const DAY_NAMES = {0:'일',1:'월',2:'화',3:'수',4:'목',5:'금',6:'토'};
  const SORT_KEY = 'olli_record_sort_settings_by_view_v3';
  function getActiveRecordView(){
    try {
      if (typeof currentRecordView !== 'undefined' && (currentRecordView === 'kinder' || currentRecordView === 'elementary')) return currentRecordView;
    } catch(e){}
    try {
      if (window.currentRecordView === 'kinder' || window.currentRecordView === 'elementary') return window.currentRecordView;
    } catch(e){}
    const kinderToggle = document.getElementById('recordKinderToggle');
    const elementaryToggle = document.getElementById('recordElementaryToggle');
    if (kinderToggle && kinderToggle.classList.contains('active')) return 'kinder';
    if (elementaryToggle && elementaryToggle.classList.contains('active')) return 'elementary';
    const label = document.getElementById('recordModeLabel')?.textContent || '';
    return label.includes('유치') ? 'kinder' : 'elementary';
  }
  function readSortState(){
    const fallback = { elementary: { criteria: 'initial' }, kinder: { criteria: 'initial' } };
    try {
      const parsed = JSON.parse(localStorage.getItem(SORT_KEY) || '{}');
      return { elementary: Object.assign({}, fallback.elementary, parsed.elementary || {}), kinder: Object.assign({}, fallback.kinder, parsed.kinder || {}) };
    } catch(e) { return fallback; }
  }
  function writeSortState(view, criteria){
    const state = readSortState();
    state[view] = Object.assign({}, state[view] || {}, { criteria });
    localStorage.setItem(SORT_KEY, JSON.stringify(state));
  }
  function getCriteria(view){ const state = readSortState(); const criteria = (state[view] && state[view].criteria) || 'initial'; if (criteria === 'lessonDayTeacher') return 'lessonDay'; return criteria; }
  function cleanText(value){ return String(value || '').trim(); }
  function safeNum(value){ const match = cleanText(value).match(/\d+/); const n = match ? Number(match[0]) : Number(value); return Number.isFinite(n) && n > 0 ? n : 999; }
  function normalizeTeacherName(value){ return cleanText(value).replace(/T$/i, '').trim(); }
  function getTeacherValue(student){ return normalizeTeacherName(student?.homeroom_teacher || student?.teacher || student?.teacher_name || student?.teacherName || ''); }
  function getTendencyValue(student){ return cleanText(student?.tendency || student?.personality || student?.personalityType || student?.personality_type || student?.tendencyType || student?.tendency_type || student?.group_tendency || student?.type_label || student?.character || ''); }
  function getSchoolValue(student){ return cleanText(student?.school || student?.elementary_school || student?.schoolName || ''); }
  function getGradeValue(student){ return cleanText(student?.grade || student?.school_grade || student?.class_grade || ''); }
  function getKindergartenValue(student){ return cleanText(student?.kindergarten || student?.school || ''); }
  function normalizeDayText(value){ return cleanText(value).replace(/요일/g,'').replace(/[·,\/]/g,' '); }
  function parseDays(student){ const raw = normalizeDayText(student?.lesson_day || student?.lessonDay || student?.days || student?.day || ''); return DAYS.filter(day => raw.includes(day)); }
  function todayKo(){ return DAY_NAMES[(new Date()).getDay()] || '월'; }
  function todayDayIndex(){ const idx = DAYS.indexOf(todayKo()); return idx < 0 ? 0 : idx; }
  function daySortDistance(day){
    const idx = DAYS.indexOf(day);
    if (idx < 0) return 999;
    return (idx - todayDayIndex() + DAYS.length) % DAYS.length;
  }
  function dayRank(student){
    const selected = parseDays(student); if (!selected.length) return 999;
    return Math.min(...selected.map(daySortDistance));
  }
  function primaryDayLabel(student){
    const selected = parseDays(student);
    if (!selected.length) return '요일없음';
    return selected.slice().sort((a,b) => daySortDistance(a) - daySortDistance(b))[0] || selected[0];
  }
  function firstHangul(value){
    const text = cleanText(value); if (!text) return '힣';
    const code = text.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) { const choseong = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ']; return choseong[Math.floor((code - 0xAC00) / 588)] || text[0]; }
    return text[0] || '힣';
  }
  function statusRank(student){ try { if (typeof getStudentStatusRank === 'function') return getStudentStatusRank(student); } catch(e){} return student && student.status === 'inactive' ? 1 : 0; }
  function nameCompare(a,b){ return cleanText(a?.name).localeCompare(cleanText(b?.name), 'ko'); }
  function stringCompare(a,b){ const av = cleanText(a); const bv = cleanText(b); if (!av && bv) return 1; if (av && !bv) return -1; return av.localeCompare(bv, 'ko'); }
  function compareElementaryByCriteria(a,b){
    const criterion = getCriteria('elementary'); let result = 0;
    if (criterion === 'tendency') {
      result = (getTendencyValue(a) ? 0 : 1) - (getTendencyValue(b) ? 0 : 1);
      if (result !== 0) return result;
      result = stringCompare(getTendencyValue(a), getTendencyValue(b));
    }
    else if (criterion === 'group') result = compareElementaryGroupFeedbackOrder(a,b);
    else if (criterion === 'grade') result = safeNum(getGradeValue(a)) - safeNum(getGradeValue(b));
    else if (criterion === 'school') result = stringCompare(getSchoolValue(a), getSchoolValue(b));
    else if (criterion === 'lessonDay') result = dayRank(a) - dayRank(b);
    else if (criterion === 'teacher') result = stringCompare(getTeacherValue(a), getTeacherValue(b));
    else result = firstHangul(a?.name).localeCompare(firstHangul(b?.name), 'ko');
    if (result !== 0) return result;
    if (criterion !== 'teacher') {
      const teacherResult = stringCompare(getTeacherValue(a), getTeacherValue(b));
      if (teacherResult !== 0) return teacherResult;
    }
    if (criterion !== 'group') { const groupResult = compareElementaryGroupFeedbackOrder(a,b); if (groupResult !== 0) return groupResult; }
    if (criterion !== 'grade') { const gradeResult = safeNum(getGradeValue(a)) - safeNum(getGradeValue(b)); if (gradeResult !== 0) return gradeResult; }
    return nameCompare(a,b);
  }
  function getElementarySortSectionKey(student){
    try { if (typeof getStudentStatus === 'function' && getStudentStatus(student) !== 'active') return 'status:' + getStudentStatus(student); } catch(e) {}
    const criterion = getCriteria('elementary');
    if (criterion === 'group') return 'group:' + (getElementaryCurrentFeedbackGroupRank(student) === 0 ? '이번달' : '일반') + ':' + (cleanText(student?.group) || '그룹없음');
    if (criterion === 'lessonDay') return 'day:' + primaryDayLabel(student);
    if (criterion === 'teacher') return 'teacher:' + (getTeacherValue(student) || '담임없음');
    if (criterion === 'tendency') return 'tendency:' + (getTendencyValue(student) || '성향없음');
    if (criterion === 'grade') return 'grade:' + (getGradeValue(student) || '학년없음');
    if (criterion === 'school') return 'school:' + (getSchoolValue(student) || '학교없음');
    return 'initial:' + firstHangul(student?.name);
  }
  function compareKinderByCriteria(a,b){
    const criterion = getCriteria('kinder'); let result = 0;
    if (criterion === 'age') result = safeNum(a?.age) - safeNum(b?.age);
    else if (criterion === 'lessonDay') result = dayRank(a) - dayRank(b);
    else if (criterion === 'kindergarten') result = stringCompare(getKindergartenValue(a), getKindergartenValue(b));
    else if (criterion === 'teacher') result = stringCompare(getTeacherValue(a), getTeacherValue(b));
    else if (criterion === 'tendency') result = stringCompare(getTendencyValue(a), getTendencyValue(b));
    else result = firstHangul(a?.name).localeCompare(firstHangul(b?.name), 'ko');
    if (result !== 0) return result;
    if (criterion !== 'teacher') {
      const teacherResult = stringCompare(getTeacherValue(a), getTeacherValue(b));
      if (teacherResult !== 0) return teacherResult;
    }
    return nameCompare(a,b);
  }
  const elementaryOptions = [['group','그룹'], ['teacher','담임'], ['tendency','성향'], ['grade','학년'], ['school','학교'], ['initial','자음'], ['lessonDay','요일']];
  const kinderOptions = [['age','나이'], ['teacher','담임'], ['tendency','성향'], ['initial','자음'], ['lessonDay','요일'], ['kindergarten','유치원']];
  let recordSortFeedbackMonthGroup = '';
  function renderRecordSortGroupLabel(label){
    return '<span class="recordSortGroupLabel">'+label+'</span>';
  }
  function renderRecordSortFeedbackMonths(){
    const groups = [['1','A'], ['2','B'], ['3','C'], ['4','D'], ['5','E'], ['6','F']];
    const groupButtons = groups.map(([group,label]) => '<button type="button" class="recordSortGroupIconBtn '+(recordSortFeedbackMonthGroup===group?'active':'')+'" data-record-sort-feedback-group="'+group+'" title="'+label+'그룹">'+renderRecordSortGroupLabel(label)+'</button>').join('');
    const monthValues = (typeof ELEMENTARY_GROUP_MONTH_VALUES !== 'undefined') ? ELEMENTARY_GROUP_MONTH_VALUES : [1,2,3,4,5,6,7,8,9,10,11,12];
    const selectedMonths = recordSortFeedbackMonthGroup && typeof getElementaryGroupFeedbackMonths === 'function' ? new Set(getElementaryGroupFeedbackMonths(recordSortFeedbackMonthGroup)) : new Set();
    const monthGrid = recordSortFeedbackMonthGroup
      ? '<div class="recordSortMonthGrid">'+monthValues.map(month => '<button type="button" class="recordSortMonthChip '+(selectedMonths.has(month)?'active':'')+'" data-record-sort-feedback-month="'+month+'">'+month+'월</button>').join('')+'</div>'
      : '<div class="recordSortMonthHint">그룹을 누르면 발송월을 설정할 수 있어요.</div>';
    return '<div class="recordSortDivider"></div><div class="recordSortFeedbackTitle">그룹별 피드백 발송월</div><div class="recordSortGroupIconGrid">'+groupButtons+'</div>'+monthGrid;
  }
  function renderSeparatedSortPopup(){
    const view = getActiveRecordView(); const selected = getCriteria(view); const options = view === 'kinder' ? kinderOptions : elementaryOptions;
    const chips = options.map(([key,label]) => '<button type="button" class="recordSortChip '+(selected===key?'active':'')+'" data-olli-sort-view="'+view+'" data-olli-sort-criteria="'+key+'">'+label+'</button>').join('');
    return '<div class="recordSortCriteriaTitle">'+(view === 'kinder' ? '유치부 정렬 기준' : '초등부 정렬 기준')+'</div><div class="recordSortCriteriaGrid">'+chips+'</div>';
  }
  function refreshRecordSortPopup(){ const popup = document.getElementById('recordSortPopup'); if (popup) popup.innerHTML = renderSeparatedSortPopup(); }
  window.refreshRecordSortPopup = refreshRecordSortPopup;
  function reloadRecordList(){ try { const input = document.getElementById('searchName'); if (typeof loadRecords === 'function') loadRecords(input ? input.value.trim() : ''); } catch(e) {} }
  document.addEventListener('click', function(event){
    const btn = event.target.closest('#recordSortBtn');
    if (btn) { setTimeout(refreshRecordSortPopup, 0); return; }
    const groupBtn = event.target.closest('[data-record-sort-feedback-group]');
    if (groupBtn) {
      event.preventDefault(); event.stopPropagation();
      const group = String(groupBtn.dataset.recordSortFeedbackGroup || '');
      recordSortFeedbackMonthGroup = recordSortFeedbackMonthGroup === group ? '' : group;
      refreshRecordSortPopup();
      return;
    }
    const monthBtn = event.target.closest('[data-record-sort-feedback-month]');
    if (monthBtn) {
      event.preventDefault(); event.stopPropagation();
      if (recordSortFeedbackMonthGroup && typeof toggleElementaryGroupFeedbackMonth === 'function') {
        toggleElementaryGroupFeedbackMonth(recordSortFeedbackMonthGroup, Number(monthBtn.dataset.recordSortFeedbackMonth));
      }
      refreshRecordSortPopup(); reloadRecordList();
      return;
    }
    const chip = event.target.closest('[data-olli-sort-criteria]');
    if (!chip) return;
    event.preventDefault(); event.stopPropagation();
    writeSortState(chip.dataset.olliSortView || getActiveRecordView(), chip.dataset.olliSortCriteria);
    refreshRecordSortPopup(); reloadRecordList();
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshRecordSortPopup); else setTimeout(refreshRecordSortPopup, 0);
})();
