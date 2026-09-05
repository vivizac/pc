
/* 2026-07-04: 출결 보강 정책 + 중간 도입 학원 계산 시작일 */
(function(){
  var STORAGE_PREFIX = 'olli_attendance_policy_v1';
  var DEFAULT_EXPIRE = '3m';
  var EXPIRE_OPTIONS = [
    ['1m', '1개월'],
    ['2m', '2개월'],
    ['3m', '3개월'],
    ['6m', '6개월'],
    ['12m', '12개월'],
    ['year_end', '연도 말까지']
  ];

  function text(value){ return String(value == null ? '' : value).trim(); }
  function escape(value){
    try { if (typeof window.settingsEscapeHtml === 'function') return window.settingsEscapeHtml(value); } catch(_) {}
    try { if (typeof window.escapeHtml === 'function') return window.escapeHtml(value); } catch(_) {}
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(s){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]); });
  }
  function getAcademyId(){
    try { if (typeof window.getOlliCurrentAcademyId === 'function') return text(window.getOlliCurrentAcademyId()); } catch(_) {}
    try { return text(localStorage.getItem('olli_current_academy_id')); } catch(_) { return ''; }
  }
  function getPolicyKey(){
    var academyId = getAcademyId() || 'unscoped';
    return STORAGE_PREFIX + '_' + academyId;
  }
  function formatDateKey(dateValue){
    var d = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (Number.isNaN(d.getTime())) return '';
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  function parseDateKey(value){
    var parts = text(value).split('-').map(Number);
    if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return null;
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    if (Number.isNaN(d.getTime())) return null;
    if (d.getFullYear() !== parts[0] || d.getMonth() !== parts[1] - 1 || d.getDate() !== parts[2]) return null;
    d.setHours(0,0,0,0);
    return d;
  }
  function clampDateParts(year, month, day){
    var y = Number(year) || new Date().getFullYear();
    var m = Math.min(Math.max(Number(month) || 1, 1), 12);
    var last = new Date(y, m, 0).getDate();
    var d = Math.min(Math.max(Number(day) || 1, 1), last);
    return formatDateKey(new Date(y, m - 1, d));
  }
  function getDefaultPolicy(){
    return {
      startDate: formatDateKey(new Date()),
      makeupExpire: DEFAULT_EXPIRE
    };
  }
  function normalizeExpire(value){
    value = text(value);
    return EXPIRE_OPTIONS.some(function(item){ return item[0] === value; }) ? value : DEFAULT_EXPIRE;
  }
  function readStoredPolicyRaw(){
    try {
      var raw = localStorage.getItem(getPolicyKey());
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch(_) { return null; }
  }
  function writePolicy(policy){
    var normalized = normalizePolicy(policy);
    try { localStorage.setItem(getPolicyKey(), JSON.stringify(normalized)); } catch(_) {}
    return normalized;
  }
  function normalizePolicy(policy){
    var base = getDefaultPolicy();
    var start = parseDateKey(policy && policy.startDate) || parseDateKey(policy && policy.attendanceStartDate) || parseDateKey(base.startDate);
    return {
      startDate: formatDateKey(start),
      makeupExpire: normalizeExpire(policy && (policy.makeupExpire || policy.makeupExpirePolicy || policy.expire))
    };
  }
  function getPolicy(){
    var stored = readStoredPolicyRaw();
    if (!stored) {
      return writePolicy(getDefaultPolicy());
    }
    return normalizePolicy(stored);
  }
  function getExpireLabel(value){
    value = normalizeExpire(value);
    var found = EXPIRE_OPTIONS.find(function(item){ return item[0] === value; });
    return found ? found[1] : '3개월';
  }
  function formatKoreanShortDate(dateKey){
    var d = parseDateKey(dateKey);
    if (!d) return '';
    return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
  }
  function addMonthsSafe(date, months){
    var d = date instanceof Date ? new Date(date.getTime()) : new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    var originalDay = d.getDate();
    var targetMonthIndex = d.getMonth() + Number(months || 0);
    var target = new Date(d.getFullYear(), targetMonthIndex, 1);
    var lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(originalDay, lastDay));
    target.setHours(23,59,59,999);
    return target;
  }
  function getAbsenceExpiryDate(absenceDate, policy){
    var d = absenceDate instanceof Date ? new Date(absenceDate.getTime()) : new Date(absenceDate);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0,0,0,0);
    var expire = normalizeExpire(policy && policy.makeupExpire);
    if (expire === 'year_end') {
      var end = new Date(d.getFullYear(), 11, 31);
      end.setHours(23,59,59,999);
      return end;
    }
    var months = Number(expire.replace('m','')) || 3;
    return addMonthsSafe(d, months);
  }
  function isWithinPolicyStart(date, policy){
    var d = date instanceof Date ? new Date(date.getTime()) : new Date(date);
    var start = parseDateKey(policy && policy.startDate);
    if (Number.isNaN(d.getTime()) || !start) return false;
    d.setHours(0,0,0,0);
    return d >= start;
  }
  function countablePastDate(dateValue){
    var d = dateValue instanceof Date ? new Date(dateValue.getTime()) : new Date(dateValue);
    if (Number.isNaN(d.getTime())) return false;
    d.setHours(0,0,0,0);
    var today = new Date();
    today.setHours(0,0,0,0);
    var policy = getPolicy();
    return d < today && isWithinPolicyStart(d, policy);
  }
  function isRecordLessonDate(student, date){
    try { if (typeof window.isRecordStudentLessonDate === 'function') return !!window.isRecordStudentLessonDate(student, date); } catch(_) {}
    return false;
  }
  function getAttendanceStatus(student, date){
    try {
      if (typeof window.getRecordAttendanceStatus === 'function') return String(window.getRecordAttendanceStatus(student && student.id, formatDateKey(date)) || '');
    } catch(_) {}
    return '';
  }
  function getEnrollmentDate(student){
    var raw = '';
    try { if (typeof window.getEnrolledAtFromStudent === 'function') raw = window.getEnrolledAtFromStudent(student); } catch(_) {}
    raw = raw || (student && (student.enrolled_at || student.enrolledAt || student.registered_at || student.registeredAt)) || '';
    if (!raw && student) {
      var y = student.year || student.enrolled_year || '';
      var m = student.month || student.enrolled_month || '';
      var d = student.day || student.enrolled_day || '';
      if (y && m && d) raw = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    }
    return parseDateKey(String(raw).split('T')[0]);
  }
  function getStudentAttendancePolicyCounts(student){
    var today = new Date();
    today.setHours(0,0,0,0);
    var year = today.getFullYear();
    var policy = getPolicy();
    var policyStart = parseDateKey(policy.startDate) || new Date(year, 0, 1);
    var enrollment = getEnrollmentDate(student);
    var yearStart = new Date(year, 0, 1);
    var start = yearStart;
    [policyStart, enrollment].forEach(function(candidate){
      if (candidate && candidate > start) start = new Date(candidate.getTime());
    });
    start.setHours(0,0,0,0);

    var yearAbsence = 0;
    var unexpiredAbsence = 0;
    var yearMakeup = 0;

    for (var cursor = new Date(start.getTime()); cursor <= today; cursor.setDate(cursor.getDate() + 1)) {
      var status = getAttendanceStatus(student, cursor);
      var lessonDate = isRecordLessonDate(student, cursor);
      if (status === 'makeup') {
        yearMakeup += 1;
      }
      if (lessonDate && cursor < today && status !== 'attended') {
        yearAbsence += 1;
        var expiry = getAbsenceExpiryDate(cursor, policy);
        if (expiry && today <= expiry) unexpiredAbsence += 1;
      }
    }
    return {
      year: year,
      startDate: policy.startDate,
      makeupExpire: policy.makeupExpire,
      yearAbsence: yearAbsence,
      yearMakeup: yearMakeup,
      remainingMakeup: Math.max(unexpiredAbsence - yearMakeup, 0),
      unexpiredAbsence: unexpiredAbsence
    };
  }
  function safeTemplate(value){
    try { if (typeof window.escapeTemplateLiteral === 'function') return window.escapeTemplateLiteral(value); } catch(_) {}
    return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  }
  function getNormalElementaryMeta(student){
    var bits = [];
    try { if (typeof window.getElementaryMetaBits === 'function') bits = window.getElementaryMetaBits(student); } catch(_) { bits = []; }
    return (Array.isArray(bits) ? bits : []).join('\u00A0\u00A0|\u00A0\u00A0');
  }
  function getNormalKinderMeta(student){
    var bits = [];
    try { if (typeof window.getKinderMetaBits === 'function') bits = window.getKinderMetaBits(student); } catch(_) { bits = []; }
    return (Array.isArray(bits) ? bits : []).join('\u00A0\u00A0|\u00A0\u00A0');
  }
  function renderAttendanceGuideHtml(student){
    var c = getStudentAttendancePolicyCounts(student);
    return '<span class="recordAttendanceGuideMeta">'
      + '<span class="recordAttendanceMetric recordAttendanceYearMetric"><b>' + c.year + '년</b></span>'
      + '<span class="recordAttendanceMetric">결석 <b>' + c.yearAbsence + '회</b></span>'
      + '<span class="recordAttendanceMetric">보강 <b>' + c.yearMakeup + '회</b></span>'
      + '<span class="recordAttendanceMetric">남은 보강 <b>' + c.remainingMakeup + '회</b></span>'
      + '</span>';
  }
  function isAttendanceGuideActive(){
    var btn = document.getElementById('recordAttendanceGuideToggle');
    return !!(btn && btn.classList.contains('active'));
  }

  var previousElementaryRenderer = window.renderElementaryStudentRows;
  var previousKinderRenderer = window.renderKinderStudentRows;

  window.renderElementaryStudentRows = function(students){
    if (!isAttendanceGuideActive() && typeof previousElementaryRenderer === 'function') return previousElementaryRenderer(students);
    var cycleGroups = typeof window.getElementaryCycleGroups === 'function' ? window.getElementaryCycleGroups(students) : {};
    var previousSectionKey = '';
    return (Array.isArray(students) ? students : []).map(function(student, index){
      var sectionKey = '';
      try {
        sectionKey = typeof window.getRecordSortSectionKey === 'function'
          ? window.getRecordSortSectionKey(student, 'elementary', cycleGroups)
          : (typeof window.getElementaryGroupSectionKey === 'function' ? window.getElementaryGroupSectionKey(student, cycleGroups) : '');
      } catch(_) { sectionKey = ''; }
      var groupBreakClass = index > 0 && sectionKey !== previousSectionKey ? ' groupBreak' : '';
      previousSectionKey = sectionKey;
      var status = typeof window.getStudentStatus === 'function' ? window.getStudentStatus(student) : (student && student.status || 'active');
      var statusClass = status === 'paused' ? ' studentStatusPaused' : (status === 'withdrawn' ? ' studentStatusWithdrawn' : '');
      var leadIcon = typeof window.renderElementaryLeadIcon === 'function' ? window.renderElementaryLeadIcon(student) : '';
      var guideHtml = renderAttendanceGuideHtml(student);
      return '\n    <button class="elementaryStudentRow' + groupBreakClass + statusClass + '" onclick="handleStudentRowClick(event,\'' + safeTemplate(student && student.id) + '\')" onpointerdown="startStudentLongPress(event,\'' + safeTemplate(student && student.id) + '\')" onpointermove="moveStudentLongPress(event)" onpointerup="cancelStudentLongPress()" onpointercancel="cancelStudentLongPress()" oncontextmenu="event.preventDefault()">'
        + '<div class="elementaryRowInner">' + leadIcon + '<span class="studentTextWrap"><span>' + escape(student && student.name || '') + '</span>'
        + (guideHtml ? '<span class="studentMetaText">' + guideHtml + '</span>' : '')
        + '</span></div></button>';
    }).join('');
  };
  try { renderElementaryStudentRows = window.renderElementaryStudentRows; } catch(_) {}

  window.renderKinderStudentRows = function(students){
    if (!isAttendanceGuideActive() && typeof previousKinderRenderer === 'function') return previousKinderRenderer(students);
    var previousSectionKey = '';
    return (Array.isArray(students) ? students : []).map(function(student, index){
      var sectionKey = '';
      try {
        sectionKey = typeof window.getRecordSortSectionKey === 'function'
          ? window.getRecordSortSectionKey(student, 'kinder')
          : 'status:' + (typeof window.getStudentStatus === 'function' ? window.getStudentStatus(student) : (student && student.status || 'active')) + ':' + (student && student.age || '');
      } catch(_) { sectionKey = ''; }
      var groupBreakClass = index > 0 && sectionKey !== previousSectionKey ? ' groupBreak' : '';
      previousSectionKey = sectionKey;
      var status = typeof window.getStudentStatus === 'function' ? window.getStudentStatus(student) : (student && student.status || 'active');
      var statusClass = status === 'paused' ? ' studentStatusPaused' : (status === 'withdrawn' ? ' studentStatusWithdrawn' : '');
      var leadIcon = typeof window.renderKinderLeadIcon === 'function' ? window.renderKinderLeadIcon(student) : '';
      var guideHtml = renderAttendanceGuideHtml(student);
      return '\n    <button class="kinderStudentRow' + groupBreakClass + statusClass + '" onclick="handleStudentRowClick(event,\'' + safeTemplate(student && student.id) + '\')" onpointerdown="startStudentLongPress(event,\'' + safeTemplate(student && student.id) + '\')" onpointermove="moveStudentLongPress(event)" onpointerup="cancelStudentLongPress()" onpointercancel="cancelStudentLongPress()" oncontextmenu="event.preventDefault()">'
        + '<div class="kinderRowInner">' + leadIcon + '<span class="studentTextWrap"><span>' + escape(student && student.name || '') + '</span>'
        + (guideHtml ? '<span class="studentMetaText">' + guideHtml + '</span>' : '')
        + '</span></div></button>';
    }).join('');
  };
  try { renderKinderStudentRows = window.renderKinderStudentRows; } catch(_) {}

  window.shouldCountRecordAttendanceDate = countablePastDate;
  try { shouldCountRecordAttendanceDate = window.shouldCountRecordAttendanceDate; } catch(_) {}
  window.getOlliAttendancePolicy = getPolicy;
  window.saveOlliAttendancePolicy = writePolicy;
  window.getOlliAttendancePolicyCounts = getStudentAttendancePolicyCounts;

  var previousMonthSummary = window.getRecordAttendanceStudentMonthSummary;
  window.getRecordAttendanceStudentMonthSummary = function(student, baseDate){
    if (typeof previousMonthSummary !== 'function') return { attended:[], absent:[], makeup:[], remainingMakeup:0 };
    var summary = previousMonthSummary(student, baseDate);
    var counts = getStudentAttendancePolicyCounts(student);
    return Object.assign({}, summary, { remainingMakeup: counts.remainingMakeup });
  };
  try { getRecordAttendanceStudentMonthSummary = window.getRecordAttendanceStudentMonthSummary; } catch(_) {}

  function refreshCurrentRows(){
    var searchValue = document.getElementById('searchName')?.value.trim() || '';
    try {
      if (typeof window.scheduleRecordAttendanceGuideButtonAlign === 'function') window.scheduleRecordAttendanceGuideButtonAlign();
      if (typeof currentRecordView !== 'undefined' && (currentRecordView === 'kinder' || currentRecordView === 'elementary') && typeof window.renderCurrentStudentRecords === 'function') window.renderCurrentStudentRecords(searchValue);
      else if (typeof window.loadRecords === 'function') window.loadRecords(searchValue);
    } catch(_) {}
  }

  function renderPolicySheetHtml(){
    var policy = getPolicy();
    var start = parseDateKey(policy.startDate) || new Date();
    var optionHtml = EXPIRE_OPTIONS.map(function(item){
      var active = normalizeExpire(policy.makeupExpire) === item[0];
      return '<button type="button" class="settingsAttendancePolicyOption ' + (active ? 'active' : '') + '" data-attendance-expire-option="' + item[0] + '" onclick="selectSettingsAttendanceExpireOption(\'' + item[0] + '\')">' + item[1] + '</button>';
    }).join('');
    return '<div class="settingsInputGroup">'
      + '<div class="settingsInputLabel">출결 계산 시작일</div>'
      + '<div class="settingsAttendanceStartDateGrid">'
      + '<input id="settingsAttendanceStartYear" class="settingsInput" type="number" min="2000" max="2100" inputmode="numeric" value="' + start.getFullYear() + '" placeholder="년">'
      + '<input id="settingsAttendanceStartMonth" class="settingsInput" type="number" min="1" max="12" inputmode="numeric" value="' + (start.getMonth() + 1) + '" placeholder="월">'
      + '<input id="settingsAttendanceStartDay" class="settingsInput" type="number" min="1" max="31" inputmode="numeric" value="' + start.getDate() + '" placeholder="일">'
      + '</div>'
      + '</div>'
      + '<div class="settingsInputGroup">'
      + '<div class="settingsInputLabel">보강 유효 기간</div>'
      + '<div class="settingsAttendancePolicyGrid">' + optionHtml + '</div>'
      + '</div>';
  }

  function savePolicyFromSheet(){
    var y = document.getElementById('settingsAttendanceStartYear')?.value || '';
    var m = document.getElementById('settingsAttendanceStartMonth')?.value || '';
    var d = document.getElementById('settingsAttendanceStartDay')?.value || '';
    var startDate = clampDateParts(y, m, d);
    var active = document.querySelector('[data-attendance-expire-option].active');
    var makeupExpire = active ? active.getAttribute('data-attendance-expire-option') : DEFAULT_EXPIRE;
    writePolicy({ startDate: startDate, makeupExpire: makeupExpire });
    updatePolicyValueUI();
    refreshCurrentRows();
  }

  window.selectSettingsAttendanceExpireOption = function(value){
    value = normalizeExpire(value);
    document.querySelectorAll('[data-attendance-expire-option]').forEach(function(btn){
      btn.classList.toggle('active', btn.getAttribute('data-attendance-expire-option') === value);
    });
  };

  function installSettingsRow(){
    if (document.getElementById('settingsAttendancePolicyRow')) {
      updatePolicyValueUI();
      return;
    }
    var attendancePrintRow = document.querySelector('.settingsRow[onclick*="attendancePrint"]');
    if (!attendancePrintRow || !attendancePrintRow.parentNode) return;
    var row = document.createElement('div');
    row.id = 'settingsAttendancePolicyRow';
    row.className = 'settingsRow';
    row.setAttribute('data-academy-management', 'true');
    row.setAttribute('role', 'button');
    row.setAttribute('onclick', "openSettingsSheet('attendancePolicy')");
    row.innerHTML = '<div class="settingsRowLeft">'
      + '<span class="settingsRowIcon"><svg viewBox="0 0 24 24"><path d="M5 4.5h14v15H5z"></path><path d="M8 3v4"></path><path d="M16 3v4"></path><path d="M8 11h8"></path><path d="M8 15h5"></path><path d="M16.5 14.5l2 2 3.5-4"></path></svg></span>'
      + '<span class="settingsRowTitle">출결 설정</span>'
      + '</div><span id="settingsAttendancePolicyValue" class="settingsRowValue"></span><svg class="settingsChevron" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"></path></svg>';
    attendancePrintRow.parentNode.insertBefore(row, attendancePrintRow.nextSibling);
    updatePolicyValueUI();
    try { if (typeof window.refreshOlliRoleBasedVisibilityUI === 'function') window.refreshOlliRoleBasedVisibilityUI(); } catch(_) {}
  }

  function updatePolicyValueUI(){
    var value = document.getElementById('settingsAttendancePolicyValue');
    if (!value) return;
    var policy = getPolicy();
    value.textContent = '보강 ' + getExpireLabel(policy.makeupExpire) + ' · ' + formatKoreanShortDate(policy.startDate) + '부터';
  }

  function installSheetData(){
    try {
      if (typeof settingsSheetData !== 'undefined') {
        settingsSheetData.attendancePolicy = {
          title: '출결 설정',
          desc: '',
          html: renderPolicySheetHtml,
          onSave: async function(){ savePolicyFromSheet(); }
        };
      }
    } catch(err) {
      console.warn('출결 설정 시트 등록 실패:', err);
    }
  }

  var oldSettingsApplyStateToUI = window.settingsApplyStateToUI;
  if (typeof oldSettingsApplyStateToUI === 'function' && !oldSettingsApplyStateToUI.__olliAttendancePolicyWrapped) {
    var wrappedApply = function(){
      var result = oldSettingsApplyStateToUI.apply(this, arguments);
      installSheetData();
      setTimeout(installSettingsRow, 0);
      setTimeout(updatePolicyValueUI, 20);
      return result;
    };
    wrappedApply.__olliAttendancePolicyWrapped = true;
    window.settingsApplyStateToUI = wrappedApply;
    try { settingsApplyStateToUI = window.settingsApplyStateToUI; } catch(_) {}
  }

  installSheetData();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ installSheetData(); installSettingsRow(); });
  } else {
    installSettingsRow();
  }
  setTimeout(function(){ installSheetData(); installSettingsRow(); }, 250);
  setTimeout(function(){ updatePolicyValueUI(); refreshCurrentRows(); }, 700);
})();
