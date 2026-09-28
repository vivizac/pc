const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = {
  account: path.join(root, 'olli-auth-account-session.js'),
  member: path.join(root, 'olli-auth-member-validation.js'),
  startup: path.join(root, 'olli-app-startup.js'),
  startPage: path.join(root, 'pc-start-page.js')
};
const read = file => fs.readFileSync(file, 'utf8');

test('PC auth boundary files parse as JavaScript', () => {
  Object.values(files).forEach(file => {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  });
});

test('PC startup requires an authoritative server session and membership validation', () => {
  const startup = read(files.startup);
  assert.match(startup, /restoreOlliAccountSession\(\{ silent: true, allowCachedFallback: false \}\)/);
  assert.doesNotMatch(startup, /restoreOlliAccountSession\(\{ silent: true, allowCachedFallback: true \}\)/);
  assert.match(startup, /typeof validateOlliCurrentMemberAccess !== 'function'/);
  assert.match(startup, /access\.valid !== true \|\| access\.authoritative !== true/);
  assert.match(startup, /olliStartupAuthReady && isOlliLoggedInForStartPage\(\)/);
});

test('authoritative account state is runtime-only and cache recovery cannot grant it', () => {
  const account = read(files.account);
  assert.match(account, /let olliAuthoritativeAccountSessionReady = false/);
  assert.match(account, /function hasOlliAuthoritativeAccountSession\(\)/);
  assert.match(account, /window\.hasOlliAuthoritativeAccountSession = hasOlliAuthoritativeAccountSession/);
  assert.match(account, /function recoverOlliCachedAccountSessionContext\(reason\) \{\s*setOlliAuthoritativeAccountSessionReady\(false\)/);
  assert.match(account, /saveOlliAcademyLoginState\(selected, \{ accountLogin: true \}\);\s*setOlliAuthoritativeAccountSessionReady\(true\)/);
});

test('teacher session helpers never accept degraded cache context as authorization', () => {
  const account = read(files.account);
  assert.match(account, /establishOlliTeacherAccountSession[\s\S]*allowCachedFallback: false/);
  assert.match(account, /restored\.authoritative === true/);
  assert.doesNotMatch(account, /restored\.authoritative === true \|\| restored\.degraded === true/);
  assert.match(account, /refreshOlliTeacherAcademyAccessAfterValidation[\s\S]*allowCachedFallback: false/);
});

test('member validation fails closed when membership identity or role is incomplete', () => {
  const member = read(files.member);
  assert.doesNotMatch(member, /matched\.membership_status \|\| matched\.member_status \|\| matched\.status \|\| 'active'/);
  assert.match(member, /reason: 'ACADEMY_ID_MISSING'/);
  assert.match(member, /reason: 'MEMBERSHIP_ID_MISSING'/);
  assert.match(member, /reason: 'MEMBER_ROLE_INVALID'/);
  assert.match(member, /\['owner', 'manager', 'teacher', 'super_admin'\]\.includes\(role\)/);
});

test('PC start-page login state requires runtime authoritative session, not local flags alone', () => {
  const startPage = read(files.startPage);
  assert.match(startPage, /global\.hasOlliAuthoritativeAccountSession\(\) !== true/);
  assert.match(startPage, /olli_owner_logged_in/);
  assert.match(startPage, /olli_current_academy_id/);
});
