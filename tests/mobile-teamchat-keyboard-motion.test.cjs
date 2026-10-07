'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.css'),'utf8');
const html=fs.readFileSync(path.join(root,'apps/mobile/index.html'),'utf8');

test('Team Chat keyboard motion is visual-only and does not replace focus ownership',()=>{
  assert.match(js,/function beginOlliTalkKeyboardMotion\(\)[\s\S]*classList\.add\('olliTalkKeyboardMotion'\)/);
  assert.match(js,/input\.addEventListener\('focus',[\s\S]*beginOlliTalkKeyboardMotion\(\)[\s\S]*syncViewport\(\)/);
  assert.match(js,/input\.addEventListener\('blur',[\s\S]*beginOlliTalkKeyboardMotion\(\)[\s\S]*syncViewport\(\)/);
  assert.match(js,/visualViewport\.addEventListener\('resize',[\s\S]*continueOlliTalkKeyboardMotion\(\)[\s\S]*syncViewport\(\)/);
  assert.match(js,/window\.OlliMobileKeyboardActivation/);
});

test('message and composer motion use scoped easing only while keyboard is transitioning',()=>{
  assert.match(css,/#olliTalkBetaScreen\.olliTalkKeyboardMotion \.olliTalkBetaChatArea\{[\s\S]*transition:padding-bottom 220ms cubic-bezier\(\.22,\.61,\.36,1\);[\s\S]*scroll-behavior:smooth/);
  assert.match(css,/#olliTalkBetaScreen\.olliTalkKeyboardMotion \.olliTalkBetaComposerLayer\{[\s\S]*top 220ms[\s\S]*height 220ms/);
  assert.match(css,/#olliTalkBetaScreen\.olliTalkKeyboardMotion \.olliTalkBetaComposerWrap\{[\s\S]*transition:bottom 220ms/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);
});

test('ordinary chat scrolling keeps the existing no-transition baseline',()=>{
  assert.match(css,/#olliTalkBetaScreen \.olliTalkBetaChatArea\{[\s\S]*transition:none;/);
  assert.match(css,/#olliTalkBetaScreen \.olliTalkBetaComposerWrap\{[\s\S]*transition:none;/);
});

test('motion assets are cache-busted',()=>{
  assert.match(html,/olli-talk-beta\.css\?v=20261008-keyboard-motion-1/);
  assert.match(html,/olli-talk-beta\.js\?v=20261008-keyboard-motion-1/);
});
