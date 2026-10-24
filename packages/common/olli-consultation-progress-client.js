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
  function assertProductionWriteHost() {
    const host = String(global.location?.hostname || '').toLowerCase();
    if (host.endsWith('.vercel.app') && host !== 'pc-seven-silk.vercel.app'
      && host !== 'vivizac-feedback.vercel.app') {
      throw new Error('미리보기 주소에서는 실제 상담 데이터를 변경할 수 없습니다.');
    }
  }

  const VALID_TASK_RULES=new Set(['after_1','after_3','every_6','every_12']);
  function summaryMonthsForTask(task) {
    return task?.ruleKey==='after_1'?1:task?.ruleKey==='after_3'?3:task?.ruleKey==='every_6'?6:12;
  }
  function primaryTask(student,requestedMonths=0) {
    const taskLoader=global.getConsultationDueTasksForStudent;
    if(typeof taskLoader!=='function')return null;
    let tasks=(taskLoader(student)||[]).filter(t=>t?.key&&VALID_TASK_RULES.has(t.ruleKey));
    const months=Number(requestedMonths)||0;
    if(months)tasks=tasks.filter(t=>summaryMonthsForTask(t)===months);
    // Newest due month wins. Annual reviews take priority if multiple rules
    // resolve to the same due month; the displayed tenure is NOT this period.
    tasks.sort((a,b)=>String(b.dueMonth||'').localeCompare(String(a.dueMonth||''))
      ||summaryMonthsForTask(b)-summaryMonthsForTask(a));
    return tasks[0]||null;
  }
  function cacheKey(academyId,task) {
    if(!academyId||!task?.key||!/^id:[0-9a-f-]{36}\|/.test(String(task.key)))return '';
    return String(academyId)+'|'+String(task.key);
  }
  function localCacheName(key) {
    return 'olli_consultation_verified_status_v2_'+String(key);
  }
  function readCachedStatus(key) {
    if(!key)return null;
    try {
      const saved=JSON.parse(global.localStorage?.getItem(localCacheName(key))||'null');
      if(!saved||!['ready','insufficient'].includes(saved.status))return null;
      return {status:saved.status,feedbackId:saved.feedbackId||null,checkedAt:saved.checkedAt||''};
    }catch(_){return null}
  }
  function writeCachedStatus(key,value) {
    if(!key||!['ready','insufficient'].includes(value?.status))return false;
    const data={status:value.status,feedbackId:value.status==='ready'?value.feedbackId||null:null,
      checkedAt:new Date().toISOString()};
    try {global.localStorage?.setItem(localCacheName(key),JSON.stringify(data));return true}
    catch(_){return false}
  }
  global.OlliConsultationServer = Object.freeze({
    readProgress: () => request('read'),
    setCompleted: (taskKeys, completed) => { assertProductionWriteHost(); return request('set_completed', {taskKeys,completed}); },
    setTodos: todos => { assertProductionWriteHost(); return request('set_todos', {todos}); },
    readRules: () => request('read_rules'),
    setRules: rules => { assertProductionWriteHost(); return request('set_rules', {rules}); },
    getPrimaryTask: primaryTask,
    getSummaryMonthsForTask: summaryMonthsForTask,
    getCacheKey: cacheKey,
    readCachedStatus,
    writeCachedStatus,
    // Both PC and Mobile call this single shared status normalization function.
    async checkSummaryStatus(student,task) {
      if(!student?.id||!task?.key)throw new Error('상담 회차 정보가 없습니다.');
      const {academyId}=context();
      const data=await this.inspectSummary(student.id,task.key);
      const verified=data.status==='ready'&&Number.isSafeInteger(Number(data.feedbackId))
        && Number(data.feedbackId)>0;
      const result={...data,status:verified?'ready':'insufficient'};
      writeCachedStatus(cacheKey(academyId,task),result);
      return result;
    },
    // Read-only material and existing summary check. Never claims jobs or generates AI.
    async inspectSummary(studentId, taskKey) {
      const { academyId, sessionToken } = context();
      const response=await global.fetch('/api/consultation-summary',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({academyId,sessionToken,studentId,taskKey,action:'inspect'})
      });
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.message||data.error||'상담 자료 조회 실패');
      return data;
    },
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
    },
    async requestManualSummary(studentId, months, selectedFeedbackIds) {
      const { academyId, sessionToken } = context();
      const validMonths = [1, 3, 6, 12].includes(Number(months));
      if (!validMonths) throw new Error('지원하지 않는 종합 피드백 기간입니다.');
      const date = new Date();
      const due = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2,'0');
      const taskKey = 'id:' + studentId + '|manual_' + Number(months) + '|' + due;
      const response = await global.fetch('/api/consultation-summary', {
        method: 'POST', headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({academyId,sessionToken,studentId,taskKey,selectedFeedbackIds})
      });
      const data=await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message||data.error||'수동 종합 피드백 서버 오류');
      return {...data,taskKey};
    },
    async reviseManualSummary(studentId, taskKey, content) {
      const {academyId,sessionToken}=context();
      const response=await global.fetch('/api/consultation-summary',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({academyId,sessionToken,studentId,taskKey,action:'revise',content})
      });
      const data=await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message||data.error||'종합 피드백 수정 저장 실패');
      return data;
    }
  });
})(window);
