from pathlib import Path

path = Path('index.html')
s = path.read_text(encoding='utf-8')
changed = False

repls = [
    ('.attendancePrintHeader {\n  padding-top: 20px;\n  margin-bottom: 5px;\n}', '.attendancePrintHeader {\n  padding-top: 30px;\n  margin-bottom: 5px;\n}', '메인 출력 학원명 위 여백'),
    ('height: 20.5px;\n  padding-top: 0.5px;', 'height: 21px;\n  padding-top: 0.5px;', '출력 행 높이'),
    ('border: 0.4px solid #b4b4b4;', 'border: 0.5px solid #b4b4b4;', '미리보기 표 선'),
    ('border: 0.4px solid #777777;', 'border: 0.5px solid #777777;', '출력 표 선'),
    ('border:0.4px solid #777777!important;', 'border:0.5px solid #777777!important;', '인라인 출력 표 선'),
    ('.attendancePrintHeader{padding-top:20px;margin-bottom:5px}', '.attendancePrintHeader{padding-top:30px;margin-bottom:5px}', '독립 출력 학원명 위 여백'),
    ('.attendancePrintTable th,.attendancePrintTable td{border:0.4px solid #777777;height:20.5px;', '.attendancePrintTable th,.attendancePrintTable td{border:0.5px solid #777777;height:21px;', '독립 출력 표 선/행 높이'),
    ("cell.style.border = '0.4px solid #777777';", "cell.style.border = '0.5px solid #777777';", 'PDF 표 선'),
]

for old, new, label in repls:
    if new in s:
        continue
    if old not in s:
        raise SystemExit(f'{label} 위치를 찾지 못했습니다.')
    s = s.replace(old, new, 1)
    changed = True

# 출석부 관련 예전 런타임 값이 남아 있으면 실패시켜 중복/덮어쓰기 누락을 잡습니다.
for stale in [
    'border: 0.4px solid #777777;',
    'border:0.4px solid #777777!important;',
    "cell.style.border = '0.4px solid #777777';",
    '.attendancePrintHeader{padding-top:20px;margin-bottom:5px}',
    '.attendancePrintTable th,.attendancePrintTable td{border:0.4px solid #777777;height:20.5px;',
]:
    if stale in s:
        raise SystemExit(f'예전 출석부 출력 값이 남아 있습니다: {stale}')

if changed:
    path.write_text(s, encoding='utf-8')
    print('attendance print values updated to 30px / 21px / 0.5px')
else:
    print('attendance print values already current')
