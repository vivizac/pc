/* Mobile 상담 데이터 경로: PC와 동일한 상담 회차 계산 + 서버 저장.
   상담 상태는 academy_settings의 RPC 단일 원본, 모바일 local mirror는 읽기 캐시. */
let olliConsultationProgressRefreshPromise = null;
let olliConsultationProgressLastRefreshAt = 0;
function normalizeOlliConsultationProgress(value){
  let raw = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch(e) { raw = {}; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  const completedRaw = raw.completed && typeof raw.completed === 'object' && !Array.isArray(raw.completed)
    ? raw.completed
    : {};
  const completed = {};
  Object.keys(completedRaw).forEach(key => {
    const item = completedRaw[key];
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      completed[key] = {
        completed_at: String(item.completed_at || item.completedAt || ''),
        completed_month: String(item.completed_month || item.completedMonth || '')
      };
    } else if (item) {
      completed[key] = { completed_at: '', completed_month: '' };
    }
  });
  const todosRaw = Array.isArray(raw.todos) ? raw.todos : [];
  const todos = todosRaw.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const text = String(item.text || '').trim().slice(0, 80);
    if (!text) return null;
    return {
      id: String(item.id || `todo_legacy_${index}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80),
      text,
      completed: !!item.completed,
      created_at: String(item.created_at || item.createdAt || ''),
      completed_at: String(item.completed_at || item.completedAt || '')
    };
  }).filter(Boolean).slice(0, 100);
  return {
    version: 1,
    tracking_started_month: String(raw.tracking_started_month || raw.trackingStartedMonth || ''),
    completed,
    todos
  };
}

function getOlliConsultationProgressMirrorKey(academyId){
  const safeAcademyId = String(academyId || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '_');
  return `olli_consultation_progress_mirror_v1_${safeAcademyId || 'unknown'}`;
}

function readOlliConsultationProgressMirror(academyId){
  if (!academyId) return normalizeOlliConsultationProgress({});
  try {
    const raw = localStorage.getItem(getOlliConsultationProgressMirrorKey(academyId));
    return normalizeOlliConsultationProgress(raw ? JSON.parse(raw) : {});
  } catch(e) {
    return normalizeOlliConsultationProgress({});
  }
}

function writeOlliConsultationProgressMirror(academyId, progress){
  const normalized = normalizeOlliConsultationProgress(progress);
  if (!academyId) return normalized;
  try {
    localStorage.setItem(getOlliConsultationProgressMirrorKey(academyId), JSON.stringify(normalized));
  } catch(e) {}
  return normalized;
}

function hasOlliConsultationProgressData(progress){
  if (!progress || typeof progress !== 'object') return false;
  if (String(progress.tracking_started_month || '').trim()) return true;
  return !!(progress.completed && typeof progress.completed === 'object' && Object.keys(progress.completed).length);
}

function getOlliConsultationProgress(){
  const academyId = ensureOlliConsultationContext();
  if (!academyId) return normalizeOlliConsultationProgress({});

  // 학원관리 화면은 Supabase 응답을 기다리지 않고 로컬 미러를 먼저 사용할 수 있습니다.
  const mirror = readOlliConsultationProgressMirror(academyId);
  if (typeof readOlliLocal !== 'function') return mirror;

  try {
    const storageProgress = normalizeOlliConsultationProgress(
      readOlliLocal(OLLI_CONSULTATION_PROGRESS_FEATURE, { academyId }, { fallback: {} })
    );
    if (hasOlliConsultationProgressData(storageProgress)) {
      writeOlliConsultationProgressMirror(academyId, storageProgress);
      return storageProgress;
    }
  } catch(e) {}
  return mirror;
}

function writeOlliConsultationProgressLocal(progress, syncStatus = 'pending'){
  const academyId = ensureOlliConsultationContext();
  const normalized = normalizeOlliConsultationProgress(progress);
  if (!academyId) return normalized;

  // 화면 재진입 시 서버 조회 전에도 상담 완료 상태를 즉시 복원하기 위한 동기 로컬 미러입니다.
  writeOlliConsultationProgressMirror(academyId, normalized);

  if (typeof writeOlliLocal === 'function') {
    writeOlliLocal(
      OLLI_CONSULTATION_PROGRESS_FEATURE,
      { academyId },
      normalized,
      { syncStatus, lastSyncedAt: syncStatus === 'synced' ? new Date().toISOString() : null, retryCount: 0 }
    );
  }
  return normalized;
}

function ensureOlliConsultationProgressTrackingStart(progress){
  const normalized = normalizeOlliConsultationProgress(progress);
  if (!normalized.tracking_started_month) {
    normalized.tracking_started_month = getAcademyConsultationMonthKey();
  }
  return normalized;
}

async function saveOlliConsultationProgressShared(progress){
  const normalized = normalizeOlliConsultationProgress(progress);
  if (!window.OlliConsultationServer) throw new Error('상담 공통 서버가 준비되지 않았습니다.');
  // 완료 상태는 반드시 setCompleted로 키별 저장합니다. 전체 스냅샷으로 덮어쓰지 않습니다.
  const serverValue = await window.OlliConsultationServer.setTodos(normalized.todos || []);
  writeOlliConsultationProgressLocal(serverValue, 'synced');
  if (typeof currentRecordView !== 'undefined' && currentRecordView === 'academy') {
    if (document.body?.classList?.contains('olliPcApp') && typeof window.pcRefreshAcademyConsultationCompletionState === 'function') {
      window.pcRefreshAcademyConsultationCompletionState();
    } else if (typeof renderRecordAcademyManagementDashboard === 'function') renderRecordAcademyManagementDashboard();
  }
  return normalizeOlliConsultationProgress(serverValue);
}

async function loadOlliConsultationProgressFromServer(options = {}){
  const academyId = ensureOlliConsultationContext();
  if (!academyId || !window.OlliConsultationServer) return false;
  if (olliConsultationProgressRefreshPromise) return olliConsultationProgressRefreshPromise;
  olliConsultationProgressRefreshPromise = (async () => {
    const previous = JSON.stringify(getOlliConsultationProgress());
    const latest = await window.OlliConsultationServer.readProgress();
    writeOlliConsultationProgressLocal(normalizeOlliConsultationProgress(latest), 'synced');
    const changed = previous !== JSON.stringify(getOlliConsultationProgress());
    if (changed && currentRecordView === 'academy') {
      if (document.body?.classList?.contains('olliPcApp') && typeof window.pcRefreshAcademyConsultationCompletionState === 'function') {
        window.pcRefreshAcademyConsultationCompletionState();
      } else if (typeof renderRecordAcademyManagementDashboard === 'function') renderRecordAcademyManagementDashboard();
    }
    return changed;
  })().catch(err => {
    console.warn('상담 상태 서버 확인 실패:',err);
    if (typeof showPushToast === 'function') showPushToast('상담완료 서버 동기화에 실패했습니다. 새로고침하여 다시 확인해 주세요.');
    return false;
  }).finally(() => { olliConsultationProgressRefreshPromise = null; });
  return olliConsultationProgressRefreshPromise;
}


async function loadOlliConsultationRulesFromServer() {
  const academyId=ensureOlliConsultationContext();
  if(!academyId||!window.OlliConsultationServer)return false;
  try {
    const rules=await window.OlliConsultationServer.readRules();
    if(typeof writeOlliLocal==='function')writeOlliLocal('consultation_rules',{academyId},
      normalizeOlliConsultationRulesByType(rules),
      {syncStatus:'synced',lastSyncedAt:new Date().toISOString(),retryCount:0});
    return true;
  }catch(err){console.warn('모바일 상담 기준 서버 조회 실패:',err);return false;}
}

function isCurrentMonthYear(date){
  if (!(date instanceof Date) || isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function isCurrentYearDate(date){
  if (!(date instanceof Date) || isNaN(date.getTime())) return false;
  return date.getFullYear() === new Date().getFullYear();
}

function addMonthsSafe(date, months){
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

function getStudentEnrollmentDateForStats(student){
  const raw = typeof getEnrolledAtFromStudent === 'function' ? getEnrolledAtFromStudent(student) : (student?.enrolled_at || student?.enrollment_date || student?.registered_at);
  if (!raw) return null;
  const date = new Date(String(raw).replace(/\./g, '-'));
  return isNaN(date.getTime()) ? null : date;
}

function getStudentWithdrawalDateForStats(student){
  const raw = student?.withdrawn_at || student?.withdrawal_at || student?.quit_at || student?.status_changed_at || student?.inactive_at || student?.deleted_at || student?.updated_at || '';
  if (!raw) return null;
  const date = new Date(String(raw).replace(/\./g, '-'));
  return isNaN(date.getTime()) ? null : date;
}

function getAcademyManagementStudentsForStats(){
  try {
    const academyId = getOlliCurrentAcademyId ? getOlliCurrentAcademyId() : '';
    const pendingStatusMap = (typeof getPendingStudentStatusMap === 'function') ? getPendingStudentStatusMap() : {};
    return getAllStudents()
      .filter(item => {
        const rawType = String(item?.type || item?.division || '').trim();
        return rawType === 'elementary' || rawType === 'kinder';
      })
      .map(item => {
        const student = normalizeStudentObject({ ...item, academy_id: item?.academy_id || academyId }, item?.type || item?.division);
        const pendingState = pendingStatusMap[String(student.id || '')] || null;
        if (pendingState) {
          return normalizeStudentObject({
            ...student,
            status: pendingState.status || student.status || 'active',
            withdrawn_at: pendingState.withdrawn_at || '',
            paused_at: pendingState.paused_at || '',
            status_changed_at: pendingState.status_changed_at || student.status_changed_at || ''
          }, student.type || 'elementary');
        }
        return student;
      })
      .filter(student => !academyId || !student.academy_id || student.academy_id === academyId)
      .filter(student => !isOlliSoftDeletedRow(student));
  } catch {
    return [];
  }
}
function isAcademyManagementActiveStudent(student){
  return (student?.type === 'elementary' || student?.type === 'kinder') && getStudentStatus(student) === 'active';
}

function getThisMonthConsultationDueStudents(students){
  return (Array.isArray(students) ? students : [])
    .filter(isAcademyManagementActiveStudent)
    .filter(student => getDueConsultationRuleLabelsForStudent(student).length > 0);
}

async function toggleAcademyConsultationCompleted(studentRef, event){
  if (event) { event.preventDefault(); event.stopPropagation(); }
  const role = typeof getOlliEffectiveStorageRole === 'function' ? getOlliEffectiveStorageRole() : (typeof getOlliCurrentRole === 'function' ? getOlliCurrentRole() : '');
  if (!['owner','manager','super_admin'].includes(role)) {
    if (typeof showPushToast === 'function') showPushToast('원장 또는 관리자만 상담완료를 변경할 수 있습니다.');
    return;
  }
  const ref = String(studentRef || '');
  const student = getAcademyManagementStudentsForStats().find(item =>
    (ref.startsWith('id:') && String(item.id) === ref.slice(3))
    || (ref.startsWith('name:') && String(item.name || '').trim() === ref.slice(5).trim()));
  if (!student) return;
  const tasks = getConsultationDueTasksForStudent(student);
  if (!tasks.length) return;
  const pressedBtn = event?.currentTarget || null;
  if (pressedBtn) { pressedBtn.disabled = true; pressedBtn.textContent = '저장중...'; }
  try {
    if (!window.OlliConsultationServer) throw new Error('상담 관리 서버가 준비되지 않았습니다.');
    // PC와 모바일이 동시에 눌러도 현재 서버 상태에서 완료/취소를 계산합니다.
    const latest = normalizeOlliConsultationProgress(await window.OlliConsultationServer.readProgress());
    const nextCompleted = !tasks.every(task => !!latest.completed[task.key]);
    const saved = await window.OlliConsultationServer.setCompleted(tasks.map(task => task.key), nextCompleted);
    writeOlliConsultationProgressLocal(normalizeOlliConsultationProgress(saved), 'synced');
    if (typeof currentRecordView !== 'undefined' && currentRecordView === 'academy') {
      if (document.body?.classList?.contains('olliPcApp') && typeof window.pcRefreshAcademyConsultationCompletionState === 'function') {
        window.pcRefreshAcademyConsultationCompletionState();
      } else if (typeof renderRecordAcademyManagementDashboard === 'function') renderRecordAcademyManagementDashboard();
    }
    if (typeof showPushToast === 'function') showPushToast(nextCompleted ? '상담완료를 서버에 저장했습니다.' : '상담완료를 취소했습니다.');
  } catch (error) {
    if (typeof showPushToast === 'function') showPushToast('상담완료 저장 실패: ' + (error.message || error));
    else alert('상담완료 저장 실패: ' + (error.message || error));
  } finally {
    if (pressedBtn?.isConnected) pressedBtn.disabled = false;
    if (typeof window.pcRefreshAcademyConsultationCompletionState === 'function') {
      window.pcRefreshAcademyConsultationCompletionState();
    }
  }
}
window.toggleAcademyConsultationCompleted = toggleAcademyConsultationCompleted;


function initializeMobileConsultationServer() {
  if (!window.OlliConsultationServer) return;
  const reload = () => {
    if (typeof getOlliCurrentAcademyId !== 'function' || !getOlliCurrentAcademyId()) return;
    Promise.all([loadOlliConsultationRulesFromServer(),loadOlliConsultationProgressFromServer({ force: true })]).then(() => {
      if (typeof currentRecordView !== 'undefined' && currentRecordView === 'academy') {
        window.renderRecordAcademyManagementDashboard();
      }
    });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reload();
  });
  window.addEventListener('focus', reload);
  reload();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeMobileConsultationServer, { once: true });
} else {
  setTimeout(initializeMobileConsultationServer, 0);
}
