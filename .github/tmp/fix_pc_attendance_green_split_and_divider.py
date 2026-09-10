from pathlib import Path

register_path = Path('pc-timetable-attendance-register.js')
register = register_path.read_text(encoding='utf-8')

old_fn = """  function attendanceRegisterSessionStatus(records, sessionDate, sessionKind) {
    const rows = Array.isArray(records) ? records : [];
    const kind = sessionKind === 'makeup' ? 'makeup' : 'regular';
    const allowed = kind === 'makeup' ? MAKEUP_ATTENDANCE_STATUS_ORDER : REGULAR_ATTENDANCE_STATUS_ORDER;
    const override = rows.find((row) =>
      clean(row && row.session_kind) === 'register_override'
      && attendanceRegisterOverrideKind(row) === kind
      && allowed.includes(clean(row && row.register_status))
    );
    if (override) return clean(override.register_status);

    if (kind === 'makeup') {
      return rows.some((row) => clean(row && row.session_kind) === 'makeup' && row.attended !== false) ? 'makeup' : 'blank';
    }

    if (rows.some((row) => clean(row && row.session_kind) === 'regular' && row.attended !== false)) return 'present';
    const expected = rows.some((row) => clean(row && row.session_kind) === 'regular_expected');
    if (expected && clean(sessionDate) < todayKey()) return 'absent';
    return 'blank';
  }
"""

new_fn = """  function attendanceRegisterSessionStatus(records, sessionDate, sessionKind) {
    const rows = Array.isArray(records) ? records : [];
    const kind = sessionKind === 'makeup' ? 'makeup' : 'regular';
    const allowed = kind === 'makeup' ? MAKEUP_ATTENDANCE_STATUS_ORDER : REGULAR_ATTENDANCE_STATUS_ORDER;
    const timeOf = (row) => {
      const time = Date.parse(clean(row && row.marked_at));
      return Number.isFinite(time) ? time : 0;
    };
    const override = rows
      .filter((row) =>
        clean(row && row.session_kind) === 'register_override'
        && attendanceRegisterOverrideKind(row) === kind
        && allowed.includes(clean(row && row.register_status))
      )
      .sort((a, b) => timeOf(b) - timeOf(a))[0] || null;
    const actual = rows
      .filter((row) => clean(row && row.session_kind) === kind && row.attended !== false)
      .sort((a, b) => timeOf(b) - timeOf(a))[0] || null;

    // 출석부 수동값과 시간표 체크가 모두 있을 때는 가장 나중에 저장된 조작을 표시합니다.
    // 따라서 출석부에서 사후 수정한 값은 유지되고, 그 뒤 시간표에서 다시 체크하면
    // 최신 시간표 출석이 즉시 출석부에 반영됩니다.
    if (override && (!actual || timeOf(override) >= timeOf(actual))) {
      return clean(override.register_status);
    }
    if (actual) return kind === 'makeup' ? 'makeup' : 'present';

    if (kind === 'makeup') return 'blank';
    const expected = rows.some((row) => clean(row && row.session_kind) === 'regular_expected');
    if (expected && clean(sessionDate) < todayKey()) return 'absent';
    return 'blank';
  }
"""

if old_fn not in register:
    raise SystemExit('attendanceRegisterSessionStatus block not found')
register = register.replace(old_fn, new_fn, 1)

old_color = "#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceLinkedMark{color:#fff;background:#0A84FF!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}"
new_color = "#recordRoomScreen .olliTtAttendanceRegisterScroll .attendanceRegisterSegment.attendanceLinkedMark{color:#fff;background:#43d878!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}"
if old_color not in register:
    raise SystemExit('PC attendance present color rule not found')
register = register.replace(old_color, new_color, 1)
register_path.write_text(register, encoding='utf-8')

css_path = Path('pc-attendance.css')
css = css_path.read_text(encoding='utf-8')
old_divider = '  content:"";height:1px;flex:1;min-width:12px;background:#666b72;\n'
new_divider = '  content:"";height:1px;flex:1;min-width:12px;background:transparent;\n'
if old_divider not in css:
    raise SystemExit('attendance roster divider rule not found')
css = css.replace(old_divider, new_divider, 1)
css_path.write_text(css, encoding='utf-8')

print('PC attendance color, latest-write sync, and divider visuals updated')
