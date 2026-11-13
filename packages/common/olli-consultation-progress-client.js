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

  let consultationBatchRunning=false;
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
      if(saved.status==='ready'&&(!Number.isSafeInteger(Number(saved.feedbackId))||Number(saved.feedbackId)<=0))return null;
      return {status:saved.status,feedbackId:saved.feedbackId||null,checkedAt:saved.checkedAt||''};
    }catch(_){return null}
  }
  function writeCachedStatus(key,value) {
    if(!key||!['ready','insufficient'].includes(value?.status))return false;
    if(value.status==='ready'&&(!Number.isSafeInteger(Number(value.feedbackId))||Number(value.feedbackId)<=0))return false;
    const data={status:value.status,feedbackId:value.status==='ready'?value.feedbackId||null:null,
      checkedAt:new Date().toISOString()};
    try {global.localStorage?.setItem(localCacheName(key),JSON.stringify(data));return true}
    catch(_){return false}
  }
  global.OlliConsultationServer = Object.freeze({
    readProgress: () => request('read'),
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
    // Date-only schedule evidence for the current academy, read after session authorization.
    async readFirstLessons(){
      const {academyId,sessionToken}=context();
      const response=await global.fetch('/api/consultation-summary',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({academyId,sessionToken,action:'first_lessons'})
      });
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.message||data.error||'첫 수업일 조회 실패');
      return data.dates||{};
    },
    // Explicit manager action. Every read and write uses the existing
    // session-protected server endpoint and the exact current-month task.
    // A previous ready report is never generated again.
    async generateDueSummaries(students,onProgress){
      assertProductionWriteHost();
      const {academyId}=context();
      const role=typeof global.getOlliCurrentRole==='function'?global.getOlliCurrentRole():'';
      if(!['owner','manager','super_admin'].includes(role))
        throw new Error('원장 또는 관리자 계정으로 실행해 주세요.');
      if(consultationBatchRunning)throw new Error('종합 피드백 일괄 생성이 이미 실행 중입니다.');
      if(!Array.isArray(students)||students.length>200)
        throw new Error('현재 학원의 상담예정학생 목록을 확인해 주세요.');
      const month=new Date();
      const dueMonth=month.getFullYear()+'-'+String(month.getMonth()+1).padStart(2,'0');
      const keys=new Set();
      const planned=[];
      for(const student of students){
        if(!student?.id||student.academy_id&&String(student.academy_id)!==academyId)continue;
        const task=primaryTask(student);
        if(!task||task.dueMonth!==dueMonth||keys.has(task.key))continue;
        keys.add(task.key);
        planned.push({student,task});
      }
      const summary={total:planned.length,processed:0,created:0,existing:0,
        insufficient:0,generating:0,reviewRequired:0,error:0,failedNames:[]};
      consultationBatchRunning=true;
      try{
        for(const {student,task} of planned){
          // Never continue an in-flight request for an unrelated academy.
          if(context().academyId!==academyId)throw new Error('학원이 변경되어 일괄 생성을 중지했습니다.');
          try{
            const existing=await this.checkSummaryStatus(student,task);
            if(existing.status==='ready'&&Number(existing.feedbackId)>0){
              summary.existing++;
            }else if(existing.reviewRequired===true){
              summary.reviewRequired++;
            }else{
              const result=await this.requestSummary(student.id,task.key);
              if(result.status==='ready'&&Number.isSafeInteger(Number(result.feedbackId))&&Number(result.feedbackId)>0){
                writeCachedStatus(cacheKey(academyId,task),{status:'ready',feedbackId:Number(result.feedbackId)});
                summary.created++;
              }else if(result.status==='generating'){
                summary.generating++;
              }else if(result.reviewRequired===true){
                summary.reviewRequired++;
              }else{
                summary.insufficient++;
              }
            }
          }catch(error){
            summary.error++;
            summary.failedNames.push(String(student.name||'학생')+': '+String(error?.message||error));
          }
          summary.processed++;
          if(typeof onProgress==='function'){
            try{onProgress({...summary},student.name)}catch(_){}
          }
        }
      }finally{consultationBatchRunning=false;}
      return summary;
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
    // Explicit owner review. Candidate retrieval cannot mark a task ready.
    async listLegacyCandidates(studentId,taskKey) {
      const {academyId,sessionToken}=context();
      const response=await global.fetch('/api/consultation-summary',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({academyId,sessionToken,studentId,taskKey,action:'legacy_candidates'})
      });
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.message||data.error||'기존 피드백 조회 실패');
      return data;
    },
    async linkLegacySummary(studentId,taskKey,feedbackId) {
      assertProductionWriteHost();
      if(!Number.isSafeInteger(Number(feedbackId))||Number(feedbackId)<=0)
        throw new Error('연결할 피드백을 선택해 주세요.');
      const {academyId,sessionToken}=context();
      const response=await global.fetch('/api/consultation-summary',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({academyId,sessionToken,studentId,taskKey,
          action:'link_legacy',feedbackId:Number(feedbackId),confirmExactRecord:true})
      });
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.message||data.error||'기존 피드백 연결 실패');
      return data;
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
