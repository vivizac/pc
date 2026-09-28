const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'olli-observation-roster-phone.js'), 'utf8');
const start = source.indexOf('function createObservationMemoSnapshot(editor) {');
const end = source.indexOf('function flushObservationMemoBeforeDone()', start);
const historySource = source.slice(start, end);

function makeHarness(initial = '') {
  const buttons = new Map();
  const editor = {
    value: initial, selectionStart: initial.length, selectionEnd: initial.length, readOnly: false, disabled: false,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    dispatchEvent() { return true; }, focus() {}
  };
  const context = {
    editor, console,
    Event: class Event { constructor(type, init = {}) { this.type = type; this.bubbles = !!init.bubbles; } },
    requestAnimationFrame(fn) { fn(); return 1; },
    resizeObservationMemoEditorToContent() {}, scheduleObservationMemoCaretVisible() {},
    getObservationMemoStudentId() { return 'student-1'; },
    getObservationMemoEditor() { return editor; }, isObservationMemoEditorView() { return true; },
    document: { getElementById(id) {
      if (id === 'memoEditor') return editor;
      if (!buttons.has(id)) buttons.set(id, { disabled: false, setAttribute() {} });
      return buttons.get(id);
    } }
  };
  const prefix = `let observationMemoUndoStack = []; let observationMemoRedoStack = []; let observationMemoHistoryStudentId = ''; let observationMemoCompositionSnapshot = null; let observationMemoHangulTransaction = null; let observationMemoPendingHangulBeforeInput = null; let observationMemoIsComposing = false; const OBSERVATION_MEMO_HISTORY_LIMIT = 100;`;
  const suffix = `globalThis.historyApi = { createObservationMemoSnapshot, pushObservationMemoUndoSnapshot, resetObservationMemoHistory, undoObservationMemoEdit, redoObservationMemoEdit, recordObservationMemoCompositionStep };`;
  vm.runInNewContext(prefix + historySource + suffix, context);
  return { editor, api: context.historyApi };
}

function compose(editor, api, value) {
  const before = api.createObservationMemoSnapshot(editor);
  editor.value = value;
  editor.selectionStart = value.length;
  editor.selectionEnd = value.length;
  const after = api.createObservationMemoSnapshot(editor);
  api.recordObservationMemoCompositionStep(before, after);
}

test('one continuously composed Hangul syllable undoes as one unit without resurrecting jamo states', () => {
  const { editor, api } = makeHarness();
  api.resetObservationMemoHistory();
  compose(editor, api, 'ㅇ');
  compose(editor, api, '아');
  compose(editor, api, '안');
  api.undoObservationMemoEdit();
  assert.equal(editor.value, '');
  api.undoObservationMemoEdit();
  assert.equal(editor.value, '');
});

test('standalone consonants remain separate undo units', () => {
  const { editor, api } = makeHarness();
  api.resetObservationMemoHistory();
  compose(editor, api, 'ㅇ');
  compose(editor, api, 'ㅇㅇ');
  compose(editor, api, 'ㅇㅇㅇ');
  api.undoObservationMemoEdit(); assert.equal(editor.value, 'ㅇㅇ');
  api.undoObservationMemoEdit(); assert.equal(editor.value, 'ㅇ');
  api.undoObservationMemoEdit(); assert.equal(editor.value, '');
});

test('Hangul composition after an existing prefix returns to the prefix in one undo', () => {
  const { editor, api } = makeHarness('abc');
  api.resetObservationMemoHistory();
  compose(editor, api, 'abcㅇ');
  compose(editor, api, 'abc아');
  compose(editor, api, 'abc안');
  api.undoObservationMemoEdit();
  assert.equal(editor.value, 'abc');
});

test('a fresh edit after undo clears redo instead of toggling removed text back', () => {
  const { editor, api } = makeHarness();
  api.resetObservationMemoHistory();
  const edit = value => {
    api.pushObservationMemoUndoSnapshot(api.createObservationMemoSnapshot(editor), true);
    editor.value = value; editor.selectionStart = value.length; editor.selectionEnd = value.length;
  };
  edit('A'); edit('AB'); edit('ABC');
  api.undoObservationMemoEdit(); assert.equal(editor.value, 'AB');
  edit('ABX');
  api.redoObservationMemoEdit(); assert.equal(editor.value, 'ABX');
});

test('IME source owns Hangul transaction coalescing and replay uses a neutral input event', () => {
  assert.match(source, /observationMemoHangulTransaction/);
  assert.match(source, /recordObservationMemoCompositionStep/);
  assert.match(source, /observationMemoPendingHangulBeforeInput/);
  assert.match(source, /document\.addEventListener\('beforeinput'/);
  const dispatchStart = source.indexOf('function dispatchObservationMemoHistoryInput');
  const applyStart = source.indexOf('function applyObservationMemoSnapshot', dispatchStart);
  const dispatchSource = source.slice(dispatchStart, applyStart);
  assert.doesNotMatch(dispatchSource, /InputEvent/);
  assert.match(dispatchSource, /new Event\('input'/);
});
