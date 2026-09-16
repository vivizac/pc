const recordStatusSectionOpenState = {
  elementary: { paused: false, withdrawn: false },
  kinder: { paused: false, withdrawn: false }
};

function isWithdrawnVisibleInAttendance(student) {
  if (getStudentStatus(student) !== 'withdrawn') return false;
  const withdrawnDate = getStudentWithdrawalDateForStats(student);
  if (!withdrawnDate) return true;
  const elapsed = Date.now() - withdrawnDate.getTime();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  return elapsed >= 0 && elapsed <= thirtyDays;
}

function toggleRecordStatusSection(view, status) {
  if (!recordStatusSectionOpenState[view] || !(status in recordStatusSectionOpenState[view])) return;
  recordStatusSectionOpenState[view][status] = !recordStatusSectionOpenState[view][status];
  const searchValue = document.getElementById('searchName')?.value.trim() || '';
  if (view === currentRecordView && (view === 'elementary' || view === 'kinder')) renderCurrentStudentRecords(searchValue);
}

function renderRecordStatusSection(view, status, label, rowsHtml, emptyText) {
  const isOpen = !!recordStatusSectionOpenState[view]?.[status];
  const bodyHtml = rowsHtml || `<div class="recordStatusSectionEmpty">${escapeHtml(emptyText || '해당 학생이 없습니다.')}</div>`;
  return `<div class="recordStatusSection${isOpen ? ' open' : ''}">
    <button type="button" class="recordStatusSectionToggle" onclick="toggleRecordStatusSection('${view}','${status}')" aria-expanded="${isOpen ? 'true' : 'false'}">
      <span>${escapeHtml(label)}</span>
      <span class="recordStatusSectionTriangle" aria-hidden="true"></span>
    </button>
    <div class="recordStatusSectionBody">${bodyHtml}</div>
  </div>`;
}

function renderRecordAttendanceLeadIcon() {
  return `<span class="recordStudentArchiveLeadIcon" aria-hidden="true" style="width:36px;height:36px;min-width:36px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 36px;pointer-events:none;">
    <img src="record-student-archive-icon.png" alt="" draggable="false" style="width:38px;height:38px;display:block;object-fit:contain;pointer-events:none;user-select:none;"/>
  </span>`;
}

function renderRecordAttendanceSummary() {
  // 초등부/유치부 옆 출석부 요약 탭과 월별 출석부 내용은 삭제되었습니다.
  const list = document.getElementById('recordList');
  if (!list) return;
  currentRecordView = currentObservationView === 'kinder' ? 'kinder' : 'elementary';
  updateRecordHeaderUI();
  const searchValue = document.getElementById('searchName')?.value.trim() || '';
  renderCurrentStudentRecords(searchValue);
}

function getRecordAttendanceGuideHtml(student) {
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

function renderElementaryStudentRows(students) {
  const cycleGroups = getElementaryCycleGroups(students);
  let previousSectionKey = '';
  return students.map((student, index) => {
    const metaBits = getElementaryMetaBits(student);
    const metaText = metaBits.join('\u00A0\u00A0|\u00A0\u00A0');
    const attendanceGuideHtml = getRecordAttendanceGuideHtml(student);
    const metaHtml = attendanceGuideHtml !== null
      ? attendanceGuideHtml
      : (metaText ? escapeHtml(metaText) : '');
    const sectionKey = (typeof getRecordSortSectionKey === 'function') ? getRecordSortSectionKey(student, 'elementary', cycleGroups) : getElementaryGroupSectionKey(student, cycleGroups);
    const groupBreakClass = index > 0 && sectionKey !== previousSectionKey ? ' groupBreak' : '';
    previousSectionKey = sectionKey;
    const status = getStudentStatus(student);
    const statusClass = status === 'paused' ? ' studentStatusPaused' : (status === 'withdrawn' ? ' studentStatusWithdrawn' : '');
    return `
    <button class="elementaryStudentRow${groupBreakClass}${statusClass}" onclick="handleStudentRowClick(event,'${escapeTemplateLiteral(student.id)}')" onpointerdown="startStudentLongPress(event,'${escapeTemplateLiteral(student.id)}')" onpointermove="moveStudentLongPress(event)" onpointerup="cancelStudentLongPress()" onpointercancel="cancelStudentLongPress()" oncontextmenu="event.preventDefault()">
      <div class="elementaryRowInner">
        ${renderElementaryLeadIcon(student)}
        <span class="studentTextWrap">
          <span>${escapeHtml(student.name)}</span>
          ${metaHtml ? `<span class="studentMetaText">${metaHtml}</span>` : ''}
        </span>
      </div>
    </button>`;
  }).join('');
}

function renderKinderStudentRows(students) {
  let previousSectionKey = '';
  return students.map((student, index) => {
    const metaBits = getKinderMetaBits(student);
    const attendanceGuideHtml = getRecordAttendanceGuideHtml(student);
    const normalMetaText = metaBits.join('\u00A0\u00A0|\u00A0\u00A0');
    const metaHtml = attendanceGuideHtml !== null
      ? attendanceGuideHtml
      : (normalMetaText ? escapeHtml(normalMetaText) : '');
    const sectionKey = (typeof getRecordSortSectionKey === 'function') ? getRecordSortSectionKey(student, 'kinder') : `status:${getStudentStatus(student)}:${student.age || ''}`;
    const groupBreakClass = index > 0 && sectionKey !== previousSectionKey ? ' groupBreak' : '';
    previousSectionKey = sectionKey;
    const status = getStudentStatus(student);
    const statusClass = status === 'paused' ? ' studentStatusPaused' : (status === 'withdrawn' ? ' studentStatusWithdrawn' : '');
    return `
    <button class="kinderStudentRow${groupBreakClass}${statusClass}" onclick="handleStudentRowClick(event,'${escapeTemplateLiteral(student.id)}')" onpointerdown="startStudentLongPress(event,'${escapeTemplateLiteral(student.id)}')" onpointermove="moveStudentLongPress(event)" onpointerup="cancelStudentLongPress()" onpointercancel="cancelStudentLongPress()" oncontextmenu="event.preventDefault()">
      <div class="kinderRowInner">
        ${renderKinderLeadIcon(student)}
        <span class="studentTextWrap">
          <span>${escapeHtml(student.name)}</span>
          ${metaHtml ? `<span class="studentMetaText">${metaHtml}</span>` : ''}
        </span>
      </div>
    </button>`;
  }).join('');
}

function renderElementaryRecords(name) {
  const list = document.getElementById('recordList');
  let students = getStudentsByType('elementary');
  if (name) students = students.filter(student => student.name.includes(name));

  const activeStudents = sortStudentsForRecord(students.filter(student => getStudentStatus(student) === 'active'));
  const pausedStudents = sortStudentsForRecord(students.filter(student => getStudentStatus(student) === 'paused'));
  const withdrawnStudents = sortStudentsForRecord(students.filter(isWithdrawnVisibleInAttendance));

  const activeHtml = renderElementaryStudentRows(activeStudents);
  const pausedHtml = renderElementaryStudentRows(pausedStudents);
  const withdrawnHtml = renderElementaryStudentRows(withdrawnStudents);
  const activeEmptyHtml = activeHtml ? '' : `<div class="recordEmpty">${name ? '검색된 재원생이 없습니다.' : '등록된 재원생이 없습니다.'}</div>`;
  list.innerHTML = activeHtml
    + activeEmptyHtml
    + renderRecordStatusSection('elementary', 'paused', '휴원', pausedHtml, '휴원생이 없습니다.')
    + renderRecordStatusSection('elementary', 'withdrawn', '퇴원', withdrawnHtml, '최근 한 달 내 퇴원생이 없습니다.');
}

function renderKinderRecords(name) {
  const list = document.getElementById('recordList');
  let students = getStudentsByType('kinder');
  if (name) students = students.filter(student => student.name.includes(name));

  const activeStudents = sortStudentsForRecord(students.filter(student => getStudentStatus(student) === 'active'));
  const pausedStudents = sortStudentsForRecord(students.filter(student => getStudentStatus(student) === 'paused'));
  const withdrawnStudents = sortStudentsForRecord(students.filter(isWithdrawnVisibleInAttendance));

  const activeHtml = renderKinderStudentRows(activeStudents);
  const pausedHtml = renderKinderStudentRows(pausedStudents);
  const withdrawnHtml = renderKinderStudentRows(withdrawnStudents);
  const transferCandidates = name ? [] : getKinderElementaryTransferCandidates();
  const transferBannerHtml = transferCandidates.length
    ? `<button type="button" class="kinderTransferBanner" onclick="openKinderTransferModal()">
        <span class="kinderTransferBannerText"><span class="kinderTransferBannerTitle">초등부 이관 대상</span><span class="kinderTransferBannerSub">3월부터 8세 유치부 학생을 확인해 주세요.</span></span>
        <span class="kinderTransferBannerCount">${transferCandidates.length}명</span>
      </button>`
    : '';
  const activeEmptyHtml = activeHtml ? '' : `<div class="recordEmpty">${name ? '검색된 재원생이 없습니다.' : '등록된 재원생이 없습니다.'}</div>`;
  list.innerHTML = transferBannerHtml + activeHtml
    + activeEmptyHtml
    + renderRecordStatusSection('kinder', 'paused', '휴원', pausedHtml, '휴원생이 없습니다.')
    + renderRecordStatusSection('kinder', 'withdrawn', '퇴원', withdrawnHtml, '최근 한 달 내 퇴원생이 없습니다.');
}


function clearRecordBoardSelection() {
  document.querySelectorAll('.savedFeedbackStudentBlock.studentRowSelected').forEach(el => el.classList.remove('studentRowSelected'));
}

function cancelRecordBoardLongPress() {
  if (recordBoardLongPressTimer) {
    clearTimeout(recordBoardLongPressTimer);
    recordBoardLongPressTimer = null;
  }
}

function startRecordBoardLongPress(e, recordKey) {
  if (currentRecordView === 'elementary' || currentRecordView === 'kinder') return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  cancelRecordBoardLongPress();
  const block = e.currentTarget.closest('.recordStudentBlock');
  const point = getPointerPoint(e);
  recordBoardLongPressStart = point;
  recordBoardLongPressTimer = setTimeout(() => {
    recordBoardLongPressTimer = null;
    suppressNextRecordBoardClick = true;
    clearRecordBoardSelection();
    if (block) block.classList.add('studentRowSelected');
    triggerLightHaptic();
    setTimeout(() => {
      openRecordBoardActionMenu(recordKey, block);
    }, 140);
  }, 650);
}

function moveRecordBoardLongPress(e) {
  if (!recordBoardLongPressTimer) return;
  const point = getPointerPoint(e);
  const dx = Math.abs(point.x - recordBoardLongPressStart.x);
  const dy = Math.abs(point.y - recordBoardLongPressStart.y);
  if (dx > 10 || dy > 10) cancelRecordBoardLongPress();
}

function handleRecordBoardHeadClick(e, headEl) {
  if (suppressNextRecordBoardClick) {
    e.preventDefault();
    e.stopPropagation();
    suppressNextRecordBoardClick = false;
    return;
  }
  toggleStudentBlock(headEl);
}

function openRecordBoardActionMenu(recordKey, blockEl) {
  const key = String(recordKey || '').trim();
  if (!key) return;
  selectedRecordBoardStudentName = key;
  const group = window.__olliRecordBoardGroups?.[key] || {};
  const displayName = group.studentName || group.displayName || key.replace(/^name:/, '').replace(/^id:/, '');
  clearRecordBoardSelection();
  if (blockEl) {
    blockEl.classList.add('studentRowSelected');
    setTimeout(() => {
      clearRecordBoardSelection();
    }, 260);
  }
  const title = document.getElementById('recordBoardActionTitle');
  if (title) title.textContent = `${displayName} 선택`;
  const overlay = document.getElementById('recordBoardActionOverlay');
  if (overlay) overlay.classList.add('show');
}

function closeRecordBoardActionMenu() {
  selectedRecordBoardStudentName = '';
  clearRecordBoardSelection();
  const overlay = document.getElementById('recordBoardActionOverlay');
  if (overlay) overlay.classList.remove('show');
}

function getRecordBoardGroupByKey(recordKey) {
  const key = String(recordKey || '').trim();
  if (!key) return null;
  const group = window.__olliRecordBoardGroups?.[key] || null;
  if (group) return { ...group, key };
  if (key.startsWith('id:')) return { key, studentId: key.slice(3), displayName: key.slice(3), studentName: '' };
  if (key.startsWith('name:')) return { key, studentId: '', displayName: key.slice(5), studentName: key.slice(5) };
  return { key: `name:${key}`, studentId: '', displayName: key, studentName: key };
}

function getOlliSoftDeleteActorId() {
  try {
    if (typeof getCurrentAcademyContext === 'function') {
      const context = getCurrentAcademyContext() || {};
      return String(context.memberId || context.userId || '').trim();
    }
  } catch {}
  return String(
    localStorage.getItem('olli_current_member_id') ||
    localStorage.getItem('olli_current_user_id') ||
    localStorage.getItem('olli_current_member_name') ||
    ''
  ).trim();
}

async function deleteRecordBoardRowsByStudentKey(recordKey) {
  const academyId = requireOlliAcademyId('기록보드 학생 삭제');
  const group = getRecordBoardGroupByKey(recordKey);
  if (!group) return;
  const studentId = String(group.studentId || '').trim();
  if (!studentId) throw new Error('학생코드가 없는 기록은 이름만으로 삭제하지 않습니다. 학생 목록에서 해당 학생을 선택해 주세요.');

  const deleteFeatures = [
    { feature: 'general_feedbacks_by_student_delete', table: 'feedbacks' },
    { feature: 'growth_feedbacks_by_student_delete', table: 'fail_feedbacks' },
    { feature: 'summary_feedbacks_by_student_delete', table: 'summary_feedbacks' }
  ];
  await Promise.all(deleteFeatures.map(item => {
    if (typeof deleteOlliData === 'function') {
      return deleteOlliData(item.feature, {
        academyId,
        studentId,
        forceCommon: true,
        deleteMode: 'soft',
        reason: 'student_deleted'
      }).catch(err => {
        console.warn(`${item.table} 기록 soft delete 대기:`, err.message || err);
      });
    }

    const err = new Error('deleteOlliData 공통 삭제 함수를 사용할 수 없어 피드백 삭제를 중단합니다. 직접 Supabase PATCH/DELETE fallback은 사용하지 않습니다.');
    if (typeof recordOlliStorageIssue === 'function') {
      recordOlliStorageIssue({
        feature: item.feature,
        resource: item.table,
        operation: 'soft_delete_common_missing',
        student_id: studentId,
        message: err.message,
        severity: 'error'
      });
    }
    console.warn(`${item.table} 기록 soft delete 공통 함수 없음:`, err.message);
    return Promise.reject(err);
  }));
}

async function deleteRecordBoardStudentByKey(recordKey) {
  const group = getRecordBoardGroupByKey(recordKey);
  if (!group) return;
  const studentId = String(group.studentId || '').trim();
  const name = String(group.studentName || group.displayName || '').trim();
  if (!studentId && !name) return;

  const matchedStudents = studentId
    ? getAllStudents().filter(student => String(student.id || '').trim() === studentId)
    : getAllStudents().filter(student => String(student.name || '').trim() === name);

  if (!studentId && matchedStudents.length > 1) {
    alert('같은 이름의 학생이 여러 명 있습니다. 학생코드가 있는 기록에서 다시 삭제해 주세요.');
    return;
  }

  const matchedIds = matchedStudents.map(student => String(student.id || '').trim()).filter(Boolean);

  if (matchedIds.length) {
    const matchedStudentMap = new Map(matchedStudents.map(student => [String(student.id || ''), student]));
    const successIds = [];
    const failed = [];
    for (const id of matchedIds) {
      try {
        await deactivateStudentInSupabase(id);
        successIds.push(String(id));
      } catch (err) {
        failed.push({ id: String(id), message: String(err && (err.message || err) || '알 수 없는 오류') });
      }
    }
    if (failed.length) {
      alert(`학생 삭제 서버 저장에 실패했습니다.\n기록보드와 출석부에서 숨기지 않고 그대로 유지합니다.\n저장 진단의 student_soft_delete 오류를 확인해 주세요.\n${failed[0].message}`);
      return;
    }
    if (successIds.length) {
      const idSet = new Set(successIds);
      successIds.forEach(id => backupAndRemoveStudentLocalData(id, matchedStudentMap.get(String(id)) || null));
      setAllStudents(getAllStudents().filter(item => !idSet.has(String(item.id))));
      successIds.forEach(id => unmarkDeletedStudentId(id));
    }
  }

  await deleteRecordBoardRowsByStudentKey(group.key || recordKey);

  if (currentMemoStudent && ((studentId && String(currentMemoStudent.id || '') === studentId) || (!studentId && String(currentMemoStudent.name || '').trim() === name))) {
    currentMemoStudent = null;
  }

  closeRecordBoardActionMenu();
  updateRecordHeaderUI();
  const searchValue = document.getElementById('searchName')?.value.trim() || '';
  await loadRecords(searchValue);
}

async function confirmDeleteRecordBoardSelected() {
  const key = String(selectedRecordBoardStudentName || '').trim();
  if (!key) return;
  const group = getRecordBoardGroupByKey(key);
  const displayName = group?.studentName || group?.displayName || key.replace(/^name:/, '').replace(/^id:/, '');
  const ok = confirm('삭제 시 통계에서 제외됩니다.\n실제 수업한 학생은 퇴원으로 처리해 주세요.');
  if (!ok) return;
  await deleteRecordBoardStudentByKey(key);
}

