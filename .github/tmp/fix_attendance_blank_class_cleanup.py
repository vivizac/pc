from pathlib import Path
p = Path('pc-timetable-attendance-register.js')
s = p.read_text(encoding='utf-8')
old = "cell.classList.remove('attendanceLinkedMark', 'attendanceAbsentMark', 'attendanceMakeupMark');"
new = "cell.classList.remove('attendanceBlankMark', 'attendanceLinkedMark', 'attendanceAbsentMark', 'attendanceMakeupMark');"
if s.count(old) != 1:
    raise SystemExit(f'expected one status-class cleanup, got {s.count(old)}')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
