function showOlliTestResetMessage(message) {
  if (typeof showPushToast === 'function') showPushToast(message);
  else alert(message);
}

function guardOlliTestResetTool() {
  if (typeof canUseOlliDevTestTools !== 'function' || !canUseOlliDevTestTools()) {
    showOlliTestResetMessage('비비작아이성향미술학원 원장 계정에서만 사용할 수 있는 테스트 기능입니다.');
    return false;
  }
  return true;
}

function clearAcademyManagementRuntimeForTest() {
  if (academyConsultationAutoCheckTimer) {
    clearTimeout(academyConsultationAutoCheckTimer);
    academyConsultationAutoCheckTimer = null;
  }
  if (academyManagementDashboardRenderTimer) {
    clearTimeout(academyManagementDashboardRenderTimer);
    academyManagementDashboardRenderTimer = null;
  }
  academyConsultationSummaryState.running = false;
  academyConsultationSummaryState.items = {};
  academyConsultationSummaryState.expandedKey = '';
  try { localStorage.removeItem(getPendingStudentStatusStorageKey()); } catch (_) {}
}

async function resetAcademyManagementPageForTest() {
  if (!guardOlliTestResetTool()) return;
  const ok = confirm('학원관리 페이지의 임시 계산 상태를 리셋하고\n원생수, 상담, 등록, 퇴원 카운트를 다시 계산합니다.\n\n상담 예정 학생도 모두 다시 확인합니다.');
  if (!ok) return;
  clearAcademyManagementRuntimeForTest();
  try {
    if (typeof loadStudentsFromSupabase === 'function') await loadStudentsFromSupabase();
  } catch (err) {
    console.warn('학원관리 리셋 학생 재조회 실패:', err.message || err);
  }
  if (typeof renderRecordAcademyManagementDashboard === 'function') renderRecordAcademyManagementDashboard();
  if (currentRecordView === 'academy' && typeof scheduleAcademyConsultationSummaryAutoCheck === 'function') {
    scheduleAcademyConsultationSummaryAutoCheck(200);
  }
  showOlliTestResetMessage('학원관리 페이지를 다시 계산합니다.');
}

function removeLocalStorageKeysForStudentTestReset(student) {
  const id = String(student?.id || '').trim();
  if (!id) return;
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || '';
  const safeId = id.replace(/[^a-zA-Z0-9._:-]/g, '_');
  const safeAcademyId = academyId.replace(/[^a-zA-Z0-9._:-]/g, '_');
  const directKeys = [
    ELEMENTARY_MEMO_PREFIX + id,
    ELEMENTARY_ANALYSIS_PREFIX + id,
    ELEMENTARY_RECORDS_PREFIX + id,
    KINDER_MEMO_PREFIX + id,
    MEMO_FEEDBACK_ARCHIVE_PREFIX + id
  ];
  directKeys.forEach(key => {
    try { localStorage.removeItem(key); } catch (_) {}
  });
  try {
    Object.keys(localStorage).forEach(key => {
      const isCommonStudentKey = key.startsWith('olli:v')
        && safeAcademyId
        && key.includes(':' + safeAcademyId + ':' + safeId + ':');
      const isLegacyStudentKey = key.includes(id) && (
        key.startsWith(ELEMENTARY_MEMO_PREFIX) ||
        key.startsWith(ELEMENTARY_ANALYSIS_PREFIX) ||
        key.startsWith(ELEMENTARY_RECORDS_PREFIX) ||
        key.startsWith(KINDER_MEMO_PREFIX) ||
        key.startsWith(MEMO_FEEDBACK_ARCHIVE_PREFIX)
      );
      if (isCommonStudentKey || isLegacyStudentKey) localStorage.removeItem(key);
    });
  } catch (err) {
    console.warn('학생별 로컬 데이터 정리 실패:', err);
  }
}

function clearStudentSyncQueueForTestReset(studentIds) {
  const academyId = (typeof getOlliCurrentAcademyId === 'function' ? getOlliCurrentAcademyId() : '') || '';
  const idSet = new Set((studentIds || []).map(id => String(id || '').trim()).filter(Boolean));
  if (!academyId || !idSet.size) return;
  try {
    const core = window.OlliStorageCore;
    if (!core?.SyncQueue) return;
    const current = core.SyncQueue.read(academyId);
    const filtered = current.filter(item => !idSet.has(String(item.student_id || '').trim()));
    if (filtered.length !== current.length) core.SyncQueue.write(academyId, filtered);
  } catch (err) {
    console.warn('학생 리셋 동기화 큐 정리 실패:', err.message || err);
  }
}

async function deleteStudentFeedbackRowsForTestReset(student) {
  const academyId = requireOlliAcademyId('출석부 학생명단 리셋');
  const studentId = String(student?.id || '').trim();
  if (!studentId || typeof deleteOlliData !== 'function') return [];
  const failures = [];
  const features = [
    { feature: 'general_feedbacks_by_student_delete', label: '일반 피드백' },
    { feature: 'growth_feedbacks_by_student_delete', label: '성장 피드백' },
    { feature: 'summary_feedbacks_by_student_delete', label: '종합 피드백' }
  ];
  for (const item of features) {
    try {
      const result = await deleteOlliData(item.feature, {
        academyId,
        studentId,
        forceCommon: true,
        deleteMode: 'soft',
        reason: 'test_reset'
      });
      if (result && result.ok === false) {
        failures.push(item.label + ': 서버 삭제 대기 또는 실패');
      }
    } catch (err) {
      failures.push(item.label + ': ' + String(err && (err.message || err) || '삭제 실패'));
    }
  }
  return failures;
}

async function deleteStudentNoteRowsForTestReset(student) {
  if (!isSupabaseConfigured() || !student?.id) return [];
  const academyId = requireOlliAcademyId('출석부 학생 노트 리셋');
  const studentId = String(student.id || '').trim();
  const failures = [];
  try {
    await clearStudentNoteDraftFromSupabase(student, student.type === 'kinder' ? 'kinder_risk' : 'elementary_observation');
  } catch (err) {
    failures.push('노트 초안: ' + String(err && (err.message || err) || '삭제 실패'));
  }
  const encodedAcademyId = encodeURIComponent(academyId);
  const encodedStudentId = encodeURIComponent(studentId);
  const tables = ['student_note_drafts', 'student_note_archives'];
  for (const table of tables) {
    try {
      await supabase('DELETE', `${table}?academy_id=eq.${encodedAcademyId}&student_id=eq.${encodedStudentId}`);
    } catch (err) {
      failures.push(table + ': ' + String(err && (err.message || err) || '삭제 실패'));
    }
  }
  return failures;
}

async function softDeleteStudentForTestReset(student) {
  if (!isSupabaseConfigured()) return;
  if (typeof saveOlliData !== 'function') throw new Error('학생 삭제 공통 저장 함수가 준비되지 않았습니다.');
  const academyId = requireOlliAcademyId('출석부 학생명단 리셋');
  const studentId = String(student?.id || '').trim();
  if (!studentId) return;
  const deletedAt = new Date().toISOString();
  const deletedBy = getOlliSoftDeleteActorId();
  const result = await saveOlliData('student_soft_delete', {
    academyId,
    studentId,
    data: {
      is_deleted: true,
      deleted_at: deletedAt,
      deleted_by: deletedBy || null,
      delete_reason: 'test_reset'
    },
    forceCommon: true
  });
  if (result && result.serverSaved && result.verified) return;
  if (result && result.pending) throw new Error('학생 삭제가 서버에 반영되지 않아 재전송 대기열에 남았습니다.');
  throw new Error('학생 삭제 서버 반영을 확인하지 못했습니다.');
}

async function resetSingleStudentForTestReset(student) {
  const relatedFailures = [];
  relatedFailures.push(...await deleteStudentFeedbackRowsForTestReset(student));
  relatedFailures.push(...await deleteStudentNoteRowsForTestReset(student));
  await softDeleteStudentForTestReset(student);
  return relatedFailures;
}

async function resetAttendanceStudentRosterForTest() {
  if (!guardOlliTestResetTool()) return;
  const students = getAllStudents();
  if (!students.length) {
    clearAcademyManagementRuntimeForTest();
    renderRecordAcademyManagementDashboard();
    showOlliTestResetMessage('삭제할 등록 학생이 없습니다.');
    return;
  }
  const ok = confirm('현재 학원의 출석부 학생명단을 리셋합니다.\n\n등록된 학생, 학생별 관찰노트 메모, 분석 설문, 저장 피드백, 종합 피드백을 함께 삭제합니다.\n이 작업은 테스트용이며 되돌리기 어렵습니다.\n\n계속할까요?');
  if (!ok) return;

  const successIds = [];
  const failures = [];
  for (const student of students) {
    const studentId = String(student?.id || '').trim();
    try {
      const relatedFailures = await resetSingleStudentForTestReset(student);
      successIds.push(studentId);
      relatedFailures.forEach(message => failures.push((student.name || studentId) + ' / ' + message));
    } catch (err) {
      failures.push((student?.name || studentId || '학생') + ': ' + String(err && (err.message || err) || '삭제 실패'));
    }
  }

  if (successIds.length) {
    const successSet = new Set(successIds);
    students.forEach(student => {
      if (successSet.has(String(student.id || '').trim())) {
        backupAndRemoveStudentLocalData(student.id, student);
        removeLocalStorageKeysForStudentTestReset(student);
        unmarkDeletedStudentId(student.id);
      }
    });
    setAllStudents(getAllStudents().filter(student => !successSet.has(String(student.id || '').trim())));
    clearStudentSyncQueueForTestReset(successIds);
  }

  if (currentMemoStudent && successIds.includes(String(currentMemoStudent.id || '').trim())) {
    currentMemoStudent = null;
    const memoScreen = document.getElementById('studentMemoScreen');
    const recordScreen = document.getElementById('recordRoomScreen');
    if (memoScreen) memoScreen.style.display = 'none';
    if (recordScreen) recordScreen.style.display = 'flex';
  }

  if (typeof selectedStudentIds !== 'undefined' && selectedStudentIds?.clear) selectedStudentIds.clear();
  clearAcademyManagementRuntimeForTest();
  try { await loadStudentsFromSupabase(); } catch (err) { console.warn('학생명단 리셋 후 학생 재조회 실패:', err.message || err); }
  try {
    const searchValue = document.getElementById('searchName')?.value?.trim() || '';
    if (typeof loadRecords === 'function') await loadRecords(searchValue);
  } catch (err) {
    console.warn('학생명단 리셋 후 출석부 갱신 실패:', err.message || err);
  }
  if (typeof renderRecordAcademyManagementDashboard === 'function') renderRecordAcademyManagementDashboard();
  try { if (typeof refreshMemoStudentSelectPopupIfOpen === 'function') refreshMemoStudentSelectPopupIfOpen(); } catch (_) {}

  const baseMessage = successIds.length + '명의 학생을 출석부에서 리셋했습니다.';
  if (failures.length) {
    alert(baseMessage + '\n\n일부 서버 기록 정리에 실패했습니다. 저장 진단을 확인해 주세요.\n' + failures.slice(0, 5).join('\n'));
  } else {
    showOlliTestResetMessage(baseMessage);
  }
}


