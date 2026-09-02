(function(){
'use strict';

const QUESTIONS=[
{id:'Q1',text:'아이는 집에서 만들기, 그리기 등의 미술활동을 자주 하나요?',mid:'가끔'},
{id:'Q2',text:'아이는 미술활동을 할 때 관심을 유지하며 오래 몰두하나요?',mid:'보통'},
{id:'Q3',text:'아이는 시작한 미술활동이나 학습활동 등을 끝까지 마무리하려고 하나요?',mid:'보통'},
{id:'Q4',text:'아이는 미술활동이 자신이 원하는 대로 되지 않아 속상해하거나 불편해한 적이 있나요?',mid:'가끔'},
{id:'Q5',text:'아이는 다른 아이의 그림을 따라 그리거나 부러워하는 모습을 보이나요?',mid:'가끔'},
{id:'Q6',text:'아이는 그리고 싶은 것이 있을 때 부모에게 자주 그려달라고 요청하나요?',mid:'가끔'},
{id:'Q7',text:'아이는 게임이나 경쟁 상황에서 졌을 때 속상함을 크게 보이는 편인가요?',mid:'보통'},
{id:'Q8',text:'아이는 새롭거나 어려운 일을 혼자 시도하기보다 부모에게 도움을 요청하는 편인가요?',mid:'보통'},
{id:'Q9',text:'아이는 색·모양·디자인의 차이에 관심을 보이며 자신의 선호를 분명히 표현하는 편인가요?',mid:'보통'},
{id:'Q10',text:'아이는 새로운 환경을 접했을 때 호기심이 많은 편인가요?',mid:'보통'},
{id:'Q11',text:'아이는 새로운 선생님이나 친구, 환경에 적응하는 데 시간이 걸리는 편인가요?',mid:'보통'},
{id:'Q12',text:'아이는 혼자 책을 보거나 부모에게 읽어달라고 요청하는 등 책을 자주 찾는 편인가요?',mid:'가끔'},
{id:'Q13',text:'아이는 책을 읽은 뒤 부모에게 그 책에 관해 이야기하거나 질문하는 편인가요?',mid:'가끔'},
{id:'Q14',text:'아이는 자신이 궁금한 점이나 생각·경험을 질문이나 이야기로 자주 표현하는 편인가요?',mid:'가끔'}
];
let rows=[];
let selectedId='';
let pollTimer=null;
let analysisLoadPromise=null;
const detailTabById=new Map();
const consultationScriptBase=(document.currentScript&&document.currentScript.src)?document.currentScript.src:location.href;

function esc(value){
  if(typeof window.escapeHtml==='function')return window.escapeHtml(String(value??''));
  return String(value??'').replace(/[&<>\"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]));
}
function academyId(){
  return String((typeof window.getOlliCurrentAcademyId==='function'?window.getOlliCurrentAcademyId():'')||localStorage.getItem('olli_current_academy_id')||'').trim();
}
function sessionToken(){return String(localStorage.getItem('olli_account_session_token_v1')||'').trim();}
function answerLabel(value,q){return value==='YES'?'그렇다':value==='MID'?(q?.mid||'보통'):value==='NO'?'아니다':'응답 없음';}
function dateLabel(value){const d=new Date(value);if(Number.isNaN(d.getTime()))return'';return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;}
function statusLabel(value){return({survey_completed:'설문 완료',observation_waiting:'수업 관찰 대기',observation_in_progress:'수업 관찰 중',final_analysis_waiting:'최종 분석 대기',ready:'상담 준비 완료',completed:'상담 완료'})[String(value||'')]||'설문 완료';}
function setHint(text){const el=document.getElementById('consultationServerHint');if(!el)return;el.textContent=text||'';el.classList.toggle('show',!!text);}

function loadAnalysisEngine(){
  if(window.OlliConsultationAnalysis?.analyze)return Promise.resolve(window.OlliConsultationAnalysis);
  if(analysisLoadPromise)return analysisLoadPromise;
  analysisLoadPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=new URL('consultation-analysis.js',consultationScriptBase).toString();
    script.async=true;
    script.onload=()=>window.OlliConsultationAnalysis?.analyze?resolve(window.OlliConsultationAnalysis):reject(new Error('상담 분석 엔진을 초기화하지 못했습니다.'));
    script.onerror=()=>reject(new Error('상담 분석 엔진 파일을 불러오지 못했습니다.'));
    document.head.appendChild(script);
  });
  analysisLoadPromise.then(()=>{if(selectedId)renderDetail(selectedId);}).catch(err=>setHint(err?.message||'상담 분석 엔진을 불러오지 못했습니다.'));
  return analysisLoadPromise;
}
function hypothesisHtml(items,type){
  if(!items.length)return `<div class="consultationNoHypothesis ${type==='confirm'?'muted':''}">${type==='major'?'정확히 일치하는 주요 패턴은 없습니다. 수업 관찰 후 판단이 필요합니다.':'추가 확인이 필요한 근접 패턴이 없습니다.'}</div>`;
  return `<div class="consultationHypothesisGrid">${items.map(item=>`<div class="consultationHypothesisCard ${type}"><div class="consultationHypothesisHead"><span class="consultationHypothesisName">${esc(item.name)}</span><span class="consultationHypothesisMatch">${esc(item.matched+'/'+item.total+' 일치')}</span></div><div class="consultationHypothesisRule">${esc(item.conditionText)}</div>${type==='confirm'&&item.opposites?`<div class="consultationOppositeNote">반대 방향 응답 ${esc(item.opposites)}개 포함 · 수업에서 확인 필요</div>`:''}</div>`).join('')}</div>`;
}
function analysisListHtml(title,items,emptyText){
  return `<div class="consultationAnalysisBlock"><div class="consultationAnalysisLabel">${esc(title)}</div>${items.length?`<div class="consultationAnalysisList">${items.map(item=>`<div class="consultationAnalysisListItem">${esc(item)}</div>`).join('')}</div>`:`<div class="consultationNoHypothesis muted">${esc(emptyText)}</div>`}</div>`;
}
function renderAutomaticAnalysis(answers){
  const engine=window.OlliConsultationAnalysis;
  if(!engine?.analyze){
    loadAnalysisEngine();
    return '<div class="consultationAnalysisWaiting">28개 성향 분석 엔진을 불러오는 중입니다.</div>';
  }
  const analysis=engine.analyze(answers||{});
  return `<div class="consultationAnalysisSummary"><div class="consultationAnalysisSummaryTop"><div><b>28개 패턴 자동 분석</b><span>설문 결과는 최종 판정이 아니라 수업에서 확인할 성향 가설입니다.</span></div><div class="consultationAnalysisCounts"><span>주요 ${analysis.primary.length}</span><span>확인 ${analysis.confirm.length}</span></div></div>${analysis.axes.length?`<div class="consultationCategoryRow"><span>관련 5대 영역</span>${analysis.axes.map(axis=>`<b>${esc(axis)}</b>`).join('')}</div>`:''}</div><div class="consultationAnalysisBlock"><div class="consultationAnalysisLabel">주요 성향 가설</div>${hypothesisHtml(analysis.primary,'major')}</div><div class="consultationAnalysisBlock"><div class="consultationAnalysisLabel">확인이 필요한 성향</div>${hypothesisHtml(analysis.confirm,'confirm')}</div>${analysisListHtml('추가 상담 질문',analysis.questions,'현재 자동으로 추려진 추가 질문이 없습니다.')}${analysisListHtml('수업 관찰 포인트',analysis.observations,'주요·확인 가설이 없어 전체 행동을 관찰해야 합니다.')}${analysisListHtml('설문 기반 지도 방향',analysis.directions,'수업 관찰 후 지도 방향을 정합니다.')}`;
}

function ensureScreen(){
  if(document.getElementById('consultationSurveyScreen'))return;
  const screen=document.createElement('div');
  screen.className='pageScreen';
  screen.id='consultationSurveyScreen';
  screen.dataset.pageKey='consultation-survey';
  screen.dataset.pageName='상담 설문';
  screen.innerHTML=`<div class="consultationManagerPage">
    <div class="consultationManagerHead">
      <div><div class="consultationManagerTitle">상담 설문</div><div class="consultationManagerDesc">학부모가 설문을 제출하면 이곳에 학생 명단이 표시됩니다.</div></div>
      <div class="consultationManagerActions">
        <button class="consultationRefreshBtn" type="button" onclick="refreshConsultationSurveyManager()"><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"></path><path d="M20 5v6h-6"></path></svg><span>새로고침</span></button>
        <button class="consultationLinkCopyBtn" type="button" onclick="copyConsultationSurveyLink()"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="10" height="10" rx="2"></rect><path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path></svg><span>설문지 페이지 링크 복사</span></button>
      </div>
    </div>
    <div class="consultationServerHint" id="consultationServerHint"></div>
    <div class="consultationManagerGrid">
      <section class="consultationListCard"><div class="consultationListHeader"><span>학생</span><span>나이/학년</span><span>제출일</span><span>상태</span></div><div class="consultationListBody" id="consultationSurveyListBody"><div class="consultationEmpty">아직 제출된 상담 설문이 없습니다.<br>오른쪽 위의 링크 복사 버튼으로 학부모에게 설문을 보내주세요.</div></div></section>
      <aside class="consultationDetailCard" id="consultationSurveyDetailCard"><div class="consultationDetailEmpty">명단에서 학생을 선택하면<br>설문 응답과 분석 준비 내용을 확인할 수 있습니다.</div></aside>
    </div>
  </div>`;
  document.body.appendChild(screen);
}

async function rpc(name,payload){
  if(typeof SUPABASE_URL==='undefined'||typeof SUPABASE_KEY==='undefined')throw new Error('Supabase 연결 정보를 찾지 못했습니다.');
  const res=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`},body:JSON.stringify(payload||{})});
  const text=await res.text();let data=null;try{data=text?JSON.parse(text):null}catch(_){data=text}
  if(!res.ok){const detail=data&&typeof data==='object'?[data.message,data.details,data.hint,data.code].filter(Boolean).join(' / '):String(data||'');throw new Error(`상담 설문 서버 요청 실패 (${res.status})${detail?'\n'+detail:''}`);}
  return data;
}
async function loadRows(){
  const aid=academyId();const token=sessionToken();
  if(!aid){setHint('현재 학원 정보를 찾지 못했습니다. 다시 로그인한 뒤 확인해주세요.');return[];}
  if(!token){setHint('상담 설문 명단을 불러오려면 올리 계정 로그인이 필요합니다.');return[];}
  try{
    const result=await rpc('olli_list_consultation_surveys',{p_session_token:token,p_academy_id:aid,p_limit:300});
    if(!result||result.ok!==true)throw new Error(result?.message||'상담 설문 명단 조회 권한을 확인해주세요.');
    setHint('');return Array.isArray(result.rows)?result.rows:[];
  }catch(err){setHint(err?.message||'상담 설문 명단을 불러오지 못했습니다.');return[];}
}
function renderContext(){
  const shell=document.getElementById('olliPcShell');if(shell?.dataset.pcSection!=='consultation')return;
  const title=document.getElementById('olliPcContextTitle');const body=document.getElementById('olliPcContextBody');
  if(title)title.textContent='설문 명단 '+rows.length;
  if(body){const done=rows.filter(r=>String(r.status||'survey_completed')==='survey_completed').length;body.innerHTML=`<button class="olliPcQuickBtn active" onclick="refreshConsultationSurveyManager()"><span>전체 제출</span><span>${rows.length}</span></button><button class="olliPcQuickBtn" onclick="refreshConsultationSurveyManager()"><span>설문 완료</span><span>${done}</span></button>`;}
  const topTitle=document.getElementById('olliPcTopbarTitle');if(topTitle)topTitle.textContent='상담기록';
}
function render(){
  const list=document.getElementById('consultationSurveyListBody');if(!list)return;
  if(!rows.length)list.innerHTML='<div class="consultationEmpty">아직 제출된 상담 설문이 없습니다.<br>오른쪽 위의 링크 복사 버튼으로 학부모에게 설문을 보내주세요.</div>';
  else list.innerHTML=rows.map(row=>`<button class="consultationListRow ${selectedId===String(row.id)?'active':''}" type="button" onclick="openConsultationSurveyDetail('${esc(row.id)}')"><span class="consultationStudentName">${esc(row.student_name||'이름 없음')}</span><span class="consultationCellSub">${esc(row.student_age||'-')}</span><span class="consultationCellSub">${esc(dateLabel(row.created_at))}</span><span class="consultationStatus">${esc(statusLabel(row.status))}</span></button>`).join('');
  if(selectedId&&!rows.some(r=>String(r.id)===selectedId))selectedId='';
  selectedId?renderDetail(selectedId):renderEmpty();renderContext();
}
function renderEmpty(){const box=document.getElementById('consultationSurveyDetailCard');if(box){box.removeAttribute('data-consultation-selected-id');box.innerHTML='<div class="consultationDetailEmpty">명단에서 학생을 선택하면<br>설문 응답과 분석 준비 내용을 확인할 수 있습니다.</div>';}}
function defaultDetailTab(row){
  const status=String(row?.status||'survey_completed');
  if(status==='observation_waiting'||status==='observation_in_progress')return 'observation';
  if(status==='final_analysis_waiting'||status==='ready'||status==='completed')return 'final';
  return 'survey';
}
function activeDetailTab(id,row){return detailTabById.get(String(id||''))||defaultDetailTab(row);}
window.setConsultationDetailTab=function(id,tab){
  const allowed=['survey','observation','final'];
  const next=allowed.includes(String(tab))?String(tab):'survey';
  detailTabById.set(String(id||''),next);
  window.syncConsultationDetailTabs();
};
window.syncConsultationDetailTabs=function(){
  const box=document.getElementById('consultationSurveyDetailCard');if(!box)return;
  const id=String(box.dataset.consultationSelectedId||selectedId||'');
  const row=rows.find(r=>String(r.id)===id);if(!id||!row)return;
  const active=activeDetailTab(id,row);
  box.querySelectorAll('[data-consultation-tab]').forEach(btn=>btn.classList.toggle('active',btn.dataset.consultationTab===active));
  box.querySelectorAll('[data-consultation-tab-panel]').forEach(panel=>{panel.hidden=panel.dataset.consultationTabPanel!==active;});
};
function renderDetail(id){
  const box=document.getElementById('consultationSurveyDetailCard');const row=rows.find(r=>String(r.id)===String(id));if(!box||!row)return renderEmpty();
  const answers=row.answers&&typeof row.answers==='object'?row.answers:{};
  box.dataset.consultationSelectedId=String(id);
  box.innerHTML=`<div class="consultationDetailTop"><div><div class="consultationDetailName">${esc(row.student_name||'학생')}</div><div class="consultationDetailMeta">${esc(row.student_age||'')}${row.parent_phone4?' · 연락처 뒤 '+esc(row.parent_phone4):''} · ${esc(dateLabel(row.created_at))}</div></div><span class="consultationStatus">${esc(statusLabel(row.status))}</span></div><div class="consultationDetailTabs" role="tablist" aria-label="상담 분석 단계"><button type="button" class="consultationDetailTab" data-consultation-tab="survey" onclick="setConsultationDetailTab('${esc(id)}','survey')">학부모 설문</button><button type="button" class="consultationDetailTab" data-consultation-tab="observation" onclick="setConsultationDetailTab('${esc(id)}','observation')">수업 관찰</button><button type="button" class="consultationDetailTab" data-consultation-tab="final" onclick="setConsultationDetailTab('${esc(id)}','final')">최종 분석</button></div><div class="consultationDetailTabPanel" data-consultation-tab-panel="survey"><div class="consultationDetailSection"><div class="consultationDetailSectionTitle">학부모 설문 분석</div>${renderAutomaticAnalysis(answers)}</div><details class="consultationSurveyAnswersFold"><summary>학부모 설문 답변 14문항</summary><div class="consultationAnswerList">${QUESTIONS.map((q,i)=>`<div class="consultationAnswerItem"><div class="consultationAnswerQ">${i+1}. ${esc(q.text)}</div><div class="consultationAnswerA">${esc(answerLabel(answers[q.id],q))}</div></div>`).join('')}</div></details></div>`;
  window.syncConsultationDetailTabs();
}
window.openConsultationSurveyDetail=function(id){selectedId=String(id||'');render();};
window.refreshConsultationSurveyManager=async function(){rows=await loadRows();rows.sort((a,b)=>Date.parse(b.created_at||0)-Date.parse(a.created_at||0));window.__olliConsultationRows=rows.slice();render();return rows;};
window.getConsultationSurveyRows=function(){return rows.slice();};
window.copyConsultationSurveyLink=async function(){
  const aid=academyId();if(!aid){alert('현재 학원 ID를 찾지 못했습니다. 로그인 상태를 확인해주세요.');return;}
  let baseHref=location.href;if(location.protocol==='file:'&&typeof window.getOlliAppQrTargetUrl==='function')baseHref=window.getOlliAppQrTargetUrl();
  const url=new URL('olli-consultation-survey.html',baseHref);url.search='';url.hash='';url.searchParams.set('academy_id',aid);
  const name=(typeof window.getOlliCurrentAcademyName==='function'?window.getOlliCurrentAcademyName():'')||localStorage.getItem('olli_current_academy_name')||'';if(name)url.searchParams.set('academy_name',name);
  const link=url.toString();
  try{await navigator.clipboard.writeText(link);if(typeof window.showPushToast==='function')window.showPushToast('상담 설문 링크를 복사했어요.');else alert('상담 설문 링크를 복사했습니다.');}
  catch(_){const ta=document.createElement('textarea');ta.value=link;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();alert('상담 설문 링크를 복사했습니다.');}
};

function showConsultationScreen(){
  ensureScreen();document.querySelectorAll('.pageScreen').forEach(s=>s.style.display=s.id==='consultationSurveyScreen'?'flex':'none');renderContext();window.refreshConsultationSurveyManager();
}
function installPcHook(){
  if(typeof window.pcOpenSection!=='function'||window.pcOpenSection.__consultationHook)return;
  const original=window.pcOpenSection;
  const wrapped=async function(section){
    if(section==='consultation'){
      await original.call(this,section);
      showConsultationScreen();
      return;
    }
    const screen=document.getElementById('consultationSurveyScreen');if(screen)screen.style.display='none';
    return original.apply(this,arguments);
  };
  wrapped.__consultationHook=true;window.pcOpenSection=wrapped;
}
function startPolling(){clearInterval(pollTimer);pollTimer=setInterval(()=>{const screen=document.getElementById('consultationSurveyScreen');if(screen&&getComputedStyle(screen).display!=='none')window.refreshConsultationSurveyManager();},20000);}
function init(){ensureScreen();installPcHook();startPolling();loadAnalysisEngine().catch(()=>{});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
