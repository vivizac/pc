from pathlib import Path

path = Path('pc-timetable-attendance-register.js')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceBlankMark{color:#666d76;background:#f0f2f4!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}\n',
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceBlankMark{color:#666d76;background:#f0f2f4!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}\n'
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterCellInner>.attendanceRegisterPlaceholder{background:#f0f2f4!important;color:#666d76!important;border-radius:5px!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}\n'
        '#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterCellInner>.attendanceRegisterHolidayPlaceholder{background:#f0f2f4!important;color:#c6535b!important;border-radius:5px!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}\n'
    ),
    (
        "        if (meta.closed) {\n          const holidayText = meta.sunday ? '' : '<span class=\"attendanceHolidayMark\">휴</span>';\n          return `<td class=\"dateCol attendanceHolidayCell ${meta.sunday ? 'attendanceSundayCell' : 'attendancePublicHolidayCell'}\" aria-disabled=\"true\">${holidayText}</td>`;\n        }",
        "        if (meta.closed) {\n          const closedMark = meta.sunday\n            ? '<span aria-hidden=\"true\">-</span>'\n            : '<span class=\"attendanceHolidayMark\">휴</span>';\n          const closedClass = meta.sunday ? 'attendanceRegisterPlaceholder attendanceBlankMark' : 'attendanceRegisterHolidayPlaceholder';\n          return `<td class=\"dateCol attendanceHolidayCell attendanceRegisterSessionCell ${meta.sunday ? 'attendanceSundayCell' : 'attendancePublicHolidayCell'}\" aria-disabled=\"true\"><div class=\"attendanceRegisterCellInner\"><span class=\"attendanceRegisterSegment ${closedClass}\">${closedMark}</span></div></td>`;\n        }"
    ),
    (
        "        if (!meta.closed) return '<td class=\"dateCol attendanceEmptyCell attendanceRegisterSessionCell\"><div class=\"attendanceRegisterCellInner\"><span class=\"attendanceRegisterSegment attendanceBlankMark attendanceRegisterPlaceholder\"><span aria-hidden=\"true\">-</span></span></div></td>';\n        const holidayText = meta.sunday ? '' : '<span class=\"attendanceHolidayMark\">휴</span>';\n        return `<td class=\"dateCol attendanceHolidayCell ${meta.sunday ? 'attendanceSundayCell' : 'attendancePublicHolidayCell'}\" aria-disabled=\"true\">${holidayText}</td>`;",
        "        if (!meta.closed) return '<td class=\"dateCol attendanceEmptyCell attendanceRegisterSessionCell\"><div class=\"attendanceRegisterCellInner\"><span class=\"attendanceRegisterSegment attendanceBlankMark attendanceRegisterPlaceholder\"><span aria-hidden=\"true\">-</span></span></div></td>';\n        const closedMark = meta.sunday\n          ? '<span aria-hidden=\"true\">-</span>'\n          : '<span class=\"attendanceHolidayMark\">휴</span>';\n        const closedClass = meta.sunday ? 'attendanceRegisterPlaceholder attendanceBlankMark' : 'attendanceRegisterHolidayPlaceholder';\n        return `<td class=\"dateCol attendanceHolidayCell attendanceRegisterSessionCell ${meta.sunday ? 'attendanceSundayCell' : 'attendancePublicHolidayCell'}\" aria-disabled=\"true\"><div class=\"attendanceRegisterCellInner\"><span class=\"attendanceRegisterSegment ${closedClass}\">${closedMark}</span></div></td>`;"
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one match, found {count}: {old[:120]}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
