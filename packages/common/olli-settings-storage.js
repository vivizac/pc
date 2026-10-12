async function loadSettingsBackupFeedbackRowsSecure(feature, academyId, limit = 5000) {
  const core = window.OlliStorageCore;
  if (!core?.FeatureRegistry || !core?.ServerAdapter) {
    throw new Error('피드백 백업 보호 서버 모듈이 준비되지 않았습니다.');
  }
  const spec = core.FeatureRegistry.require(feature);
  return core.ServerAdapter.read(spec, { academyId }, { limit });
}

async function loadSettingsBackupStudentsSecure(academyId) {
  const core = window.OlliStorageCore;
  if (!core?.FeatureRegistry || !core?.ServerAdapter) {
    throw new Error('학생 백업 보호 서버 모듈이 준비되지 않았습니다.');
  }
  const spec = core.FeatureRegistry.require('students_list');
  return core.ServerAdapter.read(spec, { academyId }, { limit: 5000 });
}

async function loadSettingsBackupMembersSecure(academyId) {
  const sessionToken = String(localStorage.getItem('olli_account_session_token_v1') || '').trim();
  if (!sessionToken) throw new Error('계정 세션이 없어 구성원 백업을 만들 수 없습니다.');
  if (typeof callOlliRpc !== 'function') throw new Error('구성원 보호 조회 모듈이 준비되지 않았습니다.');

  const rows = await callOlliRpc('olli_list_academy_members', {
    p_session_token: sessionToken,
    p_academy_id: academyId
  });
  return Array.isArray(rows) ? rows : (Array.isArray(rows?.rows) ? rows.rows : []);
}

async function downloadSettingsBackup() {
  try {
    const academyId = settingsGetAcademyId();
    if (!academyId) throw new Error('academy_id가 없습니다.');

    const [students, feedbacks, summaries, members] = await Promise.all([
      loadSettingsBackupStudentsSecure(academyId),
      loadSettingsBackupFeedbackRowsSecure('general_feedback_records_read', academyId),
      loadSettingsBackupFeedbackRowsSecure('summary_feedback_records_read', academyId),
      loadSettingsBackupMembersSecure(academyId)
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
