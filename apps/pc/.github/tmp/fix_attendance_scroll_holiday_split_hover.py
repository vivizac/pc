from pathlib import Path

attendance_path = Path('pc-timetable-attendance-register.js')
css_path = Path('pc-timetable.css')
attendance = attendance_path.read_text(encoding='utf-8')
css = css_path.read_text(encoding='utf-8')

# 1) Distinguish Sundays from non-Sunday holidays.
old = """      const info = calendarMap.get(key) || null;
      const sunday = date.getDay() === 0;
      return { day, key, closed: sunday || !!(info && info.is_holiday === true), title: sunday ? '일요일' : clean(info && info.name) };
"""
new = """      const info = calendarMap.get(key) || null;
      const sunday = date.getDay() === 0;
      const holiday = !!(info && info.is_holiday === true);
      return { day, key, sunday, holiday, closed: sunday || holiday, title: sunday ? '일요일' : clean(info && info.name) };
"""
if old in attendance:
    attendance = attendance.replace(old, new, 1)
elif 'const holiday = !!(info && info.is_holiday === true);' not in attendance:
    raise SystemExit('dayMeta holiday anchor not found')

old = """        if (meta.closed) return '<td class=\"dateCol attendanceHolidayCell\" aria-disabled=\"true\"></td>';
"""
new = """        if (meta.closed) return `<td class=\"dateCol attendanceHolidayCell ${meta.sunday ? 'attendanceSundayCell' : 'attendancePublicHolidayCell'}\" aria-disabled=\"true\"></td>`;
"""
if old in attendance:
    attendance = attendance.replace(old, new, 1)
elif 'attendancePublicHolidayCell' not in attendance:
    raise SystemExit('student holiday cell anchor not found')

old = """      const dateCells = dayMeta.map((meta) => meta.closed
        ? '<td class=\"dateCol attendanceHolidayCell\" aria-disabled=\"true\"></td>'
        : '<td class=\"dateCol\"></td>').join('');
"""
new = """      const dateCells = dayMeta.map((meta) => meta.closed
        ? `<td class=\"dateCol attendanceHolidayCell ${meta.sunday ? 'attendanceSundayCell' : 'attendancePublicHolidayCell'}\" aria-disabled=\"true\"></td>`
        : '<td class=\"dateCol\"></td>').join('');
"""
if old in attendance:
    attendance = attendance.replace(old, new, 1)
elif attendance.count('attendancePublicHolidayCell') < 2:
    raise SystemExit('blank holiday cell anchor not found')

# 2) Update only the clicked attendance cell. Do not rebuild the whole table.
old = """      state.attendanceRows = rows;
      state.attendanceRowsMonth = state.attendanceMonth;
      lastAttendanceRenderSignature = '';
      renderAttendanceRegister();
"""
new = """      state.attendanceRows = rows;
      state.attendanceRowsMonth = state.attendanceMonth;

      const statusMeta = attendanceRegisterStatusMeta(nextStatus);
      cell.dataset.status = nextStatus;
      cell.dataset.attendanceSaving = '';
      cell.classList.remove('attendanceLinkedMark', 'attendanceAbsentMark', 'attendanceMakeupMark');
      if (nextStatus === 'present') cell.classList.add('attendanceLinkedMark');
      else if (nextStatus === 'absent') cell.classList.add('attendanceAbsentMark');
      else if (nextStatus === 'makeup') cell.classList.add('attendanceMakeupMark');
      cell.innerHTML = statusMeta.mark;
      const currentAria = cell.getAttribute('aria-label') || '';
      cell.setAttribute('aria-label', currentAria.replace(/(출석|결석|보강|빈칸)$/u, statusMeta.label));
      lastAttendanceRenderSignature = attendanceRenderSignature();

      // This PC already has the saved value. Advance its sync revision too so the
      // 3-second multi-PC watcher does not immediately rebuild this same table.
      if (typeof service.loadSyncRevision === 'function') {
        try {
          const syncInfo = await service.loadSyncRevision();
          const version = Number(syncInfo && syncInfo.version || 0);
          if (version) state.syncRevision = version;
        } catch (_) {}
      }
"""
if old in attendance:
    attendance = attendance.replace(old, new, 1)
elif 'This PC already has the saved value' not in attendance:
    raise SystemExit('attendance cell update anchor not found')

# 3) Preserve scroll position and focused cell across unavoidable full rerenders.
old = """    const html = linkedAttendanceRegisterHtml();
    ui.root.innerHTML = `<section class=\"olliTtAttendanceRegister\"><div class=\"olliTtAttendanceRegisterHead\"><div><strong>${esc(monthLabel(state.attendanceMonth))} 출석부</strong><span>시간표 출석이 자동 반영되며, 날짜 칸을 클릭해 출석 상태를 수정할 수 있습니다.</span></div></div><div class=\"olliTtAttendanceRegisterScroll\">${html}</div></section>`;
    lastAttendanceRenderSignature = signature;
    bindAttendanceRegisterEditing(ui.root);

    // 글자 맞춤은 큰 표 DOM 생성 직후 강제로 실행하지 않고 다음 프레임으로 미뤄 첫 화면 표시를 막지 않습니다.
    scheduleAttendanceFitText(ui.root);
"""
new = """    const previousScroll = ui.root.querySelector('.olliTtAttendanceRegisterScroll');
    const previousScrollTop = previousScroll ? previousScroll.scrollTop : 0;
    const previousScrollLeft = previousScroll ? previousScroll.scrollLeft : 0;
    const activeCell = document.activeElement && document.activeElement.closest
      ? document.activeElement.closest('[data-tt-attendance-register-cell]')
      : null;
    const activeStudentId = activeCell ? clean(activeCell.dataset.studentId) : '';
    const activeSessionDate = activeCell ? clean(activeCell.dataset.sessionDate) : '';

    const html = linkedAttendanceRegisterHtml();
    ui.root.innerHTML = `<section class=\"olliTtAttendanceRegister\"><div class=\"olliTtAttendanceRegisterHead\"><div><strong>${esc(monthLabel(state.attendanceMonth))} 출석부</strong><span>시간표 출석이 자동 반영되며, 날짜 칸을 클릭해 출석 상태를 수정할 수 있습니다.</span></div></div><div class=\"olliTtAttendanceRegisterScroll\">${html}</div></section>`;
    lastAttendanceRenderSignature = signature;
    bindAttendanceRegisterEditing(ui.root);

    const nextScroll = ui.root.querySelector('.olliTtAttendanceRegisterScroll');
    if (nextScroll) {
      nextScroll.scrollTop = previousScrollTop;
      nextScroll.scrollLeft = previousScrollLeft;
    }
    if (activeStudentId && activeSessionDate) {
      const nextCell = Array.from(ui.root.querySelectorAll('[data-tt-attendance-register-cell]')).find((item) =>
        clean(item.dataset.studentId) === activeStudentId && clean(item.dataset.sessionDate) === activeSessionDate
      );
      if (nextCell) {
        try { nextCell.focus({ preventScroll: true }); } catch (_) { nextCell.focus(); }
      }
    }

    // 글자 맞춤은 큰 표 DOM 생성 직후 강제로 실행하지 않고 다음 프레임으로 미뤄 첫 화면 표시를 막지 않습니다.
    scheduleAttendanceFitText(ui.root);
"""
if old in attendance:
    attendance = attendance.replace(old, new, 1)
elif 'const previousScrollTop = previousScroll ? previousScroll.scrollTop : 0;' not in attendance:
    raise SystemExit('render scroll preservation anchor not found')

attendance_path.write_text(attendance, encoding='utf-8')

marker = '/* 출석부 스크롤·휴일 색상·분반 hover 보정 */'
if marker not in css:
    css += r'''

/* 출석부 스크롤·휴일 색상·분반 hover 보정 */
#recordRoomScreen .olliTtAttendanceRegisterScroll td.attendanceRegisterEditable,
#recordRoomScreen .olliTtAttendanceRegisterScroll td.attendanceRegisterEditable * {
  cursor: default !important;
  user-select: none;
  -webkit-user-select: none;
}
#recordRoomScreen .olliTtAttendanceRegisterScroll td.attendanceHolidayCell.attendanceSundayCell {
  background: #eceff1 !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
#recordRoomScreen .olliTtAttendanceRegisterScroll td.attendanceHolidayCell.attendancePublicHolidayCell {
  background: #fff0f4 !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
#recordRoomScreen .olliTtCell.split:hover {
  background: #fff;
  box-shadow: none;
}
#recordRoomScreen .olliTtCell.split .olliTtClassLane:hover {
  background: #f5faff;
  box-shadow: inset 0 0 0 2px #c4e2ff;
}
'''
css_path.write_text(css, encoding='utf-8')

print('Attendance scroll/cursor/holiday and split hover patch applied.')
