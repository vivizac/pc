from pathlib import Path

path = Path('pc-timetable.css')
text = path.read_text(encoding='utf-8')

old_base = '''#olliPcTopbar .olliTtAttendanceDivisionTabs .olliTtDivisionTab{\n  min-width:94px;\n  height:100%;\n  box-sizing:border-box;\n  padding:0 22px;\n  border:0;\n  border-right:1px solid #dbe5ef;\n  border-radius:0;\n  display:inline-flex;\n  align-items:center;\n  justify-content:center;\n  color:#303742;\n  background:#fff;\n  font:800 calc(14px * var(--olli-text-scale)) 'Pretendard',sans-serif;\n  letter-spacing:-.035em;\n  box-shadow:none;\n  cursor:pointer;\n}\n'''
new_base = old_base.replace('color:#303742;', 'color:#a1a6ae;')

old_hover = '''#olliPcTopbar .olliTtAttendanceDivisionTabs .olliTtDivisionTab:hover:not(.active){\n  color:#1f2732;\n  background:#f7faff;\n}\n'''
new_hover = '''#olliPcTopbar .olliTtAttendanceDivisionTabs .olliTtDivisionTab:hover:not(.active){\n  color:#7f8792;\n  background:#fff;\n}\n'''

old_active = '''#olliPcTopbar .olliTtAttendanceDivisionTabs .olliTtDivisionTab.active{\n  position:relative;\n  z-index:1;\n  color:#fff;\n  border-right-color:#74aaf6;\n  background:#74aaf6;\n  box-shadow:none;\n}\n'''
new_active = '''#olliPcTopbar .olliTtAttendanceDivisionTabs .olliTtDivisionTab.active{\n  position:relative;\n  z-index:1;\n  color:#171a20;\n  border-right-color:#dbe5ef;\n  background:#fff;\n  box-shadow:none;\n}\n'''

for old, new, label in [(old_base, new_base, 'base'), (old_hover, new_hover, 'hover'), (old_active, new_active, 'active')]:
    if old not in text:
        raise SystemExit(f'target {label} style not found')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
