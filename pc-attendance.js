(function pcAttendanceModule(global) {
  'use strict';

  function core() { return global.OlliPcCore; }

  function studentMatchesDay(student, day) {
    if (!day) return true;
    try {
      if (typeof parseRecordSortDays === 'function') return parseRecordSortDays(student).includes(day);
    } catch (_) {}
    const raw = String(student.lesson_day || student.lessonDay || student.days || student.day || '').replace(/요일/g, '');
    return raw.includes(day);
  }

  function renderContext(elementary, kinder) {
    const app = core();
    const title = document.getElementById('olliPcContextTitle');
    const body = document.getElementById('olliPcContextBody');
    if (!title || !body) return;
    const dayButtons = ['월', '화', '수', '목', '금', '토'].map((day) =>
      '<button class="olliPcQuickBtn '+(app.state.attendanceDay === day ? 'active' : '')+'" onclick="pcFilterAttendanceDay(\''+day+'\')"><span>'+day+'요일</span><span></span></button>'
    ).join('');
    title.textContent = '빠른 보기';
    body.innerHTML =
      '<button class="olliPcQuickBtn '+(app.state.attendanceDivision === 'all' ? 'active' : '')+'" onclick="pcFilterAttendanceDivision(\'all\')"><span>전체</span><span>'+(elementary.length + kinder.length)+'</span></button>'+
      '<button class="olliPcQuickBtn '+(app.state.attendanceDivision === 'elementary' ? 'active' : '')+'" onclick="pcFilterAttendanceDivision(\'elementary\')"><span>초등부</span><span>'+elementary.length+'</span></button>'+
      '<button class="olliPcQuickBtn '+(app.state.attendanceDivision === 'kinder' ? 'active' : '')+'" onclick="pcFilterAttendanceDivision(\'kinder\')"><span>유치부</span><span>'+kinder.length+'</span></button>'+
      '<div class="olliPcContextSectionLabel">요일</div>'+dayButtons;
  }

  async function open() {
    const app = core();
    app.hideMainScreensExcept('recordRoomScreen');
    if (typeof showRecordRoom === 'function') await showRecordRoom();
    if (typeof openRecordAttendanceDashboard === 'function') await openRecordAttendanceDashboard();
    else if (typeof currentRecordView !== 'undefined') currentRecordView = typeof currentObservationView !== 'undefined' && currentObservationView === 'kinder' ? 'kinder' : 'elementary';
    app.state.attendanceDivision = 'all';
    app.state.attendanceDay = '';
    app.renderContext();
    renderList();
  }

  function renderList(searchValue) {
    const app = core();
    if (app.state.section !== 'attendance') return;
    const list = document.getElementById('recordList');
    const dashboard = document.getElementById('recordAcademyDashboard');
    if (!list) return;
    if (dashboard) dashboard.classList.remove('show');
    list.style.display = '';

    const query = String(searchValue ?? app.state.searchValues.attendance ?? '').trim();
    const elementary = app.activeStudents('elementary').filter((student) => studentMatchesDay(student, app.state.attendanceDay) && (!query || String(student.name || '').includes(query)));
    const kinder = app.activeStudents('kinder').filter((student) => studentMatchesDay(student, app.state.attendanceDay) && (!query || String(student.name || '').includes(query)));
    let html = '';
    if (app.state.attendanceDivision === 'all' || app.state.attendanceDivision === 'elementary') {
      try { html += typeof renderElementaryStudentRows === 'function' ? renderElementaryStudentRows(typeof sortStudentsForRecord === 'function' ? sortStudentsForRecord(elementary) : elementary) : ''; }
      catch (_) {}
    }
    if (app.state.attendanceDivision === 'all' || app.state.attendanceDivision === 'kinder') {
      try { html += typeof renderKinderStudentRows === 'function' ? renderKinderStudentRows(typeof sortStudentsForRecord === 'function' ? sortStudentsForRecord(kinder) : kinder) : ''; }
      catch (_) {}
    }
    list.innerHTML = html || '<div class="recordEmpty">조건에 맞는 학생이 없습니다.</div>';
    app.renderContext();
  }

  function filterDivision(division) {
    core().state.attendanceDivision = division || 'all';
    renderList();
  }

  function filterDay(day) {
    const app = core();
    app.state.attendanceDay = app.state.attendanceDay === day ? '' : day;
    renderList();
  }

  global.OlliPcAttendance = { studentMatchesDay, renderContext, open, renderList, filterDivision, filterDay };
})(window);
