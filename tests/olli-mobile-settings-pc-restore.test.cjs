'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const pcCommon=read('apps/pc/olli-common-components.css');
const pcResponsive=read('apps/pc/olli-responsive.css');
const pcHtml=read('apps/pc/index.html');
const pcAttendance=read('apps/pc/pc-attendance.css');
const mobile=read('apps/mobile/olli-phone-base.css');
const mobileHtml=read('apps/mobile/index.html');
const control=read('apps/mobile/olli-phone-control-style.css');

test('PC observation group separators retain original 2px source while attendance hides them',()=>{
 assert.match(pcCommon,/\.elementaryStudentRow\.groupBreak::before\s*\{[^}]*height:\s*2px\s*;/);
 assert.match(pcResponsive,/#recordRoomScreen \.kinderStudentRow\.groupBreak::before\s*\{[^}]*height:\s*2px\s*;/);
 assert.match(pcAttendance,/\.kinderStudentRow\.groupBreak::before\s*\{\s*display:none!important/);
 assert.match(pcHtml,/olli-common-components\.css\?v=20261029-record-sort-lines-1/);
 assert.match(pcHtml,/olli-responsive\.css\?v=20261029-record-sort-lines-1/);
});

test('PC settings shadow values are restored to their original styles',()=>{
 assert.match(pcResponsive,/\.settingsRoundBtn,\.settingsTitlePill\{[^}]*box-shadow:0 8px 22px rgba\(0,0,0,\.045\)/);
 assert.match(pcResponsive,/\.settingsCard\{[^}]*box-shadow:0 10px 26px rgba\(0,0,0,\.045\),0 2px 8px rgba\(0,0,0,\.02\)/);
 assert.match(pcResponsive,/\.settingsDetailIntro\{[^}]*box-shadow:0 14px 34px rgba\(0,0,0,\.06\),0 4px 10px rgba\(0,0,0,\.02\)/);
 assert.match(pcResponsive,/\.settingsInfoCard,\.settingsRoleCard,\.settingsRequestCard,\.settingsTeacherCard\{[^}]*box-shadow:0 10px 26px rgba\(0,0,0,\.045\)/);
 assert.match(pcResponsive,/#settingsPageScreen \.settingsProfileEdit\{[^}]*margin-top:8px;[^}]*box-shadow:none;/);
});

test('Mobile settings cards and buttons use the existing Olli shadows only on mobile',()=>{
 assert.match(control,/--olli-phone-academy-button-shadow:/);
 const cardShadow='0 2px 14px rgba(0,0,0,.08),0 1px 4px rgba(0,0,0,.04)';
 const mobileCompact=mobile.replace(/\s+/g,'');
 assert.ok(mobileCompact.includes('.settingsCard{border-radius:28px;background:#fff;box-shadow:'+cardShadow));
 assert.ok(mobileCompact.includes('.settingsEmptyBox{')&&mobileCompact.includes('box-shadow:'+cardShadow));
 assert.ok(mobileCompact.includes('.attendancePhotoUploadBox{')&&mobileCompact.includes('box-shadow:'+cardShadow));
 for(const selector of ['.settingsActionBtn','.settingsExportBtn','.settingsSheetBtn','.settingsDangerFullBtn']){
  const start=mobile.indexOf(selector+'{');
  assert.ok(start>=0,selector+' selector must exist');
  const block=mobile.slice(start,mobile.indexOf('}',start));
  assert.match(block,/box-shadow:var\(--olli-phone-academy-button-shadow\)/,selector+' uses academy button depth');
 }
 assert.match(mobileHtml,/olli-phone-base\.css\?v=20261102-settings-shadow-2/);
 assert.match(mobileHtml,/olli-observation-roster-phone\.css\?v=20261102-sort-divider-1px-1/);
});
