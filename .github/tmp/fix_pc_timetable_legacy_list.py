from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    if text.count(old) != 1:
        raise SystemExit(f'anchor count mismatch: {label}: {text.count(old)}')
    return text.replace(old, new, 1)

# 1) PC 시간표는 schedule 섹션 전용으로 고정하고 과거 list/mobile roster 경로 제거
path = Path('pc-timetable.js')
text = path.read_text(encoding='utf-8')
text = replace_once(text, "    view: 'list',", "    view: 'schedule',", 'state.view')

pattern = re.compile(r"    let tabs = document\.getElementById\('olliTtTabs'\);\n.*?(?=    let root = document\.getElementById\('olliTtRoot'\);)", re.S)
replacement = "    const legacyTabs = document.getElementById('olliTtTabs');\n    if (legacyTabs) legacyTabs.remove();\n"
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'ensureUi legacy tabs block mismatch: {count}')
text = replace_once(text, "    return { host, tabs, root };", "    return { host, root };", 'ensureUi return')

pattern = re.compile(r"  function setView\(view\) \{.*?\n  \}\n\n  function syncAttendanceActive\(\) \{.*?\n  \}\n\n  async function loadWeek\(\) \{", re.S)
replacement = '''  function setView() {
    state.view = 'schedule';
    const ui = ensureUi();
    if (!ui) return;
    const screen = document.getElementById('recordRoomScreen');
    if (screen) screen.classList.toggle('olliPcAttendanceScheduleView', state.active);
    ui.root.classList.toggle('show', state.active);

    if (!state.active) return;
    renderWorkspaceHeader();
    renderSidebar();
    if (state.pane === 'attendance') loadAttendanceRegister();
    else loadWeek();
  }

  function syncAttendanceActive() {
    const shell = document.getElementById('olliPcShell');
    const section = shell ? clean(shell.dataset.pcSection) : '';
    state.active = section === 'schedule';
    const ui = ensureUi();
    if (!ui) return;
    if (!state.active) {
      ui.root.classList.remove('show');
      const screen = document.getElementById('recordRoomScreen');
      if (screen) screen.classList.remove('olliPcAttendanceScheduleView');
      closeDialog();
      return;
    }
    setView();
  }

  async function loadWeek() {'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'setView/syncAttendanceActive block mismatch: {count}')

if "pcRenderAttendanceList" in text:
    raise SystemExit('legacy pcRenderAttendanceList call still exists in pc-timetable.js')
if "data-tt-view" in text:
    raise SystemExit('legacy data-tt-view tab still exists in pc-timetable.js')
path.write_text(text, encoding='utf-8')

# 2) 더 이상 존재하지 않는 명단/시간표 레거시 탭 CSS 삭제
path = Path('pc-timetable.css')
text = path.read_text(encoding='utf-8')
pattern = re.compile(r"/\* OLLI PC 사이드바 > 주간 시간표 모듈 \*/\n#recordRoomScreen \.olliTtTabs \{.*?(?=#recordRoomScreen \.olliTtRoot)", re.S)
replacement = "/* OLLI PC 사이드바 > 주간 시간표 모듈 */\n"
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'legacy timetable tab CSS mismatch: {count}')
path.write_text(text, encoding='utf-8')

# 3) PC 셸이 열려 있을 때 레거시 모바일 피드백 바텀시트가 직접 열리는 것을 차단
path = Path('olli-data-attendance-feedback.js')
text = path.read_text(encoding='utf-8')
old = "async function openAttendanceStudentFeedbackSheet(studentOrId) {\n  const student = typeof studentOrId === 'object' ? studentOrId : findStudentById(studentOrId);"
new = """async function openAttendanceStudentFeedbackSheet(studentOrId) {
  const pcShell = document.getElementById('olliPcShell');
  if (pcShell && pcShell.classList.contains('visible')) {
    const pcSection = String(pcShell.dataset.pcSection || '');
    if (pcSection === 'attendance' && window.OlliPcPersonalityRecords?.selectStudent) {
      return window.OlliPcPersonalityRecords.selectStudent(studentOrId);
    }
    if (pcSection === 'schedule') {
      if (typeof closeAttendanceStudentFeedbackSheet === 'function') closeAttendanceStudentFeedbackSheet();
      return;
    }
  }
  const student = typeof studentOrId === 'object' ? studentOrId : findStudentById(studentOrId);"""
text = replace_once(text, old, new, 'PC feedback sheet guard')
path.write_text(text, encoding='utf-8')

# 4) 시간표 섹션 진입 시 혹시 열려 있던 레거시 바텀시트도 닫음
path = Path('pc-shell.js')
text = path.read_text(encoding='utf-8')
old = """    if (section === SECTION.SCHEDULE) {
      const targetView = typeof currentObservationView !== 'undefined' && currentObservationView === 'kinder' ? 'kinder' : 'elementary';"""
new = """    if (section === SECTION.SCHEDULE) {
      try { if (typeof global.closeAttendanceStudentFeedbackSheet === 'function') global.closeAttendanceStudentFeedbackSheet(); } catch (_) {}
      const targetView = typeof currentObservationView !== 'undefined' && currentObservationView === 'kinder' ? 'kinder' : 'elementary';"""
text = replace_once(text, old, new, 'schedule bottom sheet cleanup')
path.write_text(text, encoding='utf-8')

print('PC_TIMETABLE_LEGACY_LIST_FIXED')
