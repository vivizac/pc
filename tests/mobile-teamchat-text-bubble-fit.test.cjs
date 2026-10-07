'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const html=fs.readFileSync(path.join(root,'apps/mobile/index.html'),'utf8');

test('plain Team Chat text bubbles are marked for rendered-line fitting only',()=>{
  const start=js.indexOf('function createOlliTalkMessageBubble');
  const end=js.indexOf('\n  function getOlliTalkRenderedTextLines',start);
  assert.ok(start>=0 && end>start);
  const body=js.slice(start,end);

  assert.match(body,/if\(!url\) \{[\s\S]*bubble\.classList\.add\('olliTalkBetaTextBubble'\)[\s\S]*bubble\.textContent = text/);
  assert.doesNotMatch(body,/olliTalkBetaAttachmentBubble[\s\S]*olliTalkBetaTextBubble/);
  assert.doesNotMatch(body,/olliTalkBetaLinkBubble[\s\S]*olliTalkBetaTextBubble/);
});

test('wrapped text bubble width follows the longest rendered line without adding a line',()=>{
  const start=js.indexOf('function fitOlliTalkTextBubbleWidth');
  const end=js.indexOf('\n  function fitOlliTalkTextBubbles',start);
  assert.ok(start>=0 && end>start);
  const body=js.slice(start,end);

  assert.match(body,/bubble\.style\.removeProperty\('width'\)/);
  assert.match(body,/const beforeLines=getOlliTalkRenderedTextLines\(bubble\)/);
  assert.match(body,/if\(beforeLines\.length<2\) return false/);
  assert.match(body,/const longestLine=Math\.max\(\.\.\.beforeLines\.map/);
  assert.match(body,/longestLine \+ paddingX \+ borderX \+ 2/);
  assert.match(body,/nextLines\.length<=baselineLineCount/);
  assert.match(body,/nextHeight<=baselineHeight\+1\.5/);
  assert.match(body,/bubble\.style\.removeProperty\('width'\);[\s\S]*return false/);
});

test('special system and typing bubbles are excluded from text width fitting',()=>{
  const start=js.indexOf('function fitOlliTalkTextBubbleWidth');
  const end=js.indexOf('\n  function fitOlliTalkTextBubbles',start);
  const body=js.slice(start,end);
  assert.match(body,/bubble\.classList\.contains\('olliTalkBetaSystemBubble'\)/);
  assert.match(body,/bubble\.classList\.contains\('olliTalkBetaTypingBubble'\)/);
});

test('text bubble fitting runs after full render and connected incremental append',()=>{
  assert.match(js,/stack\.appendChild\(message\);[\s\S]{0,120}if\(message\.isConnected\) fitOlliTalkTextBubbles\(message\)/);
  assert.match(js,/chatArea\.replaceChildren\(list\);[\s\S]{0,120}fitOlliTalkTextBubbles\(list\)/);
  assert.match(js,/document\.fonts\?\.ready\?\.then/);
  assert.match(html,/olli-talk-beta\.js\?v=20261007-text-bubble-fit-1/);
});
