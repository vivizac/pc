let olliStudentSyncInFlight = false;
let olliStudentSyncTimer = null;

function isOlliRecordRoomVisible() {
  const screen = document.getElementById('recordRoomScreen');
  if (!screen) return false;
  const style = window.getComputedStyle ? window.getComputedStyle(screen) : null;
  return screen.style.display !== 'none' && (!style || style.display !== 'none');
}

async function syncVisibleStudentListSilently() {
  if (olliStudentSyncInFlight || document.hidden || !isOlliRecordRoomVisible()) return;
  if (!['elementary', 'kinder', 'academy'].includes(currentRecordView)) return;
  olliStudentSyncInFlight = true;
  try {
    await loadStudentsFromSupabase();
    const searchValue = document.getElementById('searchName')?.value.trim() || '';
    if (currentRecordView === 'elementary') renderElementaryRecords(searchValue);
    else if (currentRecordView === 'kinder') renderKinderRecords(searchValue);
    else if (currentRecordView === 'academy') renderRecordAcademyManagementDashboard();
    } catch (err) {
    console.warn('학생 목록 백그라운드 동기화 보류:', err?.message || err);
  } finally {
    olliStudentSyncInFlight = false;
  }
}

function startOlliStudentBackgroundSync() {
  if (olliStudentSyncTimer) return;
  olliStudentSyncTimer = window.setInterval(syncVisibleStudentListSilently, 30000);
}

window.addEventListener('focus', () => {
  setTimeout(syncVisibleStudentListSilently, 0);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) setTimeout(syncVisibleStudentListSilently, 0);
});

