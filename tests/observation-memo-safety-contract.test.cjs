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
  session: path.join(root, 'observation-memo-session-common.js'),
  feedbackClear: path.join(root, 'observation-memo-feedback-clear-common.js'),
  feedbackGeneration: path.join(root, 'olli-record-feedback-generation.js'),
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

test('storage core is the single owner of revision-aware local memo entries', () => {
  const storage = read(files.storage);
  const save = read(files.save);

  assert.match(storage, /revision:/);
  assert.match(storage, /mutationId:/);
  assert.match(storage, /conflict:/);
  assert.match(storage, /isRemoteMemoRevisionNewerThanLocal/);

  assert.doesNotMatch(save, /global\.getMemoEntryByStudent\s*=/);
  assert.doesNotMatch(save, /global\.setMemoByStudent\s*=/);
  assert.doesNotMatch(save, /global\.setMemoSyncStateByStudent\s*=/);
  assert.match(save, /const getMemoEntrySafe = global\.getMemoEntryByStudent/);
  assert.match(save, /const setMemoSafe = global\.setMemoByStudent/);
  assert.match(save, /const setMemoSyncStateSafe = global\.setMemoSyncStateByStudent/);
});

test('revision-aware storage preserves metadata before and after save layer loads', () => {
  const storageSource = read(files.storage);
  const saveSource = read(files.save);
  const values = new Map();
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
  const document = { hidden:false, addEventListener(){} };
  const sandbox = {
    window:null,
    document,
    navigator:{ onLine:true },
    localStorage,
    console:{ warn(){} },
    addEventListener(){},
    dispatchEvent(){},
    crypto:{ randomUUID(){ return 'uuid-1'; } },
    getOlliCurrentAcademyId(){ return 'academy-a'; },
    getOlliLoginDeviceId(){ return 'device-a'; },
    isSupabaseConfigured(){ return true; },
    requireOlliAcademyId(){ return 'academy-a'; },
    async ensureStudentSavedToSupabase(student){ return student; },
    async saveStudent(){},
    async supabase(){ return { ok:true, revision:9, updated_at:'2026-09-28T00:00:00Z', content:'server' }; },
    setMemoSaveStatus(){},
    OlliStorageCore:{ SyncQueue:{ read(){ return []; }, update(){} } },
    setTimeout(){ return 1; },
    clearTimeout(){},
    CustomEvent:class { constructor(type, options){ this.type=type; this.detail=options?.detail; } }
  };
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(storageSource, sandbox, { filename:'observation-memo-storage-common.js' });
  sandbox.installObservationMemoStorage({
    getMemoKey(student, noteType='') { return student?.id ? `memo_${student.id}_${noteType}` : ''; },
    getDraftType() { return 'elementary_observation'; }
  });

  const student = { id:'student-1', name:'학생1', type:'elementary' };
  sandbox.setMemoByStudent(student, 'first', {
    updatedAt:'2026-09-28T01:00:00Z',
    lastSyncedAt:'2026-09-28T00:59:00Z',
    syncStatus:'pending',
    revision:7,
    mutationId:'m1',
    conflict:{ code:'REVISION_CONFLICT' }
  }, 'elementary_observation');

  sandbox.setMemoByStudent(student, 'second', {}, 'elementary_observation');
  const beforeSaveLayer = sandbox.getMemoEntryByStudent(student, 'elementary_observation');
  const getOwner = sandbox.getMemoEntryByStudent;
  const setOwner = sandbox.setMemoByStudent;
  const syncOwner = sandbox.setMemoSyncStateByStudent;

  vm.runInContext(saveSource, sandbox, { filename:'observation-memo-save-common.js' });

  assert.equal(sandbox.getMemoEntryByStudent, getOwner);
  assert.equal(sandbox.setMemoByStudent, setOwner);
  assert.equal(sandbox.setMemoSyncStateByStudent, syncOwner);
  assert.equal(beforeSaveLayer.revision, 7);
  assert.equal(beforeSaveLayer.mutationId, 'm1');
  assert.equal(beforeSaveLayer.conflict.code, 'REVISION_CONFLICT');
});

test('storage core no longer owns legacy server draft writes', () => {
  const storage = read(files.storage);
  const save = read(files.save);

  assert.doesNotMatch(storage, /async function saveStudentNoteDraftToSupabase/);
  assert.doesNotMatch(storage, /async function clearStudentNoteDraftFromSupabase/);
  assert.doesNotMatch(storage, /saveOlliData\('student_note_draft'/);

  assert.match(save, /global\.saveStudentNoteDraftToSupabase = safeSaveNote/);
  assert.match(save, /global\.clearStudentNoteDraftFromSupabase = clearObservationMemoDraftWithGuard/);
  assert.match(save, /rpc\/olli_note_draft_save_cas/);
});

test('PC observation editor owns autosave input blur and composition-end events', () => {
  const common = read(files.common);
  const pcCore = read(files.pcCore);

  assert.match(pcCore, /__olliObservationMemoPcAutosaveLifecycleBound/);
  assert.match(pcCore, /addEventListener\('input'/);
  assert.match(pcCore, /event\.isComposing/);
  assert.match(pcCore, /handleMemoPauseAutoSaveInput\(event\.target\)/);
  assert.match(pcCore, /addEventListener\('compositionend'/);
  assert.match(pcCore, /addEventListener\('blur'/);
  assert.match(pcCore, /handleMemoPauseAutoSaveBlur\(event\.target\)/);

  assert.match(common, /const OLLI_MEMO_SERVER_AUTOSAVE_DELAY = 1500/);
  assert.doesNotMatch(common, /setupMemoPauseAutoSaveBindings/);
  assert.doesNotMatch(common, /bindPauseAutoSaveForMemoInput/);
  assert.match(common, /persistObservationMemoInputLocally\(target\)/);
  assert.match(common, /syncStatus: 'pending'/);
  assert.match(common, /saveObservationMemoServerSnapshot\(\{ status: true \}\)/);
});

test('observation view sync is platform-owned while shared common keeps only orchestration entry points', () => {
  const common = read(files.common);
  const pcCore = read(files.pcCore);

  assert.doesNotMatch(common, /function applyReconciledObservationMemoDraft\(/);
  assert.doesNotMatch(common, /function isObservationMemoScreenActive\(/);
  assert.doesNotMatch(common, /function refreshCurrentObservationMemoFromServer\(/);
  assert.doesNotMatch(common, /function requestObservationMemoCrossDeviceRefresh\(/);

  assert.match(pcCore, /function applyReconciledObservationMemoDraft\(/);
  assert.match(pcCore, /reason: 'user-edited-during-sync'/);
  assert.match(pcCore, /function isObservationMemoScreenActive\(/);
  assert.match(pcCore, /function refreshCurrentObservationMemoFromServer\(/);
  assert.match(pcCore, /function requestObservationMemoCrossDeviceRefresh\(/);

  assert.match(common, /applyReconciledObservationMemoDraft\(view\.student, memoEditor, result\)/);
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


test('save core is the final owner of same-device request ordering', () => {
  const save = read(files.save);
  const pcCore = read(files.pcCore);

  assert.match(save, /__olliObservationMemoRequestGuardIntegrated = true/);
  assert.match(save, /const requestChains = new Map\(\)/);
  assert.match(save, /const latestRequests = new Map\(\)/);
  assert.match(save, /state: 'superseded'/);
  assert.match(save, /global\.persistObservationMemoDraft = persistObservationMemoDraft/);
  assert.match(save, /global\.clearStudentNoteDraftFromSupabase = clearObservationMemoDraftWithGuard/);
  assert.match(save, /global\.protectObservationMemoLocalDraft = protectObservationMemoLocalDraft/);
  assert.match(save, /global\.getObservationMemoRequestGuardState = getObservationMemoRequestGuardState/);

  assert.doesNotMatch(pcCore, /observation-memo-request-guard-common\.js/);
});

function createIntegratedSaveGuardSandbox() {
  const source = read(files.save);
  const values = new Map([
    ['olli_current_academy_id', 'academy-a'],
    ['olli_account_session_token_v1', 'session-a'],
    ['olli_device_id_v1', 'device-a']
  ]);
  const entries = new Map();
  const calls = [];
  let uuid = 0;
  let supabaseImpl = async (method, path, body) => {
    calls.push({ method, path, body:{ ...body } });
    return {
      ok:true,
      revision:Number(body.p_expected_revision || 0) + 1,
      updated_at:'2026-09-28T00:00:00Z',
      content:String(body.p_content || '')
    };
  };

  const keyFor = (student, noteType='') => String(student?.id || '') + ':' + String(noteType || '');
  const getMemoEntryByStudent = (student, noteType='') => entries.get(keyFor(student, noteType)) || {
    content:'', updatedAt:'', lastSyncedAt:'', syncStatus:'synced', revision:0, mutationId:'', conflict:null
  };
  const setMemoByStudent = (student, content, options={}, noteType='') => {
    const key = keyFor(student, noteType);
    const previous = getMemoEntryByStudent(student, noteType);
    entries.set(key, {
      ...previous,
      content:String(content ?? ''),
      updatedAt:Object.prototype.hasOwnProperty.call(options, 'updatedAt') ? String(options.updatedAt || '') : previous.updatedAt,
      lastSyncedAt:Object.prototype.hasOwnProperty.call(options, 'lastSyncedAt') ? String(options.lastSyncedAt || '') : previous.lastSyncedAt,
      syncStatus:options.syncStatus || previous.syncStatus || 'local',
      revision:Object.prototype.hasOwnProperty.call(options, 'revision') ? Number(options.revision || 0) : Number(previous.revision || 0),
      mutationId:Object.prototype.hasOwnProperty.call(options, 'mutationId') ? String(options.mutationId || '') : String(previous.mutationId || ''),
      conflict:Object.prototype.hasOwnProperty.call(options, 'conflict') ? (options.conflict || null) : (previous.conflict || null)
    });
  };
  const setMemoSyncStateByStudent = (student, syncState={}, noteType='') => {
    const previous = getMemoEntryByStudent(student, noteType);
    setMemoByStudent(student, previous.content, {
      updatedAt:Object.prototype.hasOwnProperty.call(syncState, 'updatedAt') ? syncState.updatedAt : previous.updatedAt,
      lastSyncedAt:Object.prototype.hasOwnProperty.call(syncState, 'lastSyncedAt') ? syncState.lastSyncedAt : previous.lastSyncedAt,
      syncStatus:syncState.syncStatus || previous.syncStatus,
      revision:Object.prototype.hasOwnProperty.call(syncState, 'revision') ? syncState.revision : previous.revision,
      mutationId:Object.prototype.hasOwnProperty.call(syncState, 'mutationId') ? syncState.mutationId : previous.mutationId,
      conflict:Object.prototype.hasOwnProperty.call(syncState, 'conflict') ? syncState.conflict : previous.conflict
    }, noteType);
  };

  const win = {
    window:null,
    document:{ hidden:false, addEventListener(){} },
    navigator:{ onLine:true },
    localStorage:{
      getItem:key => values.get(key) || null,
      setItem:(key, value) => values.set(key, String(value))
    },
    console:{ warn(){} },
    crypto:{ randomUUID:() => 'uuid-' + (++uuid) },
    getOlliCurrentAcademyId:() => 'academy-a',
    getOlliLoginDeviceId:() => 'device-a',
    getSupabaseNoteDraftType:() => 'elementary_observation',
    getMemoEntryByStudent,
    setMemoByStudent,
    setMemoSyncStateByStudent,
    isRemoteMemoRevisionNewerThanLocal:(remote, local) => Number(remote || 0) > Number(local || 0),
    isSupabaseConfigured:() => true,
    requireOlliAcademyId:() => 'academy-a',
    ensureStudentSavedToSupabase:async student => student,
    saveStudent:async () => {},
    supabase(...args) { return supabaseImpl(...args); },
    setMemoSaveStatus(){},
    findStudentById(id) { return { id, type:'elementary', academy_id:'academy-a' }; },
    OlliStorageCore:{ SyncQueue:{ read(){ return []; }, update(){} } },
    addEventListener(){},
    dispatchEvent(){},
    CustomEvent:class { constructor(type, options){ this.type=type; this.detail=options?.detail; } },
    setTimeout(){ return 1; },
    clearTimeout(){}
  };
  win.window = win;

  vm.createContext(win);
  vm.runInContext(source, win, { filename:'observation-memo-save-common.js' });

  return {
    win,
    calls,
    setSupabase(fn) { supabaseImpl = fn; }
  };
}

test('integrated save guard drops obsolete queued writes before network', async () => {
  const env = createIntegratedSaveGuardSandbox();
  const student = { id:'student-guard-1', name:'학생1', type:'elementary' };

  const first = env.win.persistObservationMemoDraft(student, 'old text', { noteType:'elementary_observation' });
  const second = env.win.persistObservationMemoDraft(student, 'latest text', { noteType:'elementary_observation' });
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.state, 'superseded');
  assert.equal(secondResult.state, 'synced');
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].body.p_content, 'latest text');
});

test('integrated save guard advances the next request to the confirmed server revision', async () => {
  const env = createIntegratedSaveGuardSandbox();
  let releaseFirst;
  let callCount = 0;

  env.setSupabase((method, path, body) => {
    env.calls.push({ method, path, body:{ ...body } });
    callCount += 1;
    if (callCount === 1) {
      return new Promise(resolve => {
        releaseFirst = () => resolve({
          ok:true,
          revision:5,
          updated_at:'2026-09-28T00:00:01Z',
          content:String(body.p_content || '')
        });
      });
    }
    return Promise.resolve({
      ok:true,
      revision:Number(body.p_expected_revision || 0) + 1,
      updated_at:'2026-09-28T00:00:02Z',
      content:String(body.p_content || '')
    });
  });

  const student = { id:'student-guard-2', name:'학생2', type:'elementary' };
  env.win.setMemoByStudent(student, 'base', { syncStatus:'synced', revision:4 }, 'elementary_observation');

  const first = env.win.persistObservationMemoDraft(student, 'first text', {
    noteType:'elementary_observation',
    expectedRevision:4
  });
  await settle();

  const second = env.win.persistObservationMemoDraft(student, 'second text', {
    noteType:'elementary_observation',
    expectedRevision:4
  });
  await settle();

  const pending = env.win.getMemoEntryByStudent(student, 'elementary_observation');
  assert.equal(pending.content, 'second text');
  assert.equal(pending.syncStatus, 'pending');

  releaseFirst();
  await first;
  await second;

  assert.equal(env.calls.length, 2);
  assert.equal(env.calls[1].body.p_content, 'second text');
  assert.equal(env.calls[1].body.p_expected_revision, 5);
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

test('feedback-clear core owns only revision-protected server clear', () => {
  const core = read(files.feedbackClear);

  assert.match(core, /global\.ObservationMemoFeedbackClearCore = api/);
  assert.match(core, /const clearInFlight = new Map\(\)/);
  assert.match(core, /rpc\/olli_note_draft_clear_after_feedback/);
  assert.match(core, /p_expected_revision:\s*expectedRevision/);
  assert.match(core, /p_mutation_id:\s*mutationId/);
  assert.match(core, /String\(response\.content \|\| ''\) !== ''/);

  assert.doesNotMatch(core, /resetElementaryMemoAfterFeedbackSave/);
  assert.doesNotMatch(core, /autoSaveMemoFeedback/);
  assert.doesNotMatch(core, /reconcileObservationMemoDraft/);
  assert.doesNotMatch(core, /document\./);
  assert.doesNotMatch(core, /querySelector/);
});

test('feedback-clear core coalesces concurrent clears for the same memo', async () => {
  const coreSource = read(files.feedbackClear);
  const values = new Map([
    ['olli_current_academy_id', 'academy-a'],
    ['olli_account_session_token_v1', 'session-a'],
    ['olli_device_id_v1', 'device-a']
  ]);
  let calls = 0;
  let release;
  const server = new Promise(resolve => {
    release = () => resolve({
      ok:true,
      content:'',
      revision:8,
      updated_at:'2026-09-28T03:00:00Z',
      mutation_id:'feedback_clear_server'
    });
  });
  const win = {
    window:null,
    localStorage:{
      getItem:key => values.get(key) || null,
      setItem:(key, value) => values.set(key, String(value))
    },
    crypto:{ randomUUID:() => 'uuid-clear' },
    getOlliCurrentAcademyId:() => 'academy-a',
    getOlliLoginDeviceId:() => 'device-a',
    getMemoEntryByStudent:() => ({ revision:7, content:'memo', syncStatus:'synced' }),
    supabase:async () => {
      calls += 1;
      return server;
    }
  };
  win.window = win;

  vm.createContext(win);
  vm.runInContext(coreSource, win, { filename:'observation-memo-feedback-clear-common.js' });

  const student = { id:'student-1' };
  const first = win.ObservationMemoFeedbackClearCore.clearAfterFeedback(student);
  const second = win.ObservationMemoFeedbackClearCore.clearAfterFeedback(student);
  await settle();
  assert.equal(calls, 1);

  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.revision, 8);
  assert.equal(secondResult.revision, 8);
  assert.equal(calls, 1);
});

test('PC feedback reset waits for confirmed server clear before local memo reset', () => {
  const source = read(files.feedbackGeneration);
  const start = source.indexOf('async function resetElementaryMemoAfterFeedbackSave');
  const end = source.indexOf('function getCurrentMemoStudentName()', start);
  const reset = source.slice(start, end);

  const serverClear = reset.indexOf("await clearCore.clearAfterFeedback(studentSnapshot, 'elementary_observation')");
  const localClear = reset.indexOf("clearMemoByStudent(currentMemoStudent, 'elementary_observation')");
  assert.ok(serverClear >= 0, 'server clear call must exist');
  assert.ok(localClear > serverClear, 'local clear must happen only after server clear succeeds');
  assert.match(reset, /return \{ state: 'clear_failed', student: studentSnapshot, error \}/);
  assert.doesNotMatch(reset, /clearStudentNoteDraftFromSupabase/);
});

test('session reconcile handles intentional feedback clear without a runtime wrapper', () => {
  const session = read(files.session);
  const clearCore = read(files.feedbackClear);

  assert.match(session, /isIntentionalFeedbackClear\(row\)/);
  assert.match(session, /'remote-feedback-clear'/);
  assert.doesNotMatch(clearCore, /global\.reconcileObservationMemoDraft\s*=/);
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
