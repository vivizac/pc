function getStudentModeEntries(records, mode) {
  if (mode === 'summary') return records.filter(r => String(r.source_table || '').toLowerCase() === 'summary_feedbacks');
  return records.filter(r => String(r.feedback_type || 'class').toLowerCase() === mode);
}
function buildStudentShareText(studentName, records, mode) {
  const label = getRecordModeLabel(mode);
  const entries = getStudentModeEntries(records, mode).sort((a, b) => (parseDateSafe(b.date)?.getTime() || 0) - (parseDateSafe(a.date)?.getTime() || 0)).map(item => `${item.date || ''}\n${item.content || ''}`);
  return `${studentName} ${label}\n\n${entries.join('\n')}`.trim();
}
function copyStudentFeedback(btn, studentName, encodedRecords) {
  const records = JSON.parse(decodeURIComponent(encodedRecords));
  const text = buildStudentShareText(studentName, records, currentRecordMode);
  cp(btn, text);
}
async function shareStudentFeedback(studentName, encodedRecords) {
  const records = JSON.parse(decodeURIComponent(encodedRecords));
  const text = buildStudentShareText(studentName, records, currentRecordMode);
  await shareText(text);
}

function setObservationButtonSide(view, animate = true) {
  const modeButton = document.getElementById('recordModeToggleBtn');
  if (!modeButton) return;
  const inner = modeButton.querySelector('.flipInner');
  const shouldFlip = view === 'kinder';

  if (!animate && inner) {
    inner.classList.add('noTransition');
    modeButton.classList.toggle('flipped', shouldFlip);
    void inner.offsetWidth;
    inner.classList.remove('noTransition');
    return;
  }

  modeButton.classList.toggle('flipped', shouldFlip);
}

function updateRecordHeaderUI() {
  // 출석부 요약 탭은 삭제되었습니다. 과거 값이 남아 있으면 현재 부서 화면으로 되돌립니다.
  if (currentRecordView === 'attendance') {
    currentRecordView = currentObservationView === 'kinder' ? 'kinder' : 'elementary';
  }
  try { window.currentRecordView = currentRecordView; } catch(err) {}
  const elementaryToggle = document.getElementById('recordElementaryToggle');
  const kinderToggle = document.getElementById('recordKinderToggle');
  if (elementaryToggle) elementaryToggle.classList.toggle('active', currentRecordView === 'elementary');
  if (kinderToggle) kinderToggle.classList.toggle('active', currentRecordView === 'kinder');

  const isObservationView = currentRecordView === 'elementary' || currentRecordView === 'kinder';
  const isAcademyManagementView = currentRecordView === 'academy';
  const screen = document.getElementById('recordRoomScreen');
  if (screen) screen.classList.toggle('record-academy-management-mode', isAcademyManagementView);
  if (typeof refreshOlliRoleBasedVisibilityUI === 'function') refreshOlliRoleBasedVisibilityUI();
  const academyManageBtn = document.getElementById('recordAcademyManageBtn');
  if (academyManageBtn) academyManageBtn.classList.toggle('active', isAcademyManagementView);
  const attendanceDashboardBtn = document.getElementById('recordAttendanceDashboardBtn');
  if (attendanceDashboardBtn) attendanceDashboardBtn.classList.toggle('active', isObservationView);
  const modeLabelRow = document.querySelector('#recordRoomScreen .recordModeLabelRow');
  if (modeLabelRow) modeLabelRow.style.display = isAcademyManagementView ? 'none' : '';
  const academyDashboard = document.getElementById('recordAcademyDashboard');
  if (academyDashboard) academyDashboard.classList.toggle('show', isAcademyManagementView);
  const recordList = document.getElementById('recordList');
  if (recordList) recordList.style.display = isAcademyManagementView ? 'none' : '';

  const addBtn = document.getElementById('studentAddBtn');
  if (addBtn) {
    if (isObservationView && !studentSelectionMode) addBtn.classList.add('show');
    else {
      addBtn.classList.remove('show');
      closeRecordAddMenu();
    }
  }

  const selectionControls = document.getElementById('recordSelectionControls');
  if (selectionControls) {
    if (isObservationView && studentSelectionMode) selectionControls.classList.add('show');
    else selectionControls.classList.remove('show');
  }
}


function restoreRecordSearchFocus() {
  const screen = document.getElementById('recordRoomScreen');
  const input = document.getElementById('searchName');
  if (!screen || !screen.classList.contains('record-search-open') || !input) return;
  try { input.focus({ preventScroll:true }); } catch(err) { input.focus(); }
  try { input.setSelectionRange(input.value.length, input.value.length); } catch(err) {}
  if (typeof window.setRecordKeyboardOffset === 'function') window.setRecordKeyboardOffset();
}

function handleRecordViewTogglePress(event, targetView) {
  const screen = document.getElementById('recordRoomScreen');
  if (screen && screen.classList.contains('record-search-open')) {
    if (event) event.preventDefault();
    window.__recordViewToggleHandledUntil = Date.now() + 500;
    toggleRecordViewMode(targetView);
    restoreRecordSearchFocus();
    setTimeout(restoreRecordSearchFocus, 60);
    return;
  }
  toggleRecordViewMode(targetView);
}

function handleRecordViewToggleClick(event, targetView) {
  if (Date.now() < (window.__recordViewToggleHandledUntil || 0)) {
    if (event) event.preventDefault();
    return;
  }
  toggleRecordViewMode(targetView);
}

async function toggleRecordViewMode(targetView) {
  studentSelectionMode = false;
  selectedStudentIds.clear();

  // 삭제된 출석부 요약 탭으로 들어오려는 호출은 현재 부서 화면으로 되돌립니다.
  if (targetView === 'attendance') {
    targetView = currentObservationView === 'kinder' ? 'kinder' : 'elementary';
  }

  const nextView = targetView === 'kinder'
    ? 'kinder'
    : (targetView === 'elementary' ? 'elementary' : (currentObservationView === 'elementary' ? 'kinder' : 'elementary'));
  if (nextView === 'elementary' || nextView === 'kinder') currentObservationView = nextView;
  currentRecordView = nextView;

  const screen = document.getElementById('recordRoomScreen');
  const input = document.getElementById('searchName');
  const pill = document.getElementById('recordSearchPill');
  const searchValue = input ? input.value.trim() : '';
  const keepSearchOpen = !!(screen && screen.classList.contains('record-search-open'));

  updateRecordHeaderUI();
  if (typeof window.refreshRecordSortPopup === 'function') setTimeout(window.refreshRecordSortPopup, 0);

  if (keepSearchOpen) {
    if (screen) {
      screen.classList.add('record-search-open');
      screen.classList.toggle('record-search-has-query', !!searchValue);
    }
    if (pill) pill.classList.add('active');

    const restoreSearchFocus = () => {
      if (!input) return;
      try { input.focus({ preventScroll:true }); } catch(err) { input.focus(); }
      try { input.setSelectionRange(input.value.length, input.value.length); } catch(err) {}
      if (typeof window.setRecordKeyboardOffset === 'function') window.setRecordKeyboardOffset();
    };

    restoreSearchFocus();
    await loadRecords(searchValue);
    restoreSearchFocus();
    setTimeout(restoreSearchFocus, 20);
    setTimeout(restoreSearchFocus, 120);
    setTimeout(restoreSearchFocus, 260);
  } else {
    await loadRecords('');
  }

  
}


async function toggleRecordMode() {
  studentSelectionMode = false;
  selectedStudentIds.clear();
  if (currentRecordView === 'elementary' || currentRecordView === 'kinder') {
    currentObservationView = currentRecordView;
    currentRecordView = 'saved';
    recordStorageRotation += 90;
    const switchIcon = document.querySelector('#recordStorageToggleBtn svg');
    if (switchIcon) switchIcon.style.transform = `rotate(${recordStorageRotation}deg)`;
    updateRecordHeaderUI();
    await loadRecords('');
    
    return;
  }

  const currentIndex = RECORD_MODE_ORDER.indexOf(currentRecordMode);
  currentRecordMode = RECORD_MODE_ORDER[(currentIndex + 1) % RECORD_MODE_ORDER.length];
  recordStorageRotation += 90;
  const modeIcon = document.querySelector('#recordStorageToggleBtn svg');
  if (modeIcon) modeIcon.style.transform = `rotate(${recordStorageRotation}deg)`;
  updateRecordHeaderUI();

  const screen = document.getElementById('recordRoomScreen');
  const input = document.getElementById('searchName');
  if (screen && screen.classList.contains('record-search-open')) {
    const name = input.value.trim();
    if (!name) {
      document.getElementById('recordList').innerHTML = '<div class="recordEmpty">학생 이름을 검색해 주세요.</div>';
      return;
    }
    await loadRecords(name);
    return;
  }
  await loadRecords('');
}

async function showRecordRoom() {
  setFeedbackPageBackgroundActive(false);
  const memo = document.getElementById('studentMemoScreen');
const card = document.getElementById('mainPageScreen');

  const memoVisible = memo && memo.style.display !== 'none';
const cardVisible = card && card.style.display !== 'none';

  previousScreenBeforeRecordRoom = memoVisible ? 'studentMemo' : (cardVisible ? 'mainPage' : 'recordRoom');

  const current = vivizacGetVisibleNotePage();
  const record = document.getElementById('recordRoomScreen');
  if (record) record.style.display = 'flex';

  const finishRecordOpen = async () => {
    if (memo) memo.style.display = 'none';
if (card) card.style.display = 'none';
    if (record) record.style.display = 'flex';

    const pill = document.getElementById('recordSearchPill');
    const input = document.getElementById('searchName');
    if (record) record.classList.remove('record-search-open');
    if (pill) pill.classList.remove('active');
    if (input) input.value = '';
    updateRecordHeaderUI();
    await loadRecords('');
    
  };

  if (current && current.id !== 'recordRoomScreen') {
    vivizacSlideOutPageToRecord(current, () => {
      finishRecordOpen();
    });
    return;
  }

  await finishRecordOpen();
}
function hideRecordRoom() {
  document.getElementById('studentMemoScreen').style.display = 'none';
  document.getElementById('recordRoomScreen').style.display = 'none';
  const card = document.getElementById('mainPageScreen');

  if (previousScreenBeforeRecordRoom === 'studentMemo' && currentMemoStudent) {
    if (card) card.style.display = 'none';
    const memo = document.getElementById('studentMemoScreen');
    if (memo) { memo.style.display = 'flex'; vivizacSlideInPage(memo); }
  } else {
    const record = document.getElementById('recordRoomScreen');
    if (record) record.style.display = 'flex';
  }
  
}
function toggleStudentBlock(el) {
  const block = el.closest('.recordStudentBlock');
  if (!block) return;
  block.classList.toggle('open');
}
