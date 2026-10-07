'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.css'),'utf8');
const html=fs.readFileSync(path.join(root,'apps/mobile/index.html'),'utf8');

test('Olli prompt, action UI, and completion result share one message flow container',()=>{
  const start=js.indexOf('function createOlliTalkMessageElement');
  const end=js.indexOf('\n  function createOlliTalkAssistantTypingElement',start);
  assert.ok(start>=0 && end>start);
  const body=js.slice(start,end);

  assert.match(body,/flow\.className='olliTalkBetaMessageFlow'/);
  assert.match(body,/flow\.appendChild\(bubbleRow\)/);
  assert.match(body,/if\(actionCard\) flow\.appendChild\(actionCard\)/);
  assert.match(body,/flow\.appendChild\(createOlliTalkPendingTextInputButton\(\)\)/);
  assert.match(body,/message\.appendChild\(flow\)/);
});

test('completion bubble is appended into the same Olli flow and owns the visible time',()=>{
  const start=js.indexOf('function appendOlliTalkInlineSystemResult');
  const end=js.indexOf('\n  function createOlliTalkMessageElement',start);
  assert.ok(start>=0 && end>start);
  const body=js.slice(start,end);

  assert.match(body,/const flow=getOlliTalkMessageFlow\(messageElement\)/);
  assert.match(body,/row\.className='olliTalkBetaBubbleRow olliTalkBetaInlineSystemResultRow'/);
  assert.match(body,/flow\.appendChild\(row\)/);
  assert.match(body,/moveOlliTalkMessageMetaToRow\(messageElement,row,item\?\.created_at\)/);
});

test('moving message meta to the latest flow row also refreshes the displayed time',()=>{
  const start=js.indexOf('function moveOlliTalkMessageMetaToRow');
  const end=js.indexOf('\n  function appendOlliTalkInlineSystemResult',start);
  assert.ok(start>=0 && end>start);
  const body=js.slice(start,end);

  assert.match(body,/time\.textContent=formatOlliTalkBetaMessageTime\(createdAt\)/);
  assert.match(body,/time\.style\.visibility=''/);
  assert.match(body,/time\.removeAttribute\('aria-hidden'\)/);
  assert.match(body,/row\.appendChild\(meta\)/);
});

test('shared Olli flow owns vertical spacing instead of child margins',()=>{
  assert.match(css,/\.olliTalkBetaMessageFlow\{[\s\S]*display:flex;[\s\S]*flex-direction:column;[\s\S]*gap:6px;/);
  assert.match(css,/\.olliTalkBetaMessage \.olliTalkBetaInlineSystemResult\{[\s\S]*margin-top:0;/);
  assert.match(css,/\.olliTalkBetaActionCard\{[\s\S]*margin:0;/);
  assert.match(css,/\.olliTalkBetaMessageFlow > \.olliTalkBetaPendingInput\{[\s\S]*margin:0;/);
});

test('Team Chat loads the stage-2 grouped flow assets',()=>{
  assert.match(html,/olli-talk-beta\.css\?v=20261007-bubble-flow-stage2-1/);
  assert.match(html,/olli-talk-beta\.js\?v=20261007-bubble-flow-stage2-1/);
});
