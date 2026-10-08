'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('olli-talk-beta.js','utf8');
const html = fs.readFileSync('index.html','utf8');
const start = source.indexOf('  function stepOlliTalkKeyboardVisualController(timestamp){');
const end = source.indexOf('  function ensureOlliTalkKeyboardVisualController(){',start);
const stepSource = source.slice(start,end);

function runFollowFrames(keyboardOpen) {
  assert.ok(start > 0 && end > start);
  const declaration = source.match(/const OLLI_TALK_KEYBOARD_FOLLOW_TAU_MS = \d+;[\s\S]*?const OLLI_TALK_KEYBOARD_OPEN_FOLLOW_TAU_MS = \d+;/);
  assert.ok(declaration, 'read the real kinetic constants');
  return new Function('keyboardOpen', [
    declaration[0],
    'let olliTalkKeyboardVisualRaf = 0;',
    'let olliTalkKeyboardVisualLastTs = 0;',
    'let olliTalkComposerVisualOffsetY = -100;',
    'let olliTalkMessagesVisualOffsetY = -100;',
    'const getScreen = () => ({ classList:{ contains(name){ return keyboardOpen && name === "olliTalkKeyboardOpen"; } } });',
    'const prefersReducedOlliTalkMotion = () => false;',
    'const applyOlliTalkKeyboardVisualOffsets = () => {};',
    'const requestAnimationFrame = () => 1;',
    stepSource,
    'stepOlliTalkKeyboardVisualController(16);',
    'stepOlliTalkKeyboardVisualController(32);',
    'return {composer:olliTalkComposerVisualOffsetY,messages:olliTalkMessagesVisualOffsetY};'
  ].join('\n'))(keyboardOpen);
}

test('opening follows more gently without changing the closing response',()=>{
  assert.match(source,/const OLLI_TALK_KEYBOARD_FOLLOW_TAU_MS = 32;/);
  assert.match(source,/const OLLI_TALK_KEYBOARD_OPEN_FOLLOW_TAU_MS = 44;/);
  const opening = runFollowFrames(true);
  const closing = runFollowFrames(false);
  assert.ok(opening.composer < closing.composer, 'opening offsets should settle more slowly');
  assert.ok(opening.composer > -100, 'opening still advances');
  assert.equal(opening.composer,opening.messages, 'composer and message movement must match exactly');
  assert.equal(closing.composer,closing.messages, 'closing remains synchronized');
});

test('the source still uses a single FLIP controller without duplicating scrolling',()=>{
  assert.match(source,/const follow = 1 - Math\.exp\(-dt \/ followTau\);/);
  assert.match(source,/olliTalkComposerVisualOffsetY \+= \(0 - olliTalkComposerVisualOffsetY\) \* follow;/);
  assert.match(source,/olliTalkMessagesVisualOffsetY \+= \(0 - olliTalkMessagesVisualOffsetY\) \* follow;/);
  assert.match(source,/if \(prefersReducedOlliTalkMotion\(\)\) \{[\s\S]*?olliTalkKeyboardVisualLastTs = 0;/);
  assert.match(source,/\/\/ The latest-message anchor alone owns scrollTop\./);
  assert.match(html,/olli-talk-beta\.js\?v=20261008-keyboard-close-return-1/);
});
