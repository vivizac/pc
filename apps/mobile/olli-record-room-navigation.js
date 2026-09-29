function syncRecordAcademyPageState(){
  const screen = document.getElementById('recordRoomScreen');
  if (!screen) return;
  screen.classList.toggle('record-academy-view', currentRecordView === 'academy');
}

function hydrateRecordAttendanceLocalSnapshot(options = {}){
  const adapter = window.OlliPhoneAttendanceAdapter;
  if (!adapter || typeof adapter.hydrateLocalAttendanceSnapshot !== 'function') return false;
  try { return adapter.hydrateLocalAttendanceSnapshot(new Date(), { render: options.render !== false }); }
  catch (error) {
    console.warn('출석 로컬 스냅샷 복원 실패:', error?.message || error);
    return false;
  }
}

async function openRecordAttendanceDashboard(options = {}){
  studentSelectionMode = false;
  selectedStudentIds.clear();
  const targetView = (typeof window.getOlliLastRecordDivisionView === 'function')
    ? window.getOlliLastRecordDivisionView()
    : ((currentObservationView === 'kinder') ? 'kinder' : 'elementary');
  currentObservationView = targetView;
  currentRecordView = targetView;
  setObservationButtonSide(targetView, false);
  updateRecordHeaderUI();
  syncRecordAcademyPageState();
  if (typeof window.setOlliMainSubpageDrawerSearchActive === 'function') {
    window.setOlliMainSubpageDrawerSearchActive(false);
  }
  if (typeof window.refreshRecordSortPopup === 'function') setTimeout(window.refreshRecordSortPopup, 0);
  await loadRecords('', options);
}

async function toggleRecordAcademyManagementMode(){
  if (typeof canAccessOlliStartPageAcademyManagement === 'function' && !canAccessOlliStartPageAcademyManagement()) {
    if (currentRecordView === 'academy') {
      currentRecordView = currentObservationView === 'kinder' ? 'kinder' : 'elementary';
      updateRecordHeaderUI();
      syncRecordAcademyPageState();
      if (typeof window.setOlliMainSubpageDrawerSearchActive === 'function') {
        window.setOlliMainSubpageDrawerSearchActive(false);
      }
      await loadRecords('');
    }
    return;
  }
  studentSelectionMode = false;
  selectedStudentIds.clear();
  if (currentRecordView === 'elementary' || currentRecordView === 'kinder') currentObservationView = currentRecordView;
  currentRecordView = 'academy';
  updateRecordHeaderUI();
  syncRecordAcademyPageState();
  if (typeof window.setOlliMainSubpageDrawerSearchActive === 'function') {
    window.setOlliMainSubpageDrawerSearchActive(true);
  }
  await loadRecords('');
}

async function closeRecordAcademyManagementPage(event){
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const drawerOpen = typeof window.isOlliMainSubpageDrawerOpen === 'function'
    ? window.isOlliMainSubpageDrawerOpen()
    : false;

  if (drawerOpen && typeof window.closeOlliMainSubpageDrawer === 'function') {
    return window.closeOlliMainSubpageDrawer(event);
  }

  const openQuickNote = window.openOlliQuickNoteFromRecordShortcut
    || window.openKinderChatFeedbackPage
    || (typeof openKinderChatFeedbackPage === 'function' ? openKinderChatFeedbackPage : null);

  if (typeof openQuickNote === 'function') {
    const opened = await openQuickNote(event);
    return opened !== false;
  }

  return false;
}

let recordAcademyManagementRefreshPromise = null;

function getRecordAcademyManagementDataSignature(){
  const students = (typeof getAcademyManagementStudentsForStats === 'function'
    ? getAcademyManagementStudentsForStats()
    : []
  ).map(student => ({
    id: String(student?.id || ''),
    name: String(student?.name || ''),
    type: String(student?.type || ''),
    academy_id: String(student?.academy_id || ''),
    status: String(typeof getStudentStatus === 'function' ? getStudentStatus(student) : (student?.status || '')),
    enrolled_at: String(student?.enrolled_at || student?.enrollment_date || student?.registered_at || student?.created_at || ''),
    withdrawn_at: String(student?.withdrawn_at || ''),
    paused_at: String(student?.paused_at || ''),
    status_changed_at: String(student?.status_changed_at || '')
  })).sort((a, b) => a.id.localeCompare(b.id) || a.name.localeCompare(b.name));

  const rules = typeof getOlliConsultationRulesMap === 'function'
    ? getOlliConsultationRulesMap()
    : {};
  const progress = typeof getOlliConsultationProgress === 'function'
    ? getOlliConsultationProgress()
    : {};

  return JSON.stringify({ students, rules, progress });
}

function refreshRecordAcademyManagementFromServer(options = {}){
  if (recordAcademyManagementRefreshPromise) return recordAcademyManagementRefreshPromise;

  const beforeSignature = getRecordAcademyManagementDataSignature();
  const academyLoadToken = ++academyManagementLoadToken;
  const force = options.force !== false;

  recordAcademyManagementRefreshPromise = Promise.all([
    (typeof loadOlliConsultationRulesFromServer === 'function')
      ? loadOlliConsultationRulesFromServer({ force })
      : Promise.resolve(false),
    (typeof loadOlliConsultationProgressFromServer === 'function')
      ? loadOlliConsultationProgressFromServer({ force })
      : Promise.resolve(false),
    (typeof loadStudentsFromSupabase === 'function')
      ? loadStudentsFromSupabase().catch(error => {
          console.warn('학원관리 학생 동기화 실패:', error);
          return false;
        })
      : Promise.resolve(false)
  ]).then(() => {
    if (academyLoadToken !== academyManagementLoadToken) return { changed: false, stale: true };
    const afterSignature = getRecordAcademyManagementDataSignature();
    const changed = beforeSignature !== afterSignature;

    if (currentRecordView === 'academy') {
      if (changed && typeof renderRecordAcademyManagementDashboard === 'function') {
        renderRecordAcademyManagementDashboard();
      }
      if (typeof scheduleAcademyConsultationSummaryAutoCheck === 'function') {
        scheduleAcademyConsultationSummaryAutoCheck(900);
      }
    }

    return { changed, stale: false };
  }).catch(error => {
    console.warn('학원관리 서버 최신화 실패:', error?.message || error);
    return { changed: false, error };
  }).finally(() => {
    recordAcademyManagementRefreshPromise = null;
  });

  return recordAcademyManagementRefreshPromise;
}

window.refreshRecordAcademyManagementFromServer = refreshRecordAcademyManagementFromServer;

let recordAttendanceRefreshPromise = null;
let recordAttendanceRefreshContext = '';

function refreshRecordAttendanceDashboardFromServer(name = ''){
  const view = currentRecordView === 'kinder' ? 'kinder' : (currentRecordView === 'elementary' ? 'elementary' : '');
  if (!view) return Promise.resolve(false);
  const context = `${getOlliCurrentAcademyId()}|${view}|${String(name || '')}`;
  if (recordAttendanceRefreshPromise && recordAttendanceRefreshContext === context) {
    return recordAttendanceRefreshPromise;
  }

  const task = Promise.resolve()
    .then(() => loadRecords(name, { refreshOnly: true }))
    .catch(error => {
      console.warn('출석부 서버 최신화 실패:', error?.message || error);
      return false;
    })
    .finally(() => {
      if (recordAttendanceRefreshPromise === task) {
        recordAttendanceRefreshPromise = null;
        recordAttendanceRefreshContext = '';
      }
    });
  recordAttendanceRefreshContext = context;
  recordAttendanceRefreshPromise = task;
  return task;
}

window.refreshRecordAttendanceDashboardFromServer = refreshRecordAttendanceDashboardFromServer;

async function loadRecords(name, options = {}) {
  const list = document.getElementById('recordList');
  const localOnly = options?.localOnly === true;
  const refreshOnly = options?.refreshOnly === true;
  const loadToken = localOnly
    ? (window.__olliRecordListLoadToken || 0)
    : (window.__olliRecordListLoadToken = (window.__olliRecordListLoadToken || 0) + 1);
  // 학생 목록 화면에서는 Supabase 로딩 문구를 띄우지 않습니다.
  // 먼저 각 기기의 로컬 캐시 학생 목록을 보여주고, Supabase 동기화가 끝나면 같은 자리에서 조용히 갱신합니다.
  if (!getOlliCurrentAcademyId()) {
    list.innerHTML = '<div class="recordEmpty">현재 학원 ID가 없어 기록을 불러올 수 없습니다.<br>다시 로그인해 주세요.</div>';
    return;
  }

  if (currentRecordView === 'academy') {
    // 화면의 유일한 첫 렌더는 로컬 데이터입니다. 서버 최신화는 한 주체에서만 뒤따릅니다.
    renderRecordAcademyManagementDashboard();
    if (typeof scheduleAcademyConsultationSummaryAutoCheck === 'function') {
      scheduleAcademyConsultationSummaryAutoCheck(900);
    }
    if (localOnly) return true;
    void refreshRecordAcademyManagementFromServer({ force: true });
    return true;
  }


  if (currentRecordView === 'elementary') {
    if (!refreshOnly) {
      hydrateRecordAttendanceLocalSnapshot({ render: false });
      renderElementaryRecords(name);
      if (localOnly) return true;
    }
    await loadStudentsFromSupabase();
    if (loadToken !== window.__olliRecordListLoadToken || currentRecordView !== 'elementary') return;
    renderElementaryRecords(name);
    if (window.OlliPhoneAttendanceAdapter && typeof window.OlliPhoneAttendanceAdapter.afterRecordListLoaded === 'function') {
      window.OlliPhoneAttendanceAdapter.afterRecordListLoaded('elementary', name);
    }
    return true;
  }

  if (currentRecordView === 'kinder') {
    if (!refreshOnly) {
      hydrateRecordAttendanceLocalSnapshot({ render: false });
      renderKinderRecords(name);
      if (localOnly) return true;
    }
    await loadStudentsFromSupabase();
    if (loadToken !== window.__olliRecordListLoadToken || currentRecordView !== 'kinder') return;
    renderKinderRecords(name);
    if (window.OlliPhoneAttendanceAdapter && typeof window.OlliPhoneAttendanceAdapter.afterRecordListLoaded === 'function') {
      window.OlliPhoneAttendanceAdapter.afterRecordListLoaded('kinder', name);
    }
    return true;
  }

  const academyId = requireOlliAcademyId('기록 조회');
  let feedbackPath = `feedbacks?academy_id=eq.${encodeURIComponent(academyId)}&order=id.desc&limit=500`;
  let failFeedbackPath = `fail_feedbacks?academy_id=eq.${encodeURIComponent(academyId)}&order=id.desc&limit=500`;
  let summaryPath = `summary_feedbacks?academy_id=eq.${encodeURIComponent(academyId)}&order=id.desc&limit=500`;
  if (name) {
    const encodedName = encodeURIComponent(name);
    feedbackPath += `&student_name=ilike.*${encodedName}*`;
    failFeedbackPath += `&student_name=ilike.*${encodedName}*`;
    summaryPath += `&student_name=ilike.*${encodedName}*`;
  }

  try {
    let rawData = [];
    let sourceTableName = 'feedbacks';

    if (currentRecordMode === 'summary') {
      rawData = await supabase('GET', summaryPath);
      sourceTableName = 'summary_feedbacks';
    } else if (currentRecordMode === 'fail') {
      rawData = await supabase('GET', failFeedbackPath);
      sourceTableName = 'fail_feedbacks';
    } else {
      rawData = await supabase('GET', feedbackPath);
      sourceTableName = 'feedbacks';
    }

    if (!Array.isArray(rawData)) { list.innerHTML = '<div class="recordEmpty">오류가 발생했습니다.</div>'; return; }

    const normalized = filterOlliActiveRows(rawData).map(item => ({
      ...item,
      source_table: sourceTableName,
      feedback_type: sourceTableName === 'fail_feedbacks' ? 'fail' : (item.feedback_type || (sourceTableName === 'summary_feedbacks' ? 'summary' : 'class'))
    }));
    const filtered = currentRecordMode === 'summary' || currentRecordMode === 'fail'
      ? normalized
      : normalized.filter(r => String(r.feedback_type || 'class').toLowerCase() === currentRecordMode);

    if (!filtered.length) { list.innerHTML = '<div class="recordEmpty">저장된 피드백이 없습니다.</div>'; return; }

    const grouped = {};
    filtered.forEach(r => {
      const studentId = String(r.student_id || '').trim();
      const studentName = String(r.student_name || '').trim() || '이름 없음';
      const recordKey = studentId ? `id:${studentId}` : `name:${studentName}`;
      const year = r.year || new Date().getFullYear();
      if (!grouped[recordKey]) grouped[recordKey] = { key: recordKey, studentId, studentName, displayName: studentName, years: {}, all: [] };
      if (!grouped[recordKey].years[year]) grouped[recordKey].years[year] = [];
      grouped[recordKey].years[year].push(r);
      grouped[recordKey].all.push(r);
    });

    const allStudents = getAllStudents();
    Object.keys(grouped).forEach(recordKey => {
      const group = grouped[recordKey];
      const matchedStudent = group.studentId
        ? allStudents.find(student => String(student.id || '').trim() === group.studentId)
        : allStudents.find(student => String(student.name || '').trim() === String(group.studentName || '').trim());
      if (matchedStudent) {
        group.studentName = matchedStudent.name || group.studentName;
        group.displayName = matchedStudent.name || group.displayName;
        group.studentType = matchedStudent.type || '';
        group.student = matchedStudent;
      }
    });
    window.__olliRecordBoardGroups = grouped;

    list.innerHTML = Object.keys(grouped).sort((a, b) => String(grouped[a].displayName || '').localeCompare(String(grouped[b].displayName || ''), 'ko')).map(recordKey => {
      const group = grouped[recordKey];
      const sname = group.displayName || group.studentName || '이름 없음';
      const encodedKey = escapeTemplateLiteral(recordKey);
      const encodedName = escapeTemplateLiteral(sname);
      const encodedRecords = encodeURIComponent(JSON.stringify(group.all));
      const matchedStudent = group.student || null;
      const isKinder = matchedStudent?.type === 'kinder';
      const metaBits = matchedStudent
        ? (isKinder
          ? [getKinderMetaText(matchedStudent)].filter(Boolean)
          : [getElementaryMetaText(matchedStudent), getStudentStatusLabel(matchedStudent)].filter(Boolean))
        : [];

      const leadIcon = renderRecordBoardLeadIcon();

      const summaryButtons = currentRecordMode === 'summary'
        ? ''
        : `<button class="recordSummaryBtn" onclick="event.stopPropagation(); requestSummaryFeedbackFromRecords('${encodedName}', '${encodedRecords}', 6)">6</button><button class="recordSummaryBtn" onclick="event.stopPropagation(); requestSummaryFeedbackFromRecords('${encodedName}', '${encodedRecords}', 12)">12</button>`;

      return `
      <div class="recordStudentBlock savedFeedbackStudentBlock">
        <div class="recordStudentHead savedFeedbackStudentHead" onclick="handleRecordBoardHeadClick(event,this)" onpointerdown="startRecordBoardLongPress(event,'${encodedKey}')" onpointermove="moveRecordBoardLongPress(event)" onpointerup="cancelRecordBoardLongPress()" onpointercancel="cancelRecordBoardLongPress()" oncontextmenu="event.preventDefault()">
          <div class="recordStudentLeft savedFeedbackStudentLeft">
            ${leadIcon}
            <span class="studentTextWrap">
              <span class="recordStudentName">${escapeHtml(sname)}</span>
              ${metaBits.length ? `<span class="studentMetaText">${escapeHtml(metaBits.join('  |  '))}</span>` : ''}
            </span>
          </div>
          <div class="recordStudentActions" onclick="event.stopPropagation()">
            <button class="recordHeadIconBtn" onclick="copyStudentFeedback(this, '${encodedName}', '${encodedRecords}')" title="복사">${copyIconSvg()}</button>
            ${summaryButtons}
          </div>
        </div>
        <div class="recordStudentContent">
          ${Object.keys(group.years).sort((a, b) => Number(b) - Number(a)).map(year => `
            <div class="recordYearBlock">
              <div class="recordYearLabel">${year}년</div>
              ${group.years[year].map(r => `
                <div class="recordItem">
                  <div class="recordDate">${escapeHtml(String(r.date || ''))}</div>
                  <div class="recordText">${escapeHtml(String(r.content || ''))}</div>
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="recordEmpty">${escapeHtml(err.message || '오류가 발생했습니다.')}</div>`;
  }
}


window.syncRecordAcademyPageState = syncRecordAcademyPageState;
window.closeRecordAcademyManagementPage = closeRecordAcademyManagementPage;
