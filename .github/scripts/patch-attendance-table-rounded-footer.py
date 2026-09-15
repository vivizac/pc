from pathlib import Path

css_path = Path('pc-timetable.css')
js_path = Path('pc-timetable-attendance-register.js')

css = css_path.read_text(encoding='utf-8')
js = js_path.read_text(encoding='utf-8')

old_ipad_sheet = '''  #recordRoomScreen .olliTtAttendanceSheet {\n    width: 1600px !important;\n    min-width: 1600px !important;\n    max-width: none !important;\n    overflow: visible;\n  }'''
new_ipad_sheet = '''  #recordRoomScreen .olliTtAttendanceSheet {\n    width: 1600px !important;\n    min-width: 1600px !important;\n    max-width: none !important;\n    overflow: hidden;\n  }'''
if old_ipad_sheet not in css:
    raise SystemExit('iPad attendance sheet block not found')
css = css.replace(old_ipad_sheet, new_ipad_sheet, 1)

old_collapse = '    border-collapse: collapse !important;\n    border-spacing: 0 !important;'
new_collapse = '    border-collapse: separate !important;\n    border-spacing: 0 !important;'
if old_collapse not in css:
    raise SystemExit('iPad border-collapse block not found')
css = css.replace(old_collapse, new_collapse, 1)

footer_css_anchor = '''#recordRoomScreen .olliTtAttendanceTable {\n  margin: 0 !important;\n}\n\n/* iPad 출석부: 고정 학생정보 3열 + 날짜 가로 스크롤 */'''
footer_css_replacement = '''#recordRoomScreen .olliTtAttendanceTable {\n  margin: 0 !important;\n}\n#recordRoomScreen .olliTtAttendanceTable tbody tr.attendanceTableFooterRow > td {\n  height: 24px !important;\n  padding: 0 !important;\n  border-right: 0 !important;\n  border-bottom: 0 !important;\n  background: #f8f9fb !important;\n}\n\n/* iPad 출석부: 고정 학생정보 3열 + 날짜 가로 스크롤 */'''
if footer_css_anchor not in css:
    raise SystemExit('attendance table footer CSS anchor not found')
css = css.replace(footer_css_anchor, footer_css_replacement, 1)

old_js = '''    }).join('');\n    return `<div class="olliTtAttendanceSheet"><table class="settingsAttendancePreviewTable olliTtAttendanceTable"${tableStyle}>${colGroup}${header}<tbody>${rowHtml}${blankRows}</tbody></table></div>`;'''
new_js = '''    }).join('');\n    const footerRow = `<tr class="attendanceTableFooterRow" aria-hidden="true"><td colspan="${days + 3}"></td></tr>`;\n    return `<div class="olliTtAttendanceSheet"><table class="settingsAttendancePreviewTable olliTtAttendanceTable"${tableStyle}>${colGroup}${header}<tbody>${rowHtml}${blankRows}${footerRow}</tbody></table></div>`;'''
if old_js not in js:
    raise SystemExit('attendance table return block not found')
js = js.replace(old_js, new_js, 1)

css_path.write_text(css, encoding='utf-8')
js_path.write_text(js, encoding='utf-8')
