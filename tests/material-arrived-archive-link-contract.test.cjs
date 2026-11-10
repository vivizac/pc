const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('arrived material cards are manually archived in place, without opening the archive screen', () => {
  const cases = [
    { js:'apps/pc/pc-team-talk-material-orders.js', css:'apps/pc/pc-team-talk-material-orders.css', index:'apps/pc/index.html', button:'olliMatDoneNote', asset:'pc-team-talk-material-orders' },
    { js:'apps/mobile/olli-talk-material-orders-mobile.js', css:'apps/mobile/olli-talk-material-orders-mobile.css', index:'apps/mobile/index.html', button:'olliMobileMatDoneNote', asset:'olli-talk-material-orders-mobile' }
  ];
  for (const c of cases) {
    const src = read(c.js), css = read(c.css), html = read(c.index);
    assert.match(src, /item\.status\s*===\s*'arrived'/);
    assert.match(src, /지난 주문 내역으로 이동/);
    assert.match(src, /archiveButton\.dataset\.materialAction\s*=\s*'archive-item'/);
    assert.doesNotMatch(src, /archiveButton\.dataset\.materialAction\s*=\s*'open-archive'/);
    assert.match(src, /async function archiveRequest\(/);
    assert.match(src, /rpc\('olli_team_material_request_archive'/);
    assert.match(src, /p_expected_revision/);
    const action = src.slice(src.indexOf('async function archiveRequest('), src.indexOf('async function deleteRequest('));
    assert.ok(action.length > 400);
    assert.doesNotMatch(action, /openArchive\(/);
    assert.match(action, /if\s*\(!payload\?\.ok\)/);
    assert.match(src, /archive_date\s*\|\|\s*item\?\.needed_on/);
    assert.match(css, new RegExp('button\\.' + c.button));
    assert.match(html, new RegExp(c.asset + '\\.js\\?v=20261110-arrived-archive-2'));
    assert.match(html, new RegExp(c.asset + '\\.css\\?v=20261110-arrived-archive-1'));
  }
});

test('server keeps original needed date and excludes only manually archived rows from current list', () => {
  const sql = read('supabase/migrations/20261110091005_material_order_manual_archive.sql');
  assert.match(sql, /add column if not exists manually_archived_at timestamptz/i);
  assert.match(sql, /and r\.manually_archived_at is null/i);
  assert.match(sql, /r\.manually_archived_at is not null/i);
  assert.match(sql, /r\.needed_on < \(now\(\) at time zone 'Asia\/Seoul'\)::date/i);
  assert.match(sql, /archive_date/i);
  assert.match(sql, /r\.status = 'arrived'/i);
  assert.match(sql, /r\.revision = p_expected_revision/i);
  assert.match(sql, /private\.olli_realtime_send_signal/i);
  assert.doesNotMatch(sql, /set\s+needed_on\s*=/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.olli_team_material_requests/i);
});
