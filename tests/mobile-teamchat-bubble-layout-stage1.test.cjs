'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const css=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.css'),'utf8');
const js=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const html=fs.readFileSync(path.join(root,'apps/mobile/index.html'),'utf8');

test('Team Chat text wraps at the character that exceeds the bubble width',()=>{
  const base=css.match(/#olliTalkBetaScreen \.olliTalkBetaBubble\{([\s\S]*?)\}/)?.[1] || '';
  assert.match(base,/max-width:min\(74vw, 520px\)/);
  assert.match(base,/overflow-wrap:anywhere/);
  assert.match(base,/word-break:break-all/);
  assert.doesNotMatch(base,/word-break:keep-all/);

  const outgoing=css.match(/#olliTalkBetaScreen \.olliTalkBetaMessage\.outgoing \.olliTalkBetaBubble\{([\s\S]*?)\}/)?.[1] || '';
  assert.match(outgoing,/max-width:min\(64vw, 450px\)/);
});

test('grouped message spacing stays 6px and inline completion delegates spacing to the shared flow',()=>{
  assert.match(css,/\.olliTalkBetaMessageStack\{[\s\S]*?gap:6px;/);
  assert.match(css,/\.olliTalkBetaMessageFlow\{[\s\S]*?gap:6px;/);
  assert.match(css,/\.olliTalkBetaMessage \.olliTalkBetaInlineSystemResult\{[\s\S]*?margin-top:0;/);
});

test('sender name is smaller and sits slightly lower',()=>{
  assert.match(
    css,
    /\.olliTalkBetaIncomingLayout \.olliTalkBetaSenderName\{[\s\S]*?font-size:calc\(10px \* var\(--olli-text-scale, 1\)\);[\s\S]*?transform:translateY\(1px\);/
  );
});

test('group timestamp is synchronized so only the last message stays visible',()=>{
  const start=js.indexOf('function syncOlliTalkRenderedGroupTime(group){');
  const end=js.indexOf('\n  function createOlliTalkMessageGroupElement',start);
  assert.ok(start>=0 && end>start);
  const body=js.slice(start,end);
  assert.match(body,/querySelectorAll\('\.olliTalkBetaMessage\[data-message-id\]'\)/);
  assert.match(body,/const isLast=index===messages\.length-1/);
  assert.match(body,/time\.style\.visibility=isLast \? '' : 'hidden'/);
  assert.match(body,/time\.removeAttribute\('aria-hidden'\)/);
  assert.match(js,/stack\.appendChild\(message\);[\s\S]{0,100}syncOlliTalkRenderedGroupTime\(group\)/);
});

test('mobile Team Chat loads the stage-2 grouped flow assets',()=>{
  assert.match(html,/olli-talk-beta\.css\?v=20261007-bubble-flow-stage2-1/);
  assert.match(html,/olli-talk-beta\.js\?v=20261007-bubble-flow-stage2-1/);
});
