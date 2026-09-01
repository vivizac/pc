from pathlib import Path

path = Path('index.html')
s = path.read_text(encoding='utf-8')
changed = False

repls = [
    ('padding-top: 8px;', 'padding-top: 20px;', '학원명 위 여백'),
    ('height: 20px;\n  padding-top: 0.5px;', 'height: 20.5px;\n  padding-top: 0.5px;', '출력 행 높이'),
    ('border: 0.6px solid #b4b4b4;', 'border: 0.4px solid #b4b4b4;', '미리보기 표 선'),
    ('border: 0.6px solid #777777;', 'border: 0.4px solid #777777;', '출력 표 선'),
    ('border:0.6px solid #777777!important;', 'border:0.4px solid #777777!important;', '인라인 출력 표 선'),
    ('.attendancePrintHeader{padding-top:8px;margin-bottom:5px}', '.attendancePrintHeader{padding-top:20px;margin-bottom:5px}', '독립 출력 학원명 위 여백'),
    ('.attendancePrintTable th,.attendancePrintTable td{border:0.6px solid #777777;height:20px;', '.attendancePrintTable th,.attendancePrintTable td{border:0.4px solid #777777;height:20.5px;', '독립 출력 표 선/행 높이'),
    ("cell.style.border = '0.6px solid #777777';", "cell.style.border = '0.4px solid #777777';", 'PDF 표 선'),
]

for old, new, label in repls:
    if new in s:
        continue
    if old not in s:
        raise SystemExit(f'{label} 위치를 찾지 못했습니다.')
    s = s.replace(old, new, 1)
    changed = True

if changed:
    path.write_text(s, encoding='utf-8')
    print('attendance print fine-tune patch applied')
else:
    print('attendance print fine-tune patch already applied')
