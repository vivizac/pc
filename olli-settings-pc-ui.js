/* PC-only settings UI/router.
 * Shared settings state, roles, academy/member data, RPC, and shared policy helpers live in olli-settings-common-core.js.
 */

function openSettingsPage() {
  const settings = document.getElementById('settingsPageScreen');
  const detail = document.getElementById('settingsDetailScreen');
  const record = document.getElementById('recordRoomScreen');

  if (!settings) return;

  if (typeof window.olliPcSettingsLayoutBeforeOpenPage === 'function') {
    try { window.olliPcSettingsLayoutBeforeOpenPage(); } catch (_) {}
  }

  if (detail) detail.style.display = 'none';

  // 기존 슬라이드 함수와 충돌하지 않도록 설정 페이지는 독립 오버레이처럼 연다.
  settings.style.display = 'flex';
  settings.style.position = 'fixed';
  settings.style.inset = '0';
  settings.style.transform = 'translateX(0)';
  settings.style.opacity = '1';
  settings.style.pointerEvents = 'auto';
  settings.style.zIndex = '130000';

  if (record) record.style.display = 'flex';

  settingsApplyStateToUI();
  setTimeout(() => {
    try { if (typeof applySettingsPermissionUI === 'function') applySettingsPermissionUI(); } catch (_) {}
  }, 80);
  setTimeout(() => {
    try { if (typeof applySettingsPermissionUI === 'function') applySettingsPermissionUI(); } catch (_) {}
  }, 600);
  settingsRefreshAll();
  if (typeof window.olliPcSettingsLayoutAfterOpenPage === 'function') {
    try { window.olliPcSettingsLayoutAfterOpenPage(); } catch (_) {}
  }
}

function closeSettingsPage() {
  const settings = document.getElementById('settingsPageScreen');
  const detail = document.getElementById('settingsDetailScreen');
  const record = document.getElementById('recordRoomScreen');

  if (detail) detail.style.display = 'none';

  if (settings) {
    settings.style.display = 'none';
    settings.style.transform = '';
    settings.style.opacity = '';
    settings.style.pointerEvents = '';
  }

  if (record) record.style.display = 'flex';
  if (typeof window.olliPcSettingsLayoutAfterClosePage === 'function') {
    try { window.olliPcSettingsLayoutAfterClosePage(); } catch (_) {}
  }
}
function toggleSettingsNotification() {
  const cached = settingsGetCachedState();
  const next = !(cached.notificationEnabled !== undefined ? cached.notificationEnabled : true);
  settingsSaveCachePatch({ notificationEnabled: next });
  settingsApplyStateToUI();

  if (next && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        try { new Notification('올리', { body: '알림 설정이 완료되었습니다.' }); } catch (err) {}
      }
    }).catch(() => {});
  }
}


let currentSettingsSheetType = null;

const settingsSheetData = {
  profile: {
    title:'프로필 편집',
    desc:'학원 이름과 프로필 이미지를 설정합니다.',
    html:function(){
      const cached = settingsGetCachedState();
      const academy = olliSettingsState.academy || {};
      const academyName = academy.academy_name || cached.academyName || '비비작아이성향미술학원';
      const image = academy.profile_image_url || cached.profileImageDataUrl || '';
      const imageHtml = image ? '<img src="' + settingsEscapeAttr(image) + '" alt="학원 프로필">' : 'V';

      return '<div class="settingsProfileCard" style="box-shadow:none;background:#f7f7f5;margin-bottom:12px;">'
        + '<div class="settingsProfileImage editable" onclick="openSettingsProfileImagePicker()">' + imageHtml + '</div>'
        + '<div class="settingsProfileInfo"><div class="settingsProfileName">' + settingsEscapeHtml(academyName) + '</div><div class="settingsProfileEdit" onclick="openSettingsProfileImagePicker()">사진 변경</div></div></div>'
        + '<div class="settingsInputGroup"><div class="settingsInputLabel">학원 이름</div><input id="settingsAcademyNameInput" class="settingsInput" value="' + settingsEscapeAttr(academyName) + '"></div>'
        + '<div class="settingsMiniText">사진은 현재 이 기기 미리보기 저장 방식입니다. 실제 판매용에서는 Supabase Storage 연결이 필요합니다.</div>';
    },
    onSave: async function(){
      const input = document.getElementById('settingsAcademyNameInput');
      const newName = input && input.value.trim() ? input.value.trim() : '학원 이름';

      const academyId = settingsGetAcademyId();
      settingsSaveCachePatch({ academyName: newName });

      if (academyId && isSupabaseConfigured()) {
        try {
          const rows = await supabase('PATCH', `academies?id=eq.${encodeURIComponent(academyId)}`, { academy_name: newName });
          if (olliSettingsState.academy) olliSettingsState.academy.academy_name = newName;
          localStorage.setItem('olli_current_academy_name', newName);
        } catch (err) {
          alert('학원명 저장 중 오류가 발생했습니다.\n' + (err.message || err));
        }
      }

      settingsApplyStateToUI();
    }
  },
  ai: {
    title:'AI 사용 안내',
    desc:'AI가 생성한 문구는 자동 발송되지 않으며, 선생님 또는 원장이 검토한 뒤 사용합니다.',
    html:'<div class="settingsInfoItem">피드백 문구는 최종 검토 후 학부모에게 전달해야 합니다.</div>'
  },
  textSize: {
    title:'텍스트 크기',
    desc:'앱 안의 글자와 일부 버튼 크기를 조절합니다. OLLI 로고 크기는 그대로 유지됩니다.',
    html:function(){
      const current = getOlliTextSizeSetting();
      const option = function(value, label, guide){
        const active = current === value;
        return '<button type="button" class="settingsStartPageOption ' + (active ? 'active' : '') + '" data-text-size-option="' + value + '" onclick="selectSettingsTextSizeOption(&quot;' + value + '&quot;)"><span>' + label + '<span class="settingsTextSizeGuide">' + guide + '</span></span><span class="check">' + (active ? '✓' : '') + '</span></button>';
      };
      return '<div class="settingsInputGroup">'
        + option('default', '기본', '1.12배')
        + option('medium', '중간', '1.20배')
        + option('large', '크게', '1.30배')
        + '</div><div class="settingsMiniText">작은 글씨가 불편한 원장님은 중간 또는 크게를 선택하면 학생명, 입력창, 버튼 텍스트, 설정 메뉴가 함께 커집니다.</div>';
    },
    onSave: async function(){
      const selected = document.querySelector('[data-text-size-option].active')?.getAttribute('data-text-size-option') || 'default';
      localStorage.setItem(OLLI_TEXT_SIZE_LOCAL_KEY, selected === 'large' ? 'large' : (selected === 'medium' ? 'medium' : 'default'));
      applyOlliTextSizeSetting();
    }
  },
  startPage: {
    title:'시작 페이지',
    desc:'앱을 열었을 때 처음 보여줄 화면을 선택합니다. 계정 권한에 맞는 화면만 선택할 수 있습니다.',
    html:function(){
      const current = getOlliAllowedStartPage(getOlliDefaultStartPage() || 'elementary_attendance');
      const option = function(item){
        const value = item.value;
        const label = item.label;
        const active = normalizeOlliStartPage(value) === current;
        return '<button type="button" class="settingsStartPageOption ' + (active ? 'active' : '') + '" data-start-page-option="' + value + '" onclick="selectSettingsStartPageOption(\'' + value + '\')"><span>' + label + '</span><span class="check">' + (active ? '✓' : '') + '</span></button>';
      };
      const optionsHtml = getOlliStartPageOptionsForCurrentRole().map(option).join('');
      const guide = canAccessOlliStartPageAcademyManagement()
        ? '원장·관리자 계정은 관찰노트, 1분 피드백, 출석부, 학원관리를 시작 화면으로 선택할 수 있습니다.'
        : '선생님 계정은 관찰노트, 1분 피드백, 출석부를 시작 화면으로 선택할 수 있습니다.';
      return '<div class="settingsInputGroup">' + optionsHtml + '</div><div class="settingsMiniText">' + guide + '</div>';
    },
    onSave: async function(){
      const selected = document.querySelector('.settingsStartPageOption.active')?.getAttribute('data-start-page-option') || getOlliAllowedStartPage(getOlliDefaultStartPage() || 'elementary_attendance');
      await saveOlliDefaultStartPage(selected);
    }
  },
  consultationMonths: {
    title:'상담 기준',
    desc:'초등부와 유치부 상담 기준을 따로 선택합니다. 여러 개를 선택할 수 있습니다.',
    html:function(){
      const canEdit = canEditOlliConsultationSettings();
      const renderGroup = (type, title) => {
        const selected = new Set(getOlliConsultationRules(type));
        const buttons = getOlliConsultationRuleOptions().map(option => {
          return '<button type="button" class="settingsMonthOption ' + (selected.has(option.key) ? 'active' : '') + '" data-consultation-type="' + type + '" data-consultation-rule="' + option.key + '" ' + (canEdit ? 'onclick="toggleSettingsConsultationRuleOption(\'' + option.key + '\', \'' + type + '\')"' : 'disabled aria-disabled="true"') + '>' + option.label + '</button>';
        }).join('');
        return '<div class="settingsMiniText">' + title + '</div><div class="settingsMonthGrid">' + buttons + '</div>';
      };
      const guide = canEdit
        ? '초등부와 유치부의 상담 주기를 각각 저장합니다. 1개월 후, 3개월 후는 한 번만 표시되고 6개월마다, 12개월마다는 등록월 기준으로 반복 표시됩니다.'
        : '상담 기준은 원장 또는 관리자 계정에서만 변경할 수 있습니다. 현재 계정에서는 확인만 가능합니다.';
      return renderGroup('elementary', '초등부 상담 기준') + renderGroup('kinder', '유치부 상담 기준') + '<div class="settingsMiniText">' + guide + '</div>';
    },
    onSave: async function(){
      if (!canEditOlliConsultationSettings()) {
        alert('상담 기준은 원장 또는 관리자 계정에서만 변경할 수 있습니다.');
        return;
      }
      const collect = (type) => {
        const selected = Array.from(document.querySelectorAll(`[data-consultation-type="${type}"][data-consultation-rule].active`))
          .map(btn => btn.getAttribute('data-consultation-rule'))
          .filter(Boolean);
        return selected.length ? selected : getOlliDefaultConsultationRules(type);
      };
      await saveOlliConsultationRulesShared({ elementary: collect('elementary'), kinder: collect('kinder') });
      settingsApplyStateToUI();
      if (currentRecordView === 'academy' && typeof renderRecordAcademyManagementDashboard === 'function') renderRecordAcademyManagementDashboard();
    }
  },


  groupFeedbackMonths: {
    title:'그룹별 피드백 발송월',
    desc:'초등부 그룹별로 피드백을 발송할 월을 선택합니다. 모든 기기에서 같은 기준을 사용합니다.',
    html:function(){ return renderSettingsGroupFeedbackMonths(); },
    onSave: async function(){
      const map = readElementaryGroupFeedbackMonthsMap();
      await saveOlliSharedSettingToServer(OLLI_SHARED_SETTINGS_KEY_GROUP_MONTHS, map);
      updateSettingsGroupFeedbackMonthsValue();
      if (typeof window.refreshRecordSortPopup === 'function') window.refreshRecordSortPopup();
      if (currentRecordView === 'academy' && typeof renderRecordAcademyManagementDashboard === 'function') renderRecordAcademyManagementDashboard();
    }
  },
  newAcademy: {
    title:'새 학원 만들기',
    desc:'현재 원장 계정에 새 학원을 추가합니다. 생성된 학원은 다른 학원과 데이터가 완전히 분리됩니다.',
    html:function(){
      const accountName = String(localStorage.getItem('olli_account_name_v1') || '현재 원장 계정').trim();
      return '<div class="settingsInfoItem">연결 계정: ' + settingsEscapeHtml(accountName) + '</div>'
        + '<div class="settingsInputGroup" style="margin-top:12px;"><div class="settingsInputLabel">학원 이름</div><input id="settingsNewAcademyNameInput" class="settingsInput" maxlength="60" autocomplete="off" placeholder="예: 비비작 2호점"></div>'
        + '<div class="settingsInputGroup"><div class="settingsInputLabel">지역 또는 지점 설명</div><input id="settingsNewAcademyRegionInput" class="settingsInput" maxlength="80" autocomplete="off" placeholder="예: 대구 달서구 월성동"></div>'
        + '<div class="settingsMiniText">새 학원에는 현재 계정이 원장으로 자동 연결되고, 학생·설정·피드백 데이터는 기존 학원과 섞이지 않습니다.</div>';
    },
    onSave: async function(){
      await createOlliAcademyFromSettings();
    }
  },
  connectAcademy: {
    title:'기존 학원 연결 요청',
    desc:'학원 아이디 또는 학원명 일부로 검색한 뒤 연결을 요청합니다. 해당 학원의 원장이 승인해야 목록에 추가됩니다.',
    html:function(){
      return '<div class="settingsInputGroup"><div class="settingsInputLabel">연결할 학원 아이디 또는 학원명</div><input id="settingsConnectAcademyCodeInput" class="settingsInput" maxlength="60" autocomplete="off" placeholder="예: VIVI-5578 또는 비벼먹는" oninput="clearSettingsConnectAcademyLookupResult()"></div>'
        + '<button class="settingsSheetBtn" type="button" onclick="lookupSettingsConnectAcademy(event)" style="width:100%;margin:2px 0 12px;">학원 확인</button>'
        + '<div id="settingsConnectAcademyLookupResult" class="olliInfoBox" style="display:none;margin-bottom:12px;"></div>'
        + '<div class="settingsInputGroup"><div class="settingsInputLabel">요청 권한</div><select id="settingsConnectAcademyRoleInput" class="settingsInput"><option value="manager">관리자</option><option value="teacher">선생님</option><option value="owner">원장</option></select></div>'
        + '<div class="settingsMiniText">같은 검색어가 들어간 학원이 모두 표시됩니다. 학원 아이디를 확인하고 선택한 뒤 연결을 요청하세요.</div>';
    },
    onSave: async function(){
      await requestOlliAcademyAccessFromSettings();
    }
  },
  academyMembershipRole: {
    title:'학원별 권한 변경',
    desc:'선택한 계정의 현재 학원 권한만 변경합니다.',
    html:function(){
      return '<div class="settingsInputGroup"><div class="settingsInputLabel">변경할 권한</div><select id="settingsAcademyMembershipRoleInput" class="settingsInput"><option value="teacher">선생님</option><option value="manager">관리자</option><option value="owner">원장</option></select></div>'
        + '<div class="settingsMiniText">마지막 원장의 권한은 낮출 수 없습니다. 원장 권한을 추가할 때는 학원 전체 관리 권한이 부여됩니다.</div>';
    },
    onSave: async function(){
      await saveOlliAcademyMembershipRole();
    }
  },
  logout: {
    title:'계정 로그아웃',
    desc:'현재 기기에서 개인계정 세션을 해제합니다.',
    html:'<div class="settingsInfoItem">계정 로그아웃을 하면 이 기기의 자동 로그인이 해제됩니다. 학원 데이터와 선생님 승인은 삭제되지 않습니다.</div>'
  }
};


let currentSettingsGroupFeedbackGroup = '1';

function getSettingsGroupFeedbackGroups() {
  return [['1','A'], ['2','B'], ['3','C'], ['4','D'], ['5','E'], ['6','F']];
}

function renderSettingsGroupFeedbackMonths() {
  const groups = getSettingsGroupFeedbackGroups();
  if (!groups.some(([group]) => group === currentSettingsGroupFeedbackGroup)) currentSettingsGroupFeedbackGroup = '1';
  const currentGroup = currentSettingsGroupFeedbackGroup || '1';
  const currentLabel = (groups.find(([group]) => group === currentGroup) || ['1','A'])[1];
  const monthValues = (typeof ELEMENTARY_GROUP_MONTH_VALUES !== 'undefined') ? ELEMENTARY_GROUP_MONTH_VALUES : [1,2,3,4,5,6,7,8,9,10,11,12];
  const tabs = groups.map(([group,label]) => {
    return '<button type="button" class="settingsGroupFeedbackTab ' + (group === currentGroup ? 'active' : '') + '" data-settings-group-tab="' + group + '" onclick="selectSettingsGroupFeedbackGroup(\'' + group + '\')">' + label + '</button>';
  }).join('');
  const selected = new Set(getElementaryGroupFeedbackMonths(currentGroup));
  const months = monthValues.map(month => {
    return '<button type="button" class="settingsGroupFeedbackMonth ' + (selected.has(month) ? 'active' : '') + '" data-settings-group="' + currentGroup + '" data-settings-month="' + month + '" onclick="toggleSettingsGroupFeedbackMonth(\'' + currentGroup + '\',' + month + ')">' + month + '월</button>';
  }).join('');
  return '<div class="settingsGroupFeedbackBlock">'
    + '<div class="settingsGroupFeedbackTabs">' + tabs + '</div>'
    + '<div class="settingsGroupFeedbackHead"><div class="settingsGroupFeedbackTitle">' + currentLabel + '그룹 발송월</div></div>'
    + '<div class="settingsGroupFeedbackMonths">' + months + '</div>'
    + '</div>'
    + '<div class="settingsMiniText">A~F 그룹을 먼저 선택한 뒤, 아래에서 발송월을 선택합니다.</div>';
}

function refreshSettingsGroupFeedbackMonthsContent() {
  const content = document.getElementById('settingsSheetContent');
  if (content && currentSettingsSheetType === 'groupFeedbackMonths') content.innerHTML = renderSettingsGroupFeedbackMonths();
}

function selectSettingsGroupFeedbackGroup(group) {
  currentSettingsGroupFeedbackGroup = String(group || '1');
  refreshSettingsGroupFeedbackMonthsContent();
}

function toggleSettingsGroupFeedbackMonth(group, month) {
  toggleElementaryGroupFeedbackMonth(group, month);
  refreshSettingsGroupFeedbackMonthsContent();
  updateSettingsGroupFeedbackMonthsValue();
}

function updateSettingsGroupFeedbackMonthsValue() {
  const value = document.getElementById('settingsGroupFeedbackMonthsValue');
  if (!value) return;
  const map = readElementaryGroupFeedbackMonthsMap();
  const count = Object.values(map).filter(months => normalizeElementaryGroupMonths(months).length).length;
  value.textContent = count ? count + '개 그룹 설정' : '미설정';
}


function selectSettingsStartPageOption(page){
  const normalized = getOlliAllowedStartPage(page);
  document.querySelectorAll('.settingsStartPageOption').forEach(btn => {
    const active = normalizeOlliStartPage(btn.getAttribute('data-start-page-option')) === normalized;
    btn.classList.toggle('active', active);
    const check = btn.querySelector('.check');
    if (check) check.textContent = active ? '✓' : '';
  });
}

function openSettingsSheet(type) {
  const data = settingsSheetData[type] || settingsSheetData.ai;
  currentSettingsSheetType = type;
  const overlay = document.getElementById('settingsSheetOverlay');
  if (!overlay) return;

  document.getElementById('settingsSheetTitle').textContent = data.title;
  document.getElementById('settingsSheetDesc').textContent = data.desc;
  document.getElementById('settingsSheetContent').innerHTML = typeof data.html === 'function' ? data.html() : data.html;

  const actions = overlay.querySelector('.settingsSheetActions');
  const saveBtn = overlay.querySelector('.settingsSheetBtn.primary');
  const cancelBtn = overlay.querySelector('.settingsSheetBtn:not(.primary)');
  const consultationReadOnly = type === 'consultationMonths'
    && typeof canEditOlliConsultationSettings === 'function'
    && !canEditOlliConsultationSettings();
  if (actions) actions.style.display = type === 'logout' ? 'none' : 'grid';
  if (saveBtn) saveBtn.style.display = data && typeof data.onSave === 'function' && !consultationReadOnly ? 'flex' : 'none';
  if (cancelBtn) cancelBtn.textContent = consultationReadOnly ? '닫기' : '취소';

  overlay.classList.add('show');
}

async function saveSettingsSheet() {
  const btn = document.querySelector('#settingsSheetOverlay .settingsSheetBtn.primary');
  try {
    const data = settingsSheetData[currentSettingsSheetType];
    if (!data || typeof data.onSave !== 'function') {
      closeSettingsSheet();
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = '저장 중...';
    }
    await data.onSave();
    closeSettingsSheet();
  } catch (err) {
    alert('저장 중 오류가 발생했습니다.\n' + (err.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '저장';
    }
  }
}

function closeSettingsSheet(event) {
  if (event && event.target && event.target.id !== 'settingsSheetOverlay') return;
  const overlay = document.getElementById('settingsSheetOverlay');
  if (overlay) overlay.classList.remove('show');
}

