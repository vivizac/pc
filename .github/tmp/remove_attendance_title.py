from pathlib import Path

path = Path('pc-timetable-attendance-register.js')
text = path.read_text(encoding='utf-8')
old = '    ui.root.innerHTML = `<section class="olliTtAttendanceRegister"><div class="olliTtAttendanceRegisterHead"><strong>${esc(monthLabel(state.attendanceMonth))} 출석부</strong></div><div class="olliTtAttendanceRegisterScroll">${html}</div></section>`;'
new = '    ui.root.innerHTML = `<section class="olliTtAttendanceRegister"><div class="olliTtAttendanceRegisterScroll">${html}</div></section>`;'
if old not in text:
    raise SystemExit('target attendance title markup not found')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')

for temp in [
    Path('.github/workflows/apply-remove-attendance-title.yml'),
    Path('.github/tmp/remove_attendance_title.py'),
]:
    if temp.exists():
        temp.unlink()
