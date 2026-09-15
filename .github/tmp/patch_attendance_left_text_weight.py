from pathlib import Path

path = Path('pc-timetable.css')
text = path.read_text(encoding='utf-8')
old = """#recordRoomScreen .olliTtAttendanceTable tbody td.nameCol {\n  background: #fafbfc !important;\n  color: #111318;\n  font-weight: 800;\n}\n#recordRoomScreen .olliTtAttendanceTable tbody td.schoolGradeCol,\n#recordRoomScreen .olliTtAttendanceTable tbody td.personalityCol {\n  color: #7b8490;\n  font-weight: 600;\n}\n"""
new = """#recordRoomScreen .olliTtAttendanceTable tbody td.nameCol {\n  background: #fafbfc !important;\n  color: #111318;\n  font-weight: 700;\n}\n#recordRoomScreen .olliTtAttendanceTable tbody td.schoolGradeCol,\n#recordRoomScreen .olliTtAttendanceTable tbody td.personalityCol {\n  color: #7b8490;\n  font-weight: 500;\n}\n"""
if old not in text:
    raise SystemExit('target attendance text-weight block not found')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
