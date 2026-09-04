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


# 1) Remove the elementary-only archive UI and archive browsing logic.
p = 'olli-record-editor-core.js'
text = read(p)
lines = text.splitlines(keepends=True)
if len(lines) != 2676:
    raise SystemExit(f'unexpected editor core line count: {len(lines)}')
# Original lines 476-759 are the elementary feedback archive sheet and historical memo readers.
text = ''.join(lines[:475] + lines[759:])
old = """document.addEventListener('click', (event) => {
  const archiveBtn = document.getElementById('memoRecordsBtn');
  const archiveSheet = document.querySelector('#elementaryRecordsDropup .memoFeedbackArchiveSheet');
  closeMemoStudentSelectPopupFromOutsideAction(event);
  if (archiveBtn && archiveSheet && !archiveBtn.contains(event.target) && !archiveSheet.contains(event.target)) closeElementaryRecordsMenu();
});"""
new = """document.addEventListener('click', (event) => {
  closeMemoStudentSelectPopupFromOutsideAction(event);
});"""
text = replace_once(text, old, new, 'archive outside click')
text = text.replace('  closeElementaryRecordsMenu();\n', '')

# The old completion dot was backed by the local archive cache. Remove it with the archive.
a = text.find('function isMemoStudentFeedbackDateInCurrentMonth(value) {')
b = text.find('function renderMemoStudentMonthDivider(label) {', a)
if a < 0 or b < 0:
    raise SystemExit('feedback archive status block not found')
text = text[:a] + text[b:]
text = replace_once(
    text,
    "    const dot = !manageMode ? renderMemoStudentFeedbackStatusDot(student) : '';\n    const textBlock = `${dot}<span class=\"memoStudentSelectName\">${escapeHtml(student.name || '이름 없음')}</span>${meta ? `<span class=\"memoStudentSelectMeta\">${escapeHtml(meta)}</span>` : ''}`;",
    "    const textBlock = `<span class=\"memoStudentSelectName\">${escapeHtml(student.name || '이름 없음')}</span>${meta ? `<span class=\"memoStudentSelectMeta\">${escapeHtml(meta)}</span>` : ''}`;",
    'picker archive dot',
)

# Saving a generated elementary feedback now clears the draft and relies on the server record only.
a = text.find('function resetElementaryMemoAfterFeedbackSave(')
b = text.find('function getCurrentMemoStudentName()', a)
if a < 0 or b < 0:
    raise SystemExit('reset feedback block not found')
reset_fn = """function resetElementaryMemoAfterFeedbackSave() {
  if (!currentMemoStudent || currentMemoType !== 'elementary') return;
  clearStudentNoteDraftFromSupabase(currentMemoStudent, 'elementary_observation').catch(err => console.warn('노트 초안 삭제 실패:', err.message || err));
  clearMemoByStudent(currentMemoStudent);
  currentMemoStudent = { ...currentMemoStudent, memoUpdatedAt: '' };
  updateMemoStudentMetaDisplay(currentMemoStudent, '');
  clearElementaryAnalysisByStudent(currentMemoStudent);
  elementaryAnalysisDraft = getEmptyElementaryAnalysisState();
  selectedElementaryAnalysisHistoryId = '';
  const memo = document.getElementById('memoEditor');
  if (memo) {
    memo.readOnly = false;
    memo.value = '';
  }
  renderElementaryAnalysisSummaryCard(getEmptyElementaryAnalysisState(), { title: '분석 결과', createdAt: '' });
  renderElementaryAnalysisHistoryCards(currentMemoStudent);
  setMemoSaveStatus('자동 저장');
  if (typeof refreshMemoStudentSelectPopupIfOpen === 'function') refreshMemoStudentSelectPopupIfOpen();
}

"""
text = text[:a] + reset_fn + text[b:]

# The popup save path now writes to the server record directly, with no optimistic archive copy.
a = text.find('async function autoSaveMemoFeedback(')
b = text.find('function closeMemoFeedbackPopup()', a)
if a < 0 or b < 0:
    raise SystemExit('auto save feedback block not found')
auto_fn = """async function autoSaveMemoFeedback(text, futureDirection = '') {
  const name = getCurrentMemoStudentName();
  const content = String(text || '').trim();
  if (!name) { alert('학생 이름을 찾지 못했어요.'); return; }
  if (!content) { alert('저장할 피드백 내용이 비어 있어요.'); return; }

  let targetStudent = currentMemoStudent && currentMemoStudent.id && currentMemoStudent.type === 'elementary' ? currentMemoStudent : null;
  if (!targetStudent) {
    const matches = getAllStudents().filter(student =>
      (student.type || 'elementary') === 'elementary' &&
      String(student.name || '').trim() === String(name || '').trim()
    );
    if (matches.length === 1) targetStudent = matches[0];
    else if (matches.length > 1) {
      alert('같은 이름의 학생이 여러 명 있습니다. 학생 목록에서 해당 학생을 다시 선택해 주세요.');
      return;
    }
  }
  if (!targetStudent) {
    alert('피드백을 저장할 학생 정보를 찾지 못했어요.');
    return;
  }

  const year = new Date().getFullYear();
  const date = new Date().toLocaleDateString('ko-KR');
  try {
    const payload = addOlliAcademyToPayload({
      student_id: targetStudent.id,
      student_name: targetStudent.name || name,
      content,
      feedback_type: 'class',
      future_direction: futureDirection || null,
      year,
      date
    }, '초등부 관찰 피드백 저장');
    await saveFeedbackRowVerified('feedbacks', payload, '초등부 관찰 피드백 저장');
    if (typeof refreshRecordsAfterFeedbackSave === 'function') await refreshRecordsAfterFeedbackSave();
    else if (typeof loadRecords === 'function') await loadRecords('');
    if (currentMemoStudent && String(currentMemoStudent.id || '') === String(targetStudent.id || '')) resetElementaryMemoAfterFeedbackSave();
    closeMemoFeedbackPopup();
    showPushToast('피드백을 기록실에 저장했어요.');
  } catch (err) {
    console.error('초등부 관찰 피드백 저장 오류:', err);
    closeMemoFeedbackPopup();
    alert(`피드백 저장 중 오류가 발생했어요.\n\n${err.message || '알 수 없는 오류입니다.'}`);
  }
}

"""
text = text[:a] + auto_fn + text[b:]

# Direct AI save path: keep feedback persistence, remove archive persistence/opening.
a = text.find('async function saveElementaryFeedbackDirectlyToArchive(')
b = text.find('async function requestSceneCardFeedbackFromElementary(', a)
if a < 0 or b < 0:
    raise SystemExit('direct archive save block not found')
direct_fn = """async function saveElementaryFeedbackDirectly(text, options = {}) {
  const content = String(text || '').trim();
  if (!content) throw new Error('저장할 피드백 내용이 비어 있습니다.');
  const studentName = normalizeTodayFeedbackStudentName(options.studentName || currentMemoStudent?.name || '');
  if (!studentName) throw new Error('아이 이름을 찾지 못했습니다.');
  const selectedStudentId = options.studentId || currentMemoStudent?.id || '';
  const savedStudent = await getOrCreateStudentForSupabaseSave(studentName, 'elementary', selectedStudentId);
  const rawType = options.feedbackType || 'class';
  const tableName = getFeedbackTableNameByType(rawType);
  const feedbackType = tableName === 'fail_feedbacks' ? 'fail' : String(rawType || 'class').toLowerCase();
  const now = new Date();
  const payload = addOlliAcademyToPayload({
    student_id: savedStudent.id,
    student_name: savedStudent.name || studentName,
    content,
    feedback_type: feedbackType,
    year: now.getFullYear(),
    date: now.toLocaleDateString('ko-KR')
  }, tableName === 'fail_feedbacks' ? '초등부 성장 피드백 저장' : '초등부 피드백 저장');
  const savedRow = await saveFeedbackRowVerified(tableName, payload, tableName === 'fail_feedbacks' ? '초등부 성장 피드백 저장' : '초등부 피드백 저장');
  await refreshRecordsAfterFeedbackSave();
  if (tableName === 'feedbacks' && currentMemoStudent && String(currentMemoStudent.id || '') === String(savedStudent.id || '')) resetElementaryMemoAfterFeedbackSave();
  if (tableName === 'fail_feedbacks' && typeof resetGrowthFeedbackAfterSuccessfulSave === 'function') resetGrowthFeedbackAfterSuccessfulSave('elementary');
  return { student: savedStudent, row: savedRow, tableName };
}

"""
text = text[:a] + direct_fn + text[b:]
text = text.replace('    const saved = await saveElementaryFeedbackDirectlyToArchive(cleanText, {', '    await saveElementaryFeedbackDirectly(cleanText, {')
text = text.replace('    await openElementaryArchiveAfterDirectSave(saved.student);\n', '')
text = text.replace('    showPushToast(`${studentName} 피드백을 보관함에 저장했어요.`);', '    showPushToast(`${studentName} 피드백을 기록실에 저장했어요.`);')

# Remove student_note_archives writer.
a = text.find('async function saveStudentNoteArchiveToSupabase(')
b = text.find('function openStudentModal()', a)
if a < 0 or b < 0:
    raise SystemExit('student note archive function not found')
text = text[:a] + text[b:]
write(p, text)

# 2) Elementary analysis: delete historical observation records and feedback archive cache.
p = 'elementary-analysis.js'
text = read(p)
text = text.replace("function getElementaryRecordsKey(student) { return student?.id ? ELEMENTARY_RECORDS_PREFIX + student.id : ''; }\n", '')
a = text.find('function getElementaryMemoRecords(student) {')
b = text.find('function getElementaryAnalysisHistoryKey(student) {', a)
if a < 0 or b < 0:
    raise SystemExit('elementary archive cache block not found')
text = text[:a] + text[b:]
text = text.replace("function formatElementaryRecordLabel(record) { const y = record?.year || getCurrentYear(); const m = record?.month || (new Date().getMonth() + 1); return `${y}년 ${m}월 기록`; }\n", '')
archive_line = "function archiveCurrentElementaryMemoRecord(student, content, analysis) { if (!student?.id || !String(content || '').trim()) return; const now = new Date(); const record = { id: `elem_record_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(), label: `${now.getFullYear()}년 ${now.getMonth() + 1}월 기록`, content, analysis: normalizeElementaryAnalysisState(analysis), createdAt: now.toISOString() }; const records = getElementaryMemoRecords(student); records.unshift(record); setElementaryMemoRecords(student, records); saveStudentNoteArchiveToSupabase(student, record).catch(err => console.warn('노트기록 Supabase 저장 실패:', err.message || err)); return record; }\n"
if archive_line not in text:
    raise SystemExit('archiveCurrentElementaryMemoRecord line not found')
text = text.replace(archive_line, '')
old = """  if (viewingArchivedElementaryRecord) {
    alert('과거 수업 기록은 읽기 전용입니다. 현재 기록을 선택한 뒤 분석을 추가해 주세요.');
    return;
  }
"""
if old not in text:
    raise SystemExit('analysis archived guard not found')
text = text.replace(old, '', 1)
old = """  if (viewingArchivedElementaryRecord) {
    const record = getElementaryMemoRecords(currentMemoStudent).find(item => item.id === viewingArchivedElementaryRecord);
    if (record?.analysis) {
      openElementaryAnalysisDetailModal(record.analysis, { title: '분석 결과', createdAt: record.createdAt || '' });
    }
    return;
  }
"""
if old not in text:
    raise SystemExit('analysis detail archive branch not found')
text = text.replace(old, '', 1)
write(p, text)

# 3) Memo runtime: remove historical-record guards and archive calls.
p = 'observation-memo-core.js'
text = read(p)
text = text.replace("    '#memoRecordsBtn',\n", '')
text = text.replace("    '#studentMemoScreen .memoHeaderActions',\n", '')
text = text.replace('  closeElementaryRecordsMenu();\n', '')
text = text.replace('  viewingArchivedElementaryRecord = false;\n', '')
text = text.replace("  if (currentMemoType === 'elementary' && viewingArchivedElementaryRecord) return;\n", '')
text = text.replace("  if (inputType === 'elementary' && viewingArchivedElementaryRecord) return;\n", '')
text = text.replace('    if (viewingArchivedElementaryRecord) return;\n', '')
text = text.replace("  if (viewingArchivedElementaryRecord) { alert('과거 수업 기록은 읽기 전용입니다. 현재 기록을 선택한 뒤 피드백을 요청해 주세요.'); return; }\n", '')
text = text.replace('  archiveCurrentElementaryMemoRecord(currentMemoStudent, text, analysisData);\n', '')
write(p, text)

# 4) Shared state and student local backup no longer know about elementary archives.
p = 'olli-data-foundation.js'
text = read(p)
text = text.replace("const ELEMENTARY_RECORDS_PREFIX = 'olli_elementary_records_';\n", '')
text = text.replace("const MEMO_FEEDBACK_ARCHIVE_PREFIX = 'olli_memo_feedback_archive_';\n", '')
text = text.replace('    elementary_records: ELEMENTARY_RECORDS_PREFIX + id,\n', '')
text = text.replace('    memo_feedback_archive: MEMO_FEEDBACK_ARCHIVE_PREFIX + id\n', '')
text = text.replace('let viewingArchivedElementaryRecord = false;\n', '')
write(p, text)

# 5) Feedback sheet already reads Supabase directly; remove local archive mirror deletion.
p = 'olli-data-attendance-feedback.js'
text = read(p)
a = text.find('function removeAttendanceFeedbackItemFromLocalArchive(')
b = text.find('async function performAttendanceFeedbackSheetItemDelete(', a)
if a < 0 or b < 0:
    raise SystemExit('local archive delete helper not found')
text = text[:a] + text[b:]
text = text.replace("    if (kind !== 'summary') removeAttendanceFeedbackItemFromLocalArchive(student, item);\n", '')
write(p, text)

# 6) Remove the now-unused student_note_archive storage feature.
p = 'olli-storage-core.js'
text = read(p)
a = text.find("  FeatureRegistry.register({\n    feature: 'student_note_archive',")
b = text.find("  FeatureRegistry.register({\n    feature: 'member_default_start_page',", a)
if a < 0 or b < 0:
    raise SystemExit('storage archive feature block not found')
text = text[:a] + text[b:]
write(p, text)

p = 'olli-settings-import-test-tools.js'
text = read(p)
text = text.replace('    ELEMENTARY_RECORDS_PREFIX + id,\n', '')
text = text.replace('    MEMO_FEEDBACK_ARCHIVE_PREFIX + id\n', '')
old = """        key.startsWith(ELEMENTARY_MEMO_PREFIX) ||
        key.startsWith(ELEMENTARY_ANALYSIS_PREFIX) ||
        key.startsWith(ELEMENTARY_RECORDS_PREFIX) ||
        key.startsWith(KINDER_MEMO_PREFIX) ||
        key.startsWith(MEMO_FEEDBACK_ARCHIVE_PREFIX)
"""
new = """        key.startsWith(ELEMENTARY_MEMO_PREFIX) ||
        key.startsWith(ELEMENTARY_ANALYSIS_PREFIX) ||
        key.startsWith(KINDER_MEMO_PREFIX)
"""
text = replace_once(text, old, new, 'test reset archive keys')
text = text.replace("  const tables = ['student_note_drafts', 'student_note_archives'];", "  const tables = ['student_note_drafts'];")
write(p, text)

# 7) Remove archive button/dropup from elementary editor DOM.
p = 'observation-editor-ui.js'
text = read(p)
start = '\\n<div class=\\"memoHeaderActions\\">\\n<button aria-label=\\"피드백 보관함\\"'
a = text.find(start)
if a < 0:
    raise SystemExit('memo archive header action start not found')
end = '\\n</button>\\n</div>'
b = text.find(end, a)
if b < 0:
    raise SystemExit('memo archive header action end not found')
text = text[:a] + text[b + len(end):]
drop = '\\n<div aria-label=\\"피드백 보관함\\" class=\\"memoRecordsDropup\\" id=\\"elementaryRecordsDropup\\"></div>'
if drop not in text:
    raise SystemExit('memo archive dropup DOM not found')
text = text.replace(drop, '', 1)
write(p, text)

# 8) Remove all elementary archive CSS and old visibility patches.
p = 'index.html'
text = read(p)
a = text.find('.memoRecordsDropup {')
b = text.find('.attendanceFeedbackSheetOverlay {', a)
if a < 0 or b < 0:
    raise SystemExit('archive CSS block not found')
text = text[:a] + text[b:]
text = text.replace('  .analysisResultSheetPanel,\n  .memoFeedbackArchiveSheet {', '  .analysisResultSheetPanel {')
for line in [
    'body[data-olli-text-size="large"] .memoFeedbackArchiveText,\n',
    'body[data-olli-text-size="large"] .memoFeedbackArchiveFullText,\n',
    'body[data-olli-text-size="large"] .memoFeedbackArchiveEditArea,\n',
    'body[data-olli-text-size="large"] .memoFeedbackArchiveActionBtn,\n',
    'body[data-olli-text-size="large"] .memoFeedbackArchiveDate,\n',
    'body[data-olli-text-size="large"] .memoFeedbackArchiveTitle,\n',
    'body[data-olli-text-size="large"] .memoFeedbackArchiveSubtitle,\n',
]:
    text = text.replace(line, '')
text = text.replace(
    'body[data-olli-text-size="large"] .attendanceFeedbackSheetCardDate,\nbody[data-olli-text-size="large"] .memoFeedbackArchiveDate {',
    'body[data-olli-text-size="large"] .attendanceFeedbackSheetCardDate {'
)
text = text.replace(
    'body[data-olli-text-size="large"] #kcfInboxOverlay .kcfInboxActionBtn,\nbody[data-olli-text-size="large"] .memoFeedbackArchiveActionBtn {',
    'body[data-olli-text-size="large"] #kcfInboxOverlay .kcfInboxActionBtn {'
)
text = text.replace("      'memoRecordsBtn',\n", '')
text = text.replace("    ['.memoHeaderActions', '.memoBottomBar', '#memoModeWrap'].forEach(function(sel){", "    ['.memoBottomBar', '#memoModeWrap'].forEach(function(sel){")
text = text.replace("    '.memoFeedbackArchiveSheet', '.attendanceFeedbackSheetPanel',", "    '.attendanceFeedbackSheetPanel',")
write(p, text)

p = 'observation-editor.css'
text = read(p)
old = """#studentMemoScreen .memoRecordRoomBtn.memoRecordBtn {
  position: relative;
  top: auto;
  right: auto;
  transform: none;
  z-index: 951;
}
#studentMemoScreen #memoRecordsBtn {
  display: inline-flex;
  visibility: visible;
  opacity: 1;
  pointer-events: auto;
}
"""
text = replace_once(text, old, '', 'observation archive CSS')
text = text.replace('#studentMemoScreen .memoRecordRoomBtn:not(.memoRecordBtn) {', '#studentMemoScreen .memoRecordRoomBtn {')
text = text.replace('#studentMemoScreen .memoRecordRoomBtn:not(.memoRecordBtn) svg {', '#studentMemoScreen .memoRecordRoomBtn svg {')
write(p, text)

p = 'pc-attendance.css'
text = read(p)
text = '\n'.join(line for line in text.split('\n') if 'memoRecordsDropup' not in line)
write(p, text)

# Remove the optional dependency on the deleted archive editor helper.
p = 'olli-feedback-runtime.js'
text = read(p)
text = text.replace("  if (typeof getMemoFeedbackArchiveEditFeature === 'function') return getMemoFeedbackArchiveEditFeature(tableName);\n", '')
write(p, text)

# 9) Add a scene-card button beside the 1-minute feedback inbox.
p = 'kinder-feedback-ui.js'
text = read(p)
marker = '\\n<button aria-label=\\"임시 보관함\\" class=\\"kcfRoundBtn kcfInboxBtn\\"'
if text.count(marker) != 1:
    raise SystemExit(f'inbox marker count {text.count(marker)}')
scene = '\\n<button aria-label=\\"장면카드\\" class=\\"kcfRoundBtn kcfSceneCardBtn\\" onclick=\\"openSceneCardsFromAnyPage()\\" title=\\"장면카드\\" type=\\"button\\">\\n<svg aria-hidden=\\"true\\" viewbox=\\"0 0 24 24\\"><rect x=\\"4.5\\" y=\\"5\\" width=\\"7\\" height=\\"7\\" rx=\\"1.4\\"></rect><rect x=\\"12.5\\" y=\\"5\\" width=\\"7\\" height=\\"7\\" rx=\\"1.4\\"></rect><rect x=\\"4.5\\" y=\\"13\\" width=\\"7\\" height=\\"6\\" rx=\\"1.4\\"></rect><rect x=\\"12.5\\" y=\\"13\\" width=\\"7\\" height=\\"6\\" rx=\\"1.4\\"></rect></svg>\\n</button>'
text = text.replace(marker, scene + marker, 1)
write(p, text)

p = 'kinder-feedback.css'
text = read(p)
marker = "#kinderChatFeedbackScreen .kcfInboxBtn{\n  right:16px;\n}\n"
text = replace_once(text, marker, marker + "#kinderChatFeedbackScreen .kcfSceneCardBtn{\n  right:68px;\n}\n", 'scene card button position')
marker = "#kinderChatFeedbackScreen .kcfInboxBtn svg {\n  width:34px;\n  height:34px;\n  stroke-width:1.55;\n}\n"
text = replace_once(text, marker, marker + "#kinderChatFeedbackScreen .kcfSceneCardBtn svg {\n  width:24px;\n  height:24px;\n  stroke-width:1.6;\n}\n", 'scene card icon style')
write(p, text)

p = 'olli-app-startup.js'
text = read(p)
text = replace_once(text, '  window.toggleSceneInputMode = toggleSceneInputMode;\n', '  window.toggleSceneInputMode = toggleSceneInputMode;\n  window.openSceneCardsFromAnyPage = openSceneCardsFromAnyPage;\n', 'scene card export')
text = text.replace('  window.openCurrentElementaryMemoRecord = openCurrentElementaryMemoRecord;\n', '')
text = text.replace('  window.openArchivedElementaryMemoRecord = openArchivedElementaryMemoRecord;\n', '')
write(p, text)

# 10) Update module guide.
p = 'OLLI_PC_MODULES.md'
text = read(p)
text = text.replace('| 초등 관찰기록 저장·자동저장·보관함·피드백 연결 | `observation-memo-core.js` | `observation-editor.css` |', '| 초등 관찰기록 저장·자동저장·피드백 연결 | `observation-memo-core.js` | `observation-editor.css` |')
text = text.replace('- `observation-memo-core.js`: 학생 전환, 메모 자동저장, Supabase 동기화, 보관함, 피드백 생성 연결.', '- `observation-memo-core.js`: 학생 전환, 메모 자동저장, Supabase 동기화, 피드백 생성 연결.')
heading = '## 관찰기록·피드백 모듈 경계\n'
note = """## 초등부 PC 보관함 정책

- PC 초등부 관찰기록에서는 별도 피드백 보관함과 과거 관찰노트 보관 기능을 사용하지 않는다. 생성된 피드백은 서버 기록실/성향기록부에서 확인한다.
- `student_note_archives` 저장 기능과 초등 보관함 버튼·드롭업·편집 UI는 PC 런타임에서 제거했다.
- 유치부 1분 피드백의 `임시 보관함`은 현재 작성 흐름에 필요한 별도 기능이므로 유지한다.
- 1분 피드백 상단의 `장면카드` 버튼은 기존 장면카드 모달을 검토하기 위한 진입점이다. 장면카드 유지 여부가 확정될 때까지 관련 장면카드 엔진은 삭제하지 않는다.

"""
if note not in text:
    if heading not in text:
        raise SystemExit('doc observation heading not found')
    text = text.replace(heading, note + heading, 1)
write(p, text)
