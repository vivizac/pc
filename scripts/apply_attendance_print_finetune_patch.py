from pathlib import Path

path = Path('index.html')
s = path.read_text(encoding='utf-8')
changed = False

repls = [
    ('.attendancePrintHeader {\n  padding-top: 30px;\n  margin-bottom: 5px;\n}', '.attendancePrintHeader {\n  padding-top: 10px;\n  margin-bottom: 5px;\n}', '메인 출력 학원명 위 여백'),
    ('.attendancePrintTable tbody td.nameCol { font-size: 11.8px; font-weight: 700; }', '.attendancePrintTable tbody td.nameCol { font-size: 12px; font-weight: 700; }', '이름 텍스트 크기'),
    ('.attendancePrintTable tbody td.schoolGradeCol { font-size: 11.4px; font-weight: 600; }', '.attendancePrintTable tbody td.schoolGradeCol { font-size: 11.6px; font-weight: 600; }', '학교/학년 텍스트 크기'),
    ('.attendancePrintTable tbody td.personalityCol { font-size: 11.2px; font-weight: 600; }', '.attendancePrintTable tbody td.personalityCol { font-size: 11.4px; font-weight: 600; }', '성향 텍스트 크기'),
    ('.attendancePrintHeader{padding-top:30px;margin-bottom:5px}', '.attendancePrintHeader{padding-top:10px;margin-bottom:5px}', '독립 출력 학원명 위 여백'),
    ('.attendancePrintTable tbody td.nameCol{font-size:11.8px;font-weight:700}', '.attendancePrintTable tbody td.nameCol{font-size:12px;font-weight:700}', '독립 출력 이름 텍스트 크기'),
    ('.attendancePrintTable tbody td.schoolGradeCol{font-size:11.4px;font-weight:600}', '.attendancePrintTable tbody td.schoolGradeCol{font-size:11.6px;font-weight:600}', '독립 출력 학교/학년 텍스트 크기'),
    ('.attendancePrintTable tbody td.personalityCol{font-size:11.2px;font-weight:600}', '.attendancePrintTable tbody td.personalityCol{font-size:11.4px;font-weight:600}', '독립 출력 성향 텍스트 크기'),
]

for old, new, label in repls:
    if new in s:
        continue
    if old not in s:
        raise SystemExit(f'{label} 위치를 찾지 못했습니다.')
    s = s.replace(old, new, 1)
    changed = True

for stale in [
    '.attendancePrintHeader {\n  padding-top: 30px;\n  margin-bottom: 5px;\n}',
    '.attendancePrintTable tbody td.nameCol { font-size: 11.8px; font-weight: 700; }',
    '.attendancePrintTable tbody td.schoolGradeCol { font-size: 11.4px; font-weight: 600; }',
    '.attendancePrintTable tbody td.personalityCol { font-size: 11.2px; font-weight: 600; }',
    '.attendancePrintHeader{padding-top:30px;margin-bottom:5px}',
    '.attendancePrintTable tbody td.nameCol{font-size:11.8px;font-weight:700}',
    '.attendancePrintTable tbody td.schoolGradeCol{font-size:11.4px;font-weight:600}',
    '.attendancePrintTable tbody td.personalityCol{font-size:11.2px;font-weight:600}',
]:
    if stale in s:
        raise SystemExit(f'예전 출석부 출력 값이 남아 있습니다: {stale}')

if changed:
    path.write_text(s, encoding='utf-8')
    print('attendance print updated: 10px header spacing and slightly larger student text')
else:
    print('attendance print values already current')
