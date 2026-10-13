'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const feedback = fs.readFileSync(path.join(root, 'kinder-feedback.js'), 'utf8');
const feedbackCss = fs.readFileSync(path.join(root, 'kinder-feedback.css'), 'utf8');
const autoCss = fs.readFileSync(path.join(root, 'kcf-auto-mode.css'), 'utf8');
const auto = fs.readFileSync(path.join(root, 'kcf-auto-mode-runtime.js'), 'utf8');
const sheet = fs.readFileSync(path.join(root, 'kcf-teacher-sheet.js'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'olli-settings-phone-ui.js'), 'utf8');

const start = feedback.indexOf('const OLLI_FEEDBACK_STORAGE_DIAG_PREF_PREFIX =');
const end = feedback.indexOf('/* PWA diagnostics inspect only metadata.', start);
assert.ok(start >= 0 && end > start, 'diagnostic preferences are testable without loading app state');
const diagnosticPreferenceCode = feedback.slice(start, end);

function makeContext({role = 'owner', academyId = 'academy-1', memberId = 'member-1', prior = null} = {}) {
  const stored = new Map(prior || []);
  stored.set('olli_current_member_id', memberId);
  let writes = 0;
  const buttonClasses = new Set();
  const toggleClasses = new Set();
  const buttonAttrs = {};
  const rowAttrs = {};
  const button = {
    classList: { toggle: (name, active) => active ? buttonClasses.add(name) : buttonClasses.delete(name) },
    setAttribute: (name, value) => { buttonAttrs[name] = value; },
    tabIndex: -1
  };
  const row = {
    setAttribute: (name, value) => { rowAttrs[name] = value; },
    querySelector: () => ({
      classList: { toggle: (name, active) => active ? toggleClasses.add(name) : toggleClasses.delete(name) }
    })
  };
  const sandbox = {
    window: {},
    document: {
      querySelector: selector => selector.includes('kcfStorageDiagnosticBtn') ? button : null,
      getElementById: id => id === 'settingsFeedbackDiagnosticRow' ? row : null
    },
    getOlliCurrentRole: () => role,
    getOlliCurrentAcademyId: () => academyId,
    localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => { writes++; stored.set(key, value); }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(diagnosticPreferenceCode, sandbox);
  return {
    api: sandbox.window.OlliFeedbackStorageDiagnosticSettings,
    stored, writes: () => writes, buttonClasses, toggleClasses, buttonAttrs, rowAttrs, button
  };
}

test('administrative setting is a role-gated accessible switch, and assets are cache-busted', () => {
  assert.match(index, /<section class="settingsSection" data-owner-manager-only="true"><div class="settingsCard"><button class="settingsRow settingsFeedbackDiagnosticRow"/);
  assert.match(index, /data-owner-manager-only="true" id="settingsFeedbackDiagnosticRow"/);
  assert.match(index, /id="settingsFeedbackDiagnosticRow"[^>]*onclick="togglePhoneSettingsFeedbackDiagnostic\(\)"/);
  assert.match(index, /id="settingsFeedbackDiagnosticToggle"/);
  assert.match(index, /kinder-feedback\.js\?v=20261014-diagnostic-toggle-1/);
  assert.match(index, /kinder-feedback\.css\?v=20261014-diagnostic-toggle-1/);
  assert.match(index, /olli-settings-phone-ui\.js\?v=20261014-diagnostic-toggle-1/);
  assert.match(index, /kcf-auto-mode\.css\?v=20261014-idle-roster-hidden-1/);
  assert.match(settings, /global\.togglePhoneSettingsFeedbackDiagnostic=togglePhoneSettingsFeedbackDiagnostic/);
  assert.match(settings, /global\.OlliFeedbackStorageDiagnosticSettings\?\.sync\?\.\(\)/);
});

test('diagnostic stays hidden until an administrator opts in on this device', () => {
  const ctx = makeContext();
  assert.equal(ctx.api.isAllowed(), true);
  assert.equal(ctx.api.isEnabled(), false);
  ctx.api.sync();
  assert.equal(ctx.buttonClasses.has('is-enabled'), false);
  assert.equal(ctx.rowAttrs['aria-checked'], 'false');

  assert.equal(ctx.api.setEnabled(true), true);
  assert.equal(ctx.api.isEnabled(), true);
  assert.equal(ctx.buttonClasses.has('is-enabled'), true);
  assert.equal(ctx.toggleClasses.has('on'), true);
  assert.equal(ctx.rowAttrs['aria-checked'], 'true');
  assert.equal(ctx.button.tabIndex, 0);
  assert.equal(ctx.writes(), 1);

  assert.equal(ctx.api.setEnabled(false), true);
  assert.equal(ctx.api.isEnabled(), false);
  assert.equal(ctx.buttonClasses.has('is-enabled'), false);
  assert.equal(ctx.toggleClasses.has('on'), false);
  assert.equal(ctx.rowAttrs['aria-checked'], 'false');
});

test('settings persist by academy and account without granting teachers access', () => {
  const owner = makeContext();
  owner.api.setEnabled(true);
  assert.equal(makeContext({prior:owner.stored}).api.isEnabled(), true);
  assert.equal(makeContext({academyId:'academy-2',prior:owner.stored}).api.isEnabled(), false);
  assert.equal(makeContext({memberId:'member-2',prior:owner.stored}).api.isEnabled(), false);
  const teacher = makeContext({role:'teacher',prior:owner.stored});
  assert.equal(teacher.api.isAllowed(), false);
  assert.equal(teacher.api.isEnabled(), false);
  assert.equal(teacher.api.setEnabled(true), false);
  assert.equal(teacher.writes(), 0);
});

test('quicknote diagnostic is opt-in and cannot open for a non-admin', () => {
  assert.match(feedbackCss, /#kcfPersistentTopLayer \.kcfStorageDiagnosticBtn\s*\{\s*display:none;/);
  assert.match(feedbackCss, /#kcfPersistentTopLayer\.show \.kcfStorageDiagnosticBtn\.is-enabled\s*\{\s*display:inline-flex;/);
  assert.match(feedback, /if\(active\) syncOlliFeedbackStorageDiagnosticVisibility\(\)/);
  assert.match(feedback, /async function showOlliStorageDiagnostic\(\) \{\s*if\(!canUseOlliFeedbackStorageDiagnostic\(\)\)return;/);
});

test('idle composer hides the returning student roster, not the active portals', () => {
  assert.match(autoCss, /#kinderChatFeedbackScreen \.kcfComposerWrap > \.kcfAutoStudentRoster \{\s*display:none;/);
  assert.match(sheet, /bottom\.insertBefore\(roster, document\.getElementById\('kcfVoiceBtn'\)\)/);
  assert.match(sheet, /host\.appendChild\(roster\)/);
  assert.match(sheet, /restoreInlineRoster\(\);/);
  assert.match(sheet, /restoreRoster\(\);/);
  assert.match(auto, /state\.completedIds\.add\(submitted\.studentId\)/);
  assert.match(auto, /selectNextAvailableAutoStudent\(submitted\.studentId, submitted\.order \|\| \[\]\)/);
  assert.match(auto, /state\.selectedStudentId = nextId/);
});
