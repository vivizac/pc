import json
import re
import subprocess
from pathlib import Path

OLD = 'a0e9bb48f1fa3548029623fd1faf66cda5d03e62'
ROOT = Path('.')


def show(path):
    return subprocess.check_output(['git', 'show', f'{OLD}:{path}'], text=True)


# 분리 직전 초등 관찰노트 DOM
obs_ui = show('observation-editor-ui.js')
match = re.search(r'const blocks = (\{.*?\});\n  const html = blocks\[key\];', obs_ui, re.S)
if not match:
    raise SystemExit('old student memo UI block not found')
blocks = json.loads(match.group(1))
elementary_html = blocks['student-memo']

# 분리 직전 유치부 1분 피드백 DOM
kinder_ui = show('kinder-feedback-ui.js')
match = re.search(r'const html = ("(?:\\.|[^"\\])*");\n  script\.insertAdjacentHTML', kinder_ui, re.S)
if not match:
    raise SystemExit('old kinder feedback UI block not found')
kinder_html = json.loads(match.group(1))

# 당시 유치부 동작을 PC 전용 런타임으로 독립 복사
kinder_runtime = show('kinder-feedback.js')
(ROOT / 'pc-kinder-feedback.js').write_text(
    '/* PC 전용 1분 피드백 런타임. 분리 직전 PC 화면(a0e9bb48)의 동작을 독립 보존합니다. */\n' + kinder_runtime,
    encoding='utf-8'
)

# 현재 pc-attendance가 사용하는 mount/unmount API만 PC 전용 연결기로 유지
mount_js = f"""(function pcRecordEditorModule(global) {{
  'use strict';
  if (global.__OLLI_PC_RECORD_EDITOR_EXACT_V1__) return;
  global.__OLLI_PC_RECORD_EDITOR_EXACT_V1__ = true;

  const ELEMENTARY_HTML = {json.dumps(elementary_html, ensure_ascii=False)};
  const KINDER_HTML = {json.dumps(kinder_html, ensure_ascii=False)};
  const state = {{ host: null, screen: null, student: null, division: '' }};

  function restoreRecordRoomVisibility() {{
    const room = document.getElementById('recordRoomScreen');
    if (room) room.style.display = 'flex';
    if (state.screen) state.screen.style.display = 'flex';
  }}

  function saveDraft() {{
    try {{
      if (state.division === 'elementary' && typeof global.saveCurrentMemo === 'function') {{
        Promise.resolve(global.saveCurrentMemo({{ silent: true }})).catch(() => {{}});
      }} else if (state.division === 'kinder' && typeof global.saveKinderChatFeedbackDraft === 'function') {{
        global.saveKinderChatFeedbackDraft();
      }}
    }} catch (_) {{}}
  }}

  function unmount(options) {{
    const shouldSave = !options || options.save !== false;
    if (shouldSave) saveDraft();
    if (state.host) state.host.replaceChildren();
    state.host = null;
    state.screen = null;
    state.student = null;
    state.division = '';
    restoreRecordRoomVisibility();
  }}

  function mount(host, student) {{
    if (!host || !student) return false;
    const division = student.type === 'kinder' ? 'kinder' : 'elementary';
    const currentId = String(state.student && state.student.id || '');
    const nextId = String(student.id || '');
    if (state.host === host && state.screen && state.division === division && currentId === nextId) {{
      restoreRecordRoomVisibility();
      return true;
    }}

    unmount({{ save: true }});
    state.host = host;
    state.student = student;
    state.division = division;
    host.innerHTML = division === 'kinder' ? KINDER_HTML : ELEMENTARY_HTML;

    const screenId = division === 'kinder' ? 'kinderChatFeedbackScreen' : 'studentMemoScreen';
    state.screen = host.querySelector('#' + screenId);
    if (!state.screen) {{
      host.innerHTML = '<div class=\"pcAttendanceEditorUnavailable\">작성 화면을 불러오지 못했습니다.</div>';
      return false;
    }}
    state.screen.classList.add('pcAttendanceEmbeddedEditor');

    try {{
      if (division === 'elementary' && typeof global.openStudentMemoPageById === 'function') {{
        global.openStudentMemoPageById(student.id);
      }} else if (division === 'kinder' && typeof global.openKinderChatFeedbackPage === 'function') {{
        global.openKinderChatFeedbackPage();
        if (typeof global.selectKinderChatFeedbackStudentFromManage === 'function') {{
          global.selectKinderChatFeedbackStudentFromManage(student.id, null);
        }}
      }}
    }} catch (error) {{
      console.warn('PC 기록 작성화면 연결 실패:', error);
    }}

    restoreRecordRoomVisibility();
    return true;
  }}

  global.OlliPcRecordEditor = Object.freeze({{ mount, unmount, saveDraft }});
}})(window);
"""
(ROOT / 'pc-record-editor.js').write_text(mount_js, encoding='utf-8')

# 현재 observation-editor.css는 분리 직전과 동일하므로 중복 복사하지 않는다.
# 삭제됐던 유치부 CSS와 pc-attendance에서 제거된 PC 임베딩 보정만 PC 전용 CSS로 소유한다.
kinder_css = show('kinder-feedback.css')
old_pc_css = show('pc-attendance.css')
marker = '/* 기존 관찰노트/1분 피드백 화면을 복제하지 않고 카드 안에서 그대로 재사용합니다. */'
start = old_pc_css.find(marker)
if start < 0:
    raise SystemExit('old embedded editor css marker not found')
next_comment = old_pc_css.find('\n/*', start + len(marker))
embedded_css = old_pc_css[start:] if next_comment < 0 else old_pc_css[start:next_comment]
(ROOT / 'pc-record-editor.css').write_text(
    '/*\n'
    ' * PC 전용 관찰노트 / 1분 피드백 화면\n'
    ' * 시각 기준: a0e9bb48 (PC/폰 UI 분리 직전)\n'
    ' * 초등 기본 스타일은 기존 observation-editor.css 원본을 그대로 사용하며,\n'
    ' * 이 파일은 삭제됐던 유치부 원본 스타일과 PC 카드 임베딩 보정만 소유합니다.\n'
    ' */\n\n' + kinder_css + '\n\n' + embedded_css + '\n',
    encoding='utf-8'
)

# PC 전용 유치부 런타임을 mount 연결기보다 먼저 로드
index_path = ROOT / 'index.html'
index = index_path.read_text(encoding='utf-8')
index = index.replace('<script src="pc-kinder-feedback.js"></script>\n', '')
needle = '<script src="pc-record-editor.js"></script>'
if needle not in index:
    raise SystemExit('pc-record-editor script tag not found')
index = index.replace(needle, '<script src="pc-kinder-feedback.js"></script>\n' + needle, 1)
index_path.write_text(index, encoding='utf-8')
