const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = {
  editStateCore: path.join(root, 'observation-memo-edit-state-core.js'),
  common: path.join(root, 'observation-memo-common.js'),
  pcCore: path.join(root, 'observation-memo-core.js'),
  storage: path.join(root, 'observation-memo-storage-common.js'),
  save: path.join(root, 'observation-memo-save-common.js'),
  requestGuard: path.join(root, 'observation-memo-request-guard-common.js'),
  session: path.join(root, 'observation-memo-session-common.js'),
  feedbackClear: path.join(root, 'observation-memo-feedback-clear-common.js'),
  historyCore: path.join(root, 'observation-memo-version-history-core.js'),
  history: path.join(root, 'observation-memo-version-history-common.js')
};

const read = file => fs.readFileSync(file, 'utf8');
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

test('observation memo safety modules parse as JavaScript', () => {
  Object.values(files).forEach(file => {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  });
});

test('edit-state core owns no platform DOM and keeps the legacy state slot compatible', () => {
  const core = read(files.editStateCore);
  assert.match(core, /global\.ObservationMemoEditStateCore = Object\.freeze/);
  assert.match(core, /global\.__olliObservationMemoEditState/);
  assert.doesNotMatch(core, /document\./);
  assert.doesNotMatch(core, /getElementById/);
  assert.doesNotMatch(core, /querySelector/);
  assert.doesNotMatch(core, /createElement\(/);
});

test('edit state contract preserves baseline dirty and clean behavior for the active memo only', () => {
  const editStateCoreSource = read(files.editStateCore);
  const commonSource = read(files.common);
  const editor = {
    id: 'memoEditor',
    value: '처음 기록',
    dataset: { minHeight: '140' },
    style: {},
    scrollHeight: 140
  };
  const document = {
    hidden: false,
    addEventListener() {},
    getElementById(id) { return id === 'memoEditor' ? editor : null; },
    querySelector() { return null; },
    createElement() { return { classList:{ add(){}, remove(){} }, style:{}, appendChild(){} }; },
    body: { appendChild(){}, classList:{ add(){}, remove(){} } }
  };
  const sandbox = {
    window: null,
    document,
    console: { warn() {} },
    currentMemoStudent: { id: 'student-1', type: 'elementary' },
    currentMemoType: 'elementary',
    setTimeout() { return 1; },
    clearTimeout() {},
    requestAnimationFrame() {},
    alert() {}
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};

  vm.createContext(sandbox);
  vm.runInContext(editStateCoreSource, sandbox, { filename:'observation-memo-edit-state-core.js' });
  vm.runInContext(commonSource, sandbox, { filename:'observation-memo-common.js' });

  const state = sandbox.beginObservationMemoEditSession(
    sandbox.currentMemoStudent,
    'elementary_observation',
    '처음 기록'
  );
  assert.equal(state.studentId, 'student-1');
  assert.equal(state.noteType, 'elementary_observation');
  assert.equal(state.baselineText, '처음 기록');
  assert.equal(sandbox.hasObservationMemoDirtyChanges(), false);

  assert.equal(sandbox.markObservationMemoEditorDirty(editor), false);
  editor.value = '수정 기록';
  assert.equal(sandbox.markObservationMemoEditorDirty(editor), true);
  assert.equal(sandbox.hasObservationMemoDirtyChanges(), true);

  sandbox.markObservationMemoEditorClean();
  assert.equal(sandbox.getObservationMemoEditState().baselineText, '수정 기록');
  assert.equal(sandbox.hasObservationMemoDirtyChanges(), false);

  sandbox.currentMemoStudent = { id:'student-2', type:'elementary' };
  editor.value = '다른 학생 기록';
  assert.equal(sandbox.markObservationMemoEditorDirty(editor), false);
  assert.equal(sandbox.hasObservationMemoDirtyChanges(), false);
});

test('shared observation common no longer owns platform refresh lifecycle', () => {
  const common = read(files.common);
  const pcCore = read(files.pcCore);

  assert.match(common, /function requestObservationMemoCrossDeviceRefresh\(\)/);
  assert.doesNotMatch(common, /__olliObservationMemoCrossDeviceRefreshBound/);
  assert.doesNotMatch(common, /addEventListener\('focus', requestObservationMemoCrossDeviceRefresh/);
  assert.doesNotMatch(common, /addEventListener\('online', requestObservationMemoCrossDeviceRefresh/);
  assert.doesNotMatch(common, /addEventListener\('olli:realtime-change'/);
  assert.doesNotMatch(common, /addEventListener\('visibilitychange'/);
  assert.doesNotMatch(common, /addEventListener\('focusin'/);

  assert.match(pcCore, /__olliObservationMemoPcRefreshLifecycleBound/);
  assert.match(pcCore, /addEventListener\('focus', requestRefresh\)/);
  assert.match(pcCore, /addEventListener\('online', requestRefresh\)/);
  assert.match(pcCore, /addEventListener\('olli:realtime-change'/);
  assert.match(pcCore, /addEventListener\('visibilitychange'/);
  assert.match(pcCore, /addEventListener\('focusin'/);
  assert.match(pcCore, /event\?\.detail\?\.domain !== 'observation'/);
  assert.match(pcCore, /hasObservationMemoDirtyChanges/);
});

test('CAS save contract preserves revision, mutation and conflict states', () => {
  const source = read(files.save);

  assert.match(source, /rpc\/olli_note_draft_save_cas/);
  assert.match(source, /p_expected_revision:\s*memoRevision\(expectedRevision\)/);
  assert.match(source, /p_mutation_id:\s*mutationId \|\| createMutationId\(\)/);
  assert.match(source, /p_device_id:\s*device \|\| deviceId\(\)/);

  assert.match(source, /syncStatus:\s*'pending'/);
  assert.match(source, /syncStatus:\s*'conflict'/);
  assert.match(source, /syncStatus:\s*blocked \? 'blocked' : 'pending'/);
  assert.match(source, /revision:\s*has\('revision'\)/);
  assert.match(source, /mutationId:\s*has\('mutationId'\)/);
  assert.match(source, /conflict:\s*has\('conflict'\)/);
});

test('request guard owns same-device ordering and routes direct clears through the guarded write path', () => {
  const source = read(files.requestGuard);

  assert.match(source, /const chains = new Map\(\)/);
  assert.match(source, /const latestRequests = new Map\(\)/);
  assert.match(source, /state:\s*'superseded'/);
  assert.match(source, /global\.persistObservationMemoDraft = guardedPersistObservationMemoDraft/);
  assert.match(source, /global\.clearStudentNoteDraftFromSupabase = async function clearObservationMemoDraftWithGuard/);
  assert.match(source, /guardedPersistObservationMemoDraft\(student, '', \{ noteType \}\)/);
});

function createRequestGuardSandbox() {
  const source = read(files.requestGuard);
  const values = new Map([['olli_current_academy_id', 'academy-a']]);
  const entries = new Map();
  const calls = [];
  let mutationSequence = 0;
  let implementation = async (student, content, options) => {
    calls.push({ student: { ...student }, content, options: { ...options } });
    return {
      state: content ? 'synced' : 'cleared',
      student,
      revision: Number(options.expectedRevision || 0) + 1
    };
  };

  const keyFor = (student, noteType = '') => `${student?.id || ''}:${noteType || ''}`;

  const win = {
    window: null,
    console: { warn() {} },
    crypto: { randomUUID: () => `mutation-${++mutationSequence}` },
    localStorage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value))
    },
    getOlliCurrentAcademyId: () => 'academy-a',
    getSupabaseNoteDraftType: () => 'elementary_observation',
    createObservationMemoMutationId: () => `note-${++mutationSequence}`,
    getMemoEntryByStudent(student, noteType = '') {
      return entries.get(keyFor(student, noteType)) || {
        content: '',
        updatedAt: '',
        lastSyncedAt: '',
        syncStatus: 'synced',
        revision: 0,
        mutationId: '',
        conflict: null
      };
    },
    setMemoByStudent(student, content, options = {}, noteType = '') {
      const key = keyFor(student, noteType);
      const previous = this.getMemoEntryByStudent(student, noteType);
      entries.set(key, {
        ...previous,
        content: String(content || ''),
        updatedAt: options.updatedAt ?? previous.updatedAt,
        lastSyncedAt: options.lastSyncedAt ?? previous.lastSyncedAt,
        syncStatus: options.syncStatus || previous.syncStatus,
        revision: Object.prototype.hasOwnProperty.call(options, 'revision') ? Number(options.revision || 0) : previous.revision,
        mutationId: Object.prototype.hasOwnProperty.call(options, 'mutationId') ? String(options.mutationId || '') : previous.mutationId,
        conflict: Object.prototype.hasOwnProperty.call(options, 'conflict') ? (options.conflict || null) : previous.conflict
      });
    },
    setMemoSaveStatus() {},
    persistObservationMemoDraft(...args) {
      return implementation(...args);
    }
  };
  win.window = win;

  vm.createContext(win);
  vm.runInContext(source, win, { filename: 'observation-memo-request-guard-common.js' });

  return {
    win,
    calls,
    entries,
    setImplementation(fn) { implementation = fn; }
  };
}

test('request guard drops an obsolete queued write before it reaches the network', async () => {
  const env = createRequestGuardSandbox();
  const student = { id: 'student-1' };

  const first = env.win.persistObservationMemoDraft(student, 'old text', { noteType: 'elementary_observation' });
  const second = env.win.persistObservationMemoDraft(student, 'latest text', { noteType: 'elementary_observation' });

  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.state, 'superseded');
  assert.equal(secondResult.state, 'synced');
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].content, 'latest text');
});

test('request guard keeps the newest local text while an older request is in flight and advances expected revision', async () => {
  const env = createRequestGuardSandbox();
  const student = { id: 'student-2' };
  let releaseFirst;
  let callCount = 0;

  env.setImplementation((target, content, options) => {
    env.calls.push({ student: { ...target }, content, options: { ...options } });
    callCount += 1;
    if (callCount === 1) {
      return new Promise(resolve => {
        releaseFirst = () => resolve({
          state: 'synced',
          student: target,
          revision: 5
        });
      });
    }
    return Promise.resolve({
      state: 'synced',
      student: target,
      revision: Number(options.expectedRevision || 0) + 1
    });
  });

  const first = env.win.persistObservationMemoDraft(student, 'first text', {
    noteType: 'elementary_observation',
    expectedRevision: 4
  });
  await settle();
  assert.equal(env.calls.length, 1);

  const second = env.win.persistObservationMemoDraft(student, 'second text', {
    noteType: 'elementary_observation',
    expectedRevision: 4
  });
  await settle();

  const pendingEntry = env.win.getMemoEntryByStudent(student, 'elementary_observation');
  assert.equal(pendingEntry.content, 'second text');
  assert.equal(pendingEntry.syncStatus, 'pending');

  releaseFirst();
  await first;
  await second;

  assert.equal(env.calls.length, 2);
  assert.equal(env.calls[1].content, 'second text');
  assert.equal(env.calls[1].options.expectedRevision, 5);
});

test('reconcile contract keeps ambiguous local drafts protected and checks immutable lineage', () => {
  const source = read(files.session);

  assert.match(source, /rpc\/olli_note_draft_version_list/);
  assert.match(source, /remoteIsHistoricalReversion/);
  assert.match(source, /'historical-reversion-conflict'/);
  assert.match(source, /'unverified-local-conflict'/);
  assert.match(source, /'ambiguous-lineage-conflict'/);
  assert.match(source, /\['pending', 'blocked'\]\.includes\(localStatus\)/);
  assert.match(source, /isIntentionalFeedbackClear\(row\)/);
});

test('feedback clear is server-first and revision guarded before local reset', () => {
  const source = read(files.feedbackClear);

  assert.match(source, /rpc\/olli_note_draft_clear_after_feedback/);
  assert.match(source, /p_expected_revision:\s*expectedRevision/);
  assert.match(source, /p_mutation_id:\s*mutationId/);

  const guardedResetStart = source.indexOf('async function safeResetElementaryMemoAfterFeedbackSave');
  const guardedResetEnd = source.indexOf('safeResetElementaryMemoAfterFeedbackSave.__olliServerFirstFeedbackClear', guardedResetStart);
  const guardedReset = source.slice(guardedResetStart, guardedResetEnd);

  const serverClear = guardedReset.indexOf('await clearObservationMemoAfterFeedbackOnServer(studentSnapshot)');
  const localReset = guardedReset.indexOf('runOriginalResetWithoutSecondServerClear');
  assert.ok(serverClear >= 0, 'server clear call must exist');
  assert.ok(localReset > serverClear, 'local reset must happen only after server clear succeeds');
});

test('version history data core owns RPC contracts and never owns platform DOM', () => {
  const core = read(files.historyCore);

  assert.match(core, /global\.ObservationMemoVersionHistoryCore = Object\.freeze/);
  assert.match(core, /rpc\('olli_note_draft_version_list'/);
  assert.match(core, /rpc\('olli_note_draft_version_restore'/);
  assert.match(core, /p_expected_revision:\s*expected/);
  assert.match(core, /error\.serverResult = response \|\| null/);

  assert.doesNotMatch(core, /document\./);
  assert.doesNotMatch(core, /querySelector/);
  assert.doesNotMatch(core, /createElement\(/);
  assert.doesNotMatch(core, /innerHTML/);
  assert.doesNotMatch(core, /\.style\./);
});

test('version history UI delegates list and restore to the data core without owning RPC payloads', () => {
  const source = read(files.history);

  assert.match(source, /const versionHistoryCore = global\.ObservationMemoVersionHistoryCore/);
  assert.match(source, /await global\.saveCurrentMemo\(\{ silent: true, status: true \}\)/);
  assert.match(source, /await waitForRequestGuardIdle\(student\)/);
  assert.match(source, /return versionHistoryCore\.list\(\{/);
  assert.match(source, /response = await versionHistoryCore\.restore\(\{/);
  assert.match(source, /expectedRevision:\s*state\.currentRevision/);
  assert.match(source, /error\?\.code === 'REVISION_CONFLICT'/);

  assert.doesNotMatch(source, /rpc\/olli_note_draft_version_list/);
  assert.doesNotMatch(source, /rpc\/olli_note_draft_version_restore/);
  assert.doesNotMatch(source, /p_session_token:/);
  assert.doesNotMatch(source, /p_expected_revision:/);
});
