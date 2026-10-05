'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.css'),'utf8');

test('mobile Team Chat keeps both teacher and Olli mentions blue',()=>{
  assert.match(css,/--olli-talk-olli-accent:#EC70AF/);
  assert.match(css,/\.olliTalkSelectedMentionToken,[\s\S]*\.olliTalkSelectedMentionToken\.olli\{\s*color:#1687F8/);
  assert.doesNotMatch(css,/\.olliTalkSelectedMentionToken\.olli\{\s*color:var\(--olli-talk-olli-accent\)/);
});

test('mention prefix still renders each selected mention independently and keeps the Olli marker',()=>{
  assert.match(js,/token\.className = 'olliTalkSelectedMentionToken'/);
  assert.match(js,/member\?\.is_olli_ai === true/);
  assert.match(js,/token\.classList\.add\('olli'\)/);
  assert.match(js,/prefix\.replaceChildren\(\.\.\.tokens\)/);
});

test('Olli avatar keeps the accent styling while its profile label is English',()=>{
  assert.match(css,/\.olliTalkBetaAiAvatar\{\s*color:var\(--olli-talk-olli-accent\)/);
  assert.doesNotMatch(css,/\.olliTalkBetaMessage\.ai \.olliTalkBetaSenderName\{\s*color:var\(--olli-talk-olli-accent\)/);
  assert.equal((js.match(/avatar\.textContent = 'Olli';/g)||[]).length,2);
});
