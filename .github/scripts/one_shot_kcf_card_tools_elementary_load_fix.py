from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    return text.replace(old, new, 1)


# 1) 1분 피드백: 구형 상단바 전체 제거, 장면카드/보관함만 카드 내부 도구로 유지
p = 'kinder-feedback-ui.js'
text = read(p)
start = '<div class=\\"kcfHeader\\">'
end = '<div aria-hidden=\\"true\\" class=\\"kcfTopFadeLayer\\" id=\\"kcfTopFadeLayer\\"></div>\\n'
a = text.find(start)
b = text.find(end, a)
if a < 0 or b < 0:
    raise SystemExit('kinder feedback header block not found')
b += len(end)
card_tools = (
    '<div aria-label=\\"1분 피드백 도구\\" class=\\"kcfCardTools\\">\\n'
    '<button aria-label=\\"장면카드\\" class=\\"kcfCardToolBtn kcfSceneCardBtn\\" onclick=\\"openSceneCardsFromAnyPage()\\" title=\\"장면카드\\" type=\\"button\\">\\n'
    '<svg aria-hidden=\\"true\\" viewbox=\\"0 0 24 24\\"><rect x=\\"4.5\\" y=\\"5\\" width=\\"7\\" height=\\"7\\" rx=\\"1.4\\"></rect><rect x=\\"12.5\\" y=\\"5\\" width=\\"7\\" height=\\"7\\" rx=\\"1.4\\"></rect><rect x=\\"4.5\\" y=\\"13\\" width=\\"7\\" height=\\"6\\" rx=\\"1.4\\"></rect><rect x=\\"12.5\\" y=\\"13\\" width=\\"7\\" height=\\"6\\" rx=\\"1.4\\"></rect></svg>\\n'
    '</button>\\n'
    '<button aria-label=\\"임시 보관함\\" class=\\"kcfCardToolBtn kcfInboxBtn\\" onclick=\\"openKinderChatFeedbackInbox()\\" title=\\"임시 보관함\\" type=\\"button\\">\\n'
    '<svg aria-hidden=\\"true\\" viewbox=\\"0 0 24 24\\">\\n'
    '<path d=\\"M8.2 5.4h7.6\\"></path>\\n'
    '<path d=\\"M7.2 8.2h9.6\\"></path>\\n'
    '<rect height=\\"8.2\\" rx=\\"1.9\\" width=\\"12.8\\" x=\\"5.6\\" y=\\"10.4\\"></rect>\\n'
    '<path d=\\"M10 14.4h4\\"></path>\\n'
    '</svg>\\n'
    '<span class=\\"kcfInboxBadge\\" id=\\"kcfInboxBadge\\"></span>\\n'
    '</button>\\n'
    '</div>\\n'
)
text = text[:a] + card_tools + text[b:]
write(p, text)


# 2) 1분 피드백 CSS: 상단바/모드토글 전용 스타일 삭제, 카드 우상단 도구 스타일 추가
p = 'kinder-feedback.css'
text = read(p)
a = text.find('#kinderChatFeedbackScreen .kcfTopFadeLayer{')
b = text.find('#kinderChatFeedbackScreen .kcfInner::after', a)
if a < 0 or b < 0:
    raise SystemExit('kcf top fade block not found')
text = text[:a] + text[b:]
a = text.find('/* 상단바 */')
b = text.find('/* 대화 영역 */', a)
if a < 0 or b < 0:
    raise SystemExit('kcf topbar css block not found')
tools_css = '''/* 1분 피드백 카드 우상단 도구 */
#kinderChatFeedbackScreen .kcfCardTools{
  position:absolute;
  top:14px;
  right:14px;
  display:flex;
  align-items:center;
  gap:8px;
  z-index:80;
  pointer-events:auto;
}
#kinderChatFeedbackScreen .kcfCardToolBtn{
  position:relative;
  width:38px;
  height:38px;
  border:1px solid #e5e8ec;
  border-radius:12px;
  background:#fff;
  color:#555b63;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:0;
  cursor:pointer;
  box-shadow:0 4px 12px rgba(15,23,42,.06);
  -webkit-tap-highlight-color:transparent;
}
#kinderChatFeedbackScreen .kcfCardToolBtn:hover{
  background:#f8fafc;
  color:#111;
}
#kinderChatFeedbackScreen .kcfCardToolBtn svg{
  stroke:currentColor;
  fill:none;
  stroke-linecap:round;
  stroke-linejoin:round;
}
#kinderChatFeedbackScreen .kcfSceneCardBtn svg{
  width:21px;
  height:21px;
  stroke-width:1.7;
}
#kinderChatFeedbackScreen .kcfInboxBtn svg{
  width:25px;
  height:25px;
  stroke-width:1.55;
}
#kinderChatFeedbackScreen .kcfInboxBadge{
  display:none;
  position:absolute;
  top:-5px;
  right:-5px;
  width:18px;
  min-width:18px;
  height:18px;
  padding:0;
  border-radius:50%;
  background:#EB5757;
  color:#fff;
  font-size:calc(10px * var(--olli-text-scale));
  font-weight:800;
  line-height:1;
  border:2px solid #fff;
  text-align:center;
  align-items:center;
  justify-content:center;
  box-sizing:content-box;
}
#kinderChatFeedbackScreen .kcfInboxBadge.show{display:flex;}

'''
text = text[:a] + tools_css + text[b:]
text = replace_once(text, '  padding:112px 16px 176px;', '  padding:64px 16px 176px;', 'kcf chat top padding')
write(p, text)


# 3) 1분 피드백 JS: 삭제된 상단바 모드메뉴 전용 동작 제거
p = 'kinder-feedback.js'
text = read(p)
a = text.find('function toggleKinderChatFeedbackModeMenu(event) {')
b = text.find('function openKinderChatFeedbackPage() {', a)
if a < 0 or b < 0:
    raise SystemExit('kcf mode menu function block not found')
text = text[:a] + text[b:]
text = replace_once(
    text,
    "  document.addEventListener('click', event => {\n    if (!event.target.closest || !event.target.closest('.kcfHeaderCenter')) closeKinderChatFeedbackModeMenu();\n  });\n",
    '',
    'kcf mode menu outside click'
)
for line in [
    'window.toggleKinderChatFeedbackModeMenu = toggleKinderChatFeedbackModeMenu;\n',
    'window.switchKinderChatFeedbackMode = switchKinderChatFeedbackMode;\n',
    'window.closeKinderChatFeedbackModeMenu = closeKinderChatFeedbackModeMenu;\n',
]:
    if line not in text:
        raise SystemExit(f'missing export: {line.strip()}')
    text = text.replace(line, '', 1)
write(p, text)


# 4) PC 카드 레이아웃: 초등 구형 헤더는 숨기고 실제 에디터를 카드 첫 화면에 배치
p = 'pc-attendance.css'
text = read(p)
old = '''body.olliPcApp #recordRoomScreen .pcAttendanceSharedEditorHost>#studentMemoScreen .memoHeader,
body.olliPcApp #recordRoomScreen .pcAttendanceSharedEditorHost>#studentMemoScreen .memoTopFadeLayer,
body.olliPcApp #recordRoomScreen .pcAttendanceSharedEditorHost>#studentMemoScreen .memoEditorWrap{
  display:flex!important;flex-direction:column!important;width:100%!important;height:auto!important;min-height:100%!important;margin:0!important;padding:0 14px 18px!important;background:#fff!important;box-sizing:border-box!important;overflow:visible!important;
}'''
new = '''body.olliPcApp #recordRoomScreen .pcAttendanceSharedEditorHost>#studentMemoScreen .memoHeader,
body.olliPcApp #recordRoomScreen .pcAttendanceSharedEditorHost>#studentMemoScreen .memoTopFadeLayer{
  display:none!important;
}
body.olliPcApp #recordRoomScreen .pcAttendanceSharedEditorHost>#studentMemoScreen .memoEditorWrap{
  display:flex!important;flex-direction:column!important;width:100%!important;height:auto!important;min-height:100%!important;margin:0!important;padding:0 14px 18px!important;background:#fff!important;box-sizing:border-box!important;overflow:visible!important;
}'''
text = replace_once(text, old, new, 'embedded elementary header layout')
old = '''body.olliPcApp #recordRoomScreen .pcAttendanceSharedEditorHost>#kinderChatFeedbackScreen .kcfInner::after,
body.olliPcApp #recordRoomScreen .pcAttendanceSharedEditorHost>#kinderChatFeedbackScreen .kcfHeader,
body.olliPcApp #recordRoomScreen .pcAttendanceSharedEditorHost>#kinderChatFeedbackScreen .kcfTopFadeLayer{display:none!important;content:none!important;}'''
new = '''body.olliPcApp #recordRoomScreen .pcAttendanceSharedEditorHost>#kinderChatFeedbackScreen .kcfInner::after{display:none!important;content:none!important;}
body.olliPcApp #recordRoomScreen .pcAttendanceSharedEditorHost>#kinderChatFeedbackScreen .kcfCardTools{
  top:14px!important;right:14px!important;z-index:40!important;
}'''
text = replace_once(text, old, new, 'embedded kcf old header hide')
text = replace_once(text, '  flex:1!important;min-height:0!important;padding:18px 14px 190px!important;overflow-y:auto!important;background:#fff!important;', '  flex:1!important;min-height:0!important;padding:64px 14px 190px!important;overflow-y:auto!important;background:#fff!important;', 'embedded kcf tool clearance')
write(p, text)


# 5) 초등 관찰기록: 보관함 삭제 때 함께 사라진 날짜 포맷터를 독립 헬퍼로 복구
p = 'olli-record-editor-core.js'
text = read(p)
needle = "function updateMemoStudentMetaDisplay(student, updatedAt = '') {"
if needle not in text:
    raise SystemExit('updateMemoStudentMetaDisplay not found')
helper = '''function formatMemoUpdatedDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${d} ${hh}:${mm}`;
}
'''
text = text.replace(needle, helper + needle, 1)
text = replace_once(text, '    const dateText = formatMemoFeedbackArchiveDate(dateSource || \'\');', '    const dateText = formatMemoUpdatedDate(dateSource || \'\');', 'memo updated date formatter call')
write(p, text)


# 6) index에 남은 구형 KCF 상단바 전용 보정 코드 제거
p = 'index.html'
text = read(p)
old = '''body[data-olli-text-size="large"] #kinderChatFeedbackScreen .kcfModeTitle {
  font-size: calc(20px * var(--olli-text-scale));
}
'''
text = replace_once(text, old, '', 'large text kcf mode title')
text = replace_once(
    text,
    'body[data-olli-text-size="large"] #kinderChatFeedbackScreen .kcfModeSub,\nbody[data-olli-text-size="large"] #kinderChatFeedbackScreen .kcfModeOptionGuide,\nbody[data-olli-text-size="large"] #kinderChatFeedbackScreen .kcfPhotoMetaText,',
    'body[data-olli-text-size="large"] #kinderChatFeedbackScreen .kcfPhotoMetaText,',
    'large text kcf mode sub/guide'
)
text = replace_once(text, 'body[data-olli-text-size="large"] #kinderChatFeedbackScreen .kcfModeOptionTitle,\n', '', 'large text kcf mode option title')
patch = '''      document.querySelectorAll('.kcfModeOptionTitle').forEach(function(el){
        if (el.textContent.trim() === '1분 피드백(유치부)') el.textContent = '1분 피드백';
      });
      document.querySelectorAll('.kcfModeOptionGuide').forEach(function(el){
        if (el.textContent.trim() === '일상 관찰을 빠르게 정리') el.textContent = '유치부·초등부 관찰을 빠르게 정리';
      });
'''
text = replace_once(text, patch, '', 'legacy kcf mode text patch')
old_selector = '#studentMemoScreen #memoRecordRoomBtn.memoRecordRoomBtn:not(.memoRecordBtn) svg,\n#kinderChatFeedbackScreen .kcfRecordBtn svg {'
if text.count(old_selector) != 2:
    raise SystemExit(f'kcf back icon selector: expected 2 matches, got {text.count(old_selector)}')
text = text.replace(old_selector, '#studentMemoScreen #memoRecordRoomBtn.memoRecordRoomBtn:not(.memoRecordBtn) svg {')
write(p, text)


# 7) 문서 정책 동기화
p = 'OLLI_PC_MODULES.md'
text = read(p)
old = '- 1분 피드백 상단의 `장면카드` 버튼은 기존 장면카드 모달을 검토하기 위한 진입점이다. 장면카드 유지 여부가 확정될 때까지 관련 장면카드 엔진은 삭제하지 않는다.'
new = '- PC 1분 피드백의 별도 상단바·뒤로가기·모드 토글 UI는 제거했다. 카드 오른쪽 상단에는 검토용 `장면카드`와 작성 흐름에 필요한 `임시 보관함` 두 도구만 유지한다. 장면카드 유지 여부가 확정될 때까지 관련 장면카드 엔진은 삭제하지 않는다.'
text = replace_once(text, old, new, 'module doc KCF tools policy')
text = text.replace('`observation-editor.css`: 초등 관찰기록 상단바, 하단 버튼, 학생 선택/보관함 등 에디터 UI 스타일.', '`observation-editor.css`: 초등 관찰기록 상단바, 하단 버튼, 학생 선택 등 에디터 UI 스타일.')
write(p, text)

print('one-shot fix applied')
