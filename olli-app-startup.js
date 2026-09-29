const OLLI_BOOT_MIN_DURATION = 1500;
const OLLI_BOOT_FADE_OUT_DURATION = 720;
let olliBootStartedAt = Date.now();

function showOlliBootScreen() {
  olliBootStartedAt = Date.now();
  const boot = document.getElementById('olliBootScreen');
  if (!boot) return;
  boot.style.display = 'flex';
  boot.classList.remove('hide');
}

function waitOlli(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms || 0)));
}

async function hideOlliBootScreen() {
  const boot = document.getElementById('olliBootScreen');
  if (!boot) return;

  const elapsed = Date.now() - olliBootStartedAt;
  const remain = OLLI_BOOT_MIN_DURATION - elapsed;
  if (remain > 0) await waitOlli(remain);

  boot.classList.add('hide');
  await waitOlli(OLLI_BOOT_FADE_OUT_DURATION);
  if (boot.classList.contains('hide')) {
    boot.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  showOlliBootScreen();
  let olliStartupAuthReady = false;
  try {
    hideOlliAppScreensForRoute();

    let accountRestore = null;
    if (typeof restoreOlliAccountSession === 'function') {
      accountRestore = await restoreOlliAccountSession({ silent: true, allowCachedFallback: false });
    }

    if (!accountRestore || accountRestore.restored !== true || accountRestore.authoritative !== true) {
      if (!(typeof applyOlliTeacherInviteFromUrl === 'function' && applyOlliTeacherInviteFromUrl())) {
        if (typeof showOlliLoginEntry === 'function') showOlliLoginEntry();
      }
      await hideOlliBootScreen();
      return;
    }

    if (typeof validateOlliCurrentMemberAccess !== 'function') {
      console.warn('PC 멤버십 검증 모듈을 찾지 못해 앱 진입을 차단합니다.');
      if (typeof showOlliLoginEntry === 'function') showOlliLoginEntry();
      await hideOlliBootScreen();
      return;
    }

    const access = await validateOlliCurrentMemberAccess({
      silent: true,
      sessionRestore: accountRestore,
      refresh: false
    });
    if (!access || access.valid !== true || access.authoritative !== true) {
      if (typeof showOlliLoginEntry === 'function') showOlliLoginEntry();
      await hideOlliBootScreen();
      return;
    }

    olliStartupAuthReady = true;

    migrateStudentStorageIfNeeded();
    initGroupChoiceIcons();
    purgeOldLocalMemos();
    await loadStudentsFromSupabase();
    startOlliStudentBackgroundSync();
    updateRecordHeaderUI();
    updateModeUI();
    renderSceneInput();
    bindStudentAddButton();
    bindModalCloseEvents();
    const yearInput = document.getElementById('studentYearBadge');
    if (yearInput) {
      const currentYear = String(getCurrentYear());
      yearInput.value = currentYear;
      yearInput.defaultValue = currentYear;
    }
    setupPillPressFeedback();
    

    window.addEventListener('beforeunload', flushMemoAutoSave);

    if (isOlliLoggedInForStartPage()) {
      if (typeof clearOlliTeacherInviteParamsFromUrl === 'function') clearOlliTeacherInviteParamsFromUrl();
      await enterOlliAfterLoginOrSetup();
    } else if (!(typeof applyOlliTeacherInviteFromUrl === 'function' && applyOlliTeacherInviteFromUrl())) {
      showOlliLoginEntry();
    }
    await hideOlliBootScreen();
  } catch (err) {
    console.error('startup init error:', err);
    if (olliStartupAuthReady && isOlliLoggedInForStartPage()) {
      await enterOlliByStartPage(getOlliDefaultStartPage() || 'attendance');
    } else if (!(typeof applyOlliTeacherInviteFromUrl === 'function' && applyOlliTeacherInviteFromUrl())) {
      showOlliLoginEntry();
    }
    await hideOlliBootScreen();
  }

  window.showRecordRoom = showRecordRoom;
  window.openRecordAttendanceDashboard = openRecordAttendanceDashboard;
  window.hideRecordRoom = hideRecordRoom;
  window.toggleRecordViewMode = toggleRecordViewMode;
  window.toggleRecordMode = toggleRecordMode;
  window.openStudentModal = openStudentModal;
  window.closeModalById = closeModalById;
  window.closeStudentModal = closeStudentModal;
  window.confirmStudent = confirmStudent;
  window.openStudentMemoPageById = openStudentMemoPageById;
  window.forceStudentMemoControlsVisible = forceStudentMemoControlsVisible;
  window.closeMemoPage = closeMemoPage;
  window.saveCurrentMemo = saveCurrentMemo;
  window.requestElementaryFeedback = requestElementaryFeedback;
window.toggleMemoModeMenu = toggleMemoModeMenu;
window.openMemoObservationMode = openMemoObservationMode;
  window.openMemoFailGrowthMode = openMemoFailGrowthMode;
  window.showOlliStartPageSetup = showOlliStartPageSetup;
  window.selectOlliStartPageAndEnter = selectOlliStartPageAndEnter;
  window.enterOlliByStartPage = enterOlliByStartPage;
  window.saveOlliDefaultStartPage = saveOlliDefaultStartPage;
  window.selectSettingsStartPageOption = selectSettingsStartPageOption;
  window.toggleSceneInputMode = toggleSceneInputMode;
  window.openSceneCardsFromAnyPage = openSceneCardsFromAnyPage;
  window.handleSceneCardBodyClick = handleSceneCardBodyClick;
  window.handleSceneNumberClick = handleSceneNumberClick;
  window.toggleSceneTag = toggleSceneTag;
  window.requestSceneCardFeedback = requestSceneCardFeedback;
  window.handleMemoHeaderAction = handleMemoHeaderAction;
  window.openElementaryAnalysisModal = openElementaryAnalysisModal;
  window.closeElementaryAnalysisModal = closeElementaryAnalysisModal;
  window.openElementaryAnalysisDetailModal = openElementaryAnalysisDetailModal;
  window.closeElementaryAnalysisDetailModal = closeElementaryAnalysisDetailModal;
  window.openElementaryAnalysisDetailFromCurrent = openElementaryAnalysisDetailFromCurrent;
  
window.applyElementaryAnalysisToMemo = applyElementaryAnalysisToMemo;
  window.toggleElementaryAnalysisValue = toggleElementaryAnalysisValue;
  window.toggleElementaryTendencyValue = toggleElementaryTendencyValue;
  window.toggleElementaryTendencyGroup = toggleElementaryTendencyGroup;
  window.applyFailSurveyToInput = applyFailSurveyToInput;
  window.selectFailSurveySingle = selectFailSurveySingle;
  window.toggleFailSurveyMulti = toggleFailSurveyMulti;

  window.closeSaveModal = closeSaveModal;
  window.confirmSave = confirmSave;
  window.openSaveModal = openSaveModal;
  window.cp = cp;
  window.copyStudentFeedback = copyStudentFeedback;
  window.shareStudentFeedback = shareStudentFeedback;
  window.requestSummaryFeedbackFromRecords = requestSummaryFeedbackFromRecords;
  window.toggleStudentBlock = toggleStudentBlock;
  window.openCurrentStudentInfoModal = openCurrentStudentInfoModal;
  window.openElementaryInfoModal = openElementaryInfoModal;
  window.closeElementaryInfoModal = closeElementaryInfoModal;
  window.saveElementaryInfo = saveElementaryInfo;
  window.selectElementaryGroup = selectElementaryGroup;
  window.selectElementaryPersonality = selectElementaryPersonality;
  window.openKinderInfoModal = openKinderInfoModal;
  window.closeKinderInfoModal = closeKinderInfoModal;
  window.saveKinderInfo = saveKinderInfo;
  window.startStudentLongPress = startStudentLongPress;
  window.moveStudentLongPress = moveStudentLongPress;
  window.cancelStudentLongPress = cancelStudentLongPress;
  window.handleStudentRowClick = handleStudentRowClick;
  window.openAttendanceStudentFeedbackSheet = openAttendanceStudentFeedbackSheet;
  window.closeAttendanceStudentFeedbackSheet = closeAttendanceStudentFeedbackSheet;
  window.toggleAttendanceFeedbackSheetCard = toggleAttendanceFeedbackSheetCard;
  window.closeStudentActionMenu = closeStudentActionMenu;
  window.confirmDeleteSelectedStudent = confirmDeleteSelectedStudent;
  window.enterStudentSelectionMode = enterStudentSelectionMode;
  window.setSelectedStudentStatus = setSelectedStudentStatus;
  window.deleteSelectedStudents = deleteSelectedStudents;
  window.exitStudentSelectionMode = exitStudentSelectionMode;
  window.openMoreMenuPlaceholder = openMoreMenuPlaceholder;
});

window.addEventListener('pageshow', () => {
  try {  } catch (err) { console.warn('notification sync skipped:', err); }
});
window.addEventListener('storage', (event) => {
  if (event.key === STUDENTS_KEY || event.key === RISK_NOTIFICATIONS_KEY) {
    try {  } catch (err) { console.warn('notification sync skipped:', err); }
  }
});

document.addEventListener('input', function(event) {
  if (event.target && event.target.id === 'sceneMemoInput') {
    updateSceneMemoPlaceholder();
  }
});
document.addEventListener('DOMContentLoaded', function() {
  updateSceneMemoPlaceholder();
});


