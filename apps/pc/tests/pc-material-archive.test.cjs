const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const js = fs.readFileSync('pc-team-talk-material-orders.js', 'utf8');
const css = fs.readFileSync('pc-team-talk-material-orders.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync('../../supabase/migrations/20261002065349_pc_material_order_archive.sql', 'utf8');

test('PC material order runtime compiles after archive addition', () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: 'pc-team-talk-material-orders.js' }));
});

test('arrived orders move out of the current PC list one calendar month after ordered_at', () => {
  assert.match(js, /function materialArchiveCutoffMs\(now = new Date\(\)\)/);
  assert.match(js, /function isMaterialArchiveEligible\(item, now = new Date\(\)\)/);
  assert.match(js, /clean\(item\?\.status\) !== 'arrived'/);
  assert.match(js, /item\?\.ordered_at/);
  assert.match(js, /if \(isMaterialArchiveEligible\(item\)\) return false/);
});

test('PC material archive entry sits beside the three summary status buttons', () => {
  const summaryStart = js.indexOf('<div class="olliMatSummary"');
  const summaryEnd = js.indexOf('<div class="olliMatWorkspace"', summaryStart);
  const summary = js.slice(summaryStart, summaryEnd);
  const listHeadStart = js.indexOf('<div class="olliMatListHead">');
  const listHeadEnd = js.indexOf('<div class="olliMatList"', listHeadStart);
  const listHead = js.slice(listHeadStart, listHeadEnd);

  assert.equal((summary.match(/class="olliMatSummaryCard/g) || []).length, 4);
  assert.match(summary, /data-material-action="open-archive"/);
  assert.match(summary, /지난 주문내역/);
  assert.doesNotMatch(listHead, /open-archive|olliMatArchiveOpenBtn/);
  assert.match(css, /grid-template-columns:repeat\(4,minmax\(0,160px\)\)/);
  assert.match(css, /\.olliMatSummaryCard\.archive\{background:#fff;border-color:#e6e8eb;color:#666c73\}/);
});

test('PC archive uses year folders and month groups', () => {
  assert.match(js, /data-material-action="open-archive"/);
  assert.match(js, /data-material-archive-years/);
  assert.match(js, /data-material-archive-year/);
  assert.match(js, /olliMatArchiveMonth/);
  assert.match(js, /month \+ '월'/);
  assert.match(css, /\.olliMatArchiveYearCard/);
  assert.match(css, /\.olliMatArchiveMonthGrid/);
});

test('PC archive is read-only and keeps original material rows', () => {
  assert.match(js, /rpc\('olli_team_material_requests_archive'/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.olli_team_material_requests/i);
  assert.doesNotMatch(js.slice(js.indexOf('function renderArchiveList'), js.indexOf('function renderArchive')), /data-material-set-status/);
});

test('archive RPC authenticates academy membership and selects only arrived month-old orders', () => {
  assert.match(migration, /public\.olli_account_id_from_session\(p_session_token\)/);
  assert.match(migration, /m\.academy_id = p_academy_id/);
  assert.match(migration, /r\.status = 'arrived'/);
  assert.match(migration, /r\.ordered_at <= now\(\) - interval '1 month'/);
  assert.match(migration, /extract\(year from r\.ordered_at\)::integer/);
});

test('existing material list RPC remains the current-list source and archive has a dedicated reader', () => {
  assert.match(js, /rpc\('olli_team_material_requests_list'/);
  assert.match(js, /rpc\('olli_team_material_requests_archive'/);
  assert.match(migration, /create or replace function public\.olli_team_material_requests_archive/);
});

test('PC archive assets are cache-busted', () => {
  assert.match(html, /pc-team-talk-material-orders\.css\?v=20261002-material-archive-toolbar-1/);
  assert.match(html, /pc-team-talk-material-orders\\.js\\?v=20261002-past-orders-label-1/);
});
