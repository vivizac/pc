from pathlib import Path
p = Path('pc-timetable.css')
s = p.read_text(encoding='utf-8')
needle = "#recordRoomScreen .olliTtAttendanceTable tbody tr.attendanceTableFooterRow > td {\n  height: 24px !important;"
insert = "#recordRoomScreen .olliTtAttendanceTable tbody tr:not(.attendanceTableFooterRow) > td {\n  height: 32px !important;\n}\n"
if insert not in s:
    pos = s.find(needle)
    if pos < 0:
        raise SystemExit('anchor not found')
    s = s[:pos] + insert + s[pos:]
p.write_text(s, encoding='utf-8')
