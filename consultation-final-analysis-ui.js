(function(){
'use strict';
let currentId='';
const cache=new Map();
const loading=new Set();
const saving=new Set();

function esc(value){
  if(typeof window.escapeHtml==='function')return window.escapeHtml(String(value??''));
  return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function academyId(){return String((typeof window.getOlliCurrentAcademyId==='function'?window.getOlliCurrentAcademyId():'')||localStorage.getItem('olli_current_academy_id')||'').trim();}
function sessionToken(){return String(localStorage.getItem('olli_account_session_token_v1')||'').trim();}
function rows(){return typeof window.getConsultationSurveyRows==='function'?window.getConsultationSurveyRows():Array.isArray(window.__olliConsultationRows)?window.__olliConsultationRows.slice():[];}
function rowById(id){return rows().find(row=>String(row.id)===String(id));}
function selectedFromDom(){
  const active=document.querySelector('.consultationListRow.active');
  const code=active?.getAttribute('onclick')||'';
  const match=code.match(/openConsultationSurveyDetail\('([^']+)'\)/);
  return match?match[1]:'';
}
function toast(text){if(typeof window.showPushToast==='function')window.showPushToast(text);else alert(text);}
async function rpc(name,payload){
  if(typeof SUPABASE_URL==='undefined'||typeof SUPABASE_KEY==='undefined')throw new Error('Supabase 연결 정보를 찾지 못했습니다.');
  const res=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`},body:JSON.stringify(payload||{})});
  const text=await res.text();let data=null;try{data=text?JSON.parse(text):null}catch(_){data=text}
  if(!res.ok){const detail=data&&typeof data==='object'?[data.message,data.details,data.hint,data.code].filter(Boolean).join(' / '):String(data||'');throw new Error(`최종 분석 서버 요청 실패 (${res.status})${detail?'\n'+detail:''}`);}
  return data;
}
function cleanObject(value){return value&&typeof value==='object'&&!Array.isArray(value)?{...value}:{};}
function statusLabel(key){return ({confirmed:'확인됨',partial:'부분 확인',hold:'보류 또는 제외',needs:'추가 관찰 필요',new:'새롭게 발견됨'})[String(key||'')]||'추가 관찰 필요';}
function makeState(row,observation,finalResult){
  const surveyAnalysis=window.OlliConsultationAnalysis.analyze(row?.answers||{});
  const auto=window.OlliConsultationFinalAnalysis.analyze(surveyAnalysis,observation||{});
  const saved=finalResult?.row&&typeof finalResult.row==='object'?finalResult.row:null;
  const override=cleanObject(saved?.override_result);
  return {
    observation:observation||null,
    auto,
    saved,
    can_save:!!finalResult?.can_save,
    overrides:cleanObject(override.hypothesis_statuses),
    reason:String(saved?.override_reason||''),
    dirty:false
  };
}
async function loadState(id){
  id=String(id||'');if(!id||cache.has(id)||loading.has(id))return;
  const row=rowById(id);if(!row)return;
  loading.add(id);renderSection(id);
  try{
    const [observationResult,finalResult]=await Promise.all([
      rpc('olli_get_consultation_observation',{p_session_token:sessionToken(),p_academy_id:academyId(),p_survey_id:id}),
      rpc('olli_get_consultation_final_analysis',{p_session_token:sessionToken(),p_academy_id:academyId(),p_survey_id:id})
    ]);
    if(!observationResult||observationResult.ok!==true)throw new Error(observationResult?.message||'체험수업 관찰 기록을 불러오지 못했습니다.');
    if(!finalResult||finalResult.ok!==true)throw new Error(finalResult?.message||'최종 분석 기록을 불러오지 못했습니다.');
    cache.set(id,makeState(row,observationResult.row&&typeof observationResult.row==='object'?observationResult.row:null,finalResult));
  }catch(err){cache.set(id,{error:err?.message||'최종 분석을 불러오지 못했습니다.'});}
  finally{loading.delete(id);renderSection(id);}
}
function evidenceHtml(items){
  if(!Array.isArray(items)||!items.length)return '<div class="consultationFinalNoEvidence">이번 체험수업에서 직접 확인할 수 있는 관련 항목이 부족합니다.</div>';
  return `<div class="consultationFinalEvidence">${items.map(item=>`<div><b>${esc(item.id)}</b><span>${esc(item.ratingLabel||'')}</span><p>${esc(item.text||'')}</p></div>`).join('')}</div>`;
}
function currentStatus(h,state){return String(state.overrides[String(h.patternId)]||h.autoStatus||'needs');}
function selectHtml(id,h,state){
  const current=currentStatus(h,state);
  if(!state.can_save)return `<span class="consultationFinalStatus ${esc(current)}">${esc(statusLabel(current))}</span>`;
  const options=['confirmed','partial','hold','needs'];
  return `<select class="consultationFinalStatusSelect" onchange="setConsultationFinalStatus('${esc(id)}','${esc(h.patternId)}',this.value)">${options.map(key=>`<option value="${key}" ${current===key?'selected':''}>${esc(statusLabel(key))}</option>`).join('')}</select>`;
}
function hypothesisCard(id,h,state){
  const current=currentStatus(h,state);const changed=current!==h.autoStatus;
  return `<div class="consultationFinalCard ${esc(current)}"><div class="consultationFinalCardHead"><div><div class="consultationFinalName">${esc(h.name)}</div><div class="consultationFinalMeta">${h.source==='primary'?'주요 성향 가설':'확인이 필요한 성향'}${h.surveyMatch?' · 설문 '+esc(h.surveyMatch):''}</div></div>${selectHtml(id,h,state)}</div><div class="consultationFinalAuto">자동 판정 <b>${esc(h.statusLabel)}</b> · 신뢰도 <b>${esc(h.confidence?.dots||'●○○')} ${esc(h.confidence?.label||'낮음')}</b>${changed?'<span>원장 판정 수정됨</span>':''}</div>${evidenceHtml(h.evidence)}</div>`;
}
function newCard(item){
  return `<div class="consultationFinalCard new"><div class="consultationFinalCardHead"><div><div class="consultationFinalName">${esc(item.name)}</div><div class="consultationFinalMeta">설문 가설에는 없었지만 수업 행동 조합에서 확인</div></div><span class="consultationFinalStatus new">새롭게 발견됨</span></div><div class="consultationFinalAuto">신뢰도 <b>${esc(item.confidence?.dots||'●●○')} ${esc(item.confidence?.label||'중간')}</b>${item.caution?'<span>다른 행동과 함께 추가 해석 필요</span>':''}</div>${evidenceHtml(item.evidence)}</div>`;
}
function summaryHtml(state){
  const counts={confirmed:0,partial:0,hold:0,needs:0,new:state.auto.newDiscoveries.length};
  for(const h of state.auto.hypotheses){const key=currentStatus(h,state);if(Object.prototype.hasOwnProperty.call(counts,key))counts[key]++;}
  return `<div class="consultationFinalSummary"><div><b>설문 + 체험수업 최종 판정</b><span>한 행동이 아니라 여러 관찰 행동의 조합을 기준으로 판정합니다.</span></div><div class="consultationFinalSummaryCounts"><span>확인 ${counts.confirmed}</span><span>부분 ${counts.partial}</span><span>보류 ${counts.hold}</span><span>신규 ${counts.new}</span><span>추가 ${counts.needs}</span></div></div>`;
}
function completedHtml(id,state){
  const saved=!!state.saved;
  return `${summaryHtml(state)}<div class="consultationFinalGroup"><div class="consultationAnalysisLabel">설문 성향 가설 검증</div>${state.auto.hypotheses.length?`<div class="consultationFinalGrid">${state.auto.hypotheses.map(h=>hypothesisCard(id,h,state)).join('')}</div>`:'<div class="consultationNoHypothesis muted">설문에서 표시할 성향 가설이 없어 수업 관찰 결과를 중심으로 확인합니다.</div>'}</div><div class="consultationFinalGroup"><div class="consultationAnalysisLabel">수업에서 새롭게 발견된 성향</div>${state.auto.newDiscoveries.length?`<div class="consultationFinalGrid">${state.auto.newDiscoveries.map(newCard).join('')}</div>`:'<div class="consultationNoHypothesis muted">현재 관찰 항목에서는 설문 밖의 뚜렷한 새 성향 조합이 확인되지 않았습니다.</div>'}</div>${state.can_save?`<div class="consultationFinalReview"><label>판정 수정 이유 <span>자동 판정을 변경한 경우 필수</span></label><textarea maxlength="1000" placeholder="자동 판정을 수정한 이유나 상담 시 참고할 내용을 적어주세요." oninput="setConsultationFinalReason('${esc(id)}',this.value)">${esc(state.reason)}</textarea><button type="button" onclick="saveConsultationFinalAnalysis('${esc(id)}')">${saved?'최종 분석 다시 저장':'상담 준비 완료로 저장'}</button></div>`:'<div class="consultationObservationFoot">최종 판정은 원장 또는 관리자가 확인한 뒤 <b>상담 준비 완료</b>로 저장할 수 있습니다.</div>'}`;
}
function renderSection(id){
  if(String(id)!==String(currentId))return;
  const card=document.getElementById('consultationSurveyDetailCard');if(!card)return;
  let section=card.querySelector('[data-consultation-final-section]');
  if(!section){section=document.createElement('div');section.className='consultationDetailSection';section.dataset.consultationFinalSection='1';section.innerHTML='<div class="consultationDetailSectionTitle">최종 성향 판정</div><div data-final-analysis-body></div>';card.appendChild(section);}
  const body=section.querySelector('[data-final-analysis-body]');if(!body)return;
  if(!window.OlliConsultationFinalAnalysis?.analyze||!window.OlliConsultationAnalysis?.analyze){body.innerHTML='<div class="consultationAnalysisWaiting">최종 분석 기준을 준비하는 중입니다.</div>';return;}
  const state=cache.get(String(id));
  if(!state){body.innerHTML='<div class="consultationAnalysisWaiting">체험수업 관찰 결과와 최종 판정 기록을 불러오는 중입니다.</div>';loadState(id);return;}
  if(state.error){body.innerHTML=`<div class="consultationAnalysisWaiting">${esc(state.error)}</div>`;return;}
  if(!state.observation?.is_completed){body.innerHTML='<div class="consultationAnalysisWaiting">체험수업 관찰을 완료하면 설문 가설과 수업 행동을 비교해 최종 성향을 자동 판정합니다.</div>';return;}
  body.innerHTML=completedHtml(id,state);
}
function ensureSection(){
  if(!currentId)currentId=selectedFromDom();
  if(!currentId)return;
  if(!rowById(currentId))return;
  renderSection(currentId);
}
window.setConsultationFinalStatus=function(id,patternId,status){
  const state=cache.get(String(id));if(!state||state.error||!state.can_save)return;
  const h=state.auto.hypotheses.find(item=>String(item.patternId)===String(patternId));if(!h)return;
  if(String(status)===String(h.autoStatus))delete state.overrides[String(patternId)];else state.overrides[String(patternId)]=String(status);
  state.dirty=true;renderSection(String(id));
};
window.setConsultationFinalReason=function(id,value){const state=cache.get(String(id));if(!state||state.error)return;state.reason=String(value||'').slice(0,1000);state.dirty=true;};
window.saveConsultationFinalAnalysis=async function(id){
  id=String(id||'');const state=cache.get(id);if(!state||state.error||!state.can_save||saving.has(id))return;
  const hasOverride=Object.keys(state.overrides).length>0;
  if(hasOverride&&!state.reason.trim()){alert('자동 판정을 수정한 경우 수정 이유를 입력해주세요.');return;}
  saving.add(id);
  try{
    const overrideResult=hasOverride?{hypothesis_statuses:{...state.overrides}}:{};
    const result=await rpc('olli_save_consultation_final_analysis',{
      p_session_token:sessionToken(),p_academy_id:academyId(),p_survey_id:id,
      p_analysis_version:window.OlliConsultationFinalAnalysis.version,
      p_auto_result:state.auto,p_override_result:overrideResult,p_override_reason:state.reason.trim()
    });
    if(!result||result.ok!==true)throw new Error(result?.message||'최종 분석 저장에 실패했습니다.');
    state.saved={...(state.saved||{}),auto_result:state.auto,override_result:overrideResult,override_reason:state.reason.trim(),updated_at:result.updated_at||''};
    state.dirty=false;
    toast('최종 분석을 저장하고 상담 준비 완료로 변경했습니다.');
    if(typeof originalRefresh==='function')await originalRefresh();
    cache.delete(id);await loadState(id);ensureSection();
  }catch(err){alert(err?.message||'최종 분석 저장에 실패했습니다.');}
  finally{saving.delete(id);}
};

const originalOpen=typeof window.openConsultationSurveyDetail==='function'?window.openConsultationSurveyDetail:null;
if(originalOpen)window.openConsultationSurveyDetail=function(id){currentId=String(id||'');const result=originalOpen.apply(this,arguments);queueMicrotask(ensureSection);return result;};
const originalRefresh=typeof window.refreshConsultationSurveyManager==='function'?window.refreshConsultationSurveyManager:null;
if(originalRefresh)window.refreshConsultationSurveyManager=async function(){
  const section=document.querySelector('[data-consultation-final-section]');const active=document.activeElement;
  if((section&&active&&section.contains(active))||saving.size)return rows();
  const result=await originalRefresh.apply(this,arguments);queueMicrotask(ensureSection);return result;
};
const observer=new MutationObserver(()=>ensureSection());
const detail=document.getElementById('consultationSurveyDetailCard');if(detail)observer.observe(detail,{childList:true,subtree:false});
currentId=selectedFromDom();ensureSection();
})();
