'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'apps/mobile/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.css'),'utf8');
const js=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');

test('active mobile Team Chat composer is two rows with text first and controls second',()=>{
  assert.match(html,/class="olliTalkComposerTextRow" id="olliTalkComposerTextRow"/);
  assert.match(css,/\.olliTalkKeyboardOpen \.olliTalkComposerTextRow\{[\s\S]*grid-column:1 \/ -1;[\s\S]*grid-row:1;/);
  assert.match(css,/\.olliTalkKeyboardOpen \.olliTalkFileAddBtn\{[\s\S]*grid-row:2;/);
  assert.match(css,/\.olliTalkKeyboardOpen \.olliTalkQuickOrderBtn\{[\s\S]*grid-row:2;/);
  assert.match(css,/\.olliTalkKeyboardOpen \.olliTalkBetaSendBtn\{[\s\S]*grid-column:3;[\s\S]*grid-row:2;/);
});

test('teacher and Olli mentions are blue while multiline text starts after the mention only on line one',()=>{
  assert.match(css,/\.olliTalkSelectedMentionToken,[\s\S]*\.olliTalkSelectedMentionToken\.olli\{\s*color:#1687F8/);
  assert.match(css,/text-indent:var\(--olli-talk-mention-indent,0px\)/);
  assert.match(js,/getElementById\('olliTalkComposerTextRow'\)/);
  assert.match(js,/getBoundingClientRect\(\)\.width/);
});

test('mention menu restores the original in-flow row above the input',()=>{
  assert.match(css,/\.olliTalkMentionMenu\{[\s\S]*position:relative;[\s\S]*order:-1;[\s\S]*grid-column:1 \/ -1;[\s\S]*grid-row:1;[\s\S]*margin:0 0 9px;/);
  assert.doesNotMatch(css,/\.olliTalkMentionMenu\{[\s\S]*position:absolute;/);
  assert.match(css,/\.olliTalkComposerTextRow\{[\s\S]*grid-row:2;/);
  assert.match(css,/\.olliTalkKeyboardOpen \.olliTalkFileAddBtn\{[\s\S]*grid-row:3;/);
});

test('AI avatar label is Olli while sender name remains the Korean display name',()=>{
  assert.equal((js.match(/avatar\.textContent = 'Olli';/g)||[]).length,2);
  assert.doesNotMatch(js,/avatar\.textContent = '올리';/);
  assert.match(js,/createMessageText\('span', 'olliTalkBetaSenderName', '올리'\)/);
});

test('Team Chat system notice renders as an Olli bubble while keeping the Display P3 gradient',()=>{
  assert.match(js,/const isAi = type === 'ai' \|\| type === 'system';/);
  assert.match(js,/if \(type === 'system'\) bubble\.classList\.add\('olliTalkBetaSystemBubble'\)/);
  assert.doesNotMatch(js,/message\.className = 'olliTalkBetaSystemMessage'/);
  assert.match(css,/\.olliTalkBetaSystemBubble\{[\s\S]*color\(display-p3[\s\S]*color:#fff;/);
});

test('mobile Team Chat assets share mention-restore cache bust revision',()=>{
  assert.match(html,/olli-talk-beta\.css\?v=20261005-mention-menu-restore-1/);
  assert.match(html,/olli-talk-beta\.js\?v=20261005-mention-menu-restore-1/);
});
