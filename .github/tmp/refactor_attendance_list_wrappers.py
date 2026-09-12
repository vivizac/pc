from pathlib import Path

# 1) Canonical student-row renderers own attendance-guide metadata rendering.
p = Path("olli-record-list-view.js")
text = p.read_text()
marker = "function renderElementaryStudentRows(students) {\n"
if text.count(marker) != 1:
    raise SystemExit(f"renderElementaryStudentRows marker mismatch: {text.count(marker)}")
helper = '''function getRecordAttendanceGuideHtml(student) {
  try {
    if (typeof window.isRecordAttendanceGuideModeActive !== 'function' || !window.isRecordAttendanceGuideModeActive()) return null;
    if (typeof window.getOlliAttendancePolicyCounts !== 'function') return null;
    const counts = window.getOlliAttendancePolicyCounts(student);
    if (!counts) return null;
    return `<span class="recordAttendanceGuideMeta">
      <span class="recordAttendanceMetric recordAttendanceYearMetric"><b>${Number(counts.year) || new Date().getFullYear()}년</b></span>
      <span class="recordAttendanceMetric">결석 <b>${Number(counts.yearAbsence) || 0}회</b></span>
      <span class="recordAttendanceMetric">보강 <b>${Number(counts.yearMakeup) || 0}회</b></span>
      <span class="recordAttendanceMetric">남은 보강 <b>${Number(counts.remainingMakeup) || 0}회</b></span>
    </span>`;
  } catch(err) {
    return null;
  }
}

'''
text = text.replace(marker, helper + marker, 1)

old = "    const metaBits = getElementaryMetaBits(student);\n    const metaText = metaBits.join('\\u00A0\\u00A0|\\u00A0\\u00A0');\n"
new = "    const metaBits = getElementaryMetaBits(student);\n    const metaText = metaBits.join('\\u00A0\\u00A0|\\u00A0\\u00A0');\n    const attendanceGuideHtml = getRecordAttendanceGuideHtml(student);\n    const metaHtml = attendanceGuideHtml !== null\n      ? attendanceGuideHtml\n      : (metaText ? escapeHtml(metaText) : '');\n"
if text.count(old) != 1:
    raise SystemExit(f"elementary meta block mismatch: {text.count(old)}")
text = text.replace(old, new, 1)

old = "          ${metaText ? `<span class=\"studentMetaText\">${escapeHtml(metaText)}</span>` : ''}\n"
new = "          ${metaHtml ? `<span class=\"studentMetaText\">${metaHtml}</span>` : ''}\n"
if text.count(old) != 1:
    raise SystemExit(f"elementary render mismatch: {text.count(old)}")
text = text.replace(old, new, 1)

old = "    const metaBits = getKinderMetaBits(student);\n    const sectionKey = (typeof getRecordSortSectionKey === 'function') ? getRecordSortSectionKey(student, 'kinder') : `status:${getStudentStatus(student)}:${student.age || ''}`;\n"
new = "    const metaBits = getKinderMetaBits(student);\n    const attendanceGuideHtml = getRecordAttendanceGuideHtml(student);\n    const normalMetaText = metaBits.join('\\u00A0\\u00A0|\\u00A0\\u00A0');\n    const metaHtml = attendanceGuideHtml !== null\n      ? attendanceGuideHtml\n      : (normalMetaText ? escapeHtml(normalMetaText) : '');\n    const sectionKey = (typeof getRecordSortSectionKey === 'function') ? getRecordSortSectionKey(student, 'kinder') : `status:${getStudentStatus(student)}:${student.age || ''}`;\n"
if text.count(old) != 1:
    raise SystemExit(f"kinder meta block mismatch: {text.count(old)}")
text = text.replace(old, new, 1)

old = "          ${metaBits.length ? `<span class=\"studentMetaText\">${escapeHtml(metaBits.join('\\u00A0\\u00A0|\\u00A0\\u00A0'))}</span>` : ''}\n"
new = "          ${metaHtml ? `<span class=\"studentMetaText\">${metaHtml}</span>` : ''}\n"
if text.count(old) != 1:
    raise SystemExit(f"kinder render mismatch: {text.count(old)}")
text = text.replace(old, new, 1)
p.write_text(text)

# 2) Attendance policy retains calculations but stops overriding row renderers.
p = Path("olli-attendance-policy-runtime.js")
text = p.read_text()
start = text.find("  function safeTemplate(value){")
end_marker = "  window.shouldCountRecordAttendanceDate = countablePastDate;"
end = text.find(end_marker)
if start < 0 or end < 0 or end <= start:
    raise SystemExit("attendance policy renderer wrapper block not found")
p.write_text(text[:start] + text[end:])

# 3) Inline attendance-guide patch owns only state/button lifecycle.
p = Path("index.html")
text = p.read_text()
start = text.find('<script id="olliRecordAttendanceGuideButtonPatch">')
end = text.find("</script>", start)
if start < 0 or end < 0:
    raise SystemExit("attendance guide script not found")
end += len("</script>")
replacement = '''<script id="olliRecordAttendanceGuideButtonPatch">
/* 2026-09-13: 출결 가이드 상태/버튼만 관리합니다. 학생 행 렌더링은 olli-record-list-view.js가 소유합니다. */
(function(){
  var attendanceGuideMode = false;

  function refreshCurrentStudentRows(){
    var searchValue = document.getElementById('searchName')?.value.trim() || '';
    try {
      if ((currentRecordView === 'kinder' || currentRecordView === 'elementary') && typeof window.renderCurrentStudentRecords === 'function') window.renderCurrentStudentRecords(searchValue);
      else if (typeof window.loadRecords === 'function') window.loadRecords(searchValue);
    } catch(e) {}
  }
  function updateGuideButton(){
    var btn = document.getElementById('recordAttendanceGuideToggle');
    if (!btn) return;
    btn.classList.toggle('active', attendanceGuideMode);
    btn.setAttribute('aria-pressed', attendanceGuideMode ? 'true' : 'false');
    btn.title = attendanceGuideMode ? '출결 가이드 끄기' : '출결 가이드 보기';
  }
  function installGuideButton(){
    var row = document.querySelector('#recordRoomScreen .recordModeLabelRow');
    if (!row || document.getElementById('recordAttendanceGuideToggle')) {
      updateGuideButton();
      return;
    }
    var btn = document.createElement('button');
    btn.id = 'recordAttendanceGuideToggle';
    btn.className = 'recordAttendanceGuideBtn';
    btn.type = 'button';
    btn.textContent = '출결';
    btn.setAttribute('aria-label', '출결 가이드 보기');
    btn.onclick = window.toggleRecordAttendanceGuideMode;
    row.appendChild(btn);
    updateGuideButton();
  }

  window.isRecordAttendanceGuideModeActive = function(){ return attendanceGuideMode; };
  window.olliEnsureRecordAttendanceGuideButton = installGuideButton;
  window.toggleRecordAttendanceGuideMode = function(event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    attendanceGuideMode = !attendanceGuideMode;
    updateGuideButton();
    refreshCurrentStudentRows();
    if (typeof window.scheduleRecordAttendanceGuideButtonAlign === 'function') window.scheduleRecordAttendanceGuideButtonAlign();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installGuideButton);
  } else {
    installGuideButton();
  }
})();
</script>'''
text = text[:start] + replacement + text[end:]

old = '''  var oldUpdateRecordHeaderUI = window.updateRecordHeaderUI;
  if (typeof oldUpdateRecordHeaderUI === 'function' && !oldUpdateRecordHeaderUI.__olliAttendanceAlignWrapped) {
    var wrappedUpdate = function(){
      var result = oldUpdateRecordHeaderUI.apply(this, arguments);
      scheduleAlign();
      return result;
    };
    wrappedUpdate.__olliAttendanceAlignWrapped = true;
    window.updateRecordHeaderUI = wrappedUpdate;
    try { updateRecordHeaderUI = window.updateRecordHeaderUI; } catch (_) {}
  }

  var oldToggleRecordAttendanceGuideMode = window.toggleRecordAttendanceGuideMode;
  if (typeof oldToggleRecordAttendanceGuideMode === 'function' && !oldToggleRecordAttendanceGuideMode.__olliAttendanceAlignWrapped) {
    var wrappedToggle = function(){
      var result = oldToggleRecordAttendanceGuideMode.apply(this, arguments);
      scheduleAlign();
      return result;
    };
    wrappedToggle.__olliAttendanceAlignWrapped = true;
    window.toggleRecordAttendanceGuideMode = wrappedToggle;
  }

'''
if text.count(old) != 1:
    raise SystemExit(f"alignment wrapper block mismatch: {text.count(old)}")
text = text.replace(old, "", 1)
p.write_text(text)

# 4) Canonical header explicitly invokes the guide-button hooks.
p = Path("olli-record-room-navigation.js")
text = p.read_text()
old = '''  const selectionControls = document.getElementById('recordSelectionControls');
  if (selectionControls) {
    if (isObservationView && studentSelectionMode) selectionControls.classList.add('show');
    else selectionControls.classList.remove('show');
  }
}
'''
new = '''  const selectionControls = document.getElementById('recordSelectionControls');
  if (selectionControls) {
    if (isObservationView && studentSelectionMode) selectionControls.classList.add('show');
    else selectionControls.classList.remove('show');
  }

  if (typeof window.olliEnsureRecordAttendanceGuideButton === 'function') {
    setTimeout(window.olliEnsureRecordAttendanceGuideButton, 0);
  }
  if (typeof window.scheduleRecordAttendanceGuideButtonAlign === 'function') {
    window.scheduleRecordAttendanceGuideButtonAlign();
  }
}
'''
if text.count(old) != 1:
    raise SystemExit(f"updateRecordHeaderUI tail mismatch: {text.count(old)}")
p.write_text(text.replace(old, new, 1))

# Remove temporary ownership audit now that the refactor is applied.
audit = Path("TMP_ATTENDANCE_WRAPPER_TARGETS.txt")
if audit.exists():
    audit.unlink()
