from pathlib import Path

attendance = Path('pc-timetable-attendance-register.js')
text = attendance.read_text(encoding='utf-8')

replacements = [
    (
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterCellInner{position:absolute;inset:0;display:flex;align-items:stretch;justify-content:stretch}',
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterCellInner{position:absolute;inset:4px 5px;display:flex;align-items:stretch;justify-content:stretch;gap:4px;box-sizing:border-box}'
    ),
    (
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment{min-width:0;min-height:0;margin:0;padding:0;border:0;outline:0;display:flex;flex:1 1 0;align-items:center;justify-content:center;color:inherit;background:transparent;font:inherit;font-weight:900;cursor:default!important;box-sizing:border-box}',
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment{min-width:0;min-height:0;margin:0;padding:0;border:0;outline:0;border-radius:7px;display:flex;flex:1 1 0;align-items:center;justify-content:center;color:inherit;background:transparent;font:inherit;font-weight:900;cursor:default!important;box-sizing:border-box;overflow:hidden}'
    ),
    (
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment+.attendanceRegisterSegment{border-left:1px solid #dfe4e9}',
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment+.attendanceRegisterSegment{border-left:0}'
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'attendance expected one match, found {count}: {old}')
    text = text.replace(old, new, 1)

attendance.write_text(text, encoding='utf-8')

index = Path('index.html')
html = index.read_text(encoding='utf-8')
old = '<div aria-hidden="true" class="olliBootScreen" id="olliBootScreen">'
new = '<div aria-hidden="true" class="olliBootScreen" id="olliBootScreen" style="position:fixed;inset:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#fff;z-index:2147483000;">'
count = html.count(old)
if count != 1:
    raise SystemExit(f'boot screen expected one match, found {count}')
html = html.replace(old, new, 1)
index.write_text(html, encoding='utf-8')
