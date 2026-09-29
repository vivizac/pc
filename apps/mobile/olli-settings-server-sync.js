async function loadOlliSharedSettingsFromServer() {
  // 상담기준은 7단계부터, 그룹별 피드백 발송월은 8단계부터 공통 저장 구조 한 곳에서 처리합니다.
  // 9단계부터 academy_settings 직접 Supabase 조회 fallback은 사용하지 않습니다.
  const academyId = (typeof settingsGetAcademyId === 'function') ? settingsGetAcademyId() : ((typeof getOlliCurrentAcademyId === 'function') ? getOlliCurrentAcademyId() : '');
  if (!academyId) return false;

  if (typeof loadOlliData !== 'function') {
    recordOlliStorageIssue({
      feature: '그룹별 피드백 발송월',
      resource: OLLI_SHARED_SETTINGS_TABLE,
      operation: 'load',
      message: '공통 저장 불러오기 함수(loadOlliData)가 준비되지 않아 직접 Supabase fallback을 실행하지 않았습니다.'
    });
    return false;
  }

  try {
    const request = loadOlliData('elementary_group_feedback_months', { academyId, backgroundRefresh: true });
    const localMap = normalizeElementaryGroupFeedbackMonthsMap(request.localData);
    if (Object.keys(localMap).length) writeElementaryGroupFeedbackMonthsMap(localMap, { skipServerSync: true });
    const refreshed = await request.refreshPromise;
    if (refreshed && refreshed.data) {
      const serverMap = normalizeElementaryGroupFeedbackMonthsMap(refreshed.data);
      writeElementaryGroupFeedbackMonthsMap(serverMap, { skipServerSync: true });
    }
    olliSharedSettingsServerLoaded = true;
    return true;
  } catch(err) {
    recordOlliStorageIssue({ feature: '그룹별 피드백 발송월', resource: OLLI_SHARED_SETTINGS_TABLE, operation: 'load', message: err.message || err });
    console.warn('그룹별 피드백 발송월 공통 저장 불러오기 실패:', err.message || err);
    return false;
  }
}

























async function loadOlliConsultationRulesFromServer(options = {}){
  const academyId = ensureOlliConsultationContext();
  if (!academyId || typeof loadOlliData !== 'function') return false;
  migrateOlliConsultationRulesOnce();

  const now = Date.now();
  if (!options.force && now - olliConsultationLastRefreshAt < 1200) return false;
  if (olliConsultationRefreshPromise) return olliConsultationRefreshPromise;

  olliConsultationLastRefreshAt = now;
  olliConsultationRefreshPromise = (async () => {
    const request = loadOlliData('consultation_rules', { academyId, backgroundRefresh: true });
    const refreshed = await request.refreshPromise;

    if (refreshed && refreshed.protectedPending && request.localData) {
      // 로컬 변경이 서버보다 새로울 때만 한 번 재전송합니다.
      await saveOlliData('consultation_rules', {
        academyId,
        data: normalizeOlliConsultationRulesByType(request.localData),
        forceCommon: true
      });
    }
    return !!(refreshed && (refreshed.refreshed || refreshed.protectedPending));
  })().catch(err => {
    console.warn('상담기준 불러오기 실패:', err && (err.message || err));
    return false;
  }).finally(() => {
    olliConsultationRefreshPromise = null;
  });

  return olliConsultationRefreshPromise;
}


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
  return {
    version: 1,
    tracking_started_month: String(raw.tracking_started_month || raw.trackingStartedMonth || ''),
    completed
  };
}

const OLLI_CONSULTATION_PROGRESS_LEGACY_MIRROR_PREFIX = 'olli_consultation_progress_mirror_v1_';
const olliConsultationProgressMirrorMigrated = new Set();

function getOlliConsultationProgressLegacyMirrorKey(academyId){
  const safeAcademyId = String(academyId || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '_');
  return `${OLLI_CONSULTATION_PROGRESS_LEGACY_MIRROR_PREFIX}${safeAcademyId || 'unknown'}`;
}

function hasOlliConsultationProgressData(progress){
  if (!progress || typeof progress !== 'object') return false;
  if (String(progress.tracking_started_month || '').trim()) return true;
  return !!(progress.completed && typeof progress.completed === 'object' && Object.keys(progress.completed).length);
}

function migrateOlliConsultationProgressLegacyMirrorOnce(academyId){
  const safeAcademyId = String(academyId || '').trim();
  if (!safeAcademyId || olliConsultationProgressMirrorMigrated.has(safeAcademyId)) return;
  olliConsultationProgressMirrorMigrated.add(safeAcademyId);

  const legacyKey = getOlliConsultationProgressLegacyMirrorKey(safeAcademyId);
  try {
    const targetExists = typeof hasOlliLocal === 'function'
      ? hasOlliLocal(OLLI_CONSULTATION_PROGRESS_FEATURE, { academyId: safeAcademyId })
      : false;

    if (!targetExists) {
      const raw = localStorage.getItem(legacyKey);
      const legacyProgress = normalizeOlliConsultationProgress(raw ? JSON.parse(raw) : {});
      if (hasOlliConsultationProgressData(legacyProgress) && typeof writeOlliLocal === 'function') {
        // 과거 보정용 미러의 동기화 여부는 알 수 없으므로 pending으로 승격해 서버 검증 기회를 보장합니다.
        writeOlliLocal(
          OLLI_CONSULTATION_PROGRESS_FEATURE,
          { academyId: safeAcademyId },
          legacyProgress,
          { syncStatus: 'pending', lastSyncedAt: null, retryCount: 0 }
        );
      }
    }

    localStorage.removeItem(legacyKey);
  } catch (error) {
    console.warn('상담 진행상태 과거 미러 이관 보류:', error?.message || error);
  }
}

function getOlliConsultationProgress(){
  const academyId = ensureOlliConsultationContext();
  if (!academyId) return normalizeOlliConsultationProgress({});
  migrateOlliConsultationProgressLegacyMirrorOnce(academyId);
  if (typeof readOlliLocal !== 'function') return normalizeOlliConsultationProgress({});

  try {
    return normalizeOlliConsultationProgress(
      readOlliLocal(OLLI_CONSULTATION_PROGRESS_FEATURE, { academyId }, { fallback: {} })
    );
  } catch(e) {
    return normalizeOlliConsultationProgress({});
  }
}

function writeOlliConsultationProgressLocal(progress, syncStatus = 'pending'){
  const academyId = ensureOlliConsultationContext();
  const normalized = normalizeOlliConsultationProgress(progress);
  if (!academyId) return normalized;
  migrateOlliConsultationProgressLegacyMirrorOnce(academyId);

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
  const academyId = ensureOlliConsultationContext();
  const normalized = ensureOlliConsultationProgressTrackingStart(progress);
  writeOlliConsultationProgressLocal(normalized, 'pending');
  if (typeof currentRecordView !== 'undefined' && currentRecordView === 'academy' && typeof renderRecordAcademyManagementDashboard === 'function') {
    renderRecordAcademyManagementDashboard();
  }
  if (!academyId || typeof saveOlliData !== 'function') return normalized;

  try {
    const result = await saveOlliData(OLLI_CONSULTATION_PROGRESS_FEATURE, {
      academyId,
      data: normalized,
      forceCommon: true
    });
    if (!result || !result.serverSaved || !result.verified) {
      console.warn('상담 진행상태는 로컬에 저장되었으며 서버 동기화를 다시 시도합니다.', result && (result.errorCode || result.error));
    }
  } catch(err) {
    console.warn('상담 진행상태 서버 저장 실패:', err && (err.message || err));
  }
  return normalized;
}

async function loadOlliConsultationProgressFromServer(options = {}){
  const academyId = ensureOlliConsultationContext();
  if (!academyId || typeof loadOlliData !== 'function') return false;

  const now = Date.now();
  if (!options.force && now - olliConsultationProgressLastRefreshAt < 1200) return false;
  if (olliConsultationProgressRefreshPromise) return olliConsultationProgressRefreshPromise;

  olliConsultationProgressLastRefreshAt = now;
  olliConsultationProgressRefreshPromise = (async () => {
    const request = loadOlliData(OLLI_CONSULTATION_PROGRESS_FEATURE, { academyId, backgroundRefresh: true });
    const refreshed = await request.refreshPromise;
    let progress = getOlliConsultationProgress();

    if (!progress.tracking_started_month) {
      progress = ensureOlliConsultationProgressTrackingStart(progress);
      await saveOlliConsultationProgressShared(progress);
    } else if (refreshed && refreshed.protectedPending && request.localData) {
      await saveOlliData(OLLI_CONSULTATION_PROGRESS_FEATURE, {
        academyId,
        data: normalizeOlliConsultationProgress(request.localData),
        forceCommon: true
      });
    }

    return !!(refreshed && (refreshed.refreshed || refreshed.protectedPending));
  })().catch(err => {
    console.warn('상담 진행상태 불러오기 실패:', err && (err.message || err));
    // 서버 컬럼이 아직 준비되지 않은 경우에도 현재 기기의 이월 기능은 유지합니다.
    let progress = getOlliConsultationProgress();
    if (!progress.tracking_started_month) {
      progress = ensureOlliConsultationProgressTrackingStart(progress);
      writeOlliConsultationProgressLocal(progress, 'pending');
    }
    return false;
  }).finally(() => {
    olliConsultationProgressRefreshPromise = null;
  });

  return olliConsultationProgressRefreshPromise;
}

function bindOlliConsultationSyncOnce(){
  if (window.__olliConsultationSyncBound) return;
  window.__olliConsultationSyncBound = true;

  try {
    const core = window.OlliStorageCore;
    if (core && core.FeatureFlags) {
      core.FeatureFlags.set('consultation_rules', 'common');
      core.FeatureFlags.set(OLLI_CONSULTATION_PROGRESS_FEATURE, 'common');
    }
  } catch(e) {
    console.warn('상담 공통 저장 모드 설정 실패:', e);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindOlliConsultationSyncOnce, { once: true });
} else {
  setTimeout(bindOlliConsultationSyncOnce, 0);
}

function bindOlliGroupFeedbackMonthsSyncOnce(){
  if (window.__olliGroupFeedbackMonthsSyncBound) return;
  window.__olliGroupFeedbackMonthsSyncBound = true;

  try {
    const core = window.OlliStorageCore;
    if (core && core.FeatureFlags) core.FeatureFlags.set('elementary_group_feedback_months', 'common');
  } catch(e) {
    console.warn('그룹별 피드백 발송월 공통 저장 모드 설정 실패:', e);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindOlliGroupFeedbackMonthsSyncOnce, { once: true });
} else {
  setTimeout(bindOlliGroupFeedbackMonthsSyncOnce, 0);
}

async function toggleAcademyConsultationCompleted(studentRef, event){
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const role = typeof getOlliEffectiveStorageRole === 'function' ? getOlliEffectiveStorageRole() : '';
  if (!['owner','manager','super_admin'].includes(role)) {
    if (typeof showPushToast === 'function') showPushToast('상담 완료 선택은 원장 또는 관리자만 변경할 수 있어요.');
    return;
  }
  const ref = String(studentRef || '');
  const students = getAcademyManagementStudentsForStats();
  const student = ref.startsWith('id:')
    ? students.find(item => String(item.id || '') === ref.slice(3))
    : (ref.startsWith('name:')
      ? students.find(item => String(item.name || '').trim() === ref.slice(5).trim())
      : null);
  if (!student) return;
  const tasks = getConsultationDueTasksForStudent(student);
  if (!tasks.length) return;

  const progress = ensureOlliConsultationProgressTrackingStart(getOlliConsultationProgress());
  const nextCompleted = { ...(progress.completed || {}) };
  const shouldComplete = !tasks.every(task => !!nextCompleted[task.key]);
  if (shouldComplete) {
    const completedAt = new Date().toISOString();
    const completedMonth = getAcademyConsultationMonthKey();
    tasks.forEach(task => {
      nextCompleted[task.key] = {
        completed_at: completedAt,
        completed_month: completedMonth
      };
    });
  } else {
    tasks.forEach(task => { delete nextCompleted[task.key]; });
  }

  await saveOlliConsultationProgressShared({
    ...progress,
    completed: nextCompleted
  });
  if (typeof showPushToast === 'function') {
    showPushToast(shouldComplete ? `${student.name} 상담을 완료로 표시했어요.` : `${student.name} 상담 완료 표시를 취소했어요.`);
  }
}

window.toggleAcademyConsultationCompleted = toggleAcademyConsultationCompleted;

function updateOlliConsultationSettingUI(){
  const value = document.getElementById('settingsConsultationMonthsValue');
  if (value) value.textContent = getOlliConsultationRulesLabel() || '미설정';
  ['elementary','kinder'].forEach(type => {
    const selected = new Set(getOlliConsultationRules(type));
    document.querySelectorAll(`[data-consultation-type="${type}"][data-consultation-rule]`).forEach(btn => {
      btn.classList.toggle('active', selected.has(btn.getAttribute('data-consultation-rule')));
    });
  });
}

function getSettingsConsultationActiveLabels(type){
  return Array.from(document.querySelectorAll(`[data-consultation-type="${type}"][data-consultation-rule].active`))
    .map(item => getOlliConsultationRuleLabel(item.getAttribute('data-consultation-rule')))
    .filter(Boolean);
}

function toggleSettingsConsultationRuleOption(key, type){
  if (typeof canEditOlliConsultationSettings === 'function' && !canEditOlliConsultationSettings()) return;
  const targetKey = String(key || '');
  const targetType = getOlliConsultationDivisionKey(type);
  const btn = Array.from(document.querySelectorAll(`[data-consultation-type="${targetType}"][data-consultation-rule]`))
    .find(item => item.getAttribute('data-consultation-rule') === targetKey);
  if (!btn) return;
  btn.classList.toggle('active');
  const value = document.getElementById('settingsConsultationMonthsValue');
  if (value) {
    const elementary = getSettingsConsultationActiveLabels('elementary').join(', ') || '미설정';
    const kinder = getSettingsConsultationActiveLabels('kinder').join(', ') || '미설정';
    value.textContent = `초등부 ${elementary} / 유치부 ${kinder}`;
  }
}

function toggleSettingsConsultationMonthOption(month, type){
  const mapped = month === 1 ? 'after_1' : month === 3 ? 'after_3' : month === 6 ? 'every_6' : month === 12 ? 'every_12' : '';
  if (mapped) toggleSettingsConsultationRuleOption(mapped, type || 'elementary');
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
  const raw = getEnrolledAtFromStudent(student);
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

function buildAcademyStatCard(label, value, delta, tone, options = {}){
  const subText = options && options.sub ? String(options.sub) : '';
  const subHtml = subText
    ? subText.split(' · ').map(part => escapeHtml(part)).join('<br>')
    : '';
  return `<div class="recordAcademyStatCard">
    <div class="recordAcademyStatLabel">${escapeHtml(label)}</div>
    <div class="recordAcademyStatBody">
      <div class="recordAcademyStatValue">${escapeHtml(String(value ?? 0))}</div>
      ${subHtml ? `<div class="recordAcademyStatSub">${subHtml}</div>` : ''}
    </div>
  </div>`;
}


function renderAcademyConsultationList(students){
  const due = getThisMonthConsultationDueStudents(students);
  if (!due.length) return '<div class="recordEmpty">이번 달 상담 예정 학생이 없습니다.</div>';
  const groups = [
    { key: 'elementary', label: '초등부 상담 예정', students: due.filter(student => student.type === 'elementary') },
    { key: 'kinder', label: '유치부 상담 예정', students: due.filter(student => student.type === 'kinder') }
  ];
  return '<div class="recordAcademyConsultGroups">' + groups.map(group => {
    const rows = group.students.length
      ? '<div class="recordAcademyList">' + group.students.map(student => {
          const dueLabels = getDueConsultationRuleLabelsForStudent(student);
          const chips = dueLabels.length ? dueLabels.map(getOlliConsultationRuleShortLabel) : ['상담 예정'];
          const summaryMonths = getConsultationSummaryMonthsFromLabels(dueLabels);
          const summaryKey = getAcademyConsultationSummaryKey(student, summaryMonths);
          const stateItem = getAcademyConsultationSummaryItem(student, summaryMonths);
          const status = getAcademyConsultationSummaryDisplayStatus(stateItem.status);
          const statusLabel = getAcademyConsultationSummaryStatusLabel(status);
          const escapedKey = escapeJsSingleQuote(summaryKey);
          const preview = academyConsultationSummaryState.expandedKey === summaryKey
            ? renderAcademyConsultationSummaryPreview(summaryKey)
            : '';
          const consultationCompleted = isAcademyConsultationCompletedForCurrentList(student);
          const consultationStudentRef = student.id ? `id:${student.id}` : `name:${String(student.name || '').trim()}`;
          const consultationBtn = `<button type="button" class="recordAcademyConsultCompleteBtn${consultationCompleted ? ' active' : ''}" aria-pressed="${consultationCompleted ? 'true' : 'false'}" onclick="toggleAcademyConsultationCompleted('${escapeJsSingleQuote(consultationStudentRef)}', event)">상담</button>`;
          return `<div class="recordAcademyListItem recordAcademyConsultListItem" onclick="toggleAcademyConsultationSummaryPreview('${escapedKey}')"><div class="recordAcademyConsultStudentMain"><div class="recordAcademyListName">${escapeHtml(student.name)}</div><div class="recordAcademyChipRow">${chips.map(label => `<span class="recordAcademyInfoChip recordAcademyRuleChip">${escapeHtml(label)}</span>`).join('')}</div></div><div class="recordAcademyConsultActions">${consultationBtn}<span class="recordAcademyConsultStatusChip ${escapeHtml(status)}">${escapeHtml(statusLabel)}</span></div></div>${preview}`;
        }).join('') + '</div>'
      : '<div class="recordAcademyConsultGroupEmpty">상담 예정 학생 없음</div>';
    return `<div class="recordAcademyConsultGroup"><div class="recordAcademyConsultGroupTitle"><span>${escapeHtml(group.label)}</span></div>${rows}</div>`;
  }).join('') + '</div>';
}

function renderRecordAcademyManagementDashboard(){
  const dashboard = document.getElementById('recordAcademyDashboard');
  if (!dashboard) return;
  const students = getAcademyManagementStudentsForStats();
  const active = students.filter(isAcademyManagementActiveStudent);
  const thisYearRegistered = students.filter(s => {
    const enrolled = getStudentEnrollmentDateForStats(s);
    return isCurrentYearDate(enrolled) && getStudentStatus(s) !== 'inactive';
  });
  const thisMonthRegistered = students.filter(s => {
    const enrolled = getStudentEnrollmentDateForStats(s);
    return isCurrentMonthYear(enrolled) && getStudentStatus(s) !== 'inactive';
  });
  const thisMonthWithdrawn = students.filter(s => {
    if (getStudentStatus(s) !== 'withdrawn') return false;
    const withdrawnAt = getStudentWithdrawalDateForStats(s);
    return withdrawnAt ? isCurrentMonthYear(withdrawnAt) : false;
  });
  const thisYearWithdrawn = students.filter(s => {
    if (getStudentStatus(s) !== 'withdrawn') return false;
    const withdrawnAt = getStudentWithdrawalDateForStats(s);
    return withdrawnAt ? isCurrentYearDate(withdrawnAt) : true;
  });
  const pausedStudents = students.filter(s => getStudentStatus(s) === 'paused');
  const consultationDue = getThisMonthConsultationDueStudents(students);
  const activeElementary = active.filter(s => s.type === 'elementary').length;
  const activeKinder = active.filter(s => s.type === 'kinder').length;
  const consultationElementary = consultationDue.filter(s => s.type === 'elementary').length;
  const consultationKinder = consultationDue.filter(s => s.type === 'kinder').length;
  const now = new Date();
  const consultationCardLabel = `${now.getMonth()+1}월 상담`;
  dashboard.innerHTML = `
    <div class="recordAcademyStatGrid">
      ${buildAcademyStatCard('원생수', active.length, 0, 'blue', { sub: `초등부 ${activeElementary}명 · 유치부 ${activeKinder}명` })}
      ${buildAcademyStatCard(consultationCardLabel, consultationDue.length, consultationDue.length, 'blue', { sub: `초등부 ${consultationElementary}명 · 유치부 ${consultationKinder}명` })}
      ${buildAcademyStatCard('올해 등록', thisYearRegistered.length, thisYearRegistered.length, 'red', { sub: `이달 등록 ${thisMonthRegistered.length}명 · 이달 퇴원 ${thisMonthWithdrawn.length}명` })}
      ${buildAcademyStatCard('올해 퇴원', thisYearWithdrawn.length, thisYearWithdrawn.length, 'red', { sub: `휴원 ${pausedStudents.length}명 · 퇴원 ${thisYearWithdrawn.length}명` })}
    </div>
    <div class="recordAcademyConsultSection">${renderAcademyConsultationList(students)}</div>
  `;
}

