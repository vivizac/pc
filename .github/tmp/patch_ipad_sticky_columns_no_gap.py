from pathlib import Path

path = Path('pc-timetable.css')
text = path.read_text(encoding='utf-8')
old = '''  #recordRoomScreen .olliTtAttendanceTable {\n    width: 1600px !important;\n    min-width: 1600px !important;\n    max-width: none !important;\n    table-layout: fixed !important;\n  }\n\n  /* 학생정보 3열은 왼쪽에 고정하고 날짜 열만 가로로 이동 */\n'''
new = '''  #recordRoomScreen .olliTtAttendanceTable {\n    width: 1600px !important;\n    min-width: 1600px !important;\n    max-width: none !important;\n    table-layout: fixed !important;\n    border-collapse: collapse !important;\n    border-spacing: 0 !important;\n  }\n  #recordRoomScreen .olliTtAttendanceTable col.nameCol { width: 88px !important; }\n  #recordRoomScreen .olliTtAttendanceTable col.schoolGradeCol { width: 96px !important; }\n  #recordRoomScreen .olliTtAttendanceTable col.personalityCol { width: 56px !important; }\n\n  /* 학생정보 3열은 왼쪽에 고정하고 날짜 열만 가로로 이동 */\n'''
if old not in text:
    raise SystemExit('target iPad table block not found')
text = text.replace(old, new, 1)
path.write_text(text.rstrip() + '\n', encoding='utf-8')
