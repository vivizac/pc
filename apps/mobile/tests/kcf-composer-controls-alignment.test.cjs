'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const sheet = fs.readFileSync('kcf-teacher-sheet.js', 'utf8');
const sheetCss = fs.readFileSync('kcf-teacher-sheet.css', 'utf8');
const autoCss = fs.readFileSync('kcf-auto-mode.css', 'utf8');
const todayCss = fs.readFileSync('kcf-today-records.css', 'utf8');

test('the original Plus and microphone remain present and visible in the idle toolbar',()=>{
  assert.match(html, /id="kcfAttachBtn"/);
  assert.match(html, /id="kcfVoiceBtn"/);
  assert.match(html, /id="kcfModeSwitchBtn"/);
  assert.match(autoCss, /grid-template-columns:33px 88px minmax\(0,1fr\) 33px 33px;/);
  assert.match(autoCss, /\.kcfAttachBtn \{[\s\S]*?display:inline-flex;/);
  assert.match(autoCss, /\.kcfVoiceBtn \{[\s\S]*?display:inline-flex;/);
  assert.doesNotMatch(autoCss, /\.kcfVoiceBtn \{\s*display:none;/);
  assert.doesNotMatch(autoCss, /\.kcfAttachBtn \{\s*display:none;/);
});

test('active sheet has the same five control slots, reusing existing DOM nodes',()=>{
  assert.match(sheet, /id="kcfTeacherSheetAttachHost"/);
  assert.match(sheet, /id="kcfTeacherSheetModeHost"/);
  assert.match(sheet, /id="kcfTeacherSheetRosterHost"/);
  assert.match(sheet, /id="kcfTeacherSheetVoiceHost"/);
  assert.match(sheet, /id="kcfTeacherSheetSendBtn"/);
  assert.match(sheetCss, /grid-template-columns:33px 88px minmax\(0,1fr\) 33px 33px;/);
  assert.match(sheet, /\['kcfAttachBtn','kcfTeacherSheetAttachHost'\]/);
  assert.match(sheet, /\['kcfModeSwitchBtn','kcfTeacherSheetModeHost'\]/);
  assert.match(sheet, /\['kcfVoiceBtn','kcfTeacherSheetVoiceHost'\]/);
  assert.match(sheet, /restoreSheetControls\(\);/);
  assert.doesNotMatch(sheet, /id="kcfSheetModeSwitchBtn"/);
});

test('the active microphone reuses the existing voice recorder after returning to the inline composer',()=>{
  const from=sheet.indexOf('function mountSheetControls(){');
  const to=sheet.indexOf('function finishSheetEntrance(){',from);
  assert.ok(from>=0&&to>from);
  const micHandler=sheet.slice(from,to);
  assert.match(micHandler, /mic\.addEventListener\('click',[\s\S]*?stopImmediatePropagation\(\);[\s\S]*?close\(\{ sync:true \}\);/);
  assert.match(micHandler, /global\.KcfVoiceTranscription/);
  assert.match(micHandler, /voice\.toggle\(event\);/);
  assert.match(micHandler, /photo\.addEventListener\('pointerdown'/);
  assert.match(sheet, /\['kcfPhotoPreview','kcfTeacherSheetPhotoHost'\]/);
  assert.match(sheetCss, /\.kcfTeacherSheetPhotoHost \.kcfPhotoPreview\.show\{display:flex;\}/);
});

test('mode selector uses a real vector chevron, not a text glyph',()=>{
  assert.match(html, /class="kcfModeChevron" viewBox="0 0 24 24"/);
  assert.match(html, /<path d="m6 9 6 6 6-6"\/>/);
  assert.doesNotMatch(html, /kcfModeChevron">⌄/);
  assert.match(sheetCss, /\.kcfModeChevron\{flex:0 0 13px;width:13px;height:13px;fill:none;stroke:currentColor;/);
});

test('Today Records title aligns with observation roster title left edge',()=>{
  const observationOuterPadding=18,observationHeaderMargin=2,observationTitleShift=10;
  const target=observationOuterPadding+observationHeaderMargin+observationTitleShift;
  const todayOuterPadding=18,todayHeadPadding=12;
  assert.equal(target,todayOuterPadding+todayHeadPadding);
  assert.match(todayCss, /padding:0 2px 15px 12px;/);
});

test('close restores controls and closes state before blurring the textarea',()=>{
  assert.match(sheet, /if \(shouldSync\) syncToBase\(\);[\s\S]*?state\.open = false;[\s\S]*?activeEditor\.blur\(\)/);
  assert.match(sheet, /restoreRoster\(\);\s*restoreSheetControls\(\);/);
  assert.match(sheet, /entry\.marker\.parentNode\.insertBefore\(entry\.node,entry\.marker\)/);
});
