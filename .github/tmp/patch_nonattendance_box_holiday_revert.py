from pathlib import Path

# 1) Non-attendance dates: keep outer table cell white so the inner gray status box is visible.
css_path = Path('pc-timetable.css')
css = css_path.read_text(encoding='utf-8')
old_empty = '''#recordRoomScreen .olliTtAttendanceTable tbody td.attendanceEmptyCell {
  background: #f0f2f4 !important;
  color: #666d76 !important;
}'''
new_empty = '''#recordRoomScreen .olliTtAttendanceTable tbody td.attendanceEmptyCell {
  background: #fff !important;
  color: #666d76 !important;
}'''
if css.count(old_empty) != 1:
    raise SystemExit(f'attendanceEmptyCell rule count={css.count(old_empty)}')
css = css.replace(old_empty, new_empty, 1)
css_path.write_text(css, encoding='utf-8')

# 2) Sundays/public holidays: restore the original holiday cell rendering (no inner gray status box).
js_path = Path('pc-timetable-attendance-register.js')
js = js_path.read_text(encoding='utf-8')

holiday_style = '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterCellInner>.attendanceRegisterHolidayPlaceholder{background:#f0f2f4!important;color:#c6535b!important;border-radius:5px!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}\n'
if js.count(holiday_style) != 1:
    raise SystemExit(f'holiday placeholder style count={js.count(holiday_style)}')
js = js.replace(holiday_style, '', 1)

student_closed = '''        if (meta.closed) {
          const closedMark = meta.sunday
            ? '<span aria-hidden="true">-</span>'
            : '<span class="attendanceHolidayMark">휴</span>';
          const closedClass = meta.sunday ? 'attendanceRegisterPlaceholder attendanceBlankMark' : 'attendanceRegisterHolidayPlaceholder';
          return `<td class="dateCol attendanceHolidayCell attendanceRegisterSessionCell ${meta.sunday ? 'attendanceSundayCell' : 'attendancePublicHolidayCell'}" aria-disabled="true"><div class="attendanceRegisterCellInner"><span class="attendanceRegisterSegment ${closedClass}">${closedMark}</span></div></td>`;
        }'''
student_restored = '''        if (meta.closed) {
          const holidayText = meta.sunday ? '' : '<span class="attendanceHolidayMark">휴</span>';
          return `<td class="dateCol attendanceHolidayCell ${meta.sunday ? 'attendanceSundayCell' : 'attendancePublicHolidayCell'}" aria-disabled="true">${holidayText}</td>`;
        }'''
if js.count(student_closed) != 1:
    raise SystemExit(f'student closed block count={js.count(student_closed)}')
js = js.replace(student_closed, student_restored, 1)

blank_closed = '''        const closedMark = meta.sunday
          ? '<span aria-hidden="true">-</span>'
          : '<span class="attendanceHolidayMark">휴</span>';
        const closedClass = meta.sunday ? 'attendanceRegisterPlaceholder attendanceBlankMark' : 'attendanceRegisterHolidayPlaceholder';
        return `<td class="dateCol attendanceHolidayCell attendanceRegisterSessionCell ${meta.sunday ? 'attendanceSundayCell' : 'attendancePublicHolidayCell'}" aria-disabled="true"><div class="attendanceRegisterCellInner"><span class="attendanceRegisterSegment ${closedClass}">${closedMark}</span></div></td>`;'''
blank_restored = '''        const holidayText = meta.sunday ? '' : '<span class="attendanceHolidayMark">휴</span>';
        return `<td class="dateCol attendanceHolidayCell ${meta.sunday ? 'attendanceSundayCell' : 'attendancePublicHolidayCell'}" aria-disabled="true">${holidayText}</td>`;'''
if js.count(blank_closed) != 1:
    raise SystemExit(f'blank-row closed block count={js.count(blank_closed)}')
js = js.replace(blank_closed, blank_restored, 1)

js_path.write_text(js, encoding='utf-8')

# Focused validation of the intended structure.
css_check = css_path.read_text(encoding='utf-8')
js_check = js_path.read_text(encoding='utf-8')
assert 'td.attendanceEmptyCell {\n  background: #fff !important;' in css_check
assert 'attendanceRegisterHolidayPlaceholder' not in js_check
assert js_check.count("const holidayText = meta.sunday ? '' : '<span class=\"attendanceHolidayMark\">휴</span>';" ) == 2
assert js_check.count('attendanceHolidayCell attendanceRegisterSessionCell') == 0
assert 'attendanceEmptyCell attendanceRegisterSessionCell"><div class="attendanceRegisterCellInner"><span class="attendanceRegisterSegment attendanceBlankMark attendanceRegisterPlaceholder"' in js_check
