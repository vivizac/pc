from pathlib import Path
import re

path = Path('index.html')
s = path.read_text(encoding='utf-8')

pattern = re.compile(
    r"function addKinderChatDocumentMessage\(title, subtitle, bodyText = '', variant = '', photoMeta = null\) \{.*?\n\}\nfunction renderKinderChatFeedbackGuide\(key\) \{",
    re.S,
)

replacement = r'''function addKinderChatDocumentMessage(title, subtitle, bodyText = '', variant = '', photoMeta = null) {
  const area = document.getElementById('kcfChatArea');
  if (!area) return;
  const intro = document.getElementById('kcfCenterIntro');
  if (intro) intro.classList.add('hidden');

  const row = document.createElement('div');
  row.className = 'kcfMsgRow user';

  const card = document.createElement('div');
  card.className = `kcfDocumentCard ${variant === 'growth' ? 'growth' : ''}`.trim();

  const cleanTitle = String(title || '아이 이름').trim();
  const cleanSubtitle = String(subtitle || '1분 피드백').trim();

  const photoThumbUrl = photoMeta && photoMeta.thumbnailUrl ? String(photoMeta.thumbnailUrl) : '';
  const iconHtml = photoThumbUrl
    ? `<span class="kcfDocumentIcon hasPhoto" aria-hidden="true"><img class="kcfDocumentPhotoThumb" src="${escapeHtml(photoThumbUrl)}" alt=""></span>`
    : `<span class="kcfDocumentIcon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3.8h7.2L18 7.6V20a1.2 1.2 0 0 1-1.2 1.2H7.2A1.2 1.2 0 0 1 6 20V5a1.2 1.2 0 0 1 1-1.2z"></path><path d="M14 4v4h4"></path><path d="M9 12h6"></path><path d="M9 15h6"></path></svg></span>`;

  card.innerHTML = `${iconHtml}<span class="kcfDocumentText"><span class="kcfDocumentTitle">${escapeHtml(cleanTitle)}</span><span class="kcfDocumentSub">${escapeHtml(cleanSubtitle)}</span></span>`;

  row.appendChild(card);
  area.appendChild(row);
  requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });
}
function renderKinderChatFeedbackGuide(key) {'''

matches = list(pattern.finditer(s))
if len(matches) != 1:
    raise SystemExit(f'addKinderChatDocumentMessage 위치가 {len(matches)}개입니다. 안전을 위해 중단합니다.')

s = pattern.sub(replacement, s, count=1)

for stale in ['kcfSourceBody', 'kcfCopyText', '원문 보기', 'kcfDocumentCopyBtn']:
    if stale in s[s.find("function addKinderChatDocumentMessage"):s.find("function renderKinderChatFeedbackGuide")]:
        raise SystemExit(f'원문 표시 코드가 남아 있습니다: {stale}')

path.write_text(s, encoding='utf-8')
print('feedback source display removed; AI request data flow preserved')
