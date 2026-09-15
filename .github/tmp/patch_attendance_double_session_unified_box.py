from pathlib import Path

path = Path('pc-timetable-attendance-register.js')
text = path.read_text(encoding='utf-8')
old = '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment+.attendanceRegisterSegment{border-left:0}\n'
new = '''#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment+.attendanceRegisterSegment{border-left:0}\n#recordRoomScreen .olliTtAttendanceRegisterScroll td.attendanceRegisterSessionCell.isSplit .attendanceRegisterCellInner{gap:0;border-radius:5px;overflow:hidden;background:#f0f2f4}\n#recordRoomScreen .olliTtAttendanceRegisterScroll td.attendanceRegisterSessionCell.isSplit .attendanceRegisterSegment{border-radius:0!important}\n#recordRoomScreen .olliTtAttendanceRegisterScroll td.attendanceRegisterSessionCell.isSplit .attendanceRegisterSegment+.attendanceRegisterSegment{border-left:1px solid rgba(255,255,255,.82)}\n'''
if text.count(old) != 1:
    raise SystemExit(f'target split style count={text.count(old)}')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')

check = path.read_text(encoding='utf-8')
assert 'attendanceRegisterSessionCell.isSplit .attendanceRegisterCellInner{gap:0;border-radius:5px;overflow:hidden' in check
assert 'attendanceRegisterSessionCell.isSplit .attendanceRegisterSegment{border-radius:0!important}' in check
assert 'attendanceRegisterSessionCell.isSplit .attendanceRegisterSegment+.attendanceRegisterSegment{border-left:1px solid rgba(255,255,255,.82)}' in check
