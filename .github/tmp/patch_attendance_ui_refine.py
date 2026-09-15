from pathlib import Path

css_path = Path('pc-timetable.css')
js_path = Path('pc-timetable-attendance-register.js')

css = css_path.read_text(encoding='utf-8')
js = js_path.read_text(encoding='utf-8')

old_active = """#olliPcTopbar .olliTtAttendanceDivisionTabs .olliTtDivisionTab.active{\n  color:#fff;\n  background:#74aaf6;\n}"""
new_active = """#olliPcTopbar .olliTtAttendanceDivisionTabs .olliTtDivisionTab.active{\n  position:relative;\n  z-index:1;\n  color:#fff;\n  border-right-color:#74aaf6;\n  background:#74aaf6;\n  box-shadow:0 0 0 1px #74aaf6;\n}"""
if old_active not in css:
    raise SystemExit('active attendance division tab block not found')
css = css.replace(old_active, new_active, 1)

old_holiday_head = 'background: #fff0f4 !important;\n  color: #a95767 !important;'
new_holiday_head = 'background: #fff0f4 !important;\n  color: #e56d8a !important;'
if old_holiday_head not in css:
    raise SystemExit('holiday header colors not found')
css = css.replace(old_holiday_head, new_holiday_head, 1)

if 'color: #bd5b6d;' not in css:
    raise SystemExit('holiday mark color not found')
css = css.replace('color: #bd5b6d;', 'color: #e56d8a;', 1)

old_holiday_cell = 'tbody td.attendanceHolidayCell { color: #bd5b6d; }'
new_holiday_cell = 'tbody td.attendanceHolidayCell { color: #e56d8a; }'
if old_holiday_cell not in css:
    raise SystemExit('holiday cell color not found')
css = css.replace(old_holiday_cell, new_holiday_cell, 1)

old_header = '<th class="personalityCol">성</th>'
new_header = '<th class="personalityCol">성<br>향</th>'
if old_header not in js:
    raise SystemExit('personality header not found')
js = js.replace(old_header, new_header, 1)

replacements = {
    'td.attendanceRegisterSessionCell.isSplit .attendanceRegisterCellInner{gap:0;border-radius:5px;overflow:hidden;background:#f0f2f4}':
    'td.attendanceRegisterSessionCell.isSplit .attendanceRegisterCellInner{gap:0;border-radius:5px;overflow:hidden;background:#f4f5f7}',
    '.attendanceRegisterSegment.attendanceBlankMark{color:#666d76;background:#f0f2f4!important;':
    '.attendanceRegisterSegment.attendanceBlankMark{color:#666d76;background:#f4f5f7!important;',
    '.attendanceRegisterCellInner>.attendanceRegisterPlaceholder{background:#f0f2f4!important;':
    '.attendanceRegisterCellInner>.attendanceRegisterPlaceholder{background:#f4f5f7!important;'
}
for old, new in replacements.items():
    if old not in js:
        raise SystemExit(f'gray box pattern not found: {old}')
    js = js.replace(old, new, 1)

css_path.write_text(css, encoding='utf-8')
js_path.write_text(js, encoding='utf-8')
