const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = {
  storage: path.join(root, 'observation-memo-storage-common.js'),
  save: path.join(root, 'observation-memo-save-common.js'),
  requestGuard: path.join(root, 'observation-memo-request-guard-common.js'),
  session: path.join(root, 'observation-memo-session-common.js'),
  feedbackClear: path.join(root, 'observation-memo-feedback-clear-common.js'),
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

test('version history UI delegates list and restore to the data core without changing CAS expectations', () => {
  const source = read(files.history);

  assert.match(source, /global\.ObservationMemoVersionHistoryCore = versionHistoryCore/);
  assert.match(source, /await global\.saveCurrentMemo\(\{ silent: true, status: true \}\)/);
  assert.match(source, /await waitForRequestGuardIdle\(student\)/);
  assert.match(source, /return versionHistoryCore\.list\(\{/);
  assert.match(source, /response = await versionHistoryCore\.restore\(\{/);
  assert.match(source, /expectedRevision:\s*state\.currentRevision/);

  assert.match(source, /rpc\('olli_note_draft_version_list'/);
  assert.match(source, /rpc\('olli_note_draft_version_restore'/);
  assert.match(source, /p_expected_revision:\s*expected/);
  assert.match(source, /error\.serverResult = response \|\| null/);
  assert.match(source, /error\?\.code === 'REVISION_CONFLICT'/);
});
