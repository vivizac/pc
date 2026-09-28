(function(){
'use strict';
let currentId='';
const cache=new Map();
const loading=new Set();

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
  if(!res.ok){const detail=data&&typeof data==='object'?[data.message,data.details,data.hint,data.code].filter(Boolean).join(' / '):String(data||'');throw new Error(`상담 결과 서버 요청 실패 (${res.status})${detail?'\n'+detail:''}`);}
  return data;
}
function cleanObject(value){return value&&typeof value==='object'&&!Array.isArray(value)?{...value}:{};}
function makeState(row,observationResult,finalResult){
  const observation=observationResult?.row&&typeof observationResult.row==='object'?observationResult.row:null;
  const surveyAnalysis=window.OlliConsultationAnalysis.analyze(row?.answers||{});
  const auto=window.OlliConsultationFinalAnalysis.analyze(surveyAnalysis,observation||{});
  const saved=finalResult?.row&&typeof finalResult.row==='object'?finalResult.row:null;
  return {
    survey_updated_at:String(row?.updated_at||''),
    observation,
    auto,
    savedOverrides:cleanObject(saved?.override_result?.hypothesis_statuses),
    result:null
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
    cache.set(id,makeState(row,observationResult,finalResult));
  }catch(err){cache.set(id,{error:err?.message||'상담 결과를 불러오지 못했습니다.'});}
  finally{loading.delete(id);renderSection(id);}
}
function liveOverrides(id,state){
  const overrides={...state.savedOverrides};
  const hypotheses=Array.isArray(state.auto?.hypotheses)?state.auto.hypotheses:[];
  const autoMap=Object.fromEntries(hypotheses.map(item=>[String(item.patternId),String(item.autoStatus||'needs')]));
  document.querySelectorAll('[data-consultation-final-section] .consultationFinalStatusSelect').forEach(select=>{
    const attr=String(select.getAttribute('onchange')||'');
    const match=attr.match(/setConsultationFinalStatus\('([^']+)','([^']+)'/);
    if(!match||String(match[1])!==String(id))return;
    const patternId=String(match[2]);const selected=String(select.value||'needs');
    if(selected===autoMap[patternId])delete overrides[patternId];else overrides[patternId]=selected;
  });
  return overrides;
}
function resultFor(id,state){
  const row=rowById(id);if(!row)return null;
  return window.OlliConsultationResultSheet.build({
    studentName:row.student_name||row.name||'',
    answers:row.answers||{},
    observation:state.observation||{},
    finalAnalysis:state.auto,
    overrides:liveOverrides(id,state)
  });
}
function cards(items){
  if(!Array.isArray(items)||!items.length)return '<div class="consultationResultEmpty">이번 체험수업에서 이 항목을 자동 선택할 만큼 충분한 관찰 근거가 없습니다.</div>';
  return `<div class="consultationResultCards">${items.map(item=>`<div class="consultationResultCard"><div class="consultationResultCardHead"><span class="consultationResultCode">${esc(item.code)}</span><span class="consultationResultName">${esc(item.name)}</span></div><p>${esc(item.sentence)}</p></div>`).join('')}</div>`;
}
function block(letter,title,items){return `<div class="consultationResultBlock"><div class="consultationResultLabel"><b>${esc(letter)}</b>${esc(title)}</div>${cards(items)}</div>`;}
function contentHtml(id,result){
  return `<div class="consultationResultSheet"><div class="consultationResultIntro"><b>상담 핵심 결과</b><span>강점 → 현재 성향 → 성장 방향 → 지도방법 순서로 정리했습니다. 관찰 조합을 기본 근거로 삼고, 위의 최종 성향 판정은 결과 우선순위에 함께 반영됩니다. 판정을 수정하면 아래 결과도 즉시 다시 계산됩니다.</span></div>${block('S','아이의 강점',result.strengths)}${block('T','현재 나타나는 성향',result.tendencies)}${block('G','앞으로 성장시킬 부분',result.growth)}${block('M','아이에게 효과적인 지도방법',result.methods)}<div class="consultationResultEvidence"><b>관찰 근거</b><br>${esc(result.evidenceSentence||'')}</div><div class="consultationParentText"><div class="consultationParentTextHead"><div><b>학부모 상담 문장</b><span>매뉴얼 문장 라이브러리와 실제 관찰 근거를 순서대로 조합했습니다.</span></div><button type="button" class="consultationParentCopyBtn" onclick="copyConsultationParentText('${esc(id)}')">상담문 복사</button></div><p>${esc(result.consultationText||'')}</p></div></div>`;
}
function renderSection(id){
  if(String(id)!==String(currentId))return;
  const card=document.getElementById('consultationSurveyDetailCard');if(!card)return;
  let section=card.querySelector('[data-consultation-result-section]');
  if(!section){section=document.createElement('div');section.className='consultationDetailSection consultationDetailTabPanel';section.dataset.consultationResultSection='1';section.dataset.consultationTabPanel='final';section.innerHTML='<div class="consultationDetailSectionTitle">상담 핵심 결과</div><div data-consultation-result-body></div>';card.appendChild(section);}
  const body=section.querySelector('[data-consultation-result-body]');if(!body)return;
  if(!window.OlliConsultationResultSheet?.build||!window.OlliConsultationFinalAnalysis?.analyze){body.innerHTML='<div class="consultationAnalysisWaiting">상담 결과 기준을 준비하는 중입니다.</div>';return;}
  const state=cache.get(String(id));
  if(!state){body.innerHTML='<div class="consultationAnalysisWaiting">최종 판정과 상담 결과를 불러오는 중입니다.</div>';loadState(id);return;}
  if(state.error){body.innerHTML=`<div class="consultationAnalysisWaiting">${esc(state.error)}</div>`;return;}
  if(!state.observation?.is_completed){body.innerHTML='<div class="consultationAnalysisWaiting">체험수업 관찰을 완료하면 상담 핵심 결과와 학부모 상담 문장을 자동으로 만듭니다.</div>';return;}
  const result=resultFor(id,state);state.result=result;
  body.innerHTML=result?contentHtml(id,result):'<div class="consultationAnalysisWaiting">상담 결과를 계산하지 못했습니다.</div>';
  if(typeof window.syncConsultationDetailTabs==='function')window.syncConsultationDetailTabs();
}
function ensureSection(){
  if(!currentId)currentId=selectedFromDom();
  if(!currentId)return;
  const row=rowById(currentId);if(!row)return;
  const state=cache.get(String(currentId));
  if(state&&!state.error&&String(state.survey_updated_at||'')!==String(row.updated_at||''))cache.delete(String(currentId));
  renderSection(currentId);
}
window.copyConsultationParentText=async function(id){
  const state=cache.get(String(id));if(!state||state.error)return;
  const result=resultFor(String(id),state);const text=String(result?.consultationText||'').trim();if(!text)return;
  try{await navigator.clipboard.writeText(text);toast('학부모 상담 문장을 복사했습니다.');}
  catch(_){const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();toast('학부모 상담 문장을 복사했습니다.');}
};

const originalSet=typeof window.setConsultationFinalStatus==='function'?window.setConsultationFinalStatus:null;
if(originalSet)window.setConsultationFinalStatus=function(){const result=originalSet.apply(this,arguments);queueMicrotask(ensureSection);return result;};
const originalSave=typeof window.saveConsultationFinalAnalysis==='function'?window.saveConsultationFinalAnalysis:null;
if(originalSave)window.saveConsultationFinalAnalysis=async function(id){const result=await originalSave.apply(this,arguments);cache.delete(String(id||''));await loadState(String(id||''));ensureSection();return result;};
const originalOpen=typeof window.openConsultationSurveyDetail==='function'?window.openConsultationSurveyDetail:null;
if(originalOpen)window.openConsultationSurveyDetail=function(id){currentId=String(id||'');const result=originalOpen.apply(this,arguments);queueMicrotask(ensureSection);return result;};

const observer=new MutationObserver(()=>ensureSection());
const detail=document.getElementById('consultationSurveyDetailCard');if(detail)observer.observe(detail,{childList:true,subtree:false});
currentId=selectedFromDom();ensureSection();
})();
