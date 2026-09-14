from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')
old = '<div aria-hidden="true" class="olliBootScreen" id="olliBootScreen" style="position:fixed;inset:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#fff;z-index:2147483000;">'
new = '<div aria-hidden="true" class="olliBootScreen" id="olliBootScreen">'
count = text.count(old)
if count != 1:
    raise SystemExit(f'Expected exactly one inline boot style, found {count}')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
