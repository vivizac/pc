const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const js = fs.readFileSync('pc-team-talk-material-orders.js', 'utf8');
const css = fs.readFileSync('pc-team-talk-material-orders.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
// The October 12 policy replaced the earlier arrived/ordered_at archive cutoff.
const migration = fs.readFileSync('../../supabase/migrations/20261012054737_material_archive_by_needed_date.sql', 'utf8');

test('PC material order runtime compiles after archive addition', () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: 'pc-team-talk-material-orders.js' }));
});

test('PC archive moves requests on the day after needed_on, regardless of status', () => {
  assert.match(js, /function isMaterialArchiveEligible\\(item, now = new Date\\(\\)\\)/);
  assert.match(js, /const neededOn = clean\\(item\\?\\.needed_on\\)/);
  assert.match(js, /neededOn < localDateKey\\(now\\)/);
  assert.match(js, /state\\.items\\.filter\\(item => !isMaterialArchiveEligible\\(item\\)\\)/);
  assert.match(js, /if \\(isMaterialArchiveEligible\\(item\\)\\) return false/);

  // Run the pure production decision functions against a fixed date, not just string-match.
  const eligibleSource = js.slice(
    js.indexOf('  function isMaterialArchiveEligible('),
    js.indexOf('  function currentMaterialItems(')
  );
  const dateSource = js.slice(
    js.indexOf('  function localDateKey('),
    js.indexOf('  function mondayKey(')
  );
  const sandbox = { Date, clean: value => String(value || '').trim() };
  vm.runInNewContext(eligibleSource + dateSource + '\\nthis.isEligible=isMaterialArchiveEligible;', sandbox);
  const today = new Date(2026, 9, 24, 12);
  assert.equal(sandbox.isEligible({needed_on:'2026-10-23',status:'requested'},today),true);
  assert.equal(sandbox.isEligible({needed_on:'2026-10-23',status:'arrived'},today),true);
  assert.equal(sandbox.isEligible({needed_on:'2026-10-24',status:'arrived'},today),false);
  assert.equal(sandbox.isEligible({needed_on:'2026-10-25',status:'arrived'},today),false);
  assert.equal(sandbox.isEligible({needed_on:null,status:'arrived'},today),false);
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

test('PC past orders page title matches the toolbar entry', () => {
  assert.match(js, /<section class="olliMatArchiveView"[^>]*aria-label="지난 주문내역"/);
  assert.match(js, /<strong>지난 주문내역<\/strong>/);
  assert.doesNotMatch(js, /<strong>재료주문 보관함<\/strong>/);
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

test('archive RPC checks academy membership and uses needed_on in Seoul date (same rule as list)', () => {
  assert.match(migration, /public\\.olli_account_id_from_session\\(p_session_token\\)/);
  assert.match(migration, /m\\.academy_id = p_academy_id/);
  assert.match(migration, /r\\.needed_on < \\(now\\(\\) at time zone 'Asia\\/Seoul'\\)::date/);
  assert.match(migration, /extract\\(year from r\\.needed_on\\)::integer/);
  assert.match(migration, /r\\.needed_on is null or r\\.needed_on >= \\(now\\(\\) at time zone 'Asia\\/Seoul'\\)::date/);
  assert.match(migration, /'archive_basis', 'needed_on_past'/);
  assert.doesNotMatch(migration, /r\\.ordered_at <= now\\(\\) - interval '1 month'/);
});

test('existing material list RPC remains the current-list source and archive has a dedicated reader', () => {
  assert.match(js, /rpc\('olli_team_material_requests_list'/);
  assert.match(js, /rpc\('olli_team_material_requests_archive'/);
  assert.match(migration, /create or replace function public\.olli_team_material_requests_archive/);
});

test('PC archive assets are cache-busted', () => {
  assert.match(html, /pc-team-talk-material-orders\.css\?v=20261002-material-archive-toolbar-1/);
  assert.match(html, /pc-team-talk-material-orders\.js\?v=[^"']+/);
});
