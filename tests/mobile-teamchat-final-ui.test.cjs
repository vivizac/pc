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

test('mentions keep teacher blue and Olli pink while multiline text starts after the mention only on line one',()=>{
  assert.match(css,/\.olliTalkSelectedMentionToken\{\s*color:#1687F8/);
  assert.match(css,/\.olliTalkSelectedMentionToken\.olli\{\s*color:var\(--olli-talk-olli-accent\)/);
  assert.match(css,/text-indent:var\(--olli-talk-mention-indent,0px\)/);
  assert.match(js,/getElementById\('olliTalkComposerTextRow'\)/);
  assert.match(js,/getBoundingClientRect\(\)\.width/);
});

test('AI avatar says 올리 in pink and sender name returns to inherited original color',()=>{
  assert.equal((js.match(/avatar\.textContent = '올리';/g)||[]).length,2);
  assert.doesNotMatch(js,/avatar\.textContent = 'Olli';/);
  assert.match(css,/\.olliTalkBetaAiAvatar\{\s*color:var\(--olli-talk-olli-accent\)/);
  assert.doesNotMatch(css,/\.olliTalkBetaMessage\.ai \.olliTalkBetaSenderName\{\s*color:var\(--olli-talk-olli-accent\)/);
});

test('pink Team Chat system pill uses white text',()=>{
  assert.match(css,/\.olliTalkBetaSystemMessage\{[\s\S]*background:#EC70AF;[\s\S]*color:#fff;/);
});

test('mobile Team Chat assets share final cache bust revision',()=>{
  assert.match(html,/olli-talk-beta\.css\?v=20261005-teamchat-final-ui-1/);
  assert.match(html,/olli-talk-beta\.js\?v=20261005-teamchat-final-ui-1/);
});
