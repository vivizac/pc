from pathlib import Path

path = Path('pc-timetable.css')
text = path.read_text(encoding='utf-8')

old_tabs = '''#olliPcTopbar .olliTtAttendanceDivisionTabs{\n  display:inline-flex;\n  align-items:stretch;\n  gap:0;\n  overflow:hidden;\n  border:1px solid #dbe5ef;\n  border-radius:16px;\n  background:#fff;\n  box-shadow:0 1px 2px rgba(24,39,75,.03);\n}'''
new_tabs = '''#olliPcTopbar .olliTtAttendanceDivisionTabs{\n  height:40px;\n  box-sizing:border-box;\n  display:inline-flex;\n  align-items:stretch;\n  gap:0;\n  overflow:hidden;\n  border:1px solid #dbe5ef;\n  border-radius:16px;\n  background:#fff;\n  box-shadow:0 1px 2px rgba(24,39,75,.03);\n}'''
if text.count(old_tabs) != 1:
    raise SystemExit(f'attendance division tabs block count={text.count(old_tabs)}')
text = text.replace(old_tabs, new_tabs, 1)

old_btn = '''#olliPcTopbar .olliTtAttendanceDivisionTabs .olliTtDivisionTab{\n  min-width:94px;\n  height:40px;\n  padding:0 22px;'''
new_btn = '''#olliPcTopbar .olliTtAttendanceDivisionTabs .olliTtDivisionTab{\n  min-width:94px;\n  height:100%;\n  box-sizing:border-box;\n  padding:0 22px;'''
if text.count(old_btn) != 1:
    raise SystemExit(f'attendance division button block count={text.count(old_btn)}')
text = text.replace(old_btn, new_btn, 1)

replacements = {
    'width: 1500px !important;\n    min-width: 1500px !important;': 'width: 1600px !important;\n    min-width: 1600px !important;',
    'width: 64px !important;\n    min-width: 64px !important;\n    max-width: 64px !important;': 'width: 88px !important;\n    min-width: 88px !important;\n    max-width: 88px !important;',
    'left: 64px;\n    z-index: 5;\n    width: 51px !important;\n    min-width: 51px !important;\n    max-width: 51px !important;': 'left: 88px;\n    z-index: 5;\n    width: 96px !important;\n    min-width: 96px !important;\n    max-width: 96px !important;',
    'left: 115px;\n    z-index: 5;\n    width: 20px !important;\n    min-width: 20px !important;\n    max-width: 20px !important;': 'left: 184px;\n    z-index: 5;\n    width: 56px !important;\n    min-width: 56px !important;\n    max-width: 56px !important;'
}
for old, new in replacements.items():
    count = text.count(old)
    if count < 1:
        raise SystemExit(f'missing expected block: {old[:50]!r}')
    text = text.replace(old, new)

path.write_text(text.rstrip() + '\n', encoding='utf-8')

check = path.read_text(encoding='utf-8')
assert 'height:40px;\n  box-sizing:border-box;' in check
assert 'height:100%;\n  box-sizing:border-box;' in check
assert check.count('width: 1600px !important;') >= 2
assert 'left: 88px;' in check
assert 'left: 184px;' in check
assert 'width: 88px !important;' in check
assert 'width: 96px !important;' in check
assert 'width: 56px !important;' in check
