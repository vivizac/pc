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

























// Consultation rule/progress access and completed-state writes belong exclusively
// to olli-consultation-mobile-runtime.js (session-verified server RPC).
// The former copies here redeclared top-level 'let' bindings and prevented this
// entire script -- including the ORIGINAL dashboard renderer below -- from loading.
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
          return `<div class="recordAcademyListItem recordAcademyConsultListItem" onclick="toggleAcademyConsultationSummaryPreview('${escapedKey}')"><div class="recordAcademyConsultStudentMain"><div class="recordAcademyListName">${escapeHtml(student.name)}</div><div class="recordAcademyChipRow">${chips.map(label => `<span class="recordAcademyInfoChip recordAcademyRuleChip">${escapeHtml(label)}</span>`).join('')}</div></div><div class="recordAcademyConsultActions"><span class="recordAcademyConsultStatusChip ${escapeHtml(status)}">${escapeHtml(statusLabel)}</span></div></div>${preview}`;
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

