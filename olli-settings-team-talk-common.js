/* Team Talk settings - shared PC/Phone single source (PC main) */
(function(global){
'use strict';

const LIGHT_BG = '#F3F3F3';
const DARK_BG = '#666D77';
const LIGHT_BLUE_BG = '#F2F6FC';
const DARK_BLUE_BG = '#46576E';
const BACKGROUND_COLORS = Object.freeze({
  light: LIGHT_BG,
  dark: DARK_BG,
  'light-blue': LIGHT_BLUE_BG,
  'dark-blue': DARK_BLUE_BG
});
const BACKGROUND_LABELS = Object.freeze({
  light: '밝은 회색',
  dark: '어두운 회색',
  'light-blue': '밝은 파랑',
  'dark-blue': '어두운 파랑'
});
const CACHE_PREFIX = 'olli_team_talk_settings_v1_';

const state = {
  background: 'dark',
  botNotificationsEnabled: false,
  aiEnabled: false,
  loadedAcademyId: '',
  loading: false,
  saving: false,
  lastError: ''
};

let saveQueue = Promise.resolve();

function clean(value){ return String(value ?? '').trim(); }
function academyId(){
  try {
    return clean(
      (typeof global.getOlliCurrentAcademyId === 'function' && global.getOlliCurrentAcademyId())
      || localStorage.getItem('olli_current_academy_id')
      || global.olliSettingsState?.academy?.id
      || ''
    );
  } catch (_) { return ''; }
}
function sessionToken(){
  try { return clean(localStorage.getItem('olli_account_session_token_v1')); }
  catch (_) { return ''; }
}
function currentRole(){
  try {
    if (typeof global.getOlliCurrentRole === 'function') return clean(global.getOlliCurrentRole());
    return clean(localStorage.getItem('olli_current_member_role'));
  } catch (_) { return ''; }
}
function canEdit(){
  const role = currentRole();
  return role === 'owner' || role === 'manager' || role === 'super_admin';
}
function normalizeBackground(value){
  const mode = clean(value).toLowerCase();
  return Object.prototype.hasOwnProperty.call(BACKGROUND_COLORS, mode) ? mode : 'dark';
}
function backgroundColor(mode){ return BACKGROUND_COLORS[normalizeBackground(mode)] || DARK_BG; }
function cacheKey(id){ return CACHE_PREFIX + (clean(id) || 'unscoped'); }
function readCache(id){
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey(id)) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) { return {}; }
}
function writeCache(id){
  if (!id) return;
  try {
    localStorage.setItem(cacheKey(id), JSON.stringify({
      background: state.background,
      bot_notifications_enabled: !!state.botNotificationsEnabled,
      ai_enabled: !!state.aiEnabled,
      updated_at: new Date().toISOString()
    }));
  } catch (_) {}
}
function readCachedIntoState(id){
  const cached = readCache(id);
  if (cached.background) state.background = normalizeBackground(cached.background);
  if (Object.prototype.hasOwnProperty.call(cached,'bot_notifications_enabled')) {
    state.botNotificationsEnabled = !!cached.bot_notifications_enabled;
  }
  if (Object.prototype.hasOwnProperty.call(cached,'ai_enabled')) {
    state.aiEnabled = !!cached.ai_enabled;
  }
}

function applyBackground(mode){
  const normalized = normalizeBackground(mode);
  const color = backgroundColor(normalized);
  state.background = normalized;

  const phone = document.getElementById('olliTalkBetaScreen');
  if (phone) {
    phone.style.setProperty('--olli-talk-bg', color);
    phone.style.setProperty('--olli-talk-bg-bottom', color);
    phone.dataset.olliTalkTheme = normalized;
  }
  if (typeof global.setOlliTalkBackgroundColor === 'function') {
    try { global.setOlliTalkBackgroundColor(color); } catch (_) {}
  }

  const pc = document.getElementById('olliPcTeamTalkScreen');
  if (pc) {
    pc.style.setProperty('--olli-pc-talk-bg', color);
    pc.dataset.olliTalkTheme = normalized;
  }

  document.documentElement.dataset.olliTalkTheme = normalized;
  updateSettingsRowValue();
  syncAssistantButtons();
  return normalized;
}

function supabaseConfig(){
  let url = '', key = '';
  try { if (typeof SUPABASE_URL !== 'undefined') url = clean(SUPABASE_URL); } catch (_) {}
  try { if (typeof SUPABASE_KEY !== 'undefined') key = clean(SUPABASE_KEY); } catch (_) {}
  if (!url) url = clean(global.SUPABASE_URL);
  if (!key) key = clean(global.SUPABASE_KEY);
  return { url, key };
}
function accessToken(fallback){
  try {
    if (typeof global.getOlliAuthAccessToken === 'function') {
      const token = clean(global.getOlliAuthAccessToken());
      if (token) return token;
    }
  } catch (_) {}
  return fallback;
}
async function rpc(name, payload){
  const cfg = supabaseConfig();
  if (!cfg.url || !cfg.key) throw new Error('Supabase 설정을 확인할 수 없습니다.');
  const res = await fetch(cfg.url.replace(/\/+$/,'') + '/rest/v1/rpc/' + encodeURIComponent(name), {
    method:'POST',
    headers:{
      'apikey': cfg.key,
      'Authorization':'Bearer ' + accessToken(cfg.key),
      'Content-Type':'application/json'
    },
    body:JSON.stringify(payload || {})
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!res.ok) {
    const message = clean(data?.message || data?.error_description || data?.error || text) || '서버 요청에 실패했습니다.';
    throw new Error(message);
  }
  return data;
}

function assistantLabel(){ return state.aiEnabled ? 'AI' : '봇'; }
function syncAssistantButtons(){
  const label = assistantLabel();
  const targets = [
    document.getElementById('olliTalkOlliTriggerBtn'),
    document.getElementById('olliPcTeamTalkOlli')
  ].filter(Boolean);
  targets.forEach(button => {
    button.textContent = label;
    button.setAttribute('aria-label', state.aiEnabled ? '올리 AI 호출' : '올리봇 호출');
  });
  try {
    global.dispatchEvent(new CustomEvent('olli-team-talk-ai-mode-changed', {
      detail:{ enabled:!!state.aiEnabled, label }
    }));
  } catch (_) {}
}
function settingsSummary(){
  const bg = BACKGROUND_LABELS[normalizeBackground(state.background)] || BACKGROUND_LABELS.dark;
  return bg + ' · AI ' + (state.aiEnabled ? '켬' : '끔') + ' · 올리봇 알림 ' + (state.botNotificationsEnabled ? '켬' : '끔');
}
function updateSettingsRowValue(){
  const value = document.getElementById('settingsTeamTalkValue');
  if (value) value.textContent = settingsSummary();
}
function rowHtml(){
  return '<div class="settingsRow" data-owner-manager-only="true" id="settingsTeamTalkRow" onclick="openOlliTeamTalkSettings()" role="button">'
    + '<div class="settingsRowLeft">'
    + '<span class="settingsRowIcon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4.2 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z"></path><circle cx="9" cy="11" r=".8"></circle><circle cx="12" cy="11" r=".8"></circle><circle cx="15" cy="11" r=".8"></circle></svg></span>'
    + '<span class="settingsRowTitle">팀톡 설정</span>'
    + '</div>'
    + '<span class="settingsRowValue" id="settingsTeamTalkValue">' + settingsSummary() + '</span>'
    + '<svg class="settingsChevron" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"></path></svg>'
    + '</div>';
}
function installSettingsRow(){
  if (document.getElementById('settingsTeamTalkRow')) {
    updateSettingsRowValue();
    return;
  }
  const screen = document.getElementById('settingsPageScreen');
  if (!screen) return;
  const rows = Array.from(screen.querySelectorAll('.settingsRow'));
  const anchor = rows.find(row => clean(row.querySelector('.settingsRowTitle')?.textContent) === '텍스트 크기')
    || rows.find(row => row.querySelector('#settingsNotificationToggle'))
    || null;
  const card = anchor?.closest('.settingsCard') || screen.querySelector('.settingsCard');
  if (!card) return;
  anchor?.insertAdjacentHTML('afterend', rowHtml());
  if (!anchor) card.insertAdjacentHTML('beforeend', rowHtml());
  updateSettingsRowValue();
  if (typeof global.applySettingsPermissionUI === 'function') {
    try { global.applySettingsPermissionUI(); } catch (_) {}
  }
}

function statusHtml(){
  if (state.saving) return '<div class="olliTeamTalkSettingsStatus saving">저장 중...</div>';
  if (state.lastError) return '<div class="olliTeamTalkSettingsStatus error">' + escapeHtml(state.lastError) + '</div>';
  return '<div class="olliTeamTalkSettingsStatus">변경하면 바로 저장됩니다.</div>';
}
function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}
function themeOption(mode, label, detail){
  const selected = state.background === mode;
  const color = backgroundColor(mode);
  return '<button class="olliTeamTalkThemeOption ' + (selected ? 'active' : '') + '" type="button" data-team-talk-theme-option="' + mode + '" onclick="olliTeamTalkSelectBackground(\'' + mode + '\')">'
    + '<span class="olliTeamTalkThemePreview" style="background:' + color + '">'
    + '<span class="olliTeamTalkThemeBubble one"></span><span class="olliTeamTalkThemeBubble two"></span>'
    + '</span>'
    + '<span class="olliTeamTalkThemeText"><strong>' + escapeHtml(label) + '</strong><small>' + escapeHtml(detail) + '</small></span>'
    + '<span class="olliTeamTalkThemeCheck" aria-hidden="true">' + (selected ? '✓' : '') + '</span>'
    + '</button>';
}
function detailHtml(){
  const disabled = canEdit() ? '' : ' disabled';
  return '<div class="olliTeamTalkSettingsPage">'
    + '<div class="settingsDetailIntro"><div class="settingsDetailTitle">팀톡 화면과<br>올리봇 알림을 설정합니다.</div></div>'
    + '<section class="olliTeamTalkSettingsCard">'
    + '<div class="olliTeamTalkSettingsHead"><div><strong>채팅 배경</strong><small>배경에 맞춰 날짜·시간·시스템 글자색도 자동으로 바뀝니다.</small></div></div>'
    + '<div class="olliTeamTalkThemeGrid">'
    + themeOption('light','밝은 회색',LIGHT_BG)
    + themeOption('dark','어두운 회색',DARK_BG)
    + themeOption('light-blue','밝은 파랑',LIGHT_BLUE_BG)
    + themeOption('dark-blue','어두운 파랑',DARK_BLUE_BG)
    + '</div>'
    + '</section>'
    + '<section class="olliTeamTalkSettingsCard">'
    + '<div class="olliTeamTalkSettingsSwitchRow">'
    + '<div><strong>올리 AI</strong><small>켜면 채팅의 봇 버튼이 AI로 바뀌고 OpenAI 응답을 사용합니다. 끄면 기존 올리봇을 사용합니다.</small></div>'
    + '<button class="olliTeamTalkSwitch ' + (state.aiEnabled ? 'on' : '') + '" type="button" aria-pressed="' + (state.aiEnabled ? 'true' : 'false') + '" onclick="olliTeamTalkToggleAi()"' + disabled + '><span></span></button>'
    + '</div>'
    + '</section>'
    + '<section class="olliTeamTalkSettingsCard">'
    + '<div class="olliTeamTalkSettingsSwitchRow">'
    + '<div><strong>올리봇 알림</strong><small>AI 사용 여부와 관계없이 등록과 취소가 생기면 팀톡에 자동으로 알려줍니다.</small></div>'
    + '<button class="olliTeamTalkSwitch ' + (state.botNotificationsEnabled ? 'on' : '') + '" type="button" aria-pressed="' + (state.botNotificationsEnabled ? 'true' : 'false') + '" onclick="olliTeamTalkToggleBotNotifications()"' + disabled + '><span></span></button>'
    + '</div>'
    + '<div class="olliTeamTalkEventChips"><span>신규 등록</span><span>체험 등록</span><span>대기 등록</span><span>픽업 등록</span><span>등록 취소</span><span>체험 취소</span><span>대기 취소</span><span>픽업 취소</span></div>'
    + '<div class="olliTeamTalkSettingsNotice"><strong>팀톡 메시지는 모두 볼 수 있습니다.</strong><br>휴대폰 알림은 해당 날짜의 클래스 담당 선생님에게만 전송됩니다. 당일 대체 담임이 지정된 경우 대체 담임을 우선합니다. 담당 선생님이 지정되지 않은 클래스는 팀톡 메시지만 남습니다.</div>'
    + '</section>'
    + (!canEdit() ? '<div class="olliTeamTalkSettingsNotice">팀톡 설정 변경은 원장 또는 관리자만 할 수 있습니다.</div>' : '')
    + statusHtml()
    + '</div>';
}

function renderDetail(){
  const body = document.getElementById('settingsDetailBody');
  if (!body) return;
  body.innerHTML = detailHtml();
}

async function loadRemote(force){
  const id = academyId();
  if (!id) return state;
  if (!force && state.loadedAcademyId === id) return state;
  readCachedIntoState(id);
  applyBackground(state.background);
  state.loading = true;
  state.lastError = '';
  try {
    const result = await rpc('olli_team_talk_settings_get', {
      p_session_token: sessionToken(),
      p_academy_id: id
    });
    if (result?.ok) {
      state.background = normalizeBackground(result.background);
      state.botNotificationsEnabled = !!result.bot_notifications_enabled;
      state.aiEnabled = !!result.ai_enabled;
      state.loadedAcademyId = id;
      writeCache(id);
      applyBackground(state.background);
    }
  } catch (error) {
    state.lastError = clean(error?.message || error);
  } finally {
    state.loading = false;
    updateSettingsRowValue();
    if (document.getElementById('settingsDetailScreen')?.style.display !== 'none'
        && clean(document.getElementById('settingsDetailTitlePill')?.textContent) === '팀톡 설정') {
      renderDetail();
    }
  }
  return state;
}

function queueSave(){
  const id = academyId();
  if (!id || !canEdit()) return Promise.resolve();
  state.saving = true;
  state.lastError = '';
  writeCache(id);
  applyBackground(state.background);
  renderDetail();

  saveQueue = saveQueue.then(async () => {
    const result = await rpc('olli_team_talk_settings_update', {
      p_session_token: sessionToken(),
      p_academy_id: id,
      p_background: state.background,
      p_bot_notifications_enabled: !!state.botNotificationsEnabled,
      p_ai_enabled: !!state.aiEnabled
    });
    if (!result?.ok) throw new Error(clean(result?.message) || '팀톡 설정을 저장하지 못했습니다.');
    state.background = normalizeBackground(result.background);
    state.botNotificationsEnabled = !!result.bot_notifications_enabled;
    state.aiEnabled = !!result.ai_enabled;
    state.loadedAcademyId = id;
    writeCache(id);
    applyBackground(state.background);
  }).catch(error => {
    state.lastError = clean(error?.message || error) || '팀톡 설정을 저장하지 못했습니다.';
  }).finally(() => {
    state.saving = false;
    updateSettingsRowValue();
    if (clean(document.getElementById('settingsDetailTitlePill')?.textContent) === '팀톡 설정') renderDetail();
  });
  return saveQueue;
}

function selectBackground(mode){
  if (!canEdit()) return;
  state.background = normalizeBackground(mode);
  applyBackground(state.background);
  writeCache(academyId());
  renderDetail();
  queueSave();
}
function toggleBot(){
  if (!canEdit()) return;
  state.botNotificationsEnabled = !state.botNotificationsEnabled;
  writeCache(academyId());
  renderDetail();
  queueSave();
}
function toggleAi(){
  if (!canEdit()) return;
  state.aiEnabled = !state.aiEnabled;
  writeCache(academyId());
  syncAssistantButtons();
  renderDetail();
  queueSave();
}

function registerSettingsDetail(){
  try {
    if (typeof settingsDetailData === 'undefined' || !settingsDetailData) return false;
    settingsDetailData.teamTalk = {
      title:'팀톡 설정',
      html:detailHtml,
      instantRender:true,
      beforeOpen:async function(){ await loadRemote(true); }
    };
    return true;
  } catch (_) {
    return false;
  }
}

function getTeamTalkDetailBackButton(){
  const detail = document.getElementById('settingsDetailScreen');
  return detail?.querySelector('.settingsHeaderLeft .settingsRoundBtn') || null;
}

function bindTeamTalkDetailBackButton(){
  const back = getTeamTalkDetailBackButton();
  if (!back) return;
  back.setAttribute('onclick', 'closeOlliTeamTalkSettings()');
}

function restoreSettingsDetailBackButton(){
  const back = getTeamTalkDetailBackButton();
  if (!back) return;
  if (back.getAttribute('onclick') === 'closeOlliTeamTalkSettings()') {
    back.setAttribute('onclick', 'closeSettingsDetail()');
  }
}

function closeDetailFallback(){
  const detail = document.getElementById('settingsDetailScreen');
  const settings = document.getElementById('settingsPageScreen');

  if (detail) {
    detail.style.display = 'none';
    detail.style.transform = '';
    detail.style.opacity = '';
    detail.style.pointerEvents = '';
    detail.style.position = '';
    detail.style.inset = '';
    detail.style.zIndex = '';
  }
  if (settings) settings.style.display = 'flex';

  restoreSettingsDetailBackButton();

  if (typeof global.olliPcSettingsLayoutAfterCloseDetail === 'function') {
    try { global.olliPcSettingsLayoutAfterCloseDetail(); } catch (_) {}
  }
  return true;
}

function closeDetail(){
  try {
    if (typeof global.closeSettingsDetail === 'function') global.closeSettingsDetail();
  } catch (_) {}
  return closeDetailFallback();
}

function openDetailFallback(){
  const detail = document.getElementById('settingsDetailScreen');
  const settings = document.getElementById('settingsPageScreen');
  const titlePill = document.getElementById('settingsDetailTitlePill');
  const body = document.getElementById('settingsDetailBody');
  if (!detail || !body) return false;

  if (settings) settings.style.display = 'flex';
  if (titlePill) titlePill.textContent = '팀톡 설정';
  body.innerHTML = detailHtml();

  detail.style.display = 'flex';
  detail.style.position = 'fixed';
  detail.style.inset = '0';
  detail.style.transform = 'translateX(0)';
  detail.style.opacity = '1';
  detail.style.pointerEvents = 'auto';
  detail.style.zIndex = '91000';
  bindTeamTalkDetailBackButton();

  Promise.resolve(loadRemote(true))
    .then(function(){
      if (detail.style.display !== 'none') renderDetail();
    })
    .catch(function(error){
      state.lastError = clean(error?.message || error);
      if (detail.style.display !== 'none') renderDetail();
    });
  return true;
}

function openDetail(){
  installSettingsRow();
  const registered = registerSettingsDetail();

  if (registered && typeof global.openSettingsDetail === 'function') {
    try {
      global.openSettingsDetail('teamTalk');
      const detail = document.getElementById('settingsDetailScreen');
      if (detail && detail.style.display === 'flex') {
        bindTeamTalkDetailBackButton();
        return true;
      }
    } catch (_) {}
  }

  return openDetailFallback();
}

function refreshForAcademy(){
  const id = academyId();
  if (!id) return;
  if (state.loadedAcademyId && state.loadedAcademyId !== id) {
    state.loadedAcademyId = '';
    state.background = 'dark';
    state.botNotificationsEnabled = false;
    state.aiEnabled = false;
  }
  readCachedIntoState(id);
  applyBackground(state.background);
  installSettingsRow();
  loadRemote(true);
}

function init(){
  registerSettingsDetail();
  installSettingsRow();
  const id = academyId();
  if (id) {
    readCachedIntoState(id);
    applyBackground(state.background);
    loadRemote(false);
  } else {
    applyBackground('dark');
  }
}

global.openOlliTeamTalkSettings = openDetail;
global.closeOlliTeamTalkSettings = closeDetail;
global.olliTeamTalkSelectBackground = selectBackground;
global.olliTeamTalkToggleBotNotifications = toggleBot;
global.olliTeamTalkToggleAi = toggleAi;
global.OlliTeamTalkSettings = {
  state,
  isAiEnabled: function(){ return !!state.aiEnabled; },
  syncAssistantButtons,
  lightColor: LIGHT_BG,
  darkColor: DARK_BG,
  lightBlueColor: LIGHT_BLUE_BG,
  darkBlueColor: DARK_BLUE_BG,
  load: loadRemote,
  applyBackground,
  refreshForAcademy,
  open: openDetail
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else setTimeout(init, 0);
global.addEventListener('focus', function(){
  const id = academyId();
  if (id && id !== state.loadedAcademyId) refreshForAcademy();
});
document.addEventListener('visibilitychange', function(){
  if (!document.hidden) {
    const id = academyId();
    if (id && id !== state.loadedAcademyId) refreshForAcademy();
  }
});

})(window);
