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
async function copyText(text){
  if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);return;}
  const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();if(!ok)throw new Error('클립보드 복사에 실패했습니다.');
}
window.copyConsultationSurveyLink=async function(){
  const aid=academyId();const token=sessionToken();
  if(!aid){alert('현재 학원 ID를 찾지 못했습니다. 로그인 상태를 확인해주세요.');return;}
  if(!token){alert('설문 링크를 만들려면 올리 계정 로그인이 필요합니다.');return;}
  try{
    const result=await rpc('olli_get_consultation_survey_link_token',{p_session_token:token,p_academy_id:aid});
    if(!result||result.ok!==true||!result.survey_token)throw new Error(result?.message||'학원별 설문 토큰을 불러오지 못했습니다.');
    let baseHref=location.href;if(location.protocol==='file:'&&typeof window.getOlliAppQrTargetUrl==='function')baseHref=window.getOlliAppQrTargetUrl();
    const url=new URL('olli-consultation-survey-token.html',baseHref);url.search='';url.hash='';url.searchParams.set('survey',String(result.survey_token));
    await copyText(url.toString());toast('학원 전용 상담 설문 링크를 복사했습니다.');
  }catch(err){alert(err?.message||'상담 설문 링크를 복사하지 못했습니다.');}
};
})();
