from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')

old = """    if (nextSection !== pcSection) pcSetChrome(nextSection);\n    else {\n      const shell = document.getElementById('olliPcShell');\n      const topbar = document.getElementById('olliPcTopbar');\n      shell?.classList.add('visible');\n      topbar?.classList.add('visible');\n"""
new = """    if (nextSection !== pcSection) pcSetChrome(nextSection);\n    else {\n      const shell = document.getElementById('olliPcShell');\n      const topbar = document.getElementById('olliPcTopbar');\n      shell?.classList.add('visible');\n      topbar?.classList.add('visible');\n      // 첫 화면이 이미 학원관리여도 오른쪽 상담 학생 패널 레이아웃을 즉시 적용합니다.\n      pcUpdateRecordLayout();\n"""

if new in text:
    print('index.html already patched')
    raise SystemExit(0)

count = text.count(old)
if count != 1:
    raise RuntimeError(f'Expected exactly one PC initial sync target, found {count}')

path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Patched PC academy initial detail panel layout')
