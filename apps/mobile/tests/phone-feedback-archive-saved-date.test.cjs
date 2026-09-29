const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const adapter = fs.readFileSync('olli-record-student-picker-phone-adapter.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('olli-phone-base.css', 'utf8');

test('feedback archive cards show the saved timestamp instead of the old generic guide text', () => {
  assert.match(adapter, /function getMemoFeedbackArchiveSavedAt\(item\)/);
  assert.match(adapter, /row\.created_at,[\s\S]*item\?\.createdAt,[\s\S]*row\.updated_at,[\s\S]*row\.date/);
  assert.match(adapter, /formatMemoFeedbackArchiveDate\(getMemoFeedbackArchiveSavedAt\(item\)\) \|\| '날짜 정보 없음'/);
  assert.doesNotMatch(adapter, /formatMemoFeedbackArchiveDate\(item\.createdAt\) \|\| '저장된 피드백'/);
});

test('legacy local feedback archive IDs can still provide a saved date fallback', () => {
  assert.match(adapter, /\^memo_feedback_\(\\d\{10,\}\)_/);
  assert.match(adapter, /Number\.isFinite\(timestamp\)/);
});

test('phone loads the cache-busted feedback archive adapter', () => {
  assert.match(html, /olli-record-student-picker-phone-adapter\.js\?v=20260928-archive-shell-stable-1/);
});


test('feedback archive month capsules are horizontal, newest-first, and filter existing cards', () => {
  assert.match(adapter, /function getMemoFeedbackArchiveMonthGroups\(items\)/);
  assert.match(adapter, /return Array\.from\(groups\.values\(\)\)\.sort\(\(a, b\) => b\.sortValue - a\.sortValue\)/);
  assert.match(adapter, /function selectMemoFeedbackArchiveMonth\(monthKey\)/);
  assert.match(adapter, /card\.hidden = card\.dataset\.memoArchiveMonth !== key/);
  assert.match(adapter, /data-memo-archive-month=/);
  assert.match(css, /\.memoFeedbackArchiveMonthRow\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-wrap:\s*nowrap;[\s\S]*max-width:\s*100%;[\s\S]*overflow-x:\s*auto;[\s\S]*overscroll-behavior-x:\s*contain;/);
  assert.match(css, /\.memoFeedbackArchiveMonthBtn\s*\{[\s\S]*min-width:\s*60px;[\s\S]*height:\s*42px;[\s\S]*padding:\s*0 15px;[\s\S]*border:\s*1px solid #fff;[\s\S]*border-radius:\s*999px;[\s\S]*background:\s*#fff;[\s\S]*color:\s*#8e8e93;/);
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
