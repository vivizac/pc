from pathlib import Path

path = Path('pc-timetable-attendance-register.js')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        'outline:0;border-radius:7px;display:flex',
        'outline:0;border-radius:5px;display:flex'
    ),
    (
        "if (!sessions.length) return '<td class=\"dateCol attendanceEmptyCell\"><span aria-hidden=\"true\">-</span></td>';",
        "if (!sessions.length) return '<td class=\"dateCol attendanceEmptyCell attendanceRegisterSessionCell\"><div class=\"attendanceRegisterCellInner\"><span class=\"attendanceRegisterSegment attendanceBlankMark attendanceRegisterPlaceholder\"><span aria-hidden=\"true\">-</span></span></div></td>';"
    ),
    (
        "if (!meta.closed) return '<td class=\"dateCol\"></td>';",
        "if (!meta.closed) return '<td class=\"dateCol attendanceEmptyCell attendanceRegisterSessionCell\"><div class=\"attendanceRegisterCellInner\"><span class=\"attendanceRegisterSegment attendanceBlankMark attendanceRegisterPlaceholder\"><span aria-hidden=\"true\">-</span></span></div></td>';"
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one match, found {count}: {old}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
