
(function(){
  const DAYS = ['월','화','수','목','금','토','일'];
  const DAY_NAMES = {0:'일',1:'월',2:'화',3:'수',4:'목',5:'금',6:'토'};
  const SORT_KEY = 'olli_record_sort_settings_v2';
  let kinderInfoTeacherDraft = '';
  let studentModalTeacherDraft = '';
  let studentModalElementaryGroupDraft = '';
  let studentModalPersonalityDraft = '';
  let elementaryInfoTeacherDraft = '';
  let kinderInfoDaysDraft = [];
  let studentModalDaysDraft = [];
  let elementaryInfoDaysDraft = [];

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

  const TEACHER_CACHE_KEY = 'olli_cached_teacher_names';
  function getTeacherCacheKey(){
    const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || 'unscoped';
    return `${TEACHER_CACHE_KEY}_${academyId}`;
  }
  let teacherOptionsLoading = null;

  function readOlliTeacherIdSet(key){
    try {
      return new Set(JSON.parse(localStorage.getItem(key) || '[]').map(String));
    } catch(e) {
      return new Set();
    }
  }
  function readCachedTeacherOptions(){
    try {
      const list = JSON.parse(localStorage.getItem(getTeacherCacheKey()) || '[]');
      return Array.isArray(list) ? list.map(formatTeacherNameWithT).filter(Boolean) : [];
    } catch(e) {
      return [];
    }
  }
  function writeCachedTeacherOptions(names){
    try {
      const unique = [...new Set((names || []).map(formatTeacherNameWithT).filter(Boolean))];
      if (unique.length) localStorage.setItem(getTeacherCacheKey(), JSON.stringify(unique));
      else localStorage.removeItem(getTeacherCacheKey());
    } catch(e) {}
  }
  function teacherMemberId(member){
    return String((member && (member.id || member.member_id)) || '');
  }
  function teacherMemberStatus(member){
    return String((member && member.status) || 'active').trim().toLowerCase();
  }
  function isUsableTeacherMember(member){
    const status = teacherMemberStatus(member);
    const role = String((member && (member.role || member.member_role || member.membership_role || member.account_role || member.requested_role)) || 'teacher').trim().toLowerCase();
    // 선생님 관리에 등록된 원장/관리자/선생님 모두 수업 담임이 될 수 있으므로 owner도 담임 선택 목록에 포함합니다.
    // 단, 삭제/기기리셋/비활성/승인대기/거절 상태는 담임 선택에서 제외합니다.
    return !['deleted','removed','disabled','inactive','rejected','pending','waiting','approval_pending','승인대기','승인 대기','거절됨'].includes(status);
  }
  function teacherNameFromMember(member){
    return formatTeacherNameWithT(member?.display_name || member?.teacher_name || member?.member_name || member?.account_name || member?.name || '');
  }
  function getTeacherNamesFromMembers(members){
    return [...new Set((Array.isArray(members) ? members : [])
      .filter(isUsableTeacherMember)
      .map(teacherNameFromMember)
      .filter(Boolean))];
  }
  function getTeacherOptions(){
    let members = [];
    try {
      members = (typeof olliSettingsState !== 'undefined' && Array.isArray(olliSettingsState.members))
        ? olliSettingsState.members
        : [];
    } catch(e){}

    const names = getTeacherNamesFromMembers(members);
    if (names.length) {
      writeCachedTeacherOptions(names);
      return names;
    }

    const cached = readCachedTeacherOptions();
    if (cached.length) return cached;

    const currentMemberName = localStorage.getItem('olli_current_member_name') || '';
    if (currentMemberName) return [formatTeacherNameWithT(currentMemberName)];

    return [];
  }
  function cacheTeacherOptions(){
    let members = [];
    try {
      members = (typeof olliSettingsState !== 'undefined' && Array.isArray(olliSettingsState.members))
        ? olliSettingsState.members
        : [];
    } catch(e){}
    const names = getTeacherNamesFromMembers(members);
    if (names.length) writeCachedTeacherOptions(names);
  }
  async function hydrateTeacherOptionsFromSupabase(){
    if (teacherOptionsLoading) return teacherOptionsLoading;
    teacherOptionsLoading = (async function(){
      try {
        if (typeof settingsLoadMembers === 'function') {
          await settingsLoadMembers();
          cacheTeacherOptions();
          return getTeacherOptions();
        }
      } catch(e) {
        console.warn('settings teacher load skipped:', e.message || e);
      }

      if (!isSupabaseConfigured()) return getTeacherOptions();
      const academyId = getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : '';
      const academyCode = getOlliCurrentAcademyCode ? getOlliCurrentAcademyCode() : '';
      const fetched = [];
      try {
        if (academyId) {
          const byId = await supabase('GET', `academy_members?select=*&academy_id=eq.${encodeURIComponent(academyId)}&order=created_at.asc`);
          if (Array.isArray(byId)) fetched.push(...byId);
        }
      } catch(e) {
        console.warn('academy_members academy_id teacher load skipped:', e.message || e);
      }
      try {
        if (academyCode) {
          const byCode = await supabase('GET', `academy_members?select=*&academy_code=eq.${encodeURIComponent(academyCode)}&order=created_at.asc`);
          if (Array.isArray(byCode)) fetched.push(...byCode);
        }
      } catch(e) {
        console.warn('academy_members academy_code teacher load skipped:', e.message || e);
      }
      if (fetched.length) {
        const byKey = new Map();
        fetched.forEach(member => byKey.set(teacherMemberId(member) || teacherNameFromMember(member), member));
        if (typeof olliSettingsState !== 'undefined') olliSettingsState.members = Array.from(byKey.values());
        cacheTeacherOptions();
      }
      return getTeacherOptions();
    })().finally(() => { teacherOptionsLoading = null; });
    return teacherOptionsLoading;
  }
  const originalSettingsApplyStateToUI = window.settingsApplyStateToUI;
  if (typeof originalSettingsApplyStateToUI === 'function') {
    window.settingsApplyStateToUI = function(){
      const r = originalSettingsApplyStateToUI.apply(this, arguments);
      cacheTeacherOptions();
      refreshAllTeacherDropdowns();
      return r;
    };
  }
  
function refreshAllTeacherDropdowns(){
    try {
      const targets = [
        ['kinderTeacherToggleRow', typeof kinderInfoTeacherDraft !== 'undefined' ? kinderInfoTeacherDraft : '', 'selectKinderInfoTeacher'],
        ['studentTeacherToggleRow', typeof studentModalTeacherDraft !== 'undefined' ? studentModalTeacherDraft : '', 'selectStudentModalTeacher'],
        ['elementaryStudentTeacherToggleRow', typeof studentModalTeacherDraft !== 'undefined' ? studentModalTeacherDraft : '', 'selectStudentModalTeacher'],
        ['elementaryTeacherToggleRow', typeof elementaryInfoTeacherDraft !== 'undefined' ? elementaryInfoTeacherDraft : '', 'selectElementaryInfoTeacher']
      ];
      targets.forEach(([id, selected, setter]) => {
        if (document.getElementById(id)) renderTeacherButtons(id, selected || '', setter);
      });
    } catch(e) {
      console.warn('teacher dropdown refresh skipped:', e);
    }
  }
  window.refreshAllTeacherDropdowns = refreshAllTeacherDropdowns;
  window.cacheTeacherOptions = cacheTeacherOptions;
  window.hydrateTeacherOptionsFromSupabase = hydrateTeacherOptionsFromSupabase;
window.__olliTeacherDropdownOpen = window.__olliTeacherDropdownOpen || {};
  function escapeTeacherHtml(value){
    return String(value || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }
  function teacherCallArg(value){
    return JSON.stringify(String(value || '')).replace(/</g, '\u003c');
  }
  window.toggleTeacherDropdown = function(containerId){
    window.__olliTeacherDropdownOpen[containerId] = !window.__olliTeacherDropdownOpen[containerId];
    const drafts = {
      kinderTeacherToggleRow: typeof kinderInfoTeacherDraft !== 'undefined' ? kinderInfoTeacherDraft : '',
      studentTeacherToggleRow: typeof studentModalTeacherDraft !== 'undefined' ? studentModalTeacherDraft : '',
      elementaryStudentTeacherToggleRow: typeof studentModalTeacherDraft !== 'undefined' ? studentModalTeacherDraft : '',
      elementaryTeacherToggleRow: typeof elementaryInfoTeacherDraft !== 'undefined' ? elementaryInfoTeacherDraft : ''
    };
    const setters = { kinderTeacherToggleRow:'selectKinderInfoTeacher', studentTeacherToggleRow:'selectStudentModalTeacher', elementaryStudentTeacherToggleRow:'selectStudentModalTeacher', elementaryTeacherToggleRow:'selectElementaryInfoTeacher' };
    renderTeacherButtons(containerId, drafts[containerId] || '', setters[containerId] || 'selectKinderInfoTeacher');
  };
  function renderTeacherButtons(containerId, selected, setterName){
    const el = document.getElementById(containerId); if (!el) return;
    const teachers = getTeacherOptions();
    const isOpen = !!window.__olliTeacherDropdownOpen[containerId];
    const selectedDisplay = formatTeacherNameWithT(selected);
    const label = selectedDisplay ? escapeTeacherHtml(selectedDisplay) : '없음';
    const noneOption = '<button type="button" class="infoTeacherOption '+(!selectedDisplay?'active':'')+'" data-teacher-name="" data-teacher-setter="'+escapeTeacherHtml(setterName)+'" onclick="handleTeacherOptionClick(event)">없음</button>';
    const teacherOptions = teachers.length
      ? teachers.map(name => {
          const displayName = formatTeacherNameWithT(name);
          const activeClass = displayName === selectedDisplay ? 'active' : '';
          return '<button type="button" class="infoTeacherOption '+activeClass+'" data-teacher-name="'+escapeTeacherHtml(displayName)+'" data-teacher-setter="'+escapeTeacherHtml(setterName)+'" onclick="handleTeacherOptionClick(event)">'+escapeTeacherHtml(displayName)+'</button>';
        }).join('')
      : '<div class="infoTeacherEmpty">선생님 관리 목록이 비어있어요.</div>';
    const options = noneOption + teacherOptions;
    el.innerHTML = '<div class="infoTeacherSelect '+(isOpen?'open':'')+'"><button type="button" class="infoTeacherSelectBox '+(selected?'':'placeholder')+'" onclick="toggleTeacherDropdown(\''+containerId+'\')"><span>'+label+'</span><i class="infoTeacherArrow" aria-hidden="true"></i></button><div class="infoTeacherDropdown">'+options+'</div></div>';
  }
  window.handleTeacherOptionClick = function(event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }
    const btn = event && event.currentTarget ? event.currentTarget : null;
    if (!btn) return;
    const name = btn.dataset.teacherName || '';
    const setterName = btn.dataset.teacherSetter || '';
    const setter = window[setterName];
    if (typeof setter === 'function') setter(name);
  };
  function renderDayButtons(containerId, selected, setterName){
    const set = new Set(Array.isArray(selected) ? selected : parseDays(selected));
    const el = document.getElementById(containerId); if (!el) return;
    el.innerHTML = DAYS.map(d => '<button type="button" class="infoDayBtn '+(set.has(d)?'active':'')+'" onclick="'+setterName+'(\''+d+'\')">'+d+'</button>').join('');
  }
  function renderStudentGroupButtons(containerId, selected, setterName){
    const el = document.getElementById(containerId); if (!el) return;
    const groups = [['1','A'], ['2','B'], ['3','C'], ['4','D'], ['5','E'], ['6','F']];
    el.innerHTML = groups.map(([group,label]) => '<button type="button" class="infoToggleBtn groupIconChoiceBtn '+(String(selected||'')===group?'active':'')+'" onclick="'+setterName+'(\''+group+'\')">'+label+'</button>').join('');
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
  window.selectKinderInfoTeacher = function(name){ kinderInfoTeacherDraft = formatTeacherNameWithT(name); window.__olliTeacherDropdownOpen.kinderTeacherToggleRow = false; renderTeacherButtons('kinderTeacherToggleRow', kinderInfoTeacherDraft, 'selectKinderInfoTeacher'); };
  window.selectElementaryInfoTeacher = function(name){ elementaryInfoTeacherDraft = formatTeacherNameWithT(name); window.__olliTeacherDropdownOpen.elementaryTeacherToggleRow = false; renderTeacherButtons('elementaryTeacherToggleRow', elementaryInfoTeacherDraft, 'selectElementaryInfoTeacher'); };
  window.toggleKinderInfoDay = function(day){ const i = kinderInfoDaysDraft.indexOf(day); if (i >= 0) kinderInfoDaysDraft.splice(i,1); else kinderInfoDaysDraft.push(day); renderDayButtons('kinderLessonDayToggleRow', kinderInfoDaysDraft, 'toggleKinderInfoDay'); };
  window.toggleElementaryInfoDay = function(day){ const i = elementaryInfoDaysDraft.indexOf(day); if (i >= 0) elementaryInfoDaysDraft.splice(i,1); else elementaryInfoDaysDraft.push(day); renderDayButtons('elementaryLessonDayToggleRow', elementaryInfoDaysDraft, 'toggleElementaryInfoDay'); };
  window.selectStudentModalTeacher = function(name){
    studentModalTeacherDraft = formatTeacherNameWithT(name);
    window.__olliTeacherDropdownOpen.studentTeacherToggleRow = false;
    window.__olliTeacherDropdownOpen.elementaryStudentTeacherToggleRow = false;
    renderTeacherButtons('studentTeacherToggleRow', studentModalTeacherDraft, 'selectStudentModalTeacher');
    renderTeacherButtons('elementaryStudentTeacherToggleRow', studentModalTeacherDraft, 'selectStudentModalTeacher');
    renderStudentGroupButtons('elementaryStudentGroupToggleRow', studentModalElementaryGroupDraft, 'selectStudentModalElementaryGroup');
  };
  window.toggleStudentModalDay = function(day){ const i = studentModalDaysDraft.indexOf(day); if (i >= 0) studentModalDaysDraft.splice(i,1); else studentModalDaysDraft.push(day); renderDayButtons('studentLessonDayToggleRow', studentModalDaysDraft, 'toggleStudentModalDay'); renderDayButtons('elementaryStudentLessonDayToggleRow', studentModalDaysDraft, 'toggleStudentModalDay'); };
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

  function patchStudentModalMarkup(){
    const studentCard = document.querySelector('#studentModal .modalCard');
    if (studentCard && studentCard.dataset.orderedStudentFields !== '1') {
      studentCard.dataset.orderedStudentFields = '1';
      studentCard.innerHTML = '<div class="modalTitle" id="studentModalTitle">학생 등록</div>'
        + '<div class="studentPopupNameTeacherRow">'
        + '<div class="kinderInfoModalField studentPopupNameField"><div class="modalLabel">이름 *</div><input id="studentNameInput" placeholder="예: 김민준" class="modalInput" onkeydown="if(event.key===\'Enter\')confirmStudent()"></div>'
        + '<div id="elementaryStudentPersonalityField" class="kinderInfoModalField studentPopupPersonalityField"><div id="elementaryStudentPersonalityToggleRow" class="infoTeacherToggleRow infoPersonalityToggleRow"></div></div>'
        + '<div id="studentKinderPersonalityField" class="kinderInfoModalField studentPopupPersonalityField" style="display:none;"><div id="studentKinderPersonalityToggleRow" class="infoTeacherToggleRow infoPersonalityToggleRow"></div></div>'
        + '<div id="elementaryStudentTeacherField" class="kinderInfoModalField studentPopupTeacherField"><div class="modalLabel">담임</div><div id="elementaryStudentTeacherToggleRow" class="infoTeacherToggleRow"></div></div>'
        + '<div id="studentTeacherField" class="kinderInfoModalField studentPopupTeacherField" style="display:none;"><div class="modalLabel">담임</div><div id="studentTeacherToggleRow" class="infoTeacherToggleRow"></div></div>'
        + '</div>'
        + '<div id="elementaryStudentGradeClassField" class="studentPopupSchoolRow"><div class="kinderInfoModalField studentPopupSchoolField"><div class="modalLabel">학교</div><input id="studentSchoolInput" class="modalInput" placeholder="학교"></div><div class="kinderInfoModalField studentPopupGradeField"><div class="modalLabel">학년</div><input id="studentGradeInput" class="modalInput" type="text" inputmode="numeric" placeholder="학년" onfocus="focusElementaryGradeInput(this)" oninput="syncStudentElementaryAgeFromGrade()" onblur="blurStudentElementaryGradeInput()"></div><div class="kinderInfoModalField studentPopupClassField"><div class="modalLabel">나이</div><input id="studentElementaryAgeInput" class="modalInput" type="text" inputmode="numeric" placeholder="나이" readonly></div></div>'
        + '<div id="studentKinderBasicField" class="studentPopupKinderBasicRow" style="display:none;"><div class="kinderInfoModalField studentPopupKindergartenField"><div class="modalLabel">유치원</div><input id="studentKindergartenInput" placeholder="예: OO유치원" class="modalInput"></div><div class="kinderInfoModalField studentPopupAgeField"><div class="modalLabel">나이</div><input id="studentAgeInput" type="number" min="1" max="8" placeholder="나이" class="modalInput"></div><div class="kinderInfoModalField studentPopupEmptyCell"><div class="modalLabel">&nbsp;</div><input class="modalInput" tabindex="-1" aria-hidden="true"></div></div>'
        + '<div class="studentPopupDateOnlyRow">'
        + '<div class="kinderInfoModalField studentPopupYearField"><div class="modalLabel">년</div><input id="studentYearBadge" type="number" min="1900" max="2100" inputmode="numeric" placeholder="년" class="modalInput"></div>'
        + '<div class="kinderInfoModalField studentPopupMonthField"><div class="modalLabel">월</div><input id="studentMonthInput" type="number" min="1" max="12" placeholder="월" class="modalInput"></div>'
        + '<div class="kinderInfoModalField studentPopupDayField"><div class="modalLabel">일</div><input id="studentDayInput" type="number" min="1" max="31" placeholder="일" class="modalInput"></div>'
        + '</div>'
        + '<div id="studentElementaryFields">'
        + '<div id="elementaryStudentLessonDayField" class="kinderInfoModalField"><div class="modalLabel">요일</div><div id="elementaryStudentLessonDayToggleRow" class="infoDayToggleRow"></div></div>'
        
        + '<div id="elementaryStudentGroupField" class="kinderInfoModalField"><div class="modalLabel">그룹</div><div id="elementaryStudentGroupToggleRow" class="infoToggleRow"></div></div>'
        + '</div>'
        + '<div id="kinderExtraFields" style="display:none;">'
        + '<div class="kinderInfoModalField"><div class="modalLabel">요일</div><div id="studentLessonDayToggleRow" class="infoDayToggleRow"></div><input id="studentLessonDayInput" type="hidden"></div>'
        
        + '</div>'
        + '<div class="modalActions"><button class="modalBtnCancel" data-modal-close="studentModal" type="button">취소</button><button onclick="confirmStudent()" class="modalBtnConfirm">추가</button></div>';
    }

    const elementaryInfoCard = document.querySelector('#elementaryInfoModal .modalCard');
    if (elementaryInfoCard && elementaryInfoCard.dataset.orderedStudentFields !== '1') {
      elementaryInfoCard.dataset.orderedStudentFields = '1';
      elementaryInfoCard.innerHTML = '<div class="modalTitle">초등 학생 정보</div>'
        + '<div class="studentPopupNameTeacherRow">'
        + '<div class="kinderInfoModalField studentPopupNameField"><div class="modalLabel">이름</div><input id="elementaryInfoNameInput" class="modalInput" placeholder="예: 김민준"></div>'
        + '<div class="kinderInfoModalField studentPopupPersonalityField"><div id="elementaryPersonalityToggleRow" class="infoTeacherToggleRow infoPersonalityToggleRow"></div></div>'
        + '<div class="kinderInfoModalField studentPopupTeacherField"><div class="modalLabel">담임</div><div id="elementaryTeacherToggleRow" class="infoTeacherToggleRow"></div></div>'
        + '</div>'
        + '<div class="studentPopupSchoolRow"><div class="kinderInfoModalField studentPopupSchoolField"><div class="modalLabel">학교</div><input id="elementarySchoolInput" class="modalInput" placeholder="학교"></div><div class="kinderInfoModalField studentPopupGradeField"><div class="modalLabel">학년</div><input id="elementaryGradeInput" class="modalInput" type="text" inputmode="numeric" placeholder="학년" onfocus="focusElementaryGradeInput(this)" oninput="syncElementaryInfoAgeFromGrade()" onblur="blurElementaryInfoGradeInput()"></div><div class="kinderInfoModalField studentPopupClassField"><div class="modalLabel">나이</div><input id="elementaryAgeInput" class="modalInput" type="text" inputmode="numeric" placeholder="나이" readonly></div></div>'
        + '<div class="studentPopupDateOnlyRow">'
        + '<div class="kinderInfoModalField studentPopupYearField"><div class="modalLabel">년</div><input id="elementaryInfoYearInput" class="modalInput" type="number" min="1900" max="2100" inputmode="numeric" placeholder="년"></div>'
        + '<div class="kinderInfoModalField studentPopupMonthField"><div class="modalLabel">월</div><input id="elementaryInfoMonthInput" class="modalInput" type="number" min="1" max="12" inputmode="numeric" placeholder="월"></div>'
        + '<div class="kinderInfoModalField studentPopupDayField"><div class="modalLabel">일</div><input id="elementaryInfoDayInput" class="modalInput" type="number" min="1" max="31" inputmode="numeric" placeholder="일"></div>'
        + '</div>'
        + '<div class="kinderInfoModalField"><div class="modalLabel">요일</div><div id="elementaryLessonDayToggleRow" class="infoDayToggleRow"></div></div>'
        
        + '<div class="kinderInfoModalField"><div class="modalLabel">그룹</div><div id="elementaryGroupToggleRow" class="infoToggleRow"><button type="button" class="infoToggleBtn groupIconChoiceBtn" data-group="1" onclick="selectElementaryGroup(\'1\')">A</button><button type="button" class="infoToggleBtn groupIconChoiceBtn" data-group="2" onclick="selectElementaryGroup(\'2\')">B</button><button type="button" class="infoToggleBtn groupIconChoiceBtn" data-group="3" onclick="selectElementaryGroup(\'3\')">C</button><button type="button" class="infoToggleBtn groupIconChoiceBtn" data-group="4" onclick="selectElementaryGroup(\'4\')">D</button><button type="button" class="infoToggleBtn groupIconChoiceBtn" data-group="5" onclick="selectElementaryGroup(\'5\')">E</button><button type="button" class="infoToggleBtn groupIconChoiceBtn" data-group="6" onclick="selectElementaryGroup(\'6\')">F</button></div></div>'
        + ''
        + '<div class="modalActions"><button class="modalBtnCancel" data-modal-close="elementaryInfoModal" type="button">취소</button><button onclick="saveElementaryInfo()" class="modalBtnConfirm">저장</button></div>';
    }

    const modal = document.querySelector('#kinderInfoModal .modalCard');
    if (modal && !document.getElementById('kinderTeacherToggleRow')) {
      modal.innerHTML = '<div class="modalTitle">유치부 학생 정보</div>'
        + '<div class="studentPopupNameTeacherRow">'
        + '<div class="kinderInfoModalField studentPopupNameField"><div class="modalLabel">이름</div><input id="kinderInfoNameInput" class="modalInput" placeholder="예: 김민준"></div>'
        + '<div class="kinderInfoModalField studentPopupPersonalityField"><div id="kinderPersonalityToggleRow" class="infoTeacherToggleRow infoPersonalityToggleRow"></div></div>'
        + '<div class="kinderInfoModalField studentPopupTeacherField"><div class="modalLabel">담임</div><div id="kinderTeacherToggleRow" class="infoTeacherToggleRow"></div></div>'
        + '</div>'
        + '<div class="studentPopupKinderBasicRow">'
        + '<div class="kinderInfoModalField studentPopupKindergartenField"><div class="modalLabel">유치원</div><input id="kinderKindergartenInput" class="modalInput" placeholder="예: OO유치원"></div>'
        + '<div class="kinderInfoModalField studentPopupAgeField"><div class="modalLabel">나이</div><input id="kinderAgeInput" class="modalInput" type="number" min="1" max="8" placeholder="나이"></div>'
        + '<div class="kinderInfoModalField studentPopupEmptyCell"><div class="modalLabel">&nbsp;</div><input class="modalInput" tabindex="-1" aria-hidden="true"></div>'
        + '</div>'
        + '<div class="studentPopupDateOnlyRow">'
        + '<div class="kinderInfoModalField studentPopupYearField"><div class="modalLabel">년</div><input id="kinderInfoYearInput" class="modalInput" type="number" min="1900" max="2100" inputmode="numeric" placeholder="년"></div>'
        + '<div class="kinderInfoModalField studentPopupMonthField"><div class="modalLabel">월</div><input id="kinderInfoMonthInput" class="modalInput" type="number" min="1" max="12" inputmode="numeric" placeholder="월"></div>'
        + '<div class="kinderInfoModalField studentPopupDayField"><div class="modalLabel">일</div><input id="kinderInfoDayInput" class="modalInput" type="number" min="1" max="31" inputmode="numeric" placeholder="일"></div>'
        + '</div>'
        + '<div class="kinderInfoModalField"><div class="modalLabel">요일</div><div id="kinderLessonDayToggleRow" class="infoDayToggleRow"></div><input id="kinderLessonDayInput" type="hidden"></div>'
        
        + ''
        + '<div class="modalActions"><button class="modalBtnCancel" data-modal-close="kinderInfoModal" type="button">취소</button><button onclick="saveKinderInfo()" class="modalBtnConfirm">저장</button></div>';
    }
  }

  window.olliPatchStudentModalMarkup = patchStudentModalMarkup;
  window.olliPrepareStudentAddExtra = function(targetView){
    patchStudentModalMarkup();
    studentModalTeacherDraft = '';
    studentModalElementaryGroupDraft = '';
    studentModalPersonalityDraft = '';
    window.__olliTeacherDropdownOpen.studentTeacherToggleRow = false;
    window.__olliTeacherDropdownOpen.elementaryStudentTeacherToggleRow = false;
    studentModalDaysDraft = [];
    const elementaryFields = document.getElementById('studentElementaryFields');
    const kinderExtraFields = document.getElementById('kinderExtraFields');
    if (elementaryFields) elementaryFields.style.display = targetView === 'elementary' ? 'block' : 'none';
    if (kinderExtraFields) kinderExtraFields.style.display = targetView === 'kinder' ? 'block' : 'none';
    const elementaryGradeClassField = document.getElementById('elementaryStudentGradeClassField');
    const studentKinderBasicField = document.getElementById('studentKinderBasicField');
    const elementaryDayField = document.getElementById('elementaryStudentLessonDayField');
    const elementaryTeacherField = document.getElementById('elementaryStudentTeacherField');
    const studentTeacherField = document.getElementById('studentTeacherField');
    const elementaryGroupField = document.getElementById('elementaryStudentGroupField');
    const elementaryPersonalityField = document.getElementById('elementaryStudentPersonalityField');
    const studentKinderPersonalityField = document.getElementById('studentKinderPersonalityField');
    if (elementaryGradeClassField) elementaryGradeClassField.style.display = targetView === 'elementary' ? 'grid' : 'none';
    if (studentKinderBasicField) studentKinderBasicField.style.display = targetView === 'kinder' ? 'grid' : 'none';
    if (elementaryDayField) elementaryDayField.style.display = targetView === 'elementary' ? 'block' : 'none';
    if (elementaryTeacherField) elementaryTeacherField.style.display = targetView === 'elementary' ? 'block' : 'none';
    if (studentTeacherField) studentTeacherField.style.display = targetView === 'kinder' ? 'block' : 'none';
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
    renderTeacherButtons('studentTeacherToggleRow', studentModalTeacherDraft, 'selectStudentModalTeacher');
    renderTeacherButtons('elementaryStudentTeacherToggleRow', studentModalTeacherDraft, 'selectStudentModalTeacher');
    renderStudentGroupButtons('elementaryStudentGroupToggleRow', studentModalElementaryGroupDraft, 'selectStudentModalElementaryGroup');
    renderPersonalityButtons('studentKinderPersonalityToggleRow', studentModalPersonalityDraft, 'selectStudentModalPersonality');
    renderPersonalityButtons('elementaryStudentPersonalityToggleRow', studentModalPersonalityDraft, 'selectStudentModalPersonality');
    hydrateTeacherOptionsFromSupabase().then(refreshAllTeacherDropdowns);
    renderDayButtons('studentLessonDayToggleRow', studentModalDaysDraft, 'toggleStudentModalDay');
    renderDayButtons('elementaryStudentLessonDayToggleRow', studentModalDaysDraft, 'toggleStudentModalDay');
  };
  window.olliGetStudentAddExtra = function(type){
    const teacher = formatTeacherNameWithT(studentModalTeacherDraft);
    return {
      lesson_day: daysToText(studentModalDaysDraft),
      teacher,
      homeroom_teacher: teacher,
      group: type === 'elementary' ? studentModalElementaryGroupDraft : '',
      group_months: type === 'elementary' ? elementaryGroupMonthsToText(getElementaryGroupFeedbackMonths(studentModalElementaryGroupDraft)) : '',
      feedback_months: type === 'elementary' ? elementaryGroupMonthsToText(getElementaryGroupFeedbackMonths(studentModalElementaryGroupDraft)) : '',
      school: type === 'elementary' ? (document.getElementById('studentSchoolInput')?.value || '').trim() : '',
      grade: type === 'elementary' ? normalizeElementaryGradeValue(document.getElementById('studentGradeInput')?.value || '') : '',
      age: type === 'elementary' ? getElementaryAgeFromGrade(normalizeElementaryGradeValue(document.getElementById('studentGradeInput')?.value || '')) : '',
      className: '',
      personality: studentModalPersonalityDraft || ''
    };
  };
  window.olliPrepareInfoExtra = function(type, student){
    patchStudentModalMarkup();
    if (type === 'kinder') {
      kinderInfoTeacherDraft = formatTeacherNameWithT(student?.teacher || student?.homeroom_teacher || '');
      kinderInfoDraft.personality = student?.personality || '';
      window.__olliTeacherDropdownOpen.kinderTeacherToggleRow = false;
      kinderInfoDaysDraft = parseDays(student?.lesson_day || '');
      renderTeacherButtons('kinderTeacherToggleRow', kinderInfoTeacherDraft, 'selectKinderInfoTeacher');
      renderPersonalityButtons('kinderPersonalityToggleRow', kinderInfoDraft.personality, 'selectKinderPersonality');
      hydrateTeacherOptionsFromSupabase().then(refreshAllTeacherDropdowns);
      renderDayButtons('kinderLessonDayToggleRow', kinderInfoDaysDraft, 'toggleKinderInfoDay');
      return;
    }
    if (type === 'elementary') {
      elementaryInfoTeacherDraft = formatTeacherNameWithT(student?.teacher || student?.homeroom_teacher || '');
      elementaryInfoDraft.personality = student?.personality || '';
      window.__olliTeacherDropdownOpen.elementaryTeacherToggleRow = false;
      if (window.__olliPersonalityDropdownOpen) window.__olliPersonalityDropdownOpen.elementaryPersonalityToggleRow = false;
      elementaryInfoDaysDraft = parseDays(student?.lesson_day || student?.lessonDay || '');
      renderTeacherButtons('elementaryTeacherToggleRow', elementaryInfoTeacherDraft, 'selectElementaryInfoTeacher');
      renderPersonalityButtons('elementaryPersonalityToggleRow', elementaryInfoDraft.personality, 'selectElementaryPersonality');
      hydrateTeacherOptionsFromSupabase().then(refreshAllTeacherDropdowns);
      renderDayButtons('elementaryLessonDayToggleRow', elementaryInfoDaysDraft, 'toggleElementaryInfoDay');
    }
  };
  window.olliGetInfoExtra = function(type){
    if (type === 'kinder') {
      const teacher = formatTeacherNameWithT(kinderInfoTeacherDraft);
      return { lesson_day: daysToText(kinderInfoDaysDraft), teacher, homeroom_teacher: teacher, personality: kinderInfoDraft.personality || '' };
    }
    if (type === 'elementary') {
      const teacher = formatTeacherNameWithT(elementaryInfoTeacherDraft);
      return { lesson_day: daysToText(elementaryInfoDaysDraft), teacher, homeroom_teacher: teacher, group_months: elementaryGroupMonthsToText(getElementaryGroupFeedbackMonths(elementaryInfoDraft.group)), feedback_months: elementaryGroupMonthsToText(getElementaryGroupFeedbackMonths(elementaryInfoDraft.group)) };
    }
    return {};
  };

  document.addEventListener('DOMContentLoaded', function(){
    installRecordSortButton();
    patchStudentModalMarkup();
    hydrateTeacherOptionsFromSupabase().then(refreshAllTeacherDropdowns);
    document.querySelectorAll('strong').forEach(el => { if ((el.textContent || '').trim() === '수업 장면 ‘1분 피드백’') el.textContent = '1분 피드백'; });
    document.querySelectorAll('*').forEach(el => { if (el.childNodes && el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 && el.textContent.includes('수업장면 1분 피드백')) el.textContent = el.textContent.replace(/수업장면 1분 피드백/g, '1분 피드백'); });
  });
})();
