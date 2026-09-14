from pathlib import Path

js_path = Path('pc-timetable-attendance-register.js')
css_path = Path('pc-timetable.css')
js = js_path.read_text(encoding='utf-8')
css = css_path.read_text(encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    return text.replace(old, new, 1)

js = replace_once(js,
'''  function attendanceRegisterStatusMeta(status) {
    if (status === 'present') return { className: 'attendanceLinkedMark', mark: '<span aria-label="출석">✓</span>', label: '출석' };
    if (status === 'absent') return { className: 'attendanceAbsentMark', mark: '<span aria-label="결석">결</span>', label: '결석' };
    if (status === 'makeup') return { className: 'attendanceMakeupMark', mark: '<span aria-label="보강">보</span>', label: '보강' };
    return { className: '', mark: '', label: '빈칸' };
  }
''',
'''  function attendanceRegisterStatusMeta(status) {
    if (status === 'present') return { className: 'attendanceLinkedMark', mark: '<span aria-label="출석">✓</span>', label: '출석' };
    if (status === 'absent') return { className: 'attendanceAbsentMark', mark: '<span aria-label="결석">결</span>', label: '결석' };
    if (status === 'makeup') return { className: 'attendanceMakeupMark', mark: '<span aria-label="보강">보</span>', label: '보강' };
    return { className: 'attendanceBlankMark', mark: '<span aria-label="빈칸">-</span>', label: '빈칸' };
  }
''', 'status meta')

js = replace_once(js,
'''#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment+.attendanceRegisterSegment{border-left:1px solid rgba(50,57,66,.16)}
#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceLinkedMark{color:#fff;background:#43d878!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceAbsentMark{color:#fff;background:#e5484d!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceMakeupMark{color:#111;background:#ffd84d!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment span{display:block;font-size:10px;line-height:1}
''',
'''#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment+.attendanceRegisterSegment{border-left:1px solid #dfe4e9}
#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceBlankMark{color:#666d76;background:#f0f2f4!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceLinkedMark{color:#249e58;background:#e7f7ed!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceAbsentMark{color:#d9464d;background:#fdebed!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceMakeupMark{color:#b98700;background:#fff6cf!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment span{display:block;font-size:12px;font-weight:900;line-height:1}
#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceLinkedMark span{font-size:16px}
''', 'session colors')

js = replace_once(js,
'''      const sunday = date.getDay() === 0;
      const holiday = !!(info && info.is_holiday === true);
      return { day, key, sunday, holiday, closed: sunday || holiday, title: sunday ? '일요일' : clean(info && info.name) };
''',
'''      const sunday = date.getDay() === 0;
      const holiday = !!(info && info.is_holiday === true);
      const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
      return { day, key, weekday, sunday, holiday, closed: sunday || holiday, title: sunday ? '일요일' : clean(info && info.name) };
''', 'day metadata')

js = replace_once(js,
'''    const staticWidth = 20 + 42 + 51 + 20;
    const tableStyle = ` style="--attendance-static-col-width:${staticWidth}px;--attendance-date-col-count:${days};--attendance-date-col-width:calc((100% - ${staticWidth}px) / ${days});"`;
    const colGroup = '<colgroup><col class="noCol"><col class="nameCol"><col class="schoolGradeCol"><col class="personalityCol">'
      + Array.from({ length: days }, () => '<col class="dateCol">').join('') + '</colgroup>';
    const dayHeaders = dayMeta.map((meta) => `<th class="dateCol${meta.closed ? ' attendanceHolidayHead' : ''}"${meta.title ? ` title="${esc(meta.title)}"` : ''}>${meta.day}</th>`).join('');
    const schoolHeader = state.attendanceDivision === 'combined' ? '소속' : (state.attendanceDivision === 'kinder' ? '유치원/나이' : '학교/학년');
    const header = `<thead><tr><th class="noCol"></th><th class="nameCol">이름</th><th class="schoolGradeCol">${schoolHeader}</th><th class="personalityCol">성향</th>${dayHeaders}</tr></thead>`;
''',
'''    const staticWidth = 64 + 51 + 20;
    const tableStyle = ` style="--attendance-static-col-width:${staticWidth}px;--attendance-date-col-count:${days};--attendance-date-col-width:calc((100% - ${staticWidth}px) / ${days});"`;
    const colGroup = '<colgroup><col class="nameCol"><col class="schoolGradeCol"><col class="personalityCol">'
      + Array.from({ length: days }, () => '<col class="dateCol">').join('') + '</colgroup>';
    const dayHeaders = dayMeta.map((meta) => {
      const holidayClass = meta.sunday ? ' attendanceSundayHead' : (meta.holiday ? ' attendancePublicHolidayHead' : '');
      return `<th class="dateCol${holidayClass}"${meta.title ? ` title="${esc(meta.title)}"` : ''}><span class="attendanceDateNumber">${meta.day}</span><span class="attendanceDateWeek">${meta.weekday}</span></th>`;
    }).join('');
    const schoolHeader = state.attendanceDivision === 'combined' ? '소속' : (state.attendanceDivision === 'kinder' ? '유치원/나이' : '학교/학년');
    const header = `<thead><tr><th class="nameCol">이름</th><th class="schoolGradeCol">${schoolHeader}</th><th class="personalityCol">성향</th>${dayHeaders}</tr></thead>`;
''', 'table columns and day headers')

js = replace_once(js,
'''    const rowHtml = students.map((student, index) => {
      const dateCells = dayMeta.map((meta) => {
        if (meta.closed) return `<td class="dateCol attendanceHolidayCell ${meta.sunday ? 'attendanceSundayCell' : 'attendancePublicHolidayCell'}" aria-disabled="true"></td>`;
        const records = rowsByStudentDate.get(`${clean(student.id)}|${meta.key}`) || [];
        const regularSessions = attendanceRegisterSessions(records, 'regular');
        const makeupSessions = attendanceRegisterSessions(records, 'makeup');
        const sessions = [...regularSessions, ...makeupSessions];
        if (!sessions.length) return '<td class="dateCol"></td>';
''',
'''    const rowHtml = students.map((student) => {
      const dateCells = dayMeta.map((meta) => {
        if (meta.closed) {
          const holidayText = meta.sunday ? '' : '<span class="attendanceHolidayMark">휴</span>';
          return `<td class="dateCol attendanceHolidayCell ${meta.sunday ? 'attendanceSundayCell' : 'attendancePublicHolidayCell'}" aria-disabled="true">${holidayText}</td>`;
        }
        const records = rowsByStudentDate.get(`${clean(student.id)}|${meta.key}`) || [];
        const regularSessions = attendanceRegisterSessions(records, 'regular');
        const makeupSessions = attendanceRegisterSessions(records, 'makeup');
        const sessions = [...regularSessions, ...makeupSessions];
        if (!sessions.length) return '<td class="dateCol attendanceEmptyCell"><span aria-hidden="true">-</span></td>';
''', 'student date cell states')

js = replace_once(js,
'''      return `<tr><td class="noCol">${index + 1}</td><td class="nameCol">${esc(student.name)}</td><td class="schoolGradeCol">${esc(attendanceRosterMeta(student))}</td><td class="personalityCol">${esc(student.personality)}</td>${dateCells}</tr>`;
''',
'''      return `<tr><td class="nameCol">${esc(student.name)}</td><td class="schoolGradeCol">${esc(attendanceRosterMeta(student))}</td><td class="personalityCol">${esc(student.personality)}</td>${dateCells}</tr>`;
''', 'student row no number')

js = replace_once(js,
'''    const blankRows = Array.from({ length: Math.max(0, 40 - students.length) }, (_, index) => {
      const dateCells = dayMeta.map((meta) => meta.closed
        ? `<td class="dateCol attendanceHolidayCell ${meta.sunday ? 'attendanceSundayCell' : 'attendancePublicHolidayCell'}" aria-disabled="true"></td>`
        : '<td class="dateCol"></td>').join('');
      return `<tr class="attendanceBlankRow"><td class="noCol">${students.length + index + 1}</td><td class="nameCol"></td><td class="schoolGradeCol"></td><td class="personalityCol"></td>${dateCells}</tr>`;
    }).join('');
    const academyName = typeof global.getOlliCurrentAcademyName === 'function'
      ? clean(global.getOlliCurrentAcademyName())
      : clean(localStorage.getItem('olli_current_academy_name'));
    const registerDivision = state.attendanceDivision === 'combined' ? '유치부/초등부' : divisionLabel(state.attendanceDivision);
    return `<div><div class="attendancePrintPage"><div class="attendancePrintHeader"><div class="attendancePrintAcademy">${esc(academyName || '비비작 아이성향 미술학원')} (${registerDivision})</div><div class="attendancePrintMonth">${year}년 ${month}월</div></div><table class="settingsAttendancePreviewTable"${tableStyle}>${colGroup}${header}<tbody>${rowHtml}${blankRows}</tbody></table></div></div>`;
''',
'''    const blankRows = Array.from({ length: Math.max(0, 40 - students.length) }, () => {
      const dateCells = dayMeta.map((meta) => {
        if (!meta.closed) return '<td class="dateCol"></td>';
        const holidayText = meta.sunday ? '' : '<span class="attendanceHolidayMark">휴</span>';
        return `<td class="dateCol attendanceHolidayCell ${meta.sunday ? 'attendanceSundayCell' : 'attendancePublicHolidayCell'}" aria-disabled="true">${holidayText}</td>`;
      }).join('');
      return `<tr class="attendanceBlankRow"><td class="nameCol"></td><td class="schoolGradeCol"></td><td class="personalityCol"></td>${dateCells}</tr>`;
    }).join('');
    return `<div class="olliTtAttendanceSheet"><table class="settingsAttendancePreviewTable olliTtAttendanceTable"${tableStyle}>${colGroup}${header}<tbody>${rowHtml}${blankRows}</tbody></table></div>`;
''', 'blank rows and screen-only wrapper')

js = replace_once(js,
'''    ui.root.innerHTML = `<section class="olliTtAttendanceRegister"><div class="olliTtAttendanceRegisterHead"><div><strong>${esc(monthLabel(state.attendanceMonth))} 출석부</strong><span>같은 날 수업이 두 번 이상이면 각 수업 시간별로 나누어 출결을 기록합니다.</span></div></div><div class="olliTtAttendanceRegisterScroll">${html}</div></section>`;
''',
'''    ui.root.innerHTML = `<section class="olliTtAttendanceRegister"><div class="olliTtAttendanceRegisterHead"><strong>${esc(monthLabel(state.attendanceMonth))} 출석부</strong></div><div class="olliTtAttendanceRegisterScroll">${html}</div></section>`;
''', 'attendance title')

css = replace_once(css,
'''#recordRoomScreen .olliTtAttendanceRegisterScroll td.attendanceHolidayCell.attendanceSundayCell {
  background: #eceff1 !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
#recordRoomScreen .olliTtAttendanceRegisterScroll td.attendanceHolidayCell.attendancePublicHolidayCell {
  background: #fff0f4 !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
''',
'''#recordRoomScreen .olliTtAttendanceRegisterScroll td.attendanceHolidayCell.attendanceSundayCell,
#recordRoomScreen .olliTtAttendanceRegisterScroll td.attendanceHolidayCell.attendancePublicHolidayCell {
  background: #fff0f4 !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
''', 'holiday colors')

css += '''

/* 화면 출석부 전용 디자인 - 출력/PDF와 분리 */
#recordRoomScreen .olliTtAttendanceRegisterHead {
  min-height: 42px;
  padding: 2px 2px 10px;
  display: flex;
  align-items: center;
}
#recordRoomScreen .olliTtAttendanceRegisterHead > strong {
  color: #242a32;
  font-size: calc(24px * var(--olli-text-scale));
  font-weight: 900;
  letter-spacing: -.045em;
  line-height: 1.15;
}
#recordRoomScreen .olliTtAttendanceRegisterScroll {
  border: 1px solid #e4e7eb;
  border-radius: 21px;
  overflow: auto;
  background: #fff;
  box-shadow: 0 7px 20px rgba(27,39,58,.045);
}
#recordRoomScreen .olliTtAttendanceSheet { min-width: 100%; width: max-content; }
#recordRoomScreen .olliTtAttendanceTable {
  width: 100%;
  min-width: 0;
  border: 0 !important;
  border-collapse: separate !important;
  border-spacing: 0 !important;
  table-layout: fixed;
  background: #fff;
}
#recordRoomScreen .olliTtAttendanceTable th,
#recordRoomScreen .olliTtAttendanceTable td {
  border: 0 !important;
  border-right: 1px solid #e8ebef !important;
  border-bottom: 1px solid #e8ebef !important;
  box-sizing: border-box;
  text-align: center;
  vertical-align: middle;
}
#recordRoomScreen .olliTtAttendanceTable tr > *:last-child { border-right: 0 !important; }
#recordRoomScreen .olliTtAttendanceTable tbody tr:last-child > * { border-bottom: 0 !important; }
#recordRoomScreen .olliTtAttendanceTable thead th {
  height: 52px !important;
  padding: 5px 2px !important;
  color: #626b77 !important;
  background: #f8f9fb !important;
  font-weight: 820 !important;
}
#recordRoomScreen .olliTtAttendanceTable thead th.attendanceSundayHead,
#recordRoomScreen .olliTtAttendanceTable thead th.attendancePublicHolidayHead {
  background: #fff0f4 !important;
  color: #a95767 !important;
}
#recordRoomScreen .olliTtAttendanceTable .attendanceDateNumber,
#recordRoomScreen .olliTtAttendanceTable .attendanceDateWeek {
  display: block;
  line-height: 1.05;
}
#recordRoomScreen .olliTtAttendanceTable .attendanceDateNumber {
  font-size: calc(11px * var(--olli-text-scale));
  font-weight: 850;
}
#recordRoomScreen .olliTtAttendanceTable .attendanceDateWeek {
  margin-top: 5px;
  font-size: calc(9px * var(--olli-text-scale));
  font-weight: 720;
}
#recordRoomScreen .olliTtAttendanceTable .nameCol { width: 64px !important; }
#recordRoomScreen .olliTtAttendanceTable .schoolGradeCol { width: 51px !important; }
#recordRoomScreen .olliTtAttendanceTable .personalityCol { width: 20px !important; }
#recordRoomScreen .olliTtAttendanceTable tbody td.nameCol {
  background: #fafbfc !important;
  color: #424a56;
  font-weight: 800;
}
#recordRoomScreen .olliTtAttendanceTable tbody td.attendanceEmptyCell {
  background: #f0f2f4 !important;
  color: #666d76 !important;
}
#recordRoomScreen .olliTtAttendanceTable tbody td.attendanceEmptyCell > span {
  display: inline-block;
  color: #666d76;
  font-size: calc(12px * var(--olli-text-scale));
  font-weight: 900;
  line-height: 1;
}
#recordRoomScreen .olliTtAttendanceTable .attendanceHolidayMark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #bd5b6d;
  font-size: calc(9px * var(--olli-text-scale));
  font-weight: 850;
  line-height: 1;
}
#recordRoomScreen .olliTtAttendanceTable tbody td.attendanceHolidayCell { color: #bd5b6d; }
'''

js_path.write_text(js, encoding='utf-8')
css_path.write_text(css, encoding='utf-8')
print('patched attendance screen redesign')
