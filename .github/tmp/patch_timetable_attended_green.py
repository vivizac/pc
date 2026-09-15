from pathlib import Path

path = Path('pc-timetable.css')
text = path.read_text(encoding='utf-8')
old = "#recordRoomScreen .olliTtStudent.makeup.attended { border-color: transparent; background: #43d878; box-shadow: none; }"
new = "#recordRoomScreen .olliTtStudent.makeup.attended { border-color: transparent; background: #6fdf96; box-shadow: none; }"
if old not in text:
    raise SystemExit('target attended color rule not found')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
