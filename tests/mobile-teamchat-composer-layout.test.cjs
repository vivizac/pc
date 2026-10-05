'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'apps/mobile/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.css'),'utf8');
const js=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');

test('mobile Team Chat active composer separates text row from action row',()=>{
  assert.match(html,/class="olliTalkComposerTextRow" id="olliTalkComposerTextRow"/);
  assert.match(css,/\.olliTalkKeyboardOpen \.olliTalkComposerTextRow\{[\s\S]*grid-column:1 \/ -1;[\s\S]*grid-row:1;/);
  assert.match(css,/\.olliTalkKeyboardOpen \.olliTalkFileAddBtn\{[\s\S]*grid-row:2;/);
  assert.match(css,/\.olliTalkKeyboardOpen \.olliTalkQuickOrderBtn\{[\s\S]*grid-row:2;/);
  assert.match(css,/\.olliTalkKeyboardOpen \.olliTalkBetaSendBtn\{[\s\S]*grid-column:3;[\s\S]*grid-row:2;/);
});

test('mobile Team Chat mention occupies the first visual text line and later lines can start at the left edge',()=>{
  assert.match(css,/\.olliTalkSelectedMentionPrefix\{[\s\S]*position:absolute;[\s\S]*font-size:calc\(15px/);
  assert.match(css,/\.olliTalkBetaInput\{[\s\S]*font-size:calc\(15px[\s\S]*text-indent:var\(--olli-talk-mention-indent,0px\)/);
  assert.match(js,/getElementById\('olliTalkComposerTextRow'\)/);
  assert.match(js,/getBoundingClientRect\(\)\.width/);
  assert.match(js,/mentionWidth \+ 8/);
  assert.match(js,/--olli-talk-mention-indent', '0px'/);
});

test('mobile Team Chat composer assets use the same cache-bust revision',()=>{
  assert.match(html,/olli-talk-beta\.css\?v=20261005-composer-two-row-1/);
  assert.match(html,/olli-talk-beta\.js\?v=20261005-composer-two-row-1/);
});
