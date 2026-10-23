/* Single server authority for consultation progress and summary job status.
   Neither browser writes academy_settings directly. Account session is validated by RPC. */
(function(global) {
  'use strict';
  const RPC = 'rpc/olli_consultation_progress_access';
  function context() {
    const academyId = String(typeof global.getOlliCurrentAcademyId === 'function'
      ? global.getOlliCurrentAcademyId() : '').trim();
    const sessionToken = String(global.localStorage?.getItem('olli_account_session_token_v1') || '').trim();
    if (!academyId || !sessionToken) throw new Error('학원 로그인 세션을 확인해 주세요.');
    if (typeof global.supabase !== 'function') throw new Error('Supabase 연결이 준비되지 않았습니다.');
    return { academyId, sessionToken };
  }
  async function request(action, options = {}) {
    const { academyId, sessionToken } = context();
    const result = await global.supabase('POST', RPC, {
      p_session_token: sessionToken,
      p_academy_id: academyId,
      p_action: action,
      p_task_keys: options.taskKeys || null,
      p_completed: options.completed === true ? true : options.completed === false ? false : null,
      p_todos: options.todos || null,
      p_rules: options.rules || null
    });
    if (!result?.ok) {
      const error = new Error('상담 상태를 서버에 저장하거나 불러오지 못했습니다: ' + (result?.code || 'UNKNOWN'));
      error.code = result?.code || 'CONSULTATION_RPC_FAILED';
      throw error;
    }
    return action==='read_rules'||action==='set_rules' ? (result.rules || {}) : (result.progress || {});
  }
  global.OlliConsultationServer = Object.freeze({
    readProgress: () => request('read'),
    setCompleted: (taskKeys, completed) => request('set_completed', { taskKeys, completed }),
    setTodos: todos => request('set_todos', { todos }),
    readRules: () => request('read_rules'),
    setRules: rules => request('set_rules', { rules }),
    // Claim status is owned by the central server endpoint, never the client.
    async requestSummary(studentId, taskKey) {
      const { academyId, sessionToken } = context();
      const response = await global.fetch('/api/consultation-summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ academyId, sessionToken, studentId, taskKey })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || data.error || '종합 피드백 서버 처리 실패');
      return data;
    }
  });
})(window);
