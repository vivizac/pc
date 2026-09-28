(function(){
'use strict';
function academyId(){return String((typeof window.getOlliCurrentAcademyId==='function'?window.getOlliCurrentAcademyId():'')||localStorage.getItem('olli_current_academy_id')||'').trim();}
function sessionToken(){return String(localStorage.getItem('olli_account_session_token_v1')||'').trim();}
function toast(text){if(typeof window.showPushToast==='function')window.showPushToast(text);else alert(text);}
async function rpc(name,payload){
  if(typeof SUPABASE_URL==='undefined'||typeof SUPABASE_KEY==='undefined')throw new Error('Supabase 연결 정보를 찾지 못했습니다.');
  const res=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`},body:JSON.stringify(payload||{})});
  const text=await res.text();let data=null;try{data=text?JSON.parse(text):null}catch(_){data=text}
  if(!res.ok){const detail=data&&typeof data==='object'?[data.message,data.details,data.hint,data.code].filter(Boolean).join(' / '):String(data||'');throw new Error(detail||`설문 링크 요청 실패 (${res.status})`);}
  return data;
}

let preparedLink='';
let preparingLinkPromise=null;

function buildSurveyUrl(surveyToken){
  let baseHref=location.href;
  if(location.protocol==='file:'&&typeof window.getOlliAppQrTargetUrl==='function')baseHref=window.getOlliAppQrTargetUrl();
  const url=new URL('olli-consultation-survey-token.html',baseHref);
  url.search='';
  url.hash='';
  url.searchParams.set('survey',String(surveyToken||''));
  return url.toString();
}

async function prepareSurveyLink(){
  if(preparedLink)return preparedLink;
  if(preparingLinkPromise)return preparingLinkPromise;
  const aid=academyId();
  const token=sessionToken();
  if(!aid||!token)return '';
  preparingLinkPromise=(async()=>{
    const result=await rpc('olli_get_consultation_survey_link_token',{p_session_token:token,p_academy_id:aid});
    if(!result||result.ok!==true||!result.survey_token)throw new Error(result?.message||'학원별 설문 토큰을 불러오지 못했습니다.');
    preparedLink=buildSurveyUrl(result.survey_token);
    return preparedLink;
  })().finally(()=>{preparingLinkPromise=null;});
  return preparingLinkPromise;
}

function legacyCopy(text){
  const ta=document.createElement('textarea');
  ta.value=text;
  ta.setAttribute('readonly','');
  ta.style.position='fixed';
  ta.style.left='-9999px';
  ta.style.top='0';
  ta.style.opacity='0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0,ta.value.length);
  let ok=false;
  try{ok=typeof document.execCommand==='function'&&document.execCommand('copy');}catch(_){}
  ta.remove();
  return !!ok;
}

async function copyText(text){
  if(navigator.clipboard&&window.isSecureContext){
    try{
      await navigator.clipboard.writeText(text);
      return true;
    }catch(_){}
  }
  return legacyCopy(text);
}

function showManualCopy(text){
  document.getElementById('consultationLinkCopyFallback')?.remove();
  const overlay=document.createElement('div');
  overlay.id='consultationLinkCopyFallback';
  overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,28,.38);display:flex;align-items:center;justify-content:center;padding:22px;';
  const panel=document.createElement('div');
  panel.style.cssText='width:min(560px,100%);background:#fff;border-radius:22px;padding:22px;box-shadow:0 22px 60px rgba(0,0,0,.22);font-family:inherit;';
  const title=document.createElement('div');
  title.textContent='상담 설문 링크';
  title.style.cssText='font-size:18px;font-weight:850;color:#17191c;margin-bottom:8px;';
  const desc=document.createElement('div');
  desc.textContent='이 기기에서는 자동 복사가 제한되어 있습니다. 아래 링크를 길게 누르거나 선택해서 복사해주세요.';
  desc.style.cssText='font-size:13px;line-height:1.55;color:#747d83;margin-bottom:14px;';
  const input=document.createElement('textarea');
  input.value=text;
  input.readOnly=true;
  input.rows=4;
  input.style.cssText='width:100%;resize:none;border:1px solid #dce6e8;border-radius:14px;padding:12px;font:inherit;font-size:13px;line-height:1.5;color:#17191c;background:#f8fbfb;outline:none;';
  input.addEventListener('focus',()=>input.select());
  input.addEventListener('click',()=>input.select());
  const actions=document.createElement('div');
  actions.style.cssText='display:flex;gap:8px;justify-content:flex-end;margin-top:14px;';
  const selectBtn=document.createElement('button');
  selectBtn.type='button';
  selectBtn.textContent='링크 선택';
  selectBtn.style.cssText='height:42px;padding:0 16px;border:0;border-radius:12px;background:#079eb3;color:#fff;font-weight:800;cursor:pointer;';
  selectBtn.onclick=()=>{input.focus();input.select();};
  const closeBtn=document.createElement('button');
  closeBtn.type='button';
  closeBtn.textContent='닫기';
  closeBtn.style.cssText='height:42px;padding:0 16px;border:1px solid #dce6e8;border-radius:12px;background:#fff;color:#394247;font-weight:800;cursor:pointer;';
  closeBtn.onclick=()=>overlay.remove();
  actions.append(selectBtn,closeBtn);
  panel.append(title,desc,input,actions);
  overlay.appendChild(panel);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  document.body.appendChild(overlay);
  setTimeout(()=>{input.focus();input.select();},0);
}

window.copyConsultationSurveyLink=async function(){
  const aid=academyId();
  const token=sessionToken();
  if(!aid){alert('현재 학원 ID를 찾지 못했습니다. 로그인 상태를 확인해주세요.');return;}
  if(!token){alert('설문 링크를 만들려면 올리 계정 로그인이 필요합니다.');return;}
  try{
    let link=preparedLink;
    if(!link)link=await prepareSurveyLink();
    if(!link)throw new Error('학원별 설문 링크를 준비하지 못했습니다.');
    const copied=await copyText(link);
    if(copied)toast('학원 전용 상담 설문 링크를 복사했습니다.');
    else showManualCopy(link);
  }catch(err){
    if(preparedLink)showManualCopy(preparedLink);
    else alert(err?.message||'상담 설문 링크를 만들지 못했습니다.');
  }
};

// 네트워크 요청 때문에 복사 버튼의 사용자 동작 권한이 사라지지 않도록 링크를 미리 준비해 둔다.
setTimeout(()=>{prepareSurveyLink().catch(()=>{});},0);
})();