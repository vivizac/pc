'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.css'),'utf8');

test('mobile Team Chat keeps teacher mentions blue and Olli mentions pink',()=>{
  assert.match(css,/--olli-talk-olli-accent:#EC70AF/);
  assert.match(css,/\.olliTalkSelectedMentionToken\{\s*color:#1687F8/);
  assert.match(css,/\.olliTalkSelectedMentionToken\.olli\{\s*color:var\(--olli-talk-olli-accent\)/);
});

test('mention prefix renders each selected mention independently so Olli can have its own color',()=>{
  assert.match(js,/token\.className = 'olliTalkSelectedMentionToken'/);
  assert.match(js,/member\?\.is_olli_ai === true/);
  assert.match(js,/token\.classList\.add\('olli'\)/);
  assert.match(js,/prefix\.replaceChildren\(\.\.\.tokens\)/);
});

test('Olli sender name above AI bubbles uses the same accent color',()=>{
  assert.match(css,/\.olliTalkBetaMessage\.ai \.olliTalkBetaSenderName\{\s*color:var\(--olli-talk-olli-accent\)/);
});
