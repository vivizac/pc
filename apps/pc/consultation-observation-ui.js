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
  if(!res.ok){const detail=data&&typeof data==='object'?[data.message,data.details,data.hint,data.code].filter(Boolean).join(' / '):String(data||'');throw new Error(`수업 관찰 서버 요청 실패 (${res.status})${detail?'\n'+detail:''}`);}
  return data;
}
function cleanObject(value){return value&&typeof value==='object'&&!Array.isArray(value)?{...value}:{};}
function makeDraft(row,saved){
  const analysis=window.OlliConsultationAnalysis.analyze(row?.answers||{});
  let selected=saved?window.OlliConsultationObservation.normalizeSelected(saved.selected_item_ids):[];
  if(selected.length<6||selected.length>10)selected=window.OlliConsultationObservation.selectItems(analysis);
  return {selected_item_ids:selected.map(item=>item.id),ratings:cleanObject(saved?.ratings),notes:cleanObject(saved?.notes),is_completed:!!saved?.is_completed,updated_at:saved?.updated_at||''};
}
async function loadRecord(id){
  id=String(id||'');if(!id||cache.has(id)||loading.has(id))return;
  const row=rowById(id);if(!row)return;
  loading.add(id);renderSection(id);
  try{
    const result=await rpc('olli_get_consultation_observation',{p_session_token:sessionToken(),p_academy_id:academyId(),p_survey_id:id});
    if(!result||result.ok!==true)throw new Error(result?.message||'수업 관찰 기록을 불러오지 못했습니다.');
    cache.set(id,makeDraft(row,result.row&&typeof result.row==='object'?result.row:null));
  }catch(err){cache.set(id,{error:err?.message||'수업 관찰 기록을 불러오지 못했습니다.'});}
  finally{loading.delete(id);renderSection(id);}
}
function ratingButtons(id,itemId,value){
  return window.OlliConsultationObservation.ratings.map(r=>`<button type="button" class="consultationRatingBtn ${String(value||'')===r.value?'active':''}" data-observation-rating="${esc(itemId)}:${esc(r.value)}" onclick="setConsultationObservationRating('${esc(id)}','${esc(itemId)}','${esc(r.value)}')">${esc(r.label)}</button>`).join('');
}
function formHtml(id,draft){
  const items=window.OlliConsultationObservation.normalizeSelected(draft.selected_item_ids);
  const rated=items.filter(item=>['2','1','0','X'].includes(String(draft.ratings[item.id]||''))).length;
  const complete=draft.is_completed;
  return `<div class="consultationObservationIntro"><div><b>${complete?'관찰 기록 완료':'설문 가설 기반 관찰 항목'}</b><span>24개 전체 문항 중 현재 가설을 확인하는 데 필요한 항목만 자동으로 골랐습니다.</span></div><span data-observation-progress="${esc(id)}">${rated}/${items.length}개 기록</span></div><div class="consultationObservationList">${items.map(item=>`<div class="consultationObservationItem" data-observation-item="${esc(item.id)}"><div class="consultationObservationItemHead"><b>${esc(item.id)}</b><span>${esc(item.groupName)}</span></div><div class="consultationObservationText">${esc(item.text)}</div><div class="consultationRatingGrid">${ratingButtons(id,item.id,draft.ratings[item.id])}</div><textarea class="consultationObservationNote" maxlength="500" placeholder="관찰한 장면이나 말을 짧게 메모해주세요. (선택)" oninput="setConsultationObservationNote('${esc(id)}','${esc(item.id)}',this.value)">${esc(draft.notes[item.id]||'')}</textarea></div>`).join('')}</div><div class="consultationObservationActions"><button type="button" class="consultationObservationSaveBtn secondary" onclick="saveConsultationObservation('${esc(id)}',false)">임시 저장</button><button type="button" class="consultationObservationSaveBtn" onclick="saveConsultationObservation('${esc(id)}',true)">${complete?'완료 내용 다시 저장':'관찰 완료'}</button></div><div class="consultationObservationFoot">관찰 완료 시 모든 항목의 선택이 필요하며, 완료 후 상태가 <b>최종 분석 대기</b>로 변경됩니다.</div>`;
}
function renderSection(id){
  if(String(id)!==String(currentId))return;
  const card=document.getElementById('consultationSurveyDetailCard');if(!card)return;
  let section=card.querySelector('[data-consultation-observation-section]');
  if(!section){section=document.createElement('div');section.className='consultationDetailSection consultationDetailTabPanel';section.dataset.consultationObservationSection='1';section.dataset.consultationTabPanel='observation';section.innerHTML='<div class="consultationDetailSectionTitle">체험수업 관찰</div><div data-observation-body></div>';card.appendChild(section);}
  const body=section.querySelector('[data-observation-body]');if(!body)return;
  if(!window.OlliConsultationAnalysis?.analyze||!window.OlliConsultationObservation?.selectItems){body.innerHTML='<div class="consultationAnalysisWaiting">관찰 기준을 준비하는 중입니다.</div>';return;}
  const draft=cache.get(String(id));
  if(!draft){body.innerHTML='<div class="consultationAnalysisWaiting">선택된 관찰 항목과 저장 기록을 불러오는 중입니다.</div>';loadRecord(id);return;}
  if(draft.error){body.innerHTML=`<div class="consultationAnalysisWaiting">${esc(draft.error)}</div>`;return;}
  body.innerHTML=formHtml(id,draft);
  if(typeof window.syncConsultationDetailTabs==='function')window.syncConsultationDetailTabs();
}
function ensureSection(){
  if(!currentId)currentId=selectedFromDom();
  if(!currentId)return;
  const row=rowById(currentId);if(!row)return;
  renderSection(currentId);
}
function updateProgress(id){
  const draft=cache.get(String(id));if(!draft||draft.error)return;
  const total=draft.selected_item_ids.length;const rated=draft.selected_item_ids.filter(itemId=>['2','1','0','X'].includes(String(draft.ratings[itemId]||''))).length;
  const el=document.querySelector(`[data-observation-progress="${CSS.escape(String(id))}"]`);if(el)el.textContent=`${rated}/${total}개 기록`;
}
window.setConsultationObservationRating=function(id,itemId,value){
  const draft=cache.get(String(id));if(!draft||draft.error||!draft.selected_item_ids.includes(String(itemId)))return;
  draft.ratings[String(itemId)]=String(value);draft.is_completed=false;
  const item=document.querySelector(`[data-observation-item="${CSS.escape(String(itemId))}"]`);if(item)item.querySelectorAll('.consultationRatingBtn').forEach(btn=>btn.classList.toggle('active',btn.dataset.observationRating===`${itemId}:${value}`));
  updateProgress(id);
};
window.setConsultationObservationNote=function(id,itemId,value){const draft=cache.get(String(id));if(!draft||draft.error)return;draft.notes[String(itemId)]=String(value||'').slice(0,500);draft.is_completed=false;};
window.saveConsultationObservation=async function(id,complete){
  id=String(id||'');const draft=cache.get(id);if(!draft||draft.error||saving.has(id))return;
  const missing=draft.selected_item_ids.filter(itemId=>!['2','1','0','X'].includes(String(draft.ratings[itemId]||'')));
  if(complete&&missing.length){alert(`관찰 완료 전 ${missing.length}개 항목의 관찰 결과를 선택해주세요.`);return;}
  saving.add(id);
  try{
    const result=await rpc('olli_save_consultation_observation',{p_session_token:sessionToken(),p_academy_id:academyId(),p_survey_id:id,p_selected_item_ids:draft.selected_item_ids,p_ratings:draft.ratings,p_notes:draft.notes,p_complete:!!complete});
    if(!result||result.ok!==true)throw new Error(result?.message||'수업 관찰 기록 저장에 실패했습니다.');
    draft.is_completed=!!complete;draft.updated_at=result.updated_at||'';
    toast(complete?'수업 관찰을 완료했습니다.':'수업 관찰 내용을 임시 저장했습니다.');
    if(typeof originalRefresh==='function')await originalRefresh();
    ensureSection();
  }catch(err){alert(err?.message||'수업 관찰 기록 저장에 실패했습니다.');}
  finally{saving.delete(id);}
};

const originalOpen=typeof window.openConsultationSurveyDetail==='function'?window.openConsultationSurveyDetail:null;
if(originalOpen)window.openConsultationSurveyDetail=function(id){currentId=String(id||'');const result=originalOpen.apply(this,arguments);queueMicrotask(ensureSection);return result;};
const originalRefresh=typeof window.refreshConsultationSurveyManager==='function'?window.refreshConsultationSurveyManager:null;
if(originalRefresh)window.refreshConsultationSurveyManager=async function(){
  const section=document.querySelector('[data-consultation-observation-section]');const active=document.activeElement;
  if((section&&active&&section.contains(active))||saving.size)return rows();
  const result=await originalRefresh.apply(this,arguments);queueMicrotask(ensureSection);return result;
};

const observer=new MutationObserver(()=>ensureSection());
const detail=document.getElementById('consultationSurveyDetailCard');if(detail)observer.observe(detail,{childList:true,subtree:false});
currentId=selectedFromDom();ensureSection();
})();
