'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const messages=fs.readFileSync(path.join(root,'packages/common/olli-consultation-messages.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/index.html'),'utf8');
const desktop=fs.readFileSync(path.join(root,'apps/pc/index.html'),'utf8');
const mobileCss=fs.readFileSync(path.join(root,'apps/mobile/olli-academy-dashboard.css'),'utf8');

test('mobile copy icon matches status badge height while keeping the same horizontal target',()=>{
  assert.match(mobileCss,/\.recordAcademyConsultStatusChip\s*\{[^}]*min-height:\s*24px/s);
  assert.match(messages,/flex:0 0 28px;order:-1;width:28px;height:24px;min-height:24px;box-sizing:border-box/);
  assert.match(messages,/background:transparent;color:#7f7f7f/);
  assert.match(messages,/button\.innerHTML = manualConsultationCopyIconSvg\(\)/);
});
test('PC notice copy height matches status badge and retains horizontal appearance',()=>{
  assert.match(desktop,/\.recordAcademyConsultStatusChip\s*\{[^}]*min-height:\s*24px/s);
  assert.match(messages,/flex-shrink:0;order:-1;height:24px;min-height:24px;box-sizing:border-box/);
  assert.match(messages,/border:1px solid #fff;border-radius:999px;background:#fff;color:#343d4b;padding:0 10px/);
});
test('PC copies sit immediately left of status badge; mobile icon appearance is retained',()=>{
  assert.match(mobile,/src="olli-consultation-messages\.js\?v=20261025-copy-height-24-1"/);
  assert.match(desktop,/src="olli-consultation-messages\.js\?v=20261026-pc-copy-capsule-1"/);
  assert.match(messages,/const actions = card\.querySelector\('\.recordAcademyConsultActions'\)/);
  assert.match(messages,/if \(statusChip\) actions\.insertBefore\(button, statusChip\)/);
  assert.match(messages,/else card\.insertBefore\(button, card\.firstChild\)/);
});
