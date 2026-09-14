from pathlib import Path

path = Path('pc-timetable.css')
text = path.read_text(encoding='utf-8')
marker = '/* 출석부 표 꽉채움 + 스크롤바 바깥 배치 */'
block = '''\n\n/* 출석부 표 꽉채움 + 스크롤바 바깥 배치 */\n#recordRoomScreen .olliTtAttendanceRegister {\n  border: 0;\n  border-radius: 0;\n  background: transparent;\n  box-shadow: none;\n}\n#recordRoomScreen .olliTtAttendanceRegisterScroll {\n  min-width: 0;\n  min-height: 0;\n  padding: 0 !important;\n  flex: 1;\n  overflow: auto;\n  border: 0;\n  border-radius: 0;\n  background: transparent;\n  box-shadow: none;\n  scrollbar-gutter: stable;\n}\n#recordRoomScreen .olliTtAttendanceSheet {\n  width: 100%;\n  min-width: 900px;\n  margin: 0;\n  padding: 0;\n  border: 1px solid #e4e7eb;\n  border-radius: 21px;\n  overflow: hidden;\n  background: #fff;\n  box-shadow: 0 7px 20px rgba(27,39,58,.045);\n  box-sizing: border-box;\n}\n#recordRoomScreen .olliTtAttendanceTable {\n  margin: 0 !important;\n}\n'''
if marker in text:
    text = text[:text.index(marker)].rstrip() + block
else:
    text = text.rstrip() + block
path.write_text(text, encoding='utf-8')

for temp in [
    Path('.github/workflows/apply-attendance-scroll-clean.yml'),
    Path('.github/tmp/apply_attendance_scroll_clean.py'),
]:
    if temp.exists():
        temp.unlink()
