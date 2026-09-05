
/* 2026-04-28 settings sales-mode patch: profile storage, teacher roles, account logout */
(function(){
  let settingsPendingProfileFile = null;
  let settingsPendingProfilePreview = '';
  function getSettingsAcademyCode(){return (olliSettingsState&&olliSettingsState.academy&&olliSettingsState.academy.academy_code)||localStorage.getItem('olli_current_academy_code')||'';}
  function getSettingsAcademyName(){return (olliSettingsState&&olliSettingsState.academy&&olliSettingsState.academy.academy_name)||localStorage.getItem('olli_current_academy_name')||settingsGetCachedState().academyName||'비비작아이성향미술학원';}
  function getSettingsProfileImageUrl(){const cached=settingsGetCachedState();return settingsPendingProfilePreview||(olliSettingsState&&olliSettingsState.academy&&olliSettingsState.academy.profile_image_url)||cached.profileImageUrl||'';}
  function renderAcademyIdLine(){const code=getSettingsAcademyCode();return '<div class="settingsAcademyIdLine">학원 ID : '+settingsEscapeHtml(code||'미설정')+'</div>';}
  function injectAcademyIdLine(){document.querySelectorAll('#settingsPageScreen .settingsProfileInfo').forEach(info=>{let line=info.querySelector('.settingsAcademyIdLine');if(!line){line=document.createElement('div');line.className='settingsAcademyIdLine';const edit=info.querySelector('.settingsProfileEdit');if(edit)info.insertBefore(line,edit);else info.appendChild(line);}line.textContent='학원 ID : '+(getSettingsAcademyCode()||'미설정');});}
  const oldSettingsSetCachedAcademy=window.settingsSetCachedAcademy;window.settingsSetCachedAcademy=function(academy){if(typeof oldSettingsSetCachedAcademy==='function')oldSettingsSetCachedAcademy(academy);if(!academy)return;if(academy.region||academy.academy_region)localStorage.setItem('olli_current_academy_region',academy.region||academy.academy_region||'');if(academy.profile_image_url)settingsSaveCachePatch({profileImageUrl:academy.profile_image_url, profileImageDataUrl:''});};
  const oldSettingsApplyStateToUI=window.settingsApplyStateToUI;window.settingsApplyStateToUI=function(){if(typeof oldSettingsApplyStateToUI==='function')oldSettingsApplyStateToUI();const academyName=getSettingsAcademyName();const imageUrl=getSettingsProfileImageUrl();document.querySelectorAll('.settingsProfileName').forEach(el=>{el.textContent=academyName;});document.querySelectorAll('.settingsProfileImage').forEach(el=>{if(imageUrl)el.innerHTML='<img src="'+settingsEscapeAttr(imageUrl)+'" alt="학원 프로필">';else el.textContent='V';});injectAcademyIdLine();};
  window.handleSettingsProfileImageChange=function(event){const file=event.target.files&&event.target.files[0];if(!file)return;const allowed=['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'];if(file.type&&!allowed.includes(file.type)){alert('현재 academy_profiles 버킷은 jpg, png, webp, gif, heic만 허용되어 있습니다.\n선택한 파일 형식: '+file.type);event.target.value='';return;}settingsPendingProfileFile=file;const reader=new FileReader();reader.onload=function(){settingsPendingProfilePreview=String(reader.result||'');settingsApplyStateToUI();openSettingsSheet('profile');};reader.readAsDataURL(file);};
  function settingsCanvasToBlob(canvas, type, quality){
    return new Promise(function(resolve, reject){
      if(!canvas || typeof canvas.toBlob !== 'function'){
        reject(new Error('이미지 압축을 지원하지 않는 브라우저입니다.'));
        return;
      }
      canvas.toBlob(function(blob){
        if(blob) resolve(blob);
        else reject(new Error('프로필 이미지 압축에 실패했습니다.'));
      }, type, quality);
    });
  }

  function settingsLoadImageElementFromFile(file){
    return new Promise(function(resolve, reject){
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function(){ URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error('이미지 파일을 읽을 수 없습니다.')); };
      img.src = url;
    });
  }

  async function compressSettingsProfileImageFile(file){
    if(!file) return file;
    const inputType = file.type || 'image/jpeg';
    const allowed = ['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'];
    if(inputType && !allowed.includes(inputType)){
      throw new Error('지원하지 않는 이미지 형식입니다. jpg, png, webp, gif, heic 파일만 선택해 주세요.');
    }

    const maxFinalBytes = 900 * 1024;
    const targetBytes = 420 * 1024;
    const outputType = 'image/jpeg';
    let source = null;
    let sourceKind = '';

    try{
      try{
        if(typeof createImageBitmap === 'function'){
          source = await createImageBitmap(file);
          sourceKind = 'bitmap';
        }
      }catch(bitmapErr){
        console.warn('createImageBitmap profile compression fallback:', bitmapErr);
      }
      if(!source){
        source = await settingsLoadImageElementFromFile(file);
        sourceKind = 'image';
      }

      const originalWidth = source.width || source.naturalWidth || 1;
      const originalHeight = source.height || source.naturalHeight || 1;
      const maxSides = [640, 520, 420, 320];
      const qualities = [0.78, 0.68, 0.58, 0.48, 0.40];
      let bestBlob = null;

      for(const maxSide of maxSides){
        const ratio = Math.min(1, maxSide / Math.max(originalWidth, originalHeight));
        const width = Math.max(1, Math.round(originalWidth * ratio));
        const height = Math.max(1, Math.round(originalHeight * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if(!ctx) throw new Error('이미지 압축을 위한 캔버스를 만들 수 없습니다.');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(source, 0, 0, width, height);

        for(const quality of qualities){
          const blob = await settingsCanvasToBlob(canvas, outputType, quality);
          if(!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
          if(blob.size <= targetBytes){
            return new File([blob], 'profile.jpg', {type: outputType, lastModified: Date.now()});
          }
        }
      }

      if(!bestBlob) throw new Error('이미지 압축 결과가 없습니다.');
      if(bestBlob.size > maxFinalBytes){
        throw new Error('이미지를 압축했지만 아직 너무 큽니다. 다른 사진을 선택해 주세요.');
      }
      return new File([bestBlob], 'profile.jpg', {type: outputType, lastModified: Date.now()});
    }catch(err){
      console.warn('profile image compression failed:', err);
      throw new Error('프로필 사진 압축에 실패했습니다. 다른 사진이나 jpg/png 파일로 다시 선택해 주세요.');
    }finally{
      if(sourceKind === 'bitmap' && source && typeof source.close === 'function') source.close();
    }
  }

  async function uploadSettingsProfileImageToSupabase(file){const academyId=settingsGetAcademyId();if(!academyId)throw new Error('academy_id가 없습니다. 먼저 현재 학원 ID가 정상 저장되어 있는지 확인해야 합니다.');if(!file)return getSettingsProfileImageUrl();if(!isSupabaseConfigured())throw new Error('Supabase 설정이 없습니다.');const uploadFile=await compressSettingsProfileImageFile(file);if(uploadFile.size > 900*1024)throw new Error('압축된 사진이 아직 큽니다. 다른 사진을 선택해 주세요.');const ext='jpg';const objectPath=academyId+'/profile.'+ext;const res=await fetch(`${SUPABASE_URL}/storage/v1/object/academy_profiles/${objectPath}`,{method:'POST',headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${getOlliAuthAccessToken?(getOlliAuthAccessToken()||SUPABASE_KEY):SUPABASE_KEY}`,'Content-Type':uploadFile.type||'image/jpeg','Cache-Control':'3600','x-upsert':'true'},body:uploadFile});const txt=await res.text();if(!res.ok){let msg=txt||'프로필 사진 업로드 실패';try{const data=JSON.parse(txt);msg=data.message||data.error||txt;}catch(e){}if(String(msg).toLowerCase().includes('quota'))msg+='\n압축은 적용되어 있습니다. Supabase Storage 정책 또는 버킷 파일 크기 제한도 함께 확인해 주세요.';throw new Error(msg);}return `${SUPABASE_URL}/storage/v1/object/public/academy_profiles/${objectPath}?v=${Date.now()}`;}
  if(typeof settingsSheetData !== 'undefined' && settingsSheetData.profile){settingsSheetData.profile.desc='학원 이름과 프로필 이미지를 설정합니다.';settingsSheetData.profile.html=function(){const academyName=getSettingsAcademyName();const image=getSettingsProfileImageUrl();const imageHtml=image?'<img src="'+settingsEscapeAttr(image)+'" alt="학원 프로필">':'V';return '<div class="settingsProfileCard" style="box-shadow:none;background:#f7f7f5;margin-bottom:12px;"><div class="settingsProfileImage editable" onclick="openSettingsProfileImagePicker()">'+imageHtml+'</div><div class="settingsProfileInfo"><div class="settingsProfileName">'+settingsEscapeHtml(academyName)+'</div>'+renderAcademyIdLine()+'<div class="settingsProfileEdit" onclick="openSettingsProfileImagePicker()">사진 변경</div></div></div><div class="settingsInputGroup"><div class="settingsInputLabel">학원 이름</div><input id="settingsAcademyNameInput" class="settingsInput" value="'+settingsEscapeAttr(academyName)+'"></div><div class="settingsMiniText">사진은 Supabase Storage의 academy_profiles 버킷에 저장되어 다른 기기에서도 동일하게 표시됩니다.</div>';};settingsSheetData.profile.onSave=async function(){const input=document.getElementById('settingsAcademyNameInput');const newName=input&&input.value.trim()?input.value.trim():'학원 이름';const academyId=settingsGetAcademyId();let uploadedUrl=(olliSettingsState&&olliSettingsState.academy&&olliSettingsState.academy.profile_image_url)||settingsGetCachedState().profileImageUrl||'';try{settingsSaveCachePatch({academyName:newName});if(settingsPendingProfileFile){uploadedUrl=await uploadSettingsProfileImageToSupabase(settingsPendingProfileFile);settingsPendingProfileFile=null;settingsPendingProfilePreview='';settingsSaveCachePatch({profileImageUrl:uploadedUrl,profileImageDataUrl:''});}if(academyId&&isSupabaseConfigured()){const payload={academy_name:newName};if(uploadedUrl&&/^https?:\/\//.test(uploadedUrl))payload.profile_image_url=uploadedUrl;await supabase('PATCH',`academies?id=eq.${encodeURIComponent(academyId)}`,payload);if(olliSettingsState.academy){olliSettingsState.academy.academy_name=newName;if(payload.profile_image_url)olliSettingsState.academy.profile_image_url=payload.profile_image_url;}localStorage.setItem('olli_current_academy_name',newName);}settingsApplyStateToUI();}catch(err){alert('프로필 저장 실패\n' + (err.message || err));throw err;}};}
  const oldOpenSettingsSheetForSettingsFix=window.openSettingsSheet||openSettingsSheet;
  window.openSettingsSheet=function(type){
    if(typeof oldOpenSettingsSheetForSettingsFix==='function')oldOpenSettingsSheetForSettingsFix(type);
    const overlay=document.getElementById('settingsSheetOverlay');
    if(!overlay)return;
    const data=settingsSheetData[type]||settingsSheetData.ai;
    const actions=overlay.querySelector('.settingsSheetActions');
    const saveBtn=overlay.querySelector('.settingsSheetBtn.primary');
    const cancelBtn=overlay.querySelector('.settingsSheetBtn:not(.primary)');
    const consultationReadOnly = type === 'consultationMonths' && typeof canEditOlliConsultationSettings === 'function' && !canEditOlliConsultationSettings();
    if(actions){actions.style.display=(type==='logout')?'none':'grid';}
    if(saveBtn){saveBtn.style.display=(data&&typeof data.onSave==='function'&&!consultationReadOnly)?'flex':'none';}
    if(cancelBtn){cancelBtn.textContent=consultationReadOnly?'닫기':'취소';}
  };
  window.saveSettingsSheet=async function(){const btn=document.querySelector('#settingsSheetOverlay .settingsSheetBtn.primary');try{const data=settingsSheetData[currentSettingsSheetType];if(!data||typeof data.onSave!=='function'){closeSettingsSheet();return;}if(btn){btn.disabled=true;btn.textContent='저장 중...';}await data.onSave();closeSettingsSheet();}catch(err){alert('저장 중 오류가 발생했습니다.\n'+(err.message||err));}finally{if(btn){btn.disabled=false;btn.textContent='저장';}}};

  function getManagerPermission(roleKey){const cached=settingsGetCachedState();const perms=cached.managerPermissions||{};return !!perms[roleKey];}
  async function setManagerPermission(roleKey,value){if(roleKey!=='backup')return;const cached=settingsGetCachedState();const managerPermissions={...(cached.managerPermissions||{}),backup:!!value};settingsSaveCachePatch({managerPermissions});const academyId=settingsGetAcademyId();if(academyId&&isSupabaseConfigured()){try{await supabase('PATCH',`academies?id=eq.${encodeURIComponent(academyId)}`,{manager_can_backup:!!value});if(olliSettingsState&&olliSettingsState.academy)olliSettingsState.academy.manager_can_backup=!!value;}catch(err){console.warn('manager permission save failed:',err);alert('관리자 권한 저장 중 오류가 발생했습니다. '+(err.message||err));}}openSettingsDetail('roles');}
  window.toggleManagerPermission=function(roleKey){setManagerPermission(roleKey,!getManagerPermission(roleKey));};
  if(typeof settingsDetailData !== 'undefined' && settingsDetailData.roles){settingsDetailData.roles.html=function(){const backupOn=getManagerPermission('backup')||!!(olliSettingsState.academy&&olliSettingsState.academy.manager_can_backup);return '<div class="settingsDetailIntro"><div class="settingsDetailTitle">관리자 기본 권한 위에<br>필요한 권한만 추가합니다.</div></div><div class="settingsRoleCard"><div class="settingsRoleTop"><div class="settingsRoleName">원장</div><span class="settingsStatusBadge">전체 권한</span></div><div class="settingsRoleList"><div class="settingsRoleItem">전체 설정, 선생님 관리, 학원 삭제/양도</div><div class="settingsRoleItem">백업 / 내보내기 사용 가능</div></div></div><div class="settingsRoleCard"><div class="settingsRoleTop"><div class="settingsRoleName">관리자 기본 권한</div><span class="settingsStatusBadge">기본 권한</span></div><div class="settingsRoleList"><div class="settingsRoleItem">학생 기록과 피드백 흐름 점검 가능</div><div class="settingsRoleItem">선생님 기록 상태 확인 가능</div><div class="settingsRoleItem">학원 삭제, 원장 양도, 권한 부여는 제한</div></div></div><div class="settingsRoleCard"><div class="settingsRoleTop"><div class="settingsRoleName">관리자 추가 권한 부여</div><span class="settingsStatusBadge">선택 권한</span></div><div class="settingsPermissionRow"><div><div class="settingsPermissionText">백업 / 내보내기 사용 가능</div><div class="settingsPermissionDesc">관리자에게 데이터 내보내기 권한을 추가로 부여합니다.</div></div><button class="settingsMiniSwitch '+(backupOn?'on':'')+'" type="button" onclick="toggleManagerPermission(\'backup\')"></button></div></div><div class="settingsRoleCard"><div class="settingsRoleTop"><div class="settingsRoleName">선생님</div><span class="settingsStatusBadge">기록 권한</span></div><div class="settingsRoleList"><div class="settingsRoleItem">담당 학생 기록 작성</div><div class="settingsRoleItem">피드백 작성과 성장 피드백 입력</div><div class="settingsRoleItem">권한 변경과 데이터 내보내기는 제한</div></div></div>';};}
  const OLLI_LOGOUT_CLEAR_KEYS=['olli_owner_logged_in','olli_teacher_logged_in','olli_current_member_role','olli_current_member_name','olli_current_member_id','olli_owner_login_at','olli_teacher_login_at','olli_current_academy_id','olli_current_academy_code','olli_current_academy_name','olli_current_academy_region','olli_pending_academy_code','olli_pending_teacher_name','olli_account_session_token_v1','olli_account_login_id_v1','olli_account_id_v1','olli_account_name_v1','olli_account_academies_v1','olli_account_device_id_v1',OLLI_SETTINGS_LOCAL_KEY];
  function clearOlliAccountLogoutLocalState(){
    try{
      if(window.OlliStorageCore?.AcademyContext){
        window.OlliStorageCore.AcademyContext.clearRuntime('account_logout');
        window.OlliStorageCore.AcademyContext.setAccessible([]);
      }
      OLLI_LOGOUT_CLEAR_KEYS.forEach(k=>localStorage.removeItem(k));
      Object.keys(localStorage).forEach(key=>{
        if(key===STUDENTS_KEY||key.startsWith(STUDENTS_KEY+'_')||key===OLLI_DEFAULT_START_PAGE_FALLBACK_KEY||key.startsWith('olli_default_start_page_')) localStorage.removeItem(key);
      });
      if(typeof students!=='undefined'&&Array.isArray(students)) students.length=0;
      if(typeof filteredStudents!=='undefined'&&Array.isArray(filteredStudents)) filteredStudents.length=0;
      if(typeof olliSettingsState!=='undefined'&&olliSettingsState){
        olliSettingsState.academy=null;
        olliSettingsState.members=[];
        olliSettingsState.approvalRequests=[];
        olliSettingsState.academyAccessRequests=[];
        olliSettingsState.academyAccountMemberships=[];
        olliSettingsState.lastError='';
      }
      if(typeof currentStudentId!=='undefined') currentStudentId='';
      if(typeof currentTeacherId!=='undefined') currentTeacherId='';
      if(typeof selectedStudentIds!=='undefined'&&selectedStudentIds&&typeof selectedStudentIds.clear==='function') selectedStudentIds.clear();
    }catch(err){
      console.warn('account logout local cleanup failed',err);
    }
  }
  async function doOlliAccountLogout(){
    const ok = confirm('이 기기에서 계정 로그아웃할까요?\n학원 데이터와 선생님 승인은 삭제되지 않습니다.');
    if(!ok) return;
    const btn = document.querySelector('[data-account-logout-btn]');
    try{
      if(btn){btn.disabled=true;btn.textContent='로그아웃 중...';}
      if(typeof revokeOlliAccountSessionBestEffort==='function') await revokeOlliAccountSessionBestEffort();
      clearOlliAccountLogoutLocalState();
      closeSettingsSheet();
      showOlliLoginEntry();
    }catch(err){
      console.warn('account logout failed:',err);
      clearOlliAccountLogoutLocalState();
      closeSettingsSheet();
      showOlliLoginEntry();
    }finally{
      if(btn){btn.disabled=false;btn.textContent='계정 로그아웃';}
    }
  }
  window.doOlliLocalLogout=doOlliAccountLogout;
  window.doOlliAccountLogout=doOlliAccountLogout;
  if(typeof settingsSheetData !== 'undefined' && settingsSheetData.logout){
    settingsSheetData.logout.title='계정 로그아웃';
    settingsSheetData.logout.desc='현재 기기에서 개인계정 세션을 해제합니다.';
    settingsSheetData.logout.html='<div class="settingsInfoItem">계정 로그아웃을 하면 이 기기의 자동 로그인이 해제됩니다. 학원 데이터와 선생님 승인 정보는 삭제되지 않습니다.</div><div class="settingsLogoutDangerBox"><button class="settingsDangerFullBtn" data-account-logout-btn type="button" onclick="doOlliAccountLogout()">계정 로그아웃</button><button class="settingsDangerFullBtn light" type="button" onclick="closeSettingsSheet()">취소</button></div>';
    settingsSheetData.logout.onSave=null;
  }
  document.addEventListener('DOMContentLoaded',function(){setTimeout(function(){settingsApplyStateToUI();},0);});
})();
