from pathlib import Path
import re

path = Path('index.html')
s = path.read_text(encoding='utf-8')
original = s

def update_rule(selector, values):
    global s
    pat = re.compile(re.escape(selector) + r'\s*\{(?P<body>.*?)\}', re.S)
    m = pat.search(s)
    if not m:
        raise SystemExit(f'CSS rule not found: {selector}')
    body = m.group('body')
    for prop, value in values:
        prop_re = re.compile(r'(^|\n)(\s*)' + re.escape(prop) + r'\s*:\s*[^;]+;', re.M)
        pm = prop_re.search(body)
        if pm:
            body = body[:pm.start()] + pm.group(1) + pm.group(2) + f'{prop}: {value};' + body[pm.end():]
        else:
            body = body.rstrip() + f'\n  {prop}: {value};\n'
    s = s[:m.start('body')] + body + s[m.end('body'):]

# 제거한 보정 블록의 실제 최종값을 기본 선언으로 정확히 이전합니다.
update_rule('.attendancePrintHeader', [
    ('padding-top', '10px'),
    ('margin-bottom', '5px'),
])
update_rule('.attendancePrintAcademy', [
    ('font-size', '15px'),
    ('line-height', '1.05'),
    ('font-weight', '760'),
])
update_rule('.attendancePrintMonth', [
    ('margin-top', '1px'),
    ('font-size', '31px'),
    ('line-height', '0.98'),
])

# 속성 순서와 무관하게 현재 최종값을 검증합니다.
def rule_body(selector):
    m = re.search(re.escape(selector) + r'\s*\{(?P<body>.*?)\}', s, re.S)
    if not m:
        raise SystemExit(f'CSS rule missing during verification: {selector}')
    return m.group('body')

def require_prop(selector, prop, value):
    body = rule_body(selector)
    if not re.search(re.escape(prop) + r'\s*:\s*' + re.escape(value) + r'\s*;', body):
        raise SystemExit(f'final value verification failed: {selector} {prop}: {value}')

for prop, value in [('padding-top','10px'),('margin-bottom','5px')]:
    require_prop('.attendancePrintHeader', prop, value)
for prop, value in [('font-size','15px'),('line-height','1.05'),('font-weight','760')]:
    require_prop('.attendancePrintAcademy', prop, value)
for prop, value in [('margin-top','1px'),('font-size','31px'),('line-height','0.98')]:
    require_prop('.attendancePrintMonth', prop, value)

cell_match = re.search(r'\.attendancePrintTable th,\s*\n\s*\.attendancePrintTable td\s*\{(?P<body>.*?)\}', s, re.S)
if not cell_match:
    raise SystemExit('attendance table cell rule missing')
cell_body = cell_match.group('body')
for prop, value in [('border','0.5px solid #777777'),('height','23px'),('padding','0.5px 1.5px')]:
    if not re.search(re.escape(prop) + r'\s*:\s*' + re.escape(value) + r'\s*;', cell_body):
        raise SystemExit(f'attendance table final value verification failed: {prop}: {value}')

if s == original:
    raise SystemExit('No attendance consolidation fix needed')
path.write_text(s, encoding='utf-8')
print('attendance print final appearance values restored in consolidated base CSS')
