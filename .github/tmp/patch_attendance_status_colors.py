from pathlib import Path

path = Path('pc-timetable-attendance-register.js')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceLinkedMark{color:#249e58;background:#e7f7ed!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceLinkedMark{color:#249e58;background:#dcf4e5!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    ),
    (
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceAbsentMark{color:#d9464d;background:#fdebed!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceAbsentMark{color:#d9464d;background:#fbe0e4!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    ),
    (
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceMakeupMark{color:#b98700;background:#fff6cf!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceMakeupMark{color:#8b5e00;background:#ffefb8!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    ),
    (
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceLinkedMark span{font-size:16px}',
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceLinkedMark span{font-size:16px;font-weight:700}\n#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceBlankMark span{font-weight:650}'
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one match, found {count}: {old}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
