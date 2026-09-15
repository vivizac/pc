from pathlib import Path

css = Path('pc-timetable.css')
text = css.read_text(encoding='utf-8')
old = """#recordRoomScreen .olliTtAttendanceTable tbody td.nameCol {\n  background: #fafbfc !important;\n  color: #111318;\n  font-weight: 700;\n}\n#recordRoomScreen .olliTtAttendanceTable tbody td.schoolGradeCol,\n#recordRoomScreen .olliTtAttendanceTable tbody td.personalityCol {\n  color: #7b8490;\n  font-weight: 500;\n}"""
new = """#recordRoomScreen .olliTtAttendanceTable tbody td.nameCol {\n  background: #fafbfc !important;\n  color: #111318;\n  font-weight: 500;\n}\n#recordRoomScreen .olliTtAttendanceTable tbody td.schoolGradeCol,\n#recordRoomScreen .olliTtAttendanceTable tbody td.personalityCol {\n  color: #7b8490;\n  font-weight: 300;\n}"""
if old not in text:
    raise SystemExit('left column weight block not found')
text = text.replace(old, new, 1)
old_dash = """#recordRoomScreen .olliTtAttendanceTable tbody td.attendanceEmptyCell {\n  background: #fff !important;\n  color: #666d76 !important;\n}\n#recordRoomScreen .olliTtAttendanceTable tbody td.attendanceEmptyCell > span {\n  display: inline-block;\n  color: #666d76;"""
new_dash = """#recordRoomScreen .olliTtAttendanceTable tbody td.attendanceEmptyCell {\n  background: #fff !important;\n  color: #a5acb5 !important;\n}\n#recordRoomScreen .olliTtAttendanceTable tbody td.attendanceEmptyCell > span {\n  display: inline-block;\n  color: #a5acb5;"""
if old_dash not in text:
    raise SystemExit('empty cell dash color block not found')
text = text.replace(old_dash, new_dash, 1)
css.write_text(text, encoding='utf-8')

js = Path('pc-timetable-attendance-register.js')
text = js.read_text(encoding='utf-8')
old1 = '.attendanceRegisterSegment.attendanceBlankMark{color:#666d76;background:#f4f5f7!important;'
new1 = '.attendanceRegisterSegment.attendanceBlankMark{color:#a5acb5;background:#f4f5f7!important;'
old2 = '.attendanceRegisterCellInner>.attendanceRegisterPlaceholder{background:#f4f5f7!important;color:#666d76!important;'
new2 = '.attendanceRegisterCellInner>.attendanceRegisterPlaceholder{background:#f4f5f7!important;color:#a5acb5!important;'
if old1 not in text or old2 not in text:
    raise SystemExit('attendance blank color style not found')
text = text.replace(old1, new1, 1).replace(old2, new2, 1)
js.write_text(text, encoding='utf-8')
