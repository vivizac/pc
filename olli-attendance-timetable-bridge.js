
/* PC 사이드바 출석부의 명단/시간표 전환과 시간표 이동 */
(function(){
  if (window.__OLLI_MODULAR_TIMETABLE__) return;
  var DAYS = ['월','화','수','목','금','토'];
  var state = { view: 'list', active: false, move: null, day: '', time: '', saving: false };

  function text(value){ return String(value == null ? '' : value).trim(); }
  function escapeHtml(value){ return text(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;'); }
  function activeStudents(type){
    var students = typeof getStudentsByType === 'function' ? getStudentsByType(type) : [];
    return (Array.isArray(students) ? students : []).filter(function(student){
      try { return typeof getStudentStatus !== 'function' || getStudentStatus(student) === 'active'; }
      catch(_) { return true; }
    });
  }
  function timesFor(type){ return type === 'kinder' ? ['3시','4시','5시','6시'] : ['1시','2시','3시','4시','5시','6시','7시']; }
  function ordered(list, order){
    var unique = [];
    (Array.isArray(list) ? list : []).forEach(function(value){ if (unique.indexOf(value) < 0) unique.push(value); });
    return unique.sort(function(a,b){ return order.indexOf(a) - order.indexOf(b); });
  }
  function readDays(student){
    var raw = text(student && (student.lesson_day || student.lessonDay || student.class_day || student.classDay || ''));
    if (!raw) raw = text(student && (student.lesson_time || student.lessonTime || student.class_time || student.classTime || ''));
    return DAYS.filter(function(day){ return raw.indexOf(day) >= 0; });
  }
  function readTimes(value){
    var found = [];
    text(value).replace(/(?:오후\s*)?([1-7])\s*(?:시|:00)?/g, function(_, hour){
      var label = Number(hour) + '시';
      if (found.indexOf(label) < 0) found.push(label);
      return '';
    });
    return found;
  }
  function schedulePairs(student){
    var rawDay = text(student && (student.lesson_day || student.lessonDay || student.class_day || student.classDay || ''));
    var rawTime = text(student && (student.lesson_time || student.lessonTime || student.class_time || student.classTime || ''));
    var pairs = [];
    rawTime.split(/[·,\/|\n]+/).map(text).filter(Boolean).forEach(function(part){
      var dayMatch = part.match(/([월화수목금토])/);
      var partTimes = readTimes(part);
      if (dayMatch && partTimes.length) partTimes.forEach(function(time){ pairs.push({day:dayMatch[1], time:time}); });
    });
    if (!pairs.length) {
      var days = DAYS.filter(function(day){ return rawDay.indexOf(day) >= 0; });
      var times = readTimes(rawTime);
      if (days.length === 1) times.forEach(function(time){ pairs.push({day:days[0], time:time}); });
      else if (days.length > 1 && times.length === days.length) days.forEach(function(day, index){ pairs.push({day:day, time:times[index]}); });
      else days.forEach(function(day){ times.forEach(function(time){ pairs.push({day:day, time:time}); }); });
    }
    var seen = {};
    return pairs.filter(function(pair){
      if (DAYS.indexOf(pair.day) < 0 || !pair.time) return false;
      var key = pair.day + '/' + pair.time;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).sort(function(a,b){ return DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || Number(a.time) - Number(b.time); });
  }
  function allPairsFor(type){
    return activeStudents(type).map(function(student){ return { student: student, pairs: schedulePairs(student) }; });
  }
  function getTabHost(){ return document.getElementById('recordBodyNew'); }
  function ensureUi(){
    var host = getTabHost();
    if (!host) return null;
    var tabs = document.getElementById('olliPcAttendanceTabs');
    if (!tabs) {
      tabs = document.createElement('div');
      tabs.id = 'olliPcAttendanceTabs';
      tabs.className = 'olliPcAttendanceTabs';
      tabs.setAttribute('role','tablist');
      tabs.innerHTML = '<button type="button" class="olliPcAttendanceTab" data-olli-attendance-view="list">명단</button><button type="button" class="olliPcAttendanceTab" data-olli-attendance-view="schedule">시간표</button>';
      var list = document.getElementById('recordList');
      host.insertBefore(tabs, list || host.firstChild);
      tabs.addEventListener('click', function(event){
        var button = event.target.closest('[data-olli-attendance-view]');
        if (button) setView(button.getAttribute('data-olli-attendance-view'));
      });
    }
    var timetable = document.getElementById('olliPcTimetable');
    if (!timetable) {
      timetable = document.createElement('div');
      timetable.id = 'olliPcTimetable';
      timetable.className = 'olliPcTimetable';
      host.insertBefore(timetable, document.getElementById('pcAcademyDetailPanel'));
    }
    return { tabs: tabs, timetable: timetable };
  }
  function sectionHtml(type, label){
    var rows = timesFor(type);
    var data = allPairsFor(type);
    var grid = '<div class="olliPcTimetableGrid"><div class="olliPcTimetableCorner"></div>';
    DAYS.forEach(function(day){ grid += '<div class="olliPcTimetableDay">' + day + '</div>'; });
    rows.forEach(function(time){
      grid += '<div class="olliPcTimetableTime">' + time + '</div>';
      DAYS.forEach(function(day){
        var names = [];
        data.forEach(function(entry){
          if (entry.pairs.some(function(pair){ return pair.day === day && pair.time === time; })) {
            var id = escapeHtml(entry.student.id || '');
            names.push('<button type="button" class="olliPcScheduleStudent" data-olli-schedule-id="'+id+'" data-olli-schedule-day="'+day+'" data-olli-schedule-time="'+time+'">'+escapeHtml(entry.student.name || '학생')+'</button>');
          }
        });
        grid += '<div class="olliPcTimetableCell">' + (names.join('') || '<span class="olliPcScheduleEmpty">—</span>') + '</div>';
      });
    });
    grid += '</div>';
    return '<section class="olliPcTimetableSection '+type+'"><div class="olliPcTimetableSectionHead"><div class="olliPcTimetableSectionTitle"><span class="olliPcTimetableSectionDot"></span>'+label+'</div><div class="olliPcTimetableSectionCount">'+data.length+'명</div></div><div class="olliPcTimetableScroll">'+grid+'</div></section>';
  }
  function renderTimetable(){
    var ui = ensureUi();
    if (!ui) return;
    ui.timetable.innerHTML = '<div class="olliPcTimetableIntro"><div class="olliPcTimetableIntroTitle">수업 시간표</div><div class="olliPcTimetableIntroText">학생을 누르면 요일과 시간을 옮길 수 있어요.</div></div>' + sectionHtml('elementary','초등부') + sectionHtml('kinder','유치부');
    ui.timetable.querySelectorAll('[data-olli-schedule-id]').forEach(function(button){
      button.addEventListener('click', function(){ openMove(button.getAttribute('data-olli-schedule-id'), button.getAttribute('data-olli-schedule-day'), button.getAttribute('data-olli-schedule-time')); });
    });
  }
  function setView(view){
    state.view = view === 'schedule' ? 'schedule' : 'list';
    var ui = ensureUi();
    if (!ui) return;
    ui.tabs.querySelectorAll('[data-olli-attendance-view]').forEach(function(button){ button.classList.toggle('active', button.getAttribute('data-olli-attendance-view') === state.view); });
    var screen = document.getElementById('recordRoomScreen');
    if (screen) screen.classList.toggle('olliPcAttendanceScheduleView', state.active && state.view === 'schedule');
    if (!state.active) {
      ui.timetable.classList.remove('show');
      return;
    }
    var showSchedule = state.view === 'schedule';
    ui.timetable.classList.toggle('show', showSchedule);
    if (showSchedule) renderTimetable();
  }
  function setAttendanceActive(active){
    state.active = !!active;
    var screen = document.getElementById('recordRoomScreen');
    if (screen) {
      screen.classList.toggle('olliPcAttendanceActive', state.active);
      if (!state.active) screen.classList.remove('olliPcAttendanceScheduleView');
    }
    if (!state.active) {
      var timetable = document.getElementById('olliPcTimetable');
      if (timetable) timetable.classList.remove('show');
      var overlay = document.getElementById('olliPcScheduleMoveOverlay');
      if (overlay) overlay.classList.remove('show');
      if (!state.saving) state.move = null;
      return;
    }
    setView(state.view);
  }
  function syncAttendanceActive(){
    var shell = document.getElementById('olliPcShell');
    setAttendanceActive(!!(shell && shell.dataset.pcSection === 'attendance'));
  }
  function ensureMoveDialog(){
    var overlay = document.getElementById('olliPcScheduleMoveOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'olliPcScheduleMoveOverlay';
    overlay.tabIndex = -1;
    overlay.innerHTML = '<div id="olliPcScheduleMoveDialog" role="dialog" aria-modal="true" aria-labelledby="olliPcScheduleMoveTitle" aria-describedby="olliPcScheduleMoveSub"></div>';
    overlay.addEventListener('click', function(event){ if (event.target === overlay && !state.saving) closeMove(); });
    overlay.addEventListener('keydown', function(event){ if (event.key === 'Escape' && !state.saving) closeMove(); });
    document.body.appendChild(overlay);
    return overlay;
  }
  function moveDialogHtml(){
    var current = state.move;
    if (!current) return '';
    var timeChoices = timesFor(current.student.type || 'elementary');
    return '<div class="olliPcScheduleMoveHead">'
      + '<div class="olliPcScheduleMoveIcon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="3"></rect><path d="M8 3v4M16 3v4M4 9h16M9 14h6M13 11l3 3-3 3"></path></svg></div>'
      + '<div class="olliPcScheduleMoveHeading"><div id="olliPcScheduleMoveTitle">'+escapeHtml(current.student.name || '학생')+' 수업 이동</div><div id="olliPcScheduleMoveSub">수업 요일과 시간을 변경합니다.</div></div>'
      + '<button type="button" id="olliPcScheduleMoveClose" aria-label="닫기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>'
      + '</div><div class="olliPcScheduleMoveBody">'
      + '<div class="olliPcScheduleMoveCurrent"><span class="olliPcScheduleMoveCurrentLabel">현재 수업</span><strong class="olliPcScheduleMoveCurrentValue">'+escapeHtml(current.from.day)+'요일 · '+escapeHtml(current.from.time)+'</strong></div>'
      + '<div class="olliPcScheduleMoveSection"><div class="olliPcScheduleMoveLabel"><span>요일 선택</span><small>변경할 요일을 골라주세요</small></div><div class="olliPcScheduleMoveChoices">'
      + DAYS.map(function(day){ return '<button type="button" class="olliPcScheduleMoveChoice '+(state.day === day ? 'active' : '')+'" aria-pressed="'+(state.day === day ? 'true' : 'false')+'" data-olli-move-day="'+day+'">'+day+'</button>'; }).join('')
      + '</div></div><div class="olliPcScheduleMoveSection"><div class="olliPcScheduleMoveLabel"><span>시간 선택</span><small>변경할 시간을 골라주세요</small></div><div class="olliPcScheduleMoveChoices time">'
      + timeChoices.map(function(time){ return '<button type="button" class="olliPcScheduleMoveChoice '+(state.time === time ? 'active' : '')+'" aria-pressed="'+(state.time === time ? 'true' : 'false')+'" data-olli-move-time="'+time+'">'+time+'</button>'; }).join('')
      + '</div></div><div class="olliPcScheduleMoveActions"><button type="button" id="olliPcScheduleMoveCancel">취소</button><button type="button" id="olliPcScheduleMoveSave">수업 이동</button></div></div>';
  }
  function openMove(studentId, day, time){
    var student = typeof findStudentById === 'function' ? findStudentById(studentId) : null;
    if (!student) return;
    state.move = { student: student, from: { day: day, time: time } };
    state.day = day;
    state.time = time;
    state.saving = false;
    var overlay = ensureMoveDialog();
    renderMoveDialog();
    overlay.classList.add('show');
    requestAnimationFrame(function(){ overlay.focus(); });
  }
  function renderMoveDialog(){
    var dialog = document.getElementById('olliPcScheduleMoveDialog');
    if (!dialog) return;
    dialog.innerHTML = moveDialogHtml();
    dialog.querySelectorAll('[data-olli-move-day]').forEach(function(button){ button.addEventListener('click', function(){ state.day = button.getAttribute('data-olli-move-day'); renderMoveDialog(); }); });
    dialog.querySelectorAll('[data-olli-move-time]').forEach(function(button){ button.addEventListener('click', function(){ state.time = button.getAttribute('data-olli-move-time'); renderMoveDialog(); }); });
    var close = document.getElementById('olliPcScheduleMoveClose');
    var cancel = document.getElementById('olliPcScheduleMoveCancel');
    var save = document.getElementById('olliPcScheduleMoveSave');
    if (close) close.addEventListener('click', closeMove);
    if (cancel) cancel.addEventListener('click', closeMove);
    if (save) { save.disabled = state.saving; save.textContent = state.saving ? '저장 중…' : '수업 이동'; save.addEventListener('click', saveMove); }
  }
  function closeMove(){
    if (state.saving) return;
    var overlay = document.getElementById('olliPcScheduleMoveOverlay');
    if (overlay) overlay.classList.remove('show');
    state.move = null;
  }
  async function saveMove(){
    if (state.saving || !state.move || !state.day || !state.time) return;
    state.saving = true;
    renderMoveDialog();
    var moving = state.move;
    var pairs = schedulePairs(moving.student).filter(function(pair){ return !(pair.day === moving.from.day && pair.time === moving.from.time); });
    if (!pairs.some(function(pair){ return pair.day === state.day && pair.time === state.time; })) pairs.push({ day: state.day, time: state.time });
    pairs.sort(function(a,b){ return DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || Number(a.time) - Number(b.time); });
    var lessonDay = ordered(pairs.map(function(pair){ return pair.day; }), DAYS).join(' · ');
    var lessonTime = pairs.map(function(pair){ return pair.day+' '+pair.time; }).join(' · ');
    var nextStudent = Object.assign({}, moving.student, { lesson_day: lessonDay, lesson_time: lessonTime, class_time: lessonTime });
    try {
      if (typeof ensureStudentSavedToSupabase !== 'function') throw new Error('학생정보 저장 기능을 찾지 못했습니다.');
      await ensureStudentSavedToSupabase(nextStudent);
      state.saving = false;
      closeMove();
      if (typeof window.pcRenderAttendanceList === 'function') window.pcRenderAttendanceList();
      setView('schedule');
      if (typeof showPushToast === 'function') showPushToast((nextStudent.name || '학생') + ' 수업 시간을 변경했어요.');
    } catch(err) {
      state.saving = false;
      renderMoveDialog();
      alert('수업 시간 저장에 실패했어요.\n\n' + (err && (err.message || err) || '다시 시도해 주세요.'));
    }
  }
  function refresh(){
    if (!state.active) return;
    if (state.view === 'schedule') setView('schedule');
    else setView('list');
  }
  function install(){
    ensureUi();
    var shell = document.getElementById('olliPcShell');
    syncAttendanceActive();
    if (shell && !shell.__olliAttendanceSectionObserver) {
      shell.__olliAttendanceSectionObserver = new MutationObserver(function(){
        syncAttendanceActive();
      });
      shell.__olliAttendanceSectionObserver.observe(shell, { attributes:true, attributeFilter:['data-pc-section'] });
    }
  }
  var oldOpenSection = window.pcOpenSection;
  if (typeof oldOpenSection === 'function') {
    window.pcOpenSection = async function(section){
      setAttendanceActive(section === 'attendance');
      try {
        return await oldOpenSection.apply(this, arguments);
      } finally {
        syncAttendanceActive();
      }
    };
  }
  ['pcFilterAttendanceDivision','pcFilterAttendanceDay','pcHandleTopSearch'].forEach(function(name){
    var original = window[name];
    if (typeof original !== 'function') return;
    window[name] = function(){ var result = original.apply(this, arguments); setTimeout(refresh, 0); return result; };
  });
  window.olliPcSetAttendanceView = setView;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
