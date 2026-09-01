from pathlib import Path

path = Path('index.html')
s = path.read_text(encoding='utf-8')
changed = False

old_header = '.attendancePrintHeader {\n  padding-top: 20px;\n  margin-bottom: 5px;\n}'
new_header = '.attendancePrintHeader {\n  padding-top: 30px;\n  margin-bottom: 5px;\n}'
if old_header in s:
    s = s.replace(old_header, new_header, 1)
    changed = True
elif new_header not in s:
    raise SystemExit('출석부 메인 출력 헤더 여백 위치를 찾지 못했습니다.')

old_pdf = "cell.style.border = '0.4px solid #777777';"
new_pdf = "cell.style.border = '0.5px solid #777777';"
if old_pdf in s:
    s = s.replace(old_pdf, new_pdf, 1)
    changed = True
elif new_pdf not in s:
    raise SystemExit('출석부 PDF 표 선 위치를 찾지 못했습니다.')

if changed:
    path.write_text(s, encoding='utf-8')
    print('attendance exact header patch updated')
else:
    print('attendance exact header patch already current')
