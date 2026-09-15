from pathlib import Path

path = Path('pc-timetable.js')
text = path.read_text(encoding='utf-8')
old = 'title.innerHTML = \'<div class="olliTtDivisionTabs" role="tablist" aria-label="시간표 반 선택">\''
new = 'title.innerHTML = \'<div class="olliTtDivisionTabs olliTtAttendanceDivisionTabs" role="tablist" aria-label="시간표 반 선택">\''

if old not in text:
    raise SystemExit('target schedule division tabs markup not found')
if new in text:
    raise SystemExit('target schedule division tabs already styled')

path.write_text(text.replace(old, new, 1), encoding='utf-8')
