
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


