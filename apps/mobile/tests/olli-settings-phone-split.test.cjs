const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');
const phoneUi = fs.readFileSync(path.join(root, 'olli-settings-phone-ui.js'), 'utf8');
const phoneDetail = fs.readFileSync(path.join(root, 'olli-settings-detail-phone.js'), 'utf8');
const detailData = fs.readFileSync(path.join(root, 'olli-settings-detail-data.js'), 'utf8');
const phoneTeamTalk = fs.readFileSync(path.join(root, 'olli-settings-team-talk-phone.js'), 'utf8');
const accountRuntime = fs.readFileSync(path.join(root, 'olli-settings-account-runtime.js'), 'utf8');
const attendanceRuntime = fs.readFileSync(path.join(root, 'olli-attendance-policy-runtime.js'), 'utf8');

test('phone settings uses local page/detail routers instead of the PC detail file', () => {
  assert.match(html, /olli-settings-detail-phone\.js\?v=20260927-team-talk-phone-only-1/);
  assert.match(html, /olli-settings-phone-ui\.js\?v=20260927-team-talk-phone-only-1/);
  assert.doesNotMatch(html, /src="olli-settings-detail\.js/);
  assert.doesNotMatch(vercel, /"source":"\/olli-settings-detail\.js"/);
  assert.match(phoneDetail, /global\.openSettingsDetail=openPhoneSettingsDetail/);
  assert.match(phoneUi, /global\.openSettingsSheet=openPhoneSettingsSheet/);
  assert.match(phoneUi, /global\.openSettingsPage=openPhoneSettingsPage/);
});

test('shared academy settings stay server-backed across phone and PC', () => {
  assert.match(phoneUi, /saveOlliConsultationRulesShared\(/);
  assert.match(phoneUi, /saveOlliSharedSettingToServer\(OLLI_SHARED_SETTINGS_KEY_GROUP_MONTHS,map\)/);
  assert.match(phoneUi, /상담 기준은 학원 공통값/);
  assert.match(phoneUi, /피드백 발송월은 학원 공통값/);
});

test('phone-only presentation settings are owned by the phone router', () => {
  assert.match(phoneUi, /textSize:\{title:'텍스트 크기'/);
  assert.match(phoneUi, /startPage:\{title:'시작 페이지'/);
  assert.match(phoneUi, /togglePhoneSettingsNotification/);
  assert.match(phoneUi, /현재 폰 화면에만 적용/);
});

test('phone settings runtime contains no PC layout hooks', () => {
  assert.doesNotMatch(phoneUi, /olliPcSettingsLayout/);
  assert.doesNotMatch(phoneDetail, /olliPcSettingsLayout/);
});


test('phone settings markup calls phone-owned routes directly', () => {
  assert.match(html, /onclick="openPhoneSettingsSheet\('profile'\)"/);
  assert.match(html, /onclick="openPhoneSettingsSheet\('logout'\)"/);
  assert.match(html, /onclick="openPhoneSettingsDetail\('teachers'\)"/);
  assert.match(html, /onclick="closePhoneSettingsPage\(\)"/);
  assert.match(html, /onclick="closePhoneSettingsDetail\(\)"/);
  assert.match(html, /onclick="togglePhoneSettingsNotification\(\)"/);
});

test('phone no longer executes the PC settings base or shared sheet router', () => {
  assert.match(html, /olli-settings-common-core\.js\?v=20260924-settings-core-1/);
  assert.doesNotMatch(html, /src="olli-settings-base\.js/);
  assert.match(vercel, /"source":"\/olli-settings-common-core\.js","destination":"https:\/\/raw\.githubusercontent\.com\/vivizac\/pc\/main\/olli-settings-common-core\.js"/);
  assert.doesNotMatch(vercel, /"source":"\/olli-settings-base\.js"/);
  assert.doesNotMatch(phoneUi, /sharedOpenSettingsSheet/);
  assert.doesNotMatch(phoneUi, /sharedSaveSettingsSheet/);
  assert.doesNotMatch(phoneUi, /sharedCloseSettingsSheet/);
});


test('phone start page is device-scoped and does not overwrite the shared member default', () => {
  const start = phoneUi.indexOf('async function savePhoneStartPageSheet()');
  const end = phoneUi.indexOf('function consultationOption', start);
  const block = phoneUi.slice(start, end);
  assert.match(block, /localStorage\.setItem\('olli_default_start_page_'\+memberKey,normalized\)/);
  assert.match(block, /localStorage\.setItem\('olli_default_start_page_'\+stableKey,normalized\)/);
  assert.match(block, /localStorage\.setItem\('olli_default_start_page_fallback',normalized\)/);
  assert.doesNotMatch(block, /saveOlliDefaultStartPage\(/);
  assert.doesNotMatch(block, /supabase\(/);
});


test('phone sheet extensions register through the phone router instead of settingsSheetData', () => {
  assert.match(phoneUi, /function registerPhoneSettingsSheet\(type,config\)/);
  assert.match(phoneUi, /const phoneExternalSheets=new Map\(\)/);
  assert.match(attendanceRuntime, /registerPhoneSettingsSheet\('attendancePolicy',config\)/);
  assert.match(attendanceRuntime, /openPhoneSettingsSheet\('attendancePolicy'\)/);
  assert.doesNotMatch(attendanceRuntime, /settingsSheetData/);
});

test('account runtime provides profile actions without replacing phone sheet routing', () => {
  assert.match(accountRuntime, /window\.OlliPhoneSettingsAccount=Object\.freeze/);
  assert.match(phoneUi, /OlliPhoneSettingsAccount\?\.renderProfileSheet/);
  assert.match(phoneUi, /OlliPhoneSettingsAccount\?\.saveProfileSheet/);
  assert.doesNotMatch(accountRuntime, /settingsSheetData/);
  assert.doesNotMatch(accountRuntime, /window\.saveSettingsSheet\s*=/);
  assert.doesNotMatch(accountRuntime, /window\.openSettingsSheet\s*=/);
});


test('phone settings start-page and text-size options have live selection handlers', () => {
  assert.match(phoneUi, /function selectSettingsStartPageOption\(value\)[\s\S]*\[data-start-page-option\][\s\S]*classList\.toggle\('active',active\)[\s\S]*check\.textContent=active\?'✓':''/);
  assert.match(phoneUi, /function selectSettingsTextSizeOption\(value\)[\s\S]*\[data-text-size-option\][\s\S]*classList\.toggle\('active',active\)/);
  assert.match(phoneUi, /global\.selectSettingsStartPageOption=selectSettingsStartPageOption/);
  assert.match(phoneUi, /global\.selectSettingsTextSizeOption=selectSettingsTextSizeOption/);
  assert.match(phoneUi, /document\.querySelector\('\[data-start-page-option\]\.active'\)/);
  assert.doesNotMatch(phoneUi, /document\.querySelector\('\.settingsStartPageOption\.active'\)/);
});

test('phone Team Talk settings are fully phone-owned with no shared screen ownership', () => {
  assert.match(html, /id="settingsTeamTalkRow"[^>]*onclick="openPhoneSettingsDetail\('teamTalk'\)"/);
  assert.match(html, /olli-settings-team-talk-phone\.css\?v=20260927-phone-only-1/);
  assert.match(html, /olli-settings-team-talk-phone\.js\?v=20260928-reset-all-olli1-1/);
  assert.doesNotMatch(html, /olli-settings-team-talk-common\.(?:js|css)/);
  assert.doesNotMatch(vercel, /olli-settings-team-talk-common\.(?:js|css)/);

  assert.doesNotMatch(phoneUi, /openPhoneTeamTalkSettings|bindPhoneTeamTalkSettingsRow/);
  assert.doesNotMatch(phoneDetail, /OlliTeamTalkSettings\?\.open|type==='teamTalk'/);

  assert.match(phoneTeamTalk, /const PLATFORM='phone'/);
  assert.match(phoneTeamTalk, /settingsDetailData\.teamTalk=\{/);
  assert.match(phoneTeamTalk, /p_platform:PLATFORM/);
  assert.match(phoneTeamTalk, /global\.OlliTeamTalkSettings=\{/);
  assert.doesNotMatch(phoneTeamTalk, /function openDetail|function closeDetail|openDetailFallback|closeDetailFallback|installSettingsRow|rowHtml/);
  assert.doesNotMatch(phoneTeamTalk, /openOlliTeamTalkSettings|closeOlliTeamTalkSettings|olliPcSettingsLayout|olliPcTeamTalkScreen/);
});


test('phone detail registry executes without dead references before Team Talk registers', () => {
  const noop = () => '';
  const context = {
    renderOlliStorageDiagnostics: noop,
    renderOlliAcademySwitchOptions: noop,
    renderOlliOwnerOtherAcademyFindOptions: noop,
    renderSettingsTeacherMyAcademies: noop,
    renderSettingsTeacherAcademyFind: noop,
    renderOlliAcademyAccessSettings: noop,
    settingsLoadAcademy: noop,
    renderSettingsAttendancePhotoImport: noop,
    renderSettingsAttendancePrint: noop,
    renderSettingsMembers: noop,
    settingsLoadTeacherManagementMembers: noop,
    renderSettingsTeacherInvite: noop,
    settingsLoadAllApprovalRequests: noop,
    renderSettingsApprovalRequests: noop,
    restoreOlliAccountSession: noop,
    loadOlliAcademyManagementData: noop
  };

  vm.runInNewContext(
    detailData + '\n;globalThis.__settingsDetailData=settingsDetailData;globalThis.__settingsCurrentDetailType=settingsCurrentDetailType;',
    context
  );

  assert.ok(context.__settingsDetailData);
  assert.equal(context.__settingsDetailData.platformAdmin, undefined);
  assert.equal(context.__settingsCurrentDetailType, '');
  assert.ok(context.__settingsDetailData.storageDiagnostics);
  assert.ok(context.__settingsDetailData.teachers);
  assert.match(phoneTeamTalk, /settingsDetailData\.teamTalk=\{/);
  assert.match(html, /olli-settings-detail-data\.js\?v=20260927-dead-registry-clean-1/);
});

test('phone detail registry has no removed platform-admin leftovers', () => {
  assert.doesNotMatch(detailData, /platformAdmin/);
  assert.doesNotMatch(detailData, /renderOlliPlatformAdminSettings/);
  assert.doesNotMatch(detailData, /loadOlliPlatformAdminAcademies/);
});


test('phone Team Chat defaults to Olli style 1 and lists Olli styles before Kakao styles', () => {
  assert.match(phoneTeamTalk, /const DEFAULT_BACKGROUND='olli-light'/);
  assert.match(phoneTeamTalk, /background:DEFAULT_BACKGROUND/);
  assert.match(phoneTeamTalk, /\?mode:DEFAULT_BACKGROUND/);
  assert.match(phoneTeamTalk, /state\.background=normalizeBackground\(cached\.background\|\|DEFAULT_BACKGROUND\)/);
  const olli = phoneTeamTalk.indexOf('<div class="olliTeamTalkThemeGroupLabel olli">올리 스타일</div>');
  const kakao = phoneTeamTalk.indexOf('<div class="olliTeamTalkThemeGroupLabel">카톡 스타일</div>');
  assert.ok(olli >= 0 && kakao > olli);
  assert.match(html, /olli-settings-team-talk-phone\.js\?v=20260928-reset-all-olli1-1/);
});


test('phone ignores pre-reset cached Team Chat backgrounds but preserves other cached settings', () => {
  assert.match(phoneTeamTalk, /const BACKGROUND_RESET_VERSION='20260928-olli1'/);
  assert.match(phoneTeamTalk, /background_reset_version:BACKGROUND_RESET_VERSION/);
  assert.match(phoneTeamTalk, /cached\.background_reset_version===BACKGROUND_RESET_VERSION[\s\S]*\?normalizeBackground\(cached\.background\|\|DEFAULT_BACKGROUND\)[\s\S]*:DEFAULT_BACKGROUND/);
  assert.match(phoneTeamTalk, /cached,'bot_notifications_enabled'/);
  assert.match(phoneTeamTalk, /cached,'ai_enabled'/);
  assert.doesNotMatch(phoneTeamTalk, /state\.background='dark'/);
  assert.doesNotMatch(phoneTeamTalk, /applyBackground\('dark'\)/);
  assert.match(html, /olli-settings-team-talk-phone\.js\?v=20260928-reset-all-olli1-1/);
});
