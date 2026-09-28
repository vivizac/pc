'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const MOBILE = path.join(ROOT, 'apps', 'mobile');
const COMMON = path.join(ROOT, 'packages', 'common');

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function localScriptList() {
  const html = fs.readFileSync(path.join(MOBILE, 'index.html'), 'utf8');
  return [...html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)]
    .map(m => String(m[1] || '').split('?')[0].split('#')[0])
    .filter(src => src && !/^(?:https?:|data:|blob:)/i.test(src));
}

test('all Mobile runtime JS parses successfully', () => {
  const jsFiles = walk(MOBILE).filter(file =>
    /\.(?:js|cjs)$/.test(file)
    && !file.includes(path.sep + 'tests' + path.sep)
  );
  assert.ok(jsFiles.length >= 70, 'unexpectedly small Mobile runtime JS set');
  const failures = [];
  for (const file of jsFiles) {
    const rel = path.relative(ROOT, file).replace(/\\\\/g, '/');
    const source = fs.readFileSync(file, 'utf8');
    const isEsmApi = rel.startsWith('apps/mobile/api/') && /\\bexport\\s+default\\b|\\bimport\\s+/.test(source);
    const r = isEsmApi
      ? cp.spawnSync(process.execPath, ['--input-type=module', '--check'], { encoding: 'utf8', input: source })
      : cp.spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status !== 0) failures.push({
      file: path.relative(ROOT, file),
      stderr: String(r.stderr || r.stdout || '').trim().slice(0, 1200)
    });
  }
  assert.deepEqual(failures, []);
});


test('link preview API module parses and keeps GET-only handler contract', () => {
  const file = path.join(MOBILE, 'api', 'link-preview.js');
  const source = fs.readFileSync(file, 'utf8');
  const parsed = cp.spawnSync(process.execPath, ['--input-type=module', '--check'], { encoding: 'utf8', input: source });
  assert.equal(parsed.status, 0, String(parsed.stderr || parsed.stdout || ''));
  assert.match(source, /export default async function handler\(req, res\)/);
  assert.match(source, /req\.method !== 'GET'/);
  assert.match(source, /fetch\('\/api\/link-preview\?url='/);
});

test('all Common JS parses successfully', () => {
  const jsFiles = walk(COMMON).filter(file => /\.(?:js|cjs)$/.test(file));
  assert.ok(jsFiles.length >= 45, 'unexpectedly small Common JS set');
  const failures = [];
  for (const file of jsFiles) {
    const r = cp.spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status !== 0) failures.push({
      file: path.relative(ROOT, file),
      stderr: String(r.stderr || r.stdout || '').trim().slice(0, 1200)
    });
  }
  assert.deepEqual(failures, []);
});

test('active Mobile runtime contains no PC raw GitHub dependency', () => {
  const runtimeFiles = walk(MOBILE).filter(file => {
    const rel = path.relative(MOBILE, file).replace(/\\/g, '/');
    if (rel.startsWith('tests/') || rel.startsWith('.github/')) return false;
    if (/\.md$/i.test(rel)) return false;
    return /\.(?:html|js|cjs|css|json)$/i.test(rel);
  });
  const hits = [];
  for (const file of runtimeFiles) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('raw.githubusercontent.com/vivizac/pc/')) {
      hits.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(hits, []);
});

test('Mobile entry script order preserves critical dependency contracts', () => {
  const scripts = localScriptList();
  const pos = name => scripts.indexOf(name);
  const before = (a, b) => {
    assert.ok(pos(a) >= 0, 'missing entry script: ' + a);
    assert.ok(pos(b) >= 0, 'missing entry script: ' + b);
    assert.ok(pos(a) < pos(b), a + ' must load before ' + b);
  };

  before('olli-realtime-common.js', 'olli-attendance-data.js');
  before('olli-attendance-data.js', 'olli-attendance-phone-adapter.js');

  before('observation-memo-edit-state-core.js', 'observation-memo-common.js');
  before('observation-memo-common.js', 'observation-memo-save-common.js');
  before('observation-memo-save-common.js', 'olli-observation-runtime.js');

  before('olli-settings-common-core.js', 'olli-settings-members.js');
  before('olli-settings-common-core.js', 'olli-settings-storage.js');
  before('olli-settings-common-core.js', 'olli-settings-access.js');

  before('olli-auth-account-session.js', 'olli-auth-academy-access.js');
  before('olli-auth-teacher-membership.js', 'olli-auth-academy-access.js');

  before('olli-feedback-photo-storage-common.js', 'kinder-feedback.js');
  before('olli-command-schedule-common.js', 'olli-command-router-common.js');
});

test('every local script referenced by Mobile index exists', () => {
  const scripts = localScriptList();
  assert.ok(scripts.length >= 100, 'unexpectedly small Mobile entry script set');
  const missing = scripts.filter(src => !fs.existsSync(path.join(MOBILE, src)));
  assert.deepEqual(missing, []);
});
