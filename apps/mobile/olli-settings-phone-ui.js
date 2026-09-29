/* Phone-only settings UI/router.
 * Shared academy settings values continue to use common data/RPC functions.
 * Phone owns page/sheet DOM, device-only controls, and logout presentation.
 */
(function(global){
  'use strict';

  let phoneSettingsSheetType='';
  let phoneFeedbackGroup='1';
  const phoneExternalSheets=new Map();

  const clean=value=>String(value==null?'':value).trim();
  const esc=value=>typeof settingsEscapeHtml==='function'?settingsEscapeHtml(value):clean(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const attr=value=>typeof settingsEscapeAttr==='function'?settingsEscapeAttr(value):esc(value);

  function phoneCanEditConsultation(){
    return typeof canEditOlliConsultationSettings==='function'?canEditOlliConsultationSettings():false;
  }

  function renderPhoneProfileSheet(){
    if(typeof global.OlliPhoneSettingsAccount?.renderProfileSheet==='function'){
      return global.OlliPhoneSettingsAccount.renderProfileSheet();
    }
    const cached=typeof settingsGetCachedState==='function'?settingsGetCachedState():{};
    const academy=(typeof olliSettingsState!=='undefined'&&olliSettingsState?.academy)||{};
    const academyName=academy.academy_name||cached.academyName||'비비작아이성향미술학원';
    const image=academy.profile_image_url||cached.profileImageUrl||cached.profileImageDataUrl||'';
    const imageHtml=image?'<img src="'+attr(image)+'" alt="학원 프로필">':'V';
    return '<div class="settingsProfileCard" style="box-shadow:none;background:#f7f7f5;margin-bottom:12px;">'
      +'<div class="settingsProfileImage editable" onclick="openSettingsProfileImagePicker()">'+imageHtml+'</div>'
      +'<div class="settingsProfileInfo"><div class="settingsProfileName">'+esc(academyName)+'</div><div class="settingsProfileEdit" onclick="openSettingsProfileImagePicker()">사진 변경</div></div></div>'
      +'<div class="settingsInputGroup"><div class="settingsInputLabel">학원 이름</div><input id="settingsAcademyNameInput" class="settingsInput" value="'+attr(academyName)+'"></div>';
  }

  async function savePhoneProfileSheet(){
    if(typeof global.OlliPhoneSettingsAccount?.saveProfileSheet==='function'){
      return global.OlliPhoneSettingsAccount.saveProfileSheet();
    }
    const input=document.getElementById('settingsAcademyNameInput');
    const newName=clean(input?.value)||'학원 이름';
    const academyId=typeof settingsGetAcademyId==='function'?settingsGetAcademyId():'';

    if(typeof settingsSaveCachePatch==='function')settingsSaveCachePatch({academyName:newName});
    if(academyId&&typeof isSupabaseConfigured==='function'&&isSupabaseConfigured()&&typeof supabase==='function'){
      const rows=await supabase('PATCH','academies?id=eq.'+encodeURIComponent(academyId),{academy_name:newName});
      if(Array.isArray(rows)&&rows[0]&&typeof olliSettingsState!=='undefined'&&olliSettingsState?.academy){
        olliSettingsState.academy.academy_name=newName;
      }
      try{localStorage.setItem('olli_current_academy_name',newName)}catch(_){}
    }
    if(typeof settingsApplyStateToUI==='function')settingsApplyStateToUI();
  }

  function renderPhoneTextSizeSheet(){
    const current=typeof getOlliTextSizeSetting==='function'?getOlliTextSizeSetting():'default';
    const option=(value,label,guide)=>{
      const active=current===value;
      return '<button type="button" class="settingsStartPageOption '+(active?'active':'')+'" data-text-size-option="'+value+'" onclick="selectSettingsTextSizeOption(\''+value+'\')"><span>'+label+'<span class="settingsTextSizeGuide">'+guide+'</span></span><span class="check">'+(active?'✓':'')+'</span></button>';
    };
    return '<div class="settingsInputGroup">'
      +option('default','기본','1.12배')
      +option('medium','중간','1.20배')
      +option('large','크게','1.30배')
      +'</div><div class="settingsMiniText">이 설정은 현재 폰 화면에만 적용됩니다.</div>';
  }

  function selectSettingsTextSizeOption(value){
    const selected=clean(value)||'default';
    document.querySelectorAll('[data-text-size-option]').forEach(button=>{
      const active=button.getAttribute('data-text-size-option')===selected;
      button.classList.toggle('active',active);
      const check=button.querySelector('.check');
      if(check)check.textContent=active?'✓':'';
    });
  }

  async function savePhoneTextSizeSheet(){
    const selected=document.querySelector('[data-text-size-option].active')?.getAttribute('data-text-size-option')||'default';
    try{localStorage.setItem('olli_text_size_v1',selected==='large'?'large':(selected==='medium'?'medium':'default'))}catch(_){}
    if(typeof applyOlliTextSizeSetting==='function')applyOlliTextSizeSetting();
  }

  function renderPhoneStartPageSheet(){
    const current=typeof getOlliAllowedStartPage==='function'
      ? getOlliAllowedStartPage((typeof getOlliDefaultStartPage==='function'?getOlliDefaultStartPage():'')||'elementary_attendance')
      : 'observation_note';
    const options=typeof getOlliStartPageOptionsForCurrentRole==='function'?getOlliStartPageOptionsForCurrentRole():[];
    const html=options.map(item=>{
      const value=item.value,label=item.label;
      const active=typeof normalizeOlliStartPage==='function'?normalizeOlliStartPage(value)===current:value===current;
      return '<button type="button" class="settingsStartPageOption '+(active?'active':'')+'" data-start-page-option="'+attr(value)+'" onclick="selectSettingsStartPageOption(\''+attr(value)+'\')"><span>'+esc(label)+'</span><span class="check">'+(active?'✓':'')+'</span></button>';
    }).join('');
    return '<div class="settingsInputGroup">'+html+'</div><div class="settingsMiniText">앱을 열었을 때 이 폰에서 먼저 보여줄 화면을 선택합니다.</div>';
  }

  function selectSettingsStartPageOption(value){
    const selected=typeof normalizeOlliStartPage==='function'
      ? normalizeOlliStartPage(value)
      : clean(value);
    document.querySelectorAll('[data-start-page-option]').forEach(button=>{
      const optionValue=button.getAttribute('data-start-page-option');
      const normalizedOption=typeof normalizeOlliStartPage==='function'
        ? normalizeOlliStartPage(optionValue)
        : clean(optionValue);
      const active=!!selected&&normalizedOption===selected;
      button.classList.toggle('active',active);
      const check=button.querySelector('.check');
      if(check)check.textContent=active?'✓':'';
    });
  }

  async function savePhoneStartPageSheet(){
    const fallback=typeof getOlliDefaultStartPage==='function'?getOlliDefaultStartPage():'observation_note';
    const selected=document.querySelector('[data-start-page-option].active')?.getAttribute('data-start-page-option')||fallback;
    const normalized=typeof getOlliAllowedStartPage==='function'
      ? (getOlliAllowedStartPage(selected)||'observation_note')
      : (clean(selected)||'observation_note');

    const memberKey=typeof getOlliStartPageMemberKey==='function'?getOlliStartPageMemberKey():'phone';
    const stableKey=typeof getOlliStartPageStableKey==='function'?getOlliStartPageStableKey():memberKey;

    localStorage.setItem('olli_default_start_page_'+memberKey,normalized);
    localStorage.setItem('olli_default_start_page_'+stableKey,normalized);
    localStorage.setItem('olli_default_start_page_fallback',normalized);
    if(typeof markOlliStartPageSetupDoneForCurrentContext==='function')markOlliStartPageSetupDoneForCurrentContext();
    if(typeof updateOlliStartPageSettingUI==='function')updateOlliStartPageSettingUI();
    return normalized;
  }

  function normalizePhoneTimetableMode(value){
    return clean(value)==='half_hour'?'half_hour':'hourly';
  }

  function getPhoneTimetableMode(){
    const academy=(typeof olliSettingsState!=='undefined'&&olliSettingsState?.academy)||{};
    const cached=typeof settingsGetCachedState==='function'?settingsGetCachedState():{};
    return normalizePhoneTimetableMode(academy.kinder_timetable_mode||cached.kinderTimetableMode||'hourly');
  }

  function getPhoneTimetableModeLabel(value){
    return normalizePhoneTimetableMode(value)==='half_hour'?'30분 단위':'정시 타임';
  }

  function updatePhoneSettingsTimetableModeValue(){
    const value=document.getElementById('settingsTimetableModeValue');
    if(value)value.textContent=getPhoneTimetableModeLabel(getPhoneTimetableMode());
  }

  function renderPhoneTimetableModeSheet(){
    const current=getPhoneTimetableMode();
    const option=(value,label,guide)=>{
      const active=current===value;
      return '<button type="button" class="settingsStartPageOption '+(active?'active':'')+'" data-phone-timetable-mode="'+value+'" onclick="selectPhoneTimetableModeOption(\''+value+'\')"><span>'+label+'<span class="settingsTextSizeGuide">'+guide+'</span></span><span class="check">'+(active?'✓':'')+'</span></button>';
    };
    return '<div class="settingsInputGroup">'
      +option('hourly','정시 타임','기존 시간별 수업 · A/B 분반 가능')
      +option('half_hour','30분 단위','초등 1:00~6:00 · 유치 3:30~5:30')
      +'</div><div class="settingsMiniText">학원 공통 설정입니다. 여기서 변경하면 PC와 다른 폰에서도 같은 설정을 사용합니다.</div>';
  }

  function selectPhoneTimetableModeOption(value){
    const selected=normalizePhoneTimetableMode(value);
    document.querySelectorAll('[data-phone-timetable-mode]').forEach(button=>{
      const active=normalizePhoneTimetableMode(button.getAttribute('data-phone-timetable-mode'))===selected;
      button.classList.toggle('active',active);
      const check=button.querySelector('.check');
      if(check)check.textContent=active?'✓':'';
    });
  }

  async function savePhoneTimetableModeSheet(){
    const selected=normalizePhoneTimetableMode(document.querySelector('[data-phone-timetable-mode].active')?.getAttribute('data-phone-timetable-mode'));
    const academyId=typeof settingsGetAcademyId==='function'?settingsGetAcademyId():'';
    if(!academyId)throw new Error('현재 학원 ID를 찾지 못했습니다.');
    if(typeof saveOlliAcademySettingsSecure!=='function')throw new Error('학원 공통 설정 저장 기능을 찾지 못했습니다.');

    const academy=await saveOlliAcademySettingsSecure(academyId,{kinder_timetable_mode:selected});
    if(typeof settingsSaveCachePatch==='function')settingsSaveCachePatch({kinderTimetableMode:selected});
    if(typeof olliSettingsState!=='undefined')olliSettingsState.academy=academy;
    updatePhoneSettingsTimetableModeValue();
    global.dispatchEvent(new CustomEvent('olli:kinder-timetable-mode-changed',{detail:{mode:selected}}));
    return selected;
  }

  function consultationOption(type,option,selected,editable){
    return '<button type="button" class="settingsMonthOption '+(selected.has(option.key)?'active':'')+'" data-phone-consultation-type="'+type+'" data-phone-consultation-rule="'+option.key+'" '+(editable?'onclick="phoneToggleConsultationRule(this)"':'disabled aria-disabled="true"')+'>'+esc(option.label)+'</button>';
  }

  function renderPhoneConsultationSheet(){
    const editable=phoneCanEditConsultation();
    const options=typeof getOlliConsultationRuleOptions==='function'?getOlliConsultationRuleOptions():[];
    const group=(type,title)=>{
      const selected=new Set(typeof getOlliConsultationRules==='function'?getOlliConsultationRules(type):[]);
      return '<div class="settingsMiniText">'+title+'</div><div class="settingsMonthGrid">'
        +options.map(option=>consultationOption(type,option,selected,editable)).join('')
        +'</div>';
    };
    const guide=editable
      ?'초등부와 유치부 상담 기준은 학원 공통값입니다. 여기서 바꾸면 PC와 다른 폰에도 동일하게 적용됩니다.'
      :'상담 기준은 원장 또는 관리자 계정에서만 변경할 수 있습니다.';
    return group('elementary','초등부 상담 기준')+group('kinder','유치부 상담 기준')+'<div class="settingsMiniText">'+guide+'</div>';
  }

  function phoneToggleConsultationRule(button){
    if(!button||!phoneCanEditConsultation())return;
    button.classList.toggle('active');
  }

  async function savePhoneConsultationSheet(){
    if(!phoneCanEditConsultation())return;
    const collect=type=>Array.from(document.querySelectorAll('[data-phone-consultation-type="'+type+'"][data-phone-consultation-rule].active'))
      .map(btn=>btn.getAttribute('data-phone-consultation-rule')).filter(Boolean);
    const elementary=collect('elementary');
    const kinder=collect('kinder');
    if(typeof saveOlliConsultationRulesShared!=='function')throw new Error('상담 기준 공통 저장 기능을 찾지 못했습니다.');
    await saveOlliConsultationRulesShared({
      elementary:elementary.length?elementary:(typeof getOlliDefaultConsultationRules==='function'?getOlliDefaultConsultationRules('elementary'):[]),
      kinder:kinder.length?kinder:(typeof getOlliDefaultConsultationRules==='function'?getOlliDefaultConsultationRules('kinder'):[])
    });
    if(typeof settingsApplyStateToUI==='function')settingsApplyStateToUI();
  }

  function feedbackGroups(){return [['1','A'],['2','B'],['3','C'],['4','D'],['5','E'],['6','F']];}
  function feedbackMap(){
    return typeof readElementaryGroupFeedbackMonthsMap==='function'?readElementaryGroupFeedbackMonthsMap():{};
  }

  function renderPhoneGroupFeedbackSheet(){
    if(!feedbackGroups().some(([id])=>id===phoneFeedbackGroup))phoneFeedbackGroup='1';
    const map=feedbackMap();
    const months=(typeof ELEMENTARY_GROUP_MONTH_VALUES!=='undefined'?ELEMENTARY_GROUP_MONTH_VALUES:[1,2,3,4,5,6,7,8,9,10,11,12]);
    const selected=new Set(Array.isArray(map?.[phoneFeedbackGroup])?map[phoneFeedbackGroup].map(Number):[]);
    const tabs=feedbackGroups().map(([id,label])=>'<button type="button" class="settingsGroupFeedbackTab '+(id===phoneFeedbackGroup?'active':'')+'" onclick="phoneSelectFeedbackGroup(\''+id+'\')">'+label+'</button>').join('');
    const monthButtons=months.map(month=>'<button type="button" class="settingsGroupFeedbackMonth '+(selected.has(Number(month))?'active':'')+'" data-phone-feedback-month="'+Number(month)+'" onclick="phoneToggleFeedbackMonth(this)">'+Number(month)+'월</button>').join('');
    return '<div class="settingsGroupFeedbackBlock"><div class="settingsGroupFeedbackTabs">'+tabs+'</div>'
      +'<div class="settingsGroupFeedbackHead"><div class="settingsGroupFeedbackTitle">'+esc((feedbackGroups().find(([id])=>id===phoneFeedbackGroup)||['1','A'])[1])+'그룹 발송월</div></div>'
      +'<div class="settingsGroupFeedbackMonths">'+monthButtons+'</div></div>'
      +'<div class="settingsMiniText">그룹별 피드백 발송월은 학원 공통값입니다. 폰과 PC가 같은 값을 사용합니다.</div>';
  }

  function phoneSelectFeedbackGroup(group){
    savePhoneFeedbackGroupDraft();
    phoneFeedbackGroup=clean(group)||'1';
    refreshPhoneSettingsSheetBody();
  }

  function phoneToggleFeedbackMonth(button){
    button?.classList.toggle('active');
  }

  function savePhoneFeedbackGroupDraft(){
    const current=phoneFeedbackGroup;
    const buttons=Array.from(document.querySelectorAll('[data-phone-feedback-month]'));
    if(!buttons.length)return;
    const map=feedbackMap();
    map[current]=buttons.filter(btn=>btn.classList.contains('active')).map(btn=>Number(btn.getAttribute('data-phone-feedback-month'))).filter(Boolean);
    if(typeof writeElementaryGroupFeedbackMonthsMap==='function'){
      writeElementaryGroupFeedbackMonthsMap(map,{skipServerSync:true});
    }
  }

  function updatePhoneSettingsGroupFeedbackMonthsValue(){
    const value=document.getElementById('settingsGroupFeedbackMonthsValue');
    if(!value)return;
    const map=feedbackMap();
    const count=Object.values(map||{}).filter(months=>{
      if(typeof normalizeElementaryGroupMonths==='function')return normalizeElementaryGroupMonths(months).length;
      return Array.isArray(months)&&months.length;
    }).length;
    value.textContent=count?count+'개 그룹 설정':'미설정';
  }

  async function savePhoneGroupFeedbackSheet(){
    savePhoneFeedbackGroupDraft();
    const map=feedbackMap();
    if(typeof saveOlliSharedSettingToServer!=='function')throw new Error('피드백 발송월 공통 저장 기능을 찾지 못했습니다.');
    await saveOlliSharedSettingToServer(OLLI_SHARED_SETTINGS_KEY_GROUP_MONTHS,map);
    updatePhoneSettingsGroupFeedbackMonthsValue();
  }

  function renderPhoneNewAcademySheet(){
    const accountName=clean(localStorage.getItem('olli_account_name_v1'))||'현재 원장 계정';
    return '<div class="settingsInfoItem">연결 계정: '+esc(accountName)+'</div>'
      +'<div class="settingsInputGroup" style="margin-top:12px;"><div class="settingsInputLabel">학원 이름</div><input id="settingsNewAcademyNameInput" class="settingsInput" maxlength="60" autocomplete="off" placeholder="예: 비비작 2호점"></div>'
      +'<div class="settingsInputGroup"><div class="settingsInputLabel">지역 또는 지점 설명</div><input id="settingsNewAcademyRegionInput" class="settingsInput" maxlength="80" autocomplete="off" placeholder="예: 대구 달서구 월성동"></div>';
  }

  function renderPhoneConnectAcademySheet(){
    return '<div class="settingsInputGroup"><div class="settingsInputLabel">연결할 학원 아이디 또는 학원명</div><input id="settingsConnectAcademyCodeInput" class="settingsInput" maxlength="60" autocomplete="off" placeholder="예: VIVI-5578 또는 학원명" oninput="clearSettingsConnectAcademyLookupResult()"></div>'
      +'<button class="settingsSheetBtn" type="button" onclick="lookupSettingsConnectAcademy(event)" style="width:100%;margin:2px 0 12px;">학원 확인</button>'
      +'<div id="settingsConnectAcademyLookupResult" class="olliInfoBox" style="display:none;margin-bottom:12px;"></div>'
      +'<div class="settingsInputGroup"><div class="settingsInputLabel">요청 권한</div><select id="settingsConnectAcademyRoleInput" class="settingsInput"><option value="manager">관리자</option><option value="teacher">선생님</option><option value="owner">원장</option></select></div>';
  }

  function renderPhoneMembershipRoleSheet(){
    return '<div class="settingsInputGroup"><div class="settingsInputLabel">변경할 권한</div><select id="settingsAcademyMembershipRoleInput" class="settingsInput"><option value="teacher">선생님</option><option value="manager">관리자</option><option value="owner">원장</option></select></div>'
      +'<div class="settingsMiniText">마지막 원장의 권한은 낮출 수 없습니다.</div>';
  }

  function renderPhoneLogoutSheet(){
    return '<div class="settingsInfoItem">계정 로그아웃을 하면 이 폰의 자동 로그인이 해제됩니다. 학원 데이터와 선생님 승인 정보는 삭제되지 않습니다.</div>'
      +'<div class="settingsLogoutDangerBox"><button class="settingsDangerFullBtn" data-account-logout-btn type="button" onclick="doOlliAccountLogout()">계정 로그아웃</button>'
      +'<button class="settingsDangerFullBtn light" type="button" onclick="closeSettingsSheet()">취소</button></div>';
  }

  const PHONE_SETTINGS_SHEETS={
    profile:{title:'프로필 편집',desc:'학원 이름과 프로필 이미지를 설정합니다.',html:renderPhoneProfileSheet,onSave:savePhoneProfileSheet},
    ai:{title:'AI 사용 안내',desc:'AI가 생성한 문구는 자동 발송되지 않으며, 선생님 또는 원장이 검토한 뒤 사용합니다.',html:'<div class="settingsInfoItem">피드백 문구는 최종 검토 후 학부모에게 전달해야 합니다.</div>'},
    textSize:{title:'텍스트 크기',desc:'이 폰의 앱 화면 글자 크기를 조절합니다.',html:renderPhoneTextSizeSheet,onSave:savePhoneTextSizeSheet},
    startPage:{title:'시작 페이지',desc:'이 폰에서 앱을 열었을 때 처음 보여줄 화면을 선택합니다.',html:renderPhoneStartPageSheet,onSave:savePhoneStartPageSheet},
    timetableMode:{title:'시간표 설정',desc:'초등부와 유치부 시간표의 운영 방식을 함께 선택합니다.',html:renderPhoneTimetableModeSheet,onSave:savePhoneTimetableModeSheet},
    consultationMonths:{title:'상담 기준',desc:'초등부와 유치부 상담 기준을 설정합니다.',html:renderPhoneConsultationSheet,onSave:savePhoneConsultationSheet},
    groupFeedbackMonths:{title:'그룹별 피드백 발송월',desc:'초등부 그룹별 피드백 발송월을 설정합니다.',html:renderPhoneGroupFeedbackSheet,onSave:savePhoneGroupFeedbackSheet},
    newAcademy:{title:'새 학원 만들기',desc:'현재 원장 계정에 새 학원을 추가합니다.',html:renderPhoneNewAcademySheet,onSave:async()=>{if(typeof createOlliAcademyFromSettings==='function')await createOlliAcademyFromSettings()}},
    connectAcademy:{title:'기존 학원 연결 요청',desc:'학원을 검색한 뒤 연결을 요청합니다.',html:renderPhoneConnectAcademySheet,onSave:async()=>{if(typeof requestOlliAcademyAccessFromSettings==='function')await requestOlliAcademyAccessFromSettings()}},
    academyMembershipRole:{title:'학원별 권한 변경',desc:'선택한 계정의 현재 학원 권한만 변경합니다.',html:renderPhoneMembershipRoleSheet,onSave:async()=>{if(typeof saveOlliAcademyMembershipRole==='function')await saveOlliAcademyMembershipRole()}},
    logout:{title:'계정 로그아웃',desc:'현재 폰에서 개인계정 세션을 해제합니다.',html:renderPhoneLogoutSheet,ownActions:true}
  };

  function getPhoneSettingsSheet(type){
    return PHONE_SETTINGS_SHEETS[type]||phoneExternalSheets.get(type)||null;
  }

  function registerPhoneSettingsSheet(type,config){
    const key=clean(type);
    if(!key||!config||typeof config!=='object')return false;
    phoneExternalSheets.set(key,config);
    return true;
  }

  function refreshPhoneSettingsSheetBody(){
    const data=getPhoneSettingsSheet(phoneSettingsSheetType);
    const content=document.getElementById('settingsSheetContent');
    if(!data||!content)return;
    content.innerHTML=typeof data.html==='function'?data.html():data.html;
  }

  function openPhoneSettingsSheet(type){
    const data=getPhoneSettingsSheet(type);
    if(!data){
      console.warn('폰 설정 시트를 찾지 못했습니다:',type);
      return false;
    }
    phoneSettingsSheetType=type;

    const overlay=document.getElementById('settingsSheetOverlay');
    const title=document.getElementById('settingsSheetTitle');
    const desc=document.getElementById('settingsSheetDesc');
    const content=document.getElementById('settingsSheetContent');
    if(!overlay||!title||!desc||!content)return false;

    title.textContent=data.title||'설정';
    desc.textContent=data.desc||'';
    content.innerHTML=typeof data.html==='function'?data.html():data.html;

    const actions=overlay.querySelector('.settingsSheetActions');
    const saveBtn=overlay.querySelector('.settingsSheetBtn.primary');
    const cancelBtn=overlay.querySelector('.settingsSheetBtn:not(.primary)');
    const consultationReadOnly=type==='consultationMonths'&&!phoneCanEditConsultation();

    if(actions)actions.style.display=data.ownActions?'none':'grid';
    if(saveBtn)saveBtn.style.display=typeof data.onSave==='function'&&!consultationReadOnly?'flex':'none';
    if(cancelBtn)cancelBtn.textContent=consultationReadOnly?'닫기':'취소';

    overlay.classList.add('show');
    return true;
  }

  async function savePhoneSettingsSheet(){
    const data=getPhoneSettingsSheet(phoneSettingsSheetType);
    const btn=document.querySelector('#settingsSheetOverlay .settingsSheetBtn.primary');
    try{
      if(!data||typeof data.onSave!=='function'){
        closePhoneSettingsSheet();
        return;
      }
      if(btn){btn.disabled=true;btn.textContent='저장 중...'}
      await data.onSave();
      closePhoneSettingsSheet();
    }catch(error){
      alert('저장 중 오류가 발생했습니다.\n'+(error?.message||error));
    }finally{
      if(btn&&btn.isConnected){btn.disabled=false;btn.textContent='저장'}
    }
  }

  function closePhoneSettingsSheet(event){
    if(event&&event.target&&event.target.id!=='settingsSheetOverlay')return false;
    const overlay=document.getElementById('settingsSheetOverlay');
    if(overlay)overlay.classList.remove('show');
    phoneSettingsSheetType='';
    return true;
  }

  function openPhoneSettingsPage(){
    const settings=document.getElementById('settingsPageScreen');
    const detail=document.getElementById('settingsDetailScreen');
    const record=document.getElementById('recordRoomScreen');
    if(!settings)return false;

    if(detail)detail.style.display='none';
    settings.style.display='flex';
    settings.style.position='fixed';
    settings.style.inset='0';
    settings.style.transform='translateX(0)';
    settings.style.opacity='1';
    settings.style.pointerEvents='auto';
    settings.style.zIndex='130000';
    if(record)record.style.display='flex';

    try{if(typeof settingsApplyStateToUI==='function')settingsApplyStateToUI()}catch(_){}
    try{updatePhoneSettingsTimetableModeValue()}catch(_){}
    setTimeout(()=>{try{if(typeof applySettingsPermissionUI==='function')applySettingsPermissionUI()}catch(_){}},80);
    setTimeout(()=>{try{if(typeof applySettingsPermissionUI==='function')applySettingsPermissionUI()}catch(_){}},600);
    try{
      if(typeof settingsRefreshAll==='function'){
        Promise.resolve(settingsRefreshAll()).then(()=>{
          try{updatePhoneSettingsTimetableModeValue()}catch(_){}
          if(phoneSettingsSheetType==='timetableMode')refreshPhoneSettingsSheetBody();
        }).catch(()=>{});
      }
    }catch(_){}
    return true;
  }

  function closePhoneSettingsPage(){
    const settings=document.getElementById('settingsPageScreen');
    const detail=document.getElementById('settingsDetailScreen');
    const record=document.getElementById('recordRoomScreen');
    if(detail)detail.style.display='none';
    if(settings){
      settings.style.display='none';
      settings.style.position='';
      settings.style.inset='';
      settings.style.transform='';
      settings.style.opacity='';
      settings.style.pointerEvents='';
      settings.style.zIndex='';
    }
    if(record)record.style.display='flex';
    return true;
  }

  async function togglePhoneSettingsNotification(){
    const cached=typeof settingsGetCachedState==='function'?settingsGetCachedState():{};
    const currentEnabled=cached.notificationEnabled!==undefined?!!cached.notificationEnabled:true;
    const next=!currentEnabled;

    if(next){
      const enabled=await global.OlliTalkPush?.ensureSubscription?.({interactive:true});
      if(enabled!==true){
        if(typeof settingsSaveCachePatch==='function')settingsSaveCachePatch({notificationEnabled:false});
        if(typeof settingsApplyStateToUI==='function')settingsApplyStateToUI();
        return false;
      }
      if(typeof settingsSaveCachePatch==='function')settingsSaveCachePatch({notificationEnabled:true});
      if(typeof settingsApplyStateToUI==='function')settingsApplyStateToUI();
      try{await global.refreshOlliTalkMentionBadge?.()}catch(_){}
      try{global.showPushToast?.('알림을 켰어요.')}catch(_){}
      return true;
    }

    const disabled=await global.OlliTalkPush?.disableSubscription?.({interactive:true});
    if(disabled!==true){
      if(typeof settingsApplyStateToUI==='function')settingsApplyStateToUI();
      return false;
    }
    if(typeof settingsSaveCachePatch==='function')settingsSaveCachePatch({notificationEnabled:false});
    if(typeof settingsApplyStateToUI==='function')settingsApplyStateToUI();
    try{global.showPushToast?.('알림을 껐어요.')}catch(_){}
    return true;
  }

  global.selectSettingsTextSizeOption=selectSettingsTextSizeOption;
  global.selectSettingsStartPageOption=selectSettingsStartPageOption;
  global.selectPhoneTimetableModeOption=selectPhoneTimetableModeOption;
  global.updatePhoneSettingsTimetableModeValue=updatePhoneSettingsTimetableModeValue;
  global.phoneToggleConsultationRule=phoneToggleConsultationRule;
  global.phoneSelectFeedbackGroup=phoneSelectFeedbackGroup;
  global.phoneToggleFeedbackMonth=phoneToggleFeedbackMonth;
  global.updateSettingsGroupFeedbackMonthsValue=updatePhoneSettingsGroupFeedbackMonthsValue;
  global.registerPhoneSettingsSheet=registerPhoneSettingsSheet;

  if(global.OlliAttendancePolicyPhoneSheet){
    registerPhoneSettingsSheet('attendancePolicy',global.OlliAttendancePolicyPhoneSheet);
  }

  global.openPhoneSettingsPage=openPhoneSettingsPage;
  global.closePhoneSettingsPage=closePhoneSettingsPage;
  global.openPhoneSettingsSheet=openPhoneSettingsSheet;
  global.savePhoneSettingsSheet=savePhoneSettingsSheet;
  global.closePhoneSettingsSheet=closePhoneSettingsSheet;
  global.togglePhoneSettingsNotification=togglePhoneSettingsNotification;

  // Compatibility aliases for shared actions that still call the generic names.
  global.openSettingsPage=openPhoneSettingsPage;
  global.closeSettingsPage=closePhoneSettingsPage;
  global.openSettingsSheet=openPhoneSettingsSheet;
  global.saveSettingsSheet=savePhoneSettingsSheet;
  global.closeSettingsSheet=closePhoneSettingsSheet;
  global.toggleSettingsNotification=togglePhoneSettingsNotification;

  setTimeout(()=>{
    try{if(typeof settingsApplyStateToUI==='function')settingsApplyStateToUI()}catch(_){}
  },0);
})(window);
