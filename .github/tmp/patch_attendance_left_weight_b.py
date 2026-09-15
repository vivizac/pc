from pathlib import Path
p = Path('pc-timetable.css')
s = p.read_text(encoding='utf-8')
old = """#recordRoomScreen .olliTtAttendanceTable tbody td.nameCol {\n  background: #fafbfc !important;\n  color: #111318;\n  font-weight: 500;\n}\n#recordRoomScreen .olliTtAttendanceTable tbody td.schoolGradeCol,\n#recordRoomScreen .olliTtAttendanceTable tbody td.personalityCol {\n  color: #7b8490;\n  font-weight: 300;\n}\n"""
new = """#recordRoomScreen .olliTtAttendanceTable tbody td.nameCol {\n  background: #fafbfc !important;\n  color: #111318;\n  font-weight: 600;\n}\n#recordRoomScreen .olliTtAttendanceTable tbody td.schoolGradeCol,\n#recordRoomScreen .olliTtAttendanceTable tbody td.personalityCol {\n  color: #7b8490;\n  font-weight: 400;\n}\n"""
if old not in s:
    raise SystemExit('expected attendance left-column weight block not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
