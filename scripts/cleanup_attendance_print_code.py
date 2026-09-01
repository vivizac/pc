from pathlib import Path
import re

path = Path('index.html')
s = path.read_text(encoding='utf-8')
original = s

# 현재 실제 출력값을 기본 출석부 CSS 선언으로 통합합니다.
def replace_rule(selector_pattern, updater, label):
    global s
    pat = re.compile(selector_pattern + r'\s*\{(?P<body>.*?)\}', re.S)
    m = pat.search(s)
    if not m:
        raise SystemExit(f'{label} 기본 CSS 선언을 찾지 못했습니다.')
    old_body = m.group('body')
    new_body = updater(old_body)
    s = s[:m.start('body')] + new_body + s[m.end('body'):]


def set_prop(body, prop, value):
    prop_re = re.compile(r'(^|\n)(\s*)' + re.escape(prop) + r'\s*:\s*[^;]+;', re.M)
    m = prop_re.search(body)
    if m:
        return body[:m.start()] + m.group(1) + m.group(2) + f'{prop}: {value};' + body[m.end():]
    indent = '  '
    return body.rstrip() + f'\n{indent}{prop}: {value};\n'

# 헤더 상단 여백의 최종값 10px을 기본 선언에 둡니다.
def update_header(body):
    return set_prop(body, 'padding-top', '10px')
replace_rule(r'\.attendancePrintHeader', update_header, '출석부 헤더')

# 표 셀의 최종값: 0.5px 선, 23px 행, 상하 0.5px / 좌우 1.5px.
def update_cells(body):
    body = set_prop(body, 'border', '0.5px solid #777777')
    body = set_prop(body, 'height', '23px')
    # 기존 padding shorthand가 있으면 최종값으로 통합하고, 개별 상하 padding은 제거합니다.
    body = re.sub(r'(^|\n)\s*padding-top\s*:\s*[^;]+;','',body,flags=re.M)
    body = re.sub(r'(^|\n)\s*padding-bottom\s*:\s*[^;]+;','',body,flags=re.M)
    body = set_prop(body, 'padding', '0.5px 1.5px')
    return body
replace_rule(r'\.attendancePrintTable th,\s*\n\s*\.attendancePrintTable td', update_cells, '출석부 표 셀')

# 40명 1페이지 맞춤을 위해 뒤에서 다시 같은 값을 덮던 보정 CSS 블록을 제거합니다.
override = re.compile(
    r'/\* 2026-09-01: 출석부 출력 40명 1페이지 맞춤 보정.*?\*/\s*'
    r'\.attendancePrintHeader\s*\{.*?\}\s*'
    r'\.attendancePrintAcademy\s*\{.*?\}\s*'
    r'\.attendancePrintMonth\s*\{.*?\}\s*'
    r'\.attendancePrintTable th,\s*\.attendancePrintTable td\s*\{.*?\}\s*',
    re.S,
)
m = override.search(s)
if not m:
    raise SystemExit('출석부 40명 출력 중복 보정 CSS 블록을 찾지 못했습니다.')
s = s[:m.start()] + '/* 출석부 출력값은 위 기본 .attendancePrint* 선언에서 단일 관리합니다. */\n' + s[m.end():]

# 실제 새 창 출력용 CSS 문자열은 별도 문서 컨텍스트라 유지하되, 현재 확정값이 맞는지 검증합니다.
required = [
    '.attendancePrintHeader{padding-top:10px;margin-bottom:5px}',
    'border:0.5px solid #777777;height:23px;padding:.5px 1.5px',
    '.attendancePrintTable tbody td.nameCol{font-size:12px;font-weight:700}',
    '.attendancePrintTable tbody td.schoolGradeCol{font-size:11.6px;font-weight:600}',
    '.attendancePrintTable tbody td.personalityCol{font-size:11.4px;font-weight:600}',
    '.attendancePrintTable .nameCol{width:43px',
    '.attendancePrintTable .schoolGradeCol{width:52px',
]
for marker in required:
    if marker not in s:
        raise SystemExit(f'독립 출력용 현재 확정값을 찾지 못했습니다: {marker}')

# 핵심 기능 값 검증
if 'const SETTINGS_ATTENDANCE_PRINT_ROWS_PER_PAGE = 40;' not in s:
    raise SystemExit('출석부 40행 설정을 찾지 못했습니다.')
if 'buildBlankRow' not in s:
    raise SystemExit('출석부 빈 행 생성 로직을 찾지 못했습니다.')

if s == original:
    raise SystemExit('정리할 출석부 코드 변경점이 없습니다.')

path.write_text(s, encoding='utf-8')
print('attendance print CSS overrides consolidated without changing final print values')
