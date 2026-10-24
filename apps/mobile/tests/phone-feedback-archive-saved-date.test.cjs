const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const adapter = fs.readFileSync('olli-record-student-picker-phone-adapter.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('olli-phone-base.css', 'utf8');

test('feedback archive cards use the saved lesson date with server-created timestamp as fallback', () => {
  assert.match(adapter, /function getMemoFeedbackArchiveSavedAt\(item\)/);
  // Lesson/record date is preferred for the archive month, while created_at remains a fallback.
  assert.match(adapter, /const candidates = \[row\.date, row\.lesson_date, item\?\.date, item\?\.createdAt, row\.created_at,/);
  assert.match(adapter, /row\.updated_at, item\?\.updatedAt, item\?\.updated_at/);
  assert.match(adapter, /formatMemoFeedbackArchiveDate\(getMemoFeedbackArchiveSavedAt\(item\)\) \|\| '날짜 정보 없음'/);
  assert.doesNotMatch(adapter, /formatMemoFeedbackArchiveDate\(item\.createdAt\) \|\| '저장된 피드백'/);
});

test('legacy local feedback archive IDs still recover timestamp as a last resort', () => {
  const vm=require('node:vm');
  const begin=adapter.indexOf('function getMemoFeedbackArchiveSavedAt(item)');
  const end=adapter.indexOf('function getMemoFeedbackArchiveMonthInfo(item)',begin);
  assert.ok(begin>=0&&end>begin,'the real archive date resolver must exist');
  const sandbox={
    normalizeMemoFeedbackArchiveDate:()=>'', // simulate no saved server dates
    formatMemoFeedbackArchiveDate:value=>Number.isFinite(value)?'valid-date':''
  };
  vm.runInNewContext(adapter.slice(begin,end)+'\nthis.getSavedAt=getMemoFeedbackArchiveSavedAt;',sandbox);
  const id='memo_feedback_1761300000000_legacy';
  assert.equal(sandbox.getSavedAt({id}),1761300000000);
  assert.equal(sandbox.getSavedAt({id:'legacy-without-timestamp'}),'');
});

test('phone loads the cache-busted feedback archive adapter', () => {
  assert.match(html, /olli-record-student-picker-phone-adapter\.js\?v=[^"'\s>]+/);
});


test('feedback archive month capsules are horizontal, newest-first, and filter existing cards', () => {
  assert.match(adapter, /function getMemoFeedbackArchiveMonthGroups\(items\)/);
  assert.match(adapter, /return Array\.from\(groups\.values\(\)\)\.sort\(\(a, b\) => b\.sortValue - a\.sortValue\)/);
  assert.match(adapter, /function selectMemoFeedbackArchiveMonth\(monthKey\)/);
  assert.match(adapter, /card\.hidden = card\.dataset\.memoArchiveMonth !== key/);
  assert.match(adapter, /data-memo-archive-month=/);
  assert.match(css, /\.memoFeedbackArchiveMonthRow\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-wrap:\s*nowrap;[\s\S]*max-width:\s*100%;[\s\S]*overflow-x:\s*auto;[\s\S]*overscroll-behavior-x:\s*contain;/);
  const monthButton = css.slice(css.indexOf('.memoFeedbackArchiveMonthBtn {'),css.indexOf('.memoFeedbackArchiveMonthBtn.active'));
  assert.ok(monthButton.length>0);
  // Sizes may grow for readability, but must remain comfortably tappable.
  const width=Number(monthButton.match(/min-width:\s*(\d+)px;/)?.[1]);
  const height=Number(monthButton.match(/height:\s*(\d+)px;/)?.[1]);
  assert.ok(width>=60,'month chip must be at least 60px wide');
  assert.ok(height>=42,'month chip must be at least 42px high');
  assert.match(monthButton, /flex:\s*0 0 auto;/);
  assert.match(monthButton, /border-radius:\s*999px;/);
  assert.match(monthButton, /background:\s*#fff;/);
  assert.match(monthButton, /color:\s*#8e8e93;/);
  assert.match(css, /\.memoFeedbackArchiveMonthBtn\.active\s*\{[\s\S]*background:\s*#0A84FF;[\s\S]*color:\s*#fff;/);
});

test('phone loads versioned archive month capsule styles', () => {
  assert.match(html, /olli-phone-base\.css\?v=[^"'\s>]+/);
});


test('feedback archive keeps one bottom-sheet shell while server data refreshes its inner content', () => {
  assert.match(adapter, /function ensureMemoFeedbackArchiveSheet\(menu\)/);
  assert.match(adapter, /let sheet = menu\.querySelector\('\.memoFeedbackArchiveSheet'\)/);
  assert.match(adapter, /menu\.replaceChildren\(sheet\)/);
  assert.match(adapter, /<div class="memoFeedbackArchiveContent"><\/div>/);
  assert.match(adapter, /const contentEl = sheet\.querySelector\('\.memoFeedbackArchiveContent'\)/);
  assert.match(adapter, /contentEl\.innerHTML = /);
  assert.doesNotMatch(adapter, /function renderMemoFeedbackArchiveSheet[\s\S]*?menu\.innerHTML = /);
  assert.doesNotMatch(adapter, /관찰노트 보관함 불러오기 오류:[\s\S]*?menu\.innerHTML = /);
  assert.match(adapter, /renderMemoFeedbackArchiveLoadError\(menu, err\)/);
  assert.match(adapter, /menu\.classList\.contains\('show'\) && menu\.querySelector\('\.memoFeedbackArchiveCard\.editing'\)/);
});
