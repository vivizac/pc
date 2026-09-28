from pathlib import Path

path = Path('index.html')
s = path.read_text(encoding='utf-8')

css_tag = '<link rel="stylesheet" href="consultation-survey.css">'
js_tag = '<script src="consultation-survey.js"></script>'

if css_tag not in s:
    s = s.replace('</head>', css_tag + '\n</head>', 1)

old_label = '<svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7"></path><path d="M6.5 10v10h11V10"></path><path d="M10 20v-6h4v6"></path></svg><span>학원 관리</span>'
new_label = '<svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7"></path><path d="M6.5 10v10h11V10"></path><path d="M10 20v-6h4v6"></path></svg><span>학생관리</span>'
if old_label in s:
    s = s.replace(old_label, new_label, 1)

feedback_block = '''    <button class="olliPcNavBtn" data-pc-nav="feedback" type="button" onclick="pcOpenSection('feedback')">
      <svg viewBox="0 0 24 24"><path d="M5 19l2.2-.5L18.5 7.2a2 2 0 0 0-2.8-2.8L4.5 15.7 4 19z"></path><path d="M13.8 6.3l3.9 3.9"></path></svg><span>1분 피드백</span>
    </button>'''
consultation_block = feedback_block + '''
    <button class="olliPcNavBtn" data-pc-nav="consultation" type="button" onclick="pcOpenSection('consultation')">
      <svg viewBox="0 0 24 24"><path d="M6 4.5h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-4.5 3v-3H6a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z"></path><path d="M8 9h8M8 13h5"></path></svg><span>상담 설문</span>
    </button>'''
if 'data-pc-nav="consultation"' not in s:
    if feedback_block not in s:
        raise SystemExit('1분 피드백 사이드바 위치를 찾지 못했습니다.')
    s = s.replace(feedback_block, consultation_block, 1)

if js_tag not in s:
    end_marker = '</body></html>'
    idx = s.rfind(end_marker)
    if idx >= 0:
        s = s[:idx] + js_tag + '\n' + s[idx:]
    else:
        body_idx = s.rfind('</body>')
        if body_idx < 0:
            raise SystemExit('body 닫힘 위치를 찾지 못했습니다.')
        s = s[:body_idx] + js_tag + '\n' + s[body_idx:]

path.write_text(s, encoding='utf-8')
print('consultation survey patch applied')
