from pathlib import Path

path = Path('pc-timetable-attendance-register.js')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterCellInner{position:absolute;inset:4px 5px;display:flex;align-items:stretch;justify-content:stretch;gap:4px;box-sizing:border-box}',
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterCellInner{position:absolute;inset:3px 4px;display:flex;align-items:stretch;justify-content:stretch;gap:3px;box-sizing:border-box}'
    ),
    (
        'outline:0;border-radius:7px;display:flex;',
        'outline:0;border-radius:5px;display:flex;'
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected one match, found {count}: {old}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
