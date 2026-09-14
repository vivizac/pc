from pathlib import Path
p = Path('pc-timetable.css')
s = p.read_text(encoding='utf-8')
old = '#recordRoomScreen .olliTtAttendanceSheet { min-width: 100%; width: max-content; }'
new = '#recordRoomScreen .olliTtAttendanceSheet { min-width: 100%; width: 100%; }'
if s.count(old) != 1:
    raise SystemExit(f'expected one attendance sheet width rule, got {s.count(old)}')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
