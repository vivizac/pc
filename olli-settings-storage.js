async function downloadSettingsBackup() {
  try {
    const academyId = settingsGetAcademyId();
    if (!academyId) throw new Error('academy_id가 없습니다.');

    const [students, feedbacks, summaries, members] = await Promise.all([
      supabase('GET', `students?select=*&academy_id=eq.${encodeURIComponent(academyId)}`),
      supabase('GET', `feedbacks?select=*&academy_id=eq.${encodeURIComponent(academyId)}`),
      supabase('GET', `summary_feedbacks?select=*&academy_id=eq.${encodeURIComponent(academyId)}`),
      supabase('GET', `academy_members?select=*&academy_id=eq.${encodeURIComponent(academyId)}`)
    ]);

    const backup = {
      exported_at: new Date().toISOString(),
      academy: olliSettingsState.academy,
      members,
      students,
      feedbacks,
      summary_feedbacks: summaries,
};

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0,10);
    a.href = url;
    a.download = 'olli-backup-' + date + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('백업 생성 실패\n' + (err.message || err));
  }
}


function olliStorageDiagnosticsEscape(value) {
  if (typeof settingsEscapeHtml === 'function') return settingsEscapeHtml(value);
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function getOlliStorageDiagnosticsSnapshotSafe() {
  const academyId = (typeof settingsGetAcademyId === 'function' && settingsGetAcademyId())
    || localStorage.getItem('olli_current_academy_id')
    || '';
  const core = window.OlliStorageCore;
  if (!core || !core.Diagnostics || typeof core.Diagnostics.snapshot !== 'function') {
    return {
      foundationVersion: 'not_ready',
      academyId,
      context: { academyId, role: typeof getOlliCurrentRole === 'function' ? getOlliCurrentRole() : '' },
      features: [],
      syncQueue: [],
      issues: [],
      createdAt: new Date().toISOString(),
      notReady: true
    };
  }
  try {
    return core.Diagnostics.snapshot(academyId);
  } catch (err) {
    return {
      foundationVersion: core.foundationVersion || 'unknown',
      academyId,
      context: core.AcademyContext && typeof core.AcademyContext.getCurrent === 'function' ? core.AcademyContext.getCurrent() : {},
      features: core.Diagnostics.registrySnapshot ? core.Diagnostics.registrySnapshot() : [],
      syncQueue: [],
      issues: [{ feature: 'storage_diagnostics', operation: 'snapshot', error_code: 'SNAPSHOT_FAILED', error_message: String(err && (err.message || err) || ''), created_at: new Date().toISOString() }],
      createdAt: new Date().toISOString()
    };
  }
}
function olliStorageDiagnosticsStatusLabel(status) {
  const value = String(status || '').trim();
  if (value === 'blocked') return '점검 필요';
  if (value === 'pending') return '재전송 대기';
  if (value === 'synced') return '동기화 완료';
  if (value === 'failed') return '실패';
  return value || '대기';
}
function olliFormatDiagnosticsDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    }).format(date);
  } catch (_) {
    return date.toLocaleString('ko-KR');
  }
}
function renderOlliStorageDiagnosticsFeatureList(features) {
  const rows = Array.isArray(features) ? features : [];
  if (!rows.length) return '<div class="settingsEmptyBox">등록된 공통 저장 기능을 아직 읽지 못했습니다.</div>';
  return '<div class="settingsInfoCard">'
    + '<div class="settingsInfoHead">등록된 저장 기능</div>'
    + rows.map(item => {
      const label = item.label || item.feature || '';
      const meta = [item.feature, item.table ? ('테이블 ' + item.table) : '', item.scope, item.persistence].filter(Boolean).join(' · ');
      const mode = item.mode || 'legacy';
      return '<div class="settingsInfoItem"><strong>' + olliStorageDiagnosticsEscape(label) + '</strong><br><span class="settingsMiniText">'
        + olliStorageDiagnosticsEscape(meta) + '</span><br><span class="settingsBadge ' + (mode === 'common' ? '' : 'warn') + '">' + olliStorageDiagnosticsEscape(mode) + '</span></div>';
    }).join('')
    + '</div>';
}
function renderOlliStorageDiagnosticsQueue(queue) {
  const rows = Array.isArray(queue) ? queue : [];
  if (!rows.length) return '<div class="settingsInfoCard"><div class="settingsInfoHead">재전송 대기열</div><div class="settingsInfoItem">현재 학원에 재전송 대기 항목이 없습니다.</div></div>';
  return '<div class="settingsInfoCard">'
    + '<div class="settingsInfoHead">재전송 대기열</div>'
    + rows.slice(0, 30).map(item => {
      const status = olliStorageDiagnosticsStatusLabel(item.status);
      const meta = [item.operation, item.student_id ? ('학생 ' + item.student_id) : '', item.record_id ? ('기록 ' + item.record_id) : '', item.file_id ? ('파일 ' + item.file_id) : '', item.created_at ? ('생성 ' + olliFormatDiagnosticsDate(item.created_at)) : '', item.last_attempt_at ? ('마지막 시도 ' + olliFormatDiagnosticsDate(item.last_attempt_at)) : ''].filter(Boolean).join(' · ');
      const err = item.error_message ? '<div class="settingsMiniText">' + olliStorageDiagnosticsEscape(item.error_message).slice(0, 160) + '</div>' : '';
      return '<div class="settingsRequestCard"><div class="settingsRequestTop"><div class="settingsRequestName">'
        + olliStorageDiagnosticsEscape(item.feature || 'unknown')
        + '</div><span class="settingsStatusBadge waiting">' + olliStorageDiagnosticsEscape(status) + '</span></div>'
        + '<div class="settingsRequestMeta"><div>' + olliStorageDiagnosticsEscape(meta || '작업 정보 없음') + '</div><div>시도 횟수: '
        + olliStorageDiagnosticsEscape(item.retry_count || 0) + '</div></div>' + err + '</div>';
    }).join('')
    + (rows.length > 30 ? '<div class="settingsMiniText">외 ' + (rows.length - 30) + '건은 진단 파일 내보내기에서 확인할 수 있습니다.</div>' : '')
    + '</div>';
}
function renderOlliStorageDiagnosticsIssues(issues) {
  const rows = Array.isArray(issues) ? issues : [];
  if (!rows.length) return '<div class="settingsInfoCard"><div class="settingsInfoHead">최근 오류</div><div class="settingsInfoItem">현재 학원에 기록된 저장 오류가 없습니다.</div></div>';
  return '<div class="settingsInfoCard">'
    + '<div class="settingsInfoHead">최근 오류</div>'
    + rows.slice(0, 30).map(item => {
      const meta = [item.resource, item.operation, item.error_code, olliFormatDiagnosticsDate(item.created_at)].filter(Boolean).join(' · ');
      return '<div class="settingsRequestCard"><div class="settingsRequestTop"><div class="settingsRequestName">'
        + olliStorageDiagnosticsEscape(item.feature || 'unknown')
        + '</div><span class="settingsStatusBadge waiting">오류</span></div>'
        + '<div class="settingsRequestMeta"><div>' + olliStorageDiagnosticsEscape(meta || '오류 정보 없음') + '</div></div>'
        + '<div class="settingsMiniText">' + olliStorageDiagnosticsEscape(item.error_message || item.message || '').slice(0, 220) + '</div></div>';
    }).join('')
    + (rows.length > 30 ? '<div class="settingsMiniText">외 ' + (rows.length - 30) + '건은 진단 파일 내보내기에서 확인할 수 있습니다.</div>' : '')
    + '</div>';
}
function renderOlliStorageDiagnostics() {
  const snapshot = getOlliStorageDiagnosticsSnapshotSafe();
  const features = Array.isArray(snapshot.features) ? snapshot.features : [];
  const queue = Array.isArray(snapshot.syncQueue) ? snapshot.syncQueue : [];
  const issues = Array.isArray(snapshot.issues) ? snapshot.issues : [];
  const retryableBlockedCount = queue.filter(item => String(item.status || '') === 'blocked' && String(item.feature || '') === 'student_soft_delete').length;
  const blockedCount = queue.filter(item => String(item.status || '') === 'blocked' && String(item.feature || '') !== 'student_soft_delete').length;
  const pendingCount = queue.filter(item => String(item.status || '') !== 'blocked').length + retryableBlockedCount;
  const currentRole = (snapshot.context && snapshot.context.role) || (typeof getOlliCurrentRole === 'function' ? getOlliCurrentRole() : '');
  const header = '<div class="settingsDetailIntro">'
    + '<div class="settingsDetailTitle">저장 상태를<br>점검합니다.</div>'
    + '<div class="settingsMiniText">현재 학원 기준으로 공통 저장 기능, 재전송 대기열, 최근 오류를 확인합니다.</div>'
    + '<div class="settingsMiniText">학원 ID: <strong>' + olliStorageDiagnosticsEscape(snapshot.academyId || '없음') + '</strong> · 역할: <strong>' + olliStorageDiagnosticsEscape(currentRole || '확인 안 됨') + '</strong></div>'
    + '<div class="settingsActionGrid"><button class="settingsActionBtn" type="button" onclick="refreshOlliStorageDiagnostics()">새로고침</button><button class="settingsActionBtn primary" type="button" onclick="retryOlliStorageQueue()">재전송 실행</button><button class="settingsActionBtn" type="button" onclick="downloadOlliStorageDiagnostics()">진단 파일 내보내기</button></div>'
    + '<div class="settingsActionGrid" style="margin-top:8px;"><button class="settingsActionBtn primary" type="button" onclick="openOlliTestApprovalManager()">승인관리</button></div>'
    + '</div>';
  const summary = '<div class="settingsCard">'
    + '<div class="settingsRow"><div class="settingsRowLeft"><span class="settingsRowTitle">등록된 저장 기능</span></div><span class="settingsBadge">' + features.length + '개</span></div>'
    + '<div class="settingsRow"><div class="settingsRowLeft"><span class="settingsRowTitle">재전송 대기</span></div><span class="settingsBadge ' + (pendingCount ? 'warn' : '') + '">' + pendingCount + '건</span></div>'
    + '<div class="settingsRow"><div class="settingsRowLeft"><span class="settingsRowTitle">점검 필요</span></div><span class="settingsBadge ' + (blockedCount ? 'warn' : '') + '">' + blockedCount + '건</span></div>'
    + '<div class="settingsRow"><div class="settingsRowLeft"><span class="settingsRowTitle">최근 오류</span></div><span class="settingsBadge ' + (issues.length ? 'warn' : '') + '">' + issues.length + '건</span></div>'
    + '</div>';
  const notReady = snapshot.notReady ? '<div class="settingsErrorBox">공통 저장 기반이 아직 준비되지 않았습니다. 앱을 새로고침한 뒤 다시 확인해 주세요.</div>' : '';
  return header + notReady + summary + renderOlliStorageDiagnosticsQueue(queue) + renderOlliStorageDiagnosticsIssues(issues) + renderOlliStorageDiagnosticsFeatureList(features);
}
function refreshOlliStorageDiagnostics() {
  const body = document.getElementById('settingsDetailBody');
  if (body) body.innerHTML = renderOlliStorageDiagnostics();
  const value = document.getElementById('settingsStorageDiagnosticsValue');
  if (value) {
    const snapshot = getOlliStorageDiagnosticsSnapshotSafe();
    const queueCount = Array.isArray(snapshot.syncQueue) ? snapshot.syncQueue.length : 0;
    const issueCount = Array.isArray(snapshot.issues) ? snapshot.issues.length : 0;
    value.textContent = (queueCount || issueCount) ? `${queueCount + issueCount}건` : '정상';
  }
}
function downloadOlliStorageDiagnostics() {
  try {
    const snapshot = getOlliStorageDiagnosticsSnapshotSafe();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const academy = String(snapshot.academyId || 'academy').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `olli-storage-diagnostics-${academy}-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('저장 진단 파일을 만들지 못했습니다.\n' + (err.message || err));
  }
}


async function retryOlliStorageQueue() {
  const core = window.OlliStorageCore;
  const academyId = (typeof settingsGetAcademyId === 'function' && settingsGetAcademyId())
    || localStorage.getItem('olli_current_academy_id')
    || '';
  if (!core || !core.SyncQueue || !core.FeatureRegistry) {
    alert('공통 저장 기반이 아직 준비되지 않았습니다. 앱을 새로고침한 뒤 다시 시도해 주세요.');
    return;
  }
  if (!academyId) {
    alert('현재 학원 ID를 확인할 수 없습니다. 학원을 다시 선택한 뒤 시도해 주세요.');
    return;
  }
  if (navigator && navigator.onLine === false) {
    alert('인터넷 연결 후 재전송을 실행해 주세요.');
    return;
  }

  const queue = core.SyncQueue.read(academyId).filter(item => {
    const status = String(item.status || 'pending');
    if (status !== 'blocked') return true;
    // 이전 버전에서 CHECK_CONSTRAINT_FAILED로 blocked 처리된 학생 삭제 항목은
    // 이번 버전에서 payload를 정규화해 다시 전송할 수 있게 합니다.
    return String(item.feature || '') === 'student_soft_delete';
  });
  if (!queue.length) {
    alert('재전송할 대기 항목이 없습니다.');
    refreshOlliStorageDiagnostics();
    return;
  }

  let success = 0;
  let failed = 0;
  let skipped = 0;
  const max = Math.min(queue.length, 20);
  for (let i = 0; i < max; i++) {
    const item = queue[i];
    const queueId = item.queue_id;
    const feature = String(item.feature || '').trim();
    const operation = String(item.operation || '').trim().toLowerCase();
    if (!feature || !core.FeatureRegistry.has(feature)) {
      failed++;
      core.SyncQueue.update(academyId, queueId, {
        status: 'blocked',
        last_attempt_at: new Date().toISOString(),
        retry_count: Number(item.retry_count || 0) + 1,
        error_code: 'FEATURE_NOT_REGISTERED',
        error_message: '등록되지 않은 저장 기능입니다: ' + feature
      });
      continue;
    }
    if (operation === 'upload') {
      skipped++;
      core.SyncQueue.update(academyId, queueId, {
        status: 'blocked',
        last_attempt_at: new Date().toISOString(),
        retry_count: Number(item.retry_count || 0) + 1,
        error_code: 'FILE_RETRY_NEEDS_INDEXEDDB',
        error_message: '사진 파일 업로드 재전송은 IndexedDB 파일 보관 구조가 필요합니다.'
      });
      continue;
    }

    core.SyncQueue.update(academyId, queueId, {
      last_attempt_at: new Date().toISOString(),
      retry_count: Number(item.retry_count || 0) + 1,
      status: 'pending'
    });

    const request = {
      academyId: item.academy_id || academyId,
      studentId: item.student_id || undefined,
      memberId: item.member_id || undefined,
      recordId: item.record_id || undefined,
      fileId: item.file_id || undefined,
      noteType: item.note_type || undefined,
      localRecordId: item.local_record_id || undefined,
      data: item.payload || {},
      clientMutationId: item.client_mutation_id || undefined,
      forceCommon: true,
      suppressQueue: true
    };
    if (feature === 'student_soft_delete') {
      const p = item.payload && typeof item.payload === 'object' ? item.payload : {};
      const retryAt = new Date().toISOString();
      request.data = {
        is_deleted: true,
        deleted_at: p.deleted_at || retryAt,
        deleted_by: p.deleted_by || localStorage.getItem('olli_current_member_id') || localStorage.getItem('olli_current_user_id') || '',
        delete_reason: p.delete_reason || p.reason || 'student_deleted'
      };
    }

    try {
      let result;
      if (operation === 'delete' || operation === 'soft_delete') {
        result = await deleteOlliData(feature, Object.assign({}, request, {
          deleteMode: (item.payload && item.payload.deleteMode) || 'soft',
          reason: (item.payload && item.payload.reason) || 'retry'
        }));
      } else {
        result = await saveOlliData(feature, request);
      }
      if ((result && result.serverSaved) || (result && result.deleted)) {
        core.SyncQueue.remove(academyId, queueId);
        success++;
      } else if (result && result.ok && result.pending) {
        failed++;
        core.SyncQueue.update(academyId, queueId, {
          status: 'pending',
          error_code: result.errorCode || 'SERVER_WRITE_PENDING',
          error_message: String(result.error && (result.error.message || result.error) || '서버 저장이 아직 완료되지 않았습니다.')
        });
      } else {
        failed++;
        core.SyncQueue.update(academyId, queueId, {
          status: 'pending',
          error_code: (result && result.errorCode) || 'RETRY_FAILED',
          error_message: String(result && result.error && (result.error.message || result.error) || (result && result.reason) || '재전송에 실패했습니다.')
        });
      }
    } catch (err) {
      failed++;
      core.SyncQueue.update(academyId, queueId, {
        status: 'pending',
        error_code: (err && err.code) || 'RETRY_FAILED',
        error_message: String(err && (err.message || err) || '')
      });
      if (core.Diagnostics && typeof core.Diagnostics.record === 'function') {
        core.Diagnostics.record({
          feature,
          resource: '',
          operation: 'retry',
          academy_id: academyId,
          student_id: item.student_id || null,
          error_code: (err && err.code) || 'RETRY_FAILED',
          error_message: String(err && (err.message || err) || '')
        });
      }
    }
  }

  refreshOlliStorageDiagnostics();
  alert('재전송 처리 결과\n성공: ' + success + '건\n실패: ' + failed + '건' + (skipped ? '\n보류: ' + skipped + '건' : ''));
}
