/* Phone-only settings detail navigation.
 * Data/render functions stay shared; phone owns the page transition and DOM lifecycle.
 */
(function(global){
  'use strict';

  function renderPhoneSettingsDetailHtml(data){
    return typeof data?.html==='function'?data.html():String(data?.html||'');
  }

  async function openPhoneSettingsDetail(type){
    const data=(typeof settingsDetailData!=='undefined'&&settingsDetailData)?settingsDetailData[type]:null;
    if(!data)return false;

    const detail=document.getElementById('settingsDetailScreen');
    const settings=document.getElementById('settingsPageScreen');
    const titlePill=document.getElementById('settingsDetailTitlePill');
    const body=document.getElementById('settingsDetailBody');
    if(!detail||!body)return false;

    settingsCurrentDetailType=type;
    if(settings)settings.style.display='flex';
    if(titlePill)titlePill.textContent=data.title||'설정';

    try{
      body.innerHTML=data.instantRender
        ? renderPhoneSettingsDetailHtml(data)
        : '<div class="settingsLoadingText">불러오는 중입니다...</div>';
      if(type==='attendancePrint'&&typeof settingsAttendanceScheduleFitText==='function'){
        settingsAttendanceScheduleFitText(body);
      }
    }catch(_){
      body.innerHTML='<div class="settingsLoadingText">화면을 준비하고 있습니다.</div>';
    }

    detail.style.display='flex';
    detail.style.position='fixed';
    detail.style.inset='0';
    detail.style.transform='translateX(0)';
    detail.style.opacity='1';
    detail.style.pointerEvents='auto';
    detail.style.zIndex='130100';

    try{
      if(typeof data.beforeOpen==='function')await data.beforeOpen();
      if(settingsCurrentDetailType!==type||detail.style.display==='none')return true;
      body.innerHTML=renderPhoneSettingsDetailHtml(data);
      if(type==='attendancePrint'&&typeof settingsAttendanceScheduleFitText==='function'){
        settingsAttendanceScheduleFitText(body);
      }
    }catch(error){
      if(settingsCurrentDetailType!==type||detail.style.display==='none')return false;
      if(typeof olliSettingsState!=='undefined'&&olliSettingsState)olliSettingsState.lastError=error?.message||String(error);
      const errorHtml=typeof renderSettingsErrorIfNeeded==='function'?renderSettingsErrorIfNeeded():'';
      body.innerHTML=data.instantRender
        ? errorHtml+renderPhoneSettingsDetailHtml(data)
        : errorHtml||'<div class="settingsLoadingText">설정을 불러오지 못했습니다.</div>';
    }
    return true;
  }

  function closePhoneSettingsDetail(){
    settingsCurrentDetailType='';
    const detail=document.getElementById('settingsDetailScreen');
    const settings=document.getElementById('settingsPageScreen');
    if(detail){
      detail.style.display='none';
      detail.style.position='';
      detail.style.inset='';
      detail.style.transform='';
      detail.style.opacity='';
      detail.style.pointerEvents='';
      detail.style.zIndex='';
    }
    if(settings)settings.style.display='flex';
    return true;
  }

  global.openPhoneSettingsDetail=openPhoneSettingsDetail;
  global.closePhoneSettingsDetail=closePhoneSettingsDetail;
  global.openSettingsDetail=openPhoneSettingsDetail;
  global.closeSettingsDetail=closePhoneSettingsDetail;

  document.addEventListener('DOMContentLoaded',()=>{
    try{if(typeof settingsApplyStateToUI==='function')settingsApplyStateToUI()}catch(_){}
  });
})(window);
