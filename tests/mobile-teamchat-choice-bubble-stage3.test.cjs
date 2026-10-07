'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.css'),'utf8');
const html=fs.readFileSync(path.join(root,'apps/mobile/index.html'),'utf8');

test('completed structured choices render as ordinary Olli bubbles, not disabled buttons',()=>{
  const start=js.indexOf('function createOlliTalkActionCard(action){');
  const end=js.indexOf('\n  function getOlliTalkReplyTargetIds',start);
  assert.ok(start>=0 && end>start);
  const body=js.slice(start,end);

  assert.match(body,/status==='completed' && isOlliTalkChoiceActionType/);
  assert.match(body,/selectedRow\.className='olliTalkBetaBubbleRow olliTalkBetaSelectedChoiceRow'/);
  assert.match(body,/olliTalkBetaBubble olliTalkBetaSelectedChoiceBubble/);
  assert.match(body,/getOlliTalkSelectedChoiceButtonLabel\(action\)/);
  assert.doesNotMatch(body,/document\.createElement\('button'\)[\s\S]{0,180}selectedChoice/);
});

test('pending choice controls stay real buttons until the user selects one',()=>{
  const start=js.indexOf('function createOlliTalkActionCard(action){');
  const end=js.indexOf('\n  function getOlliTalkReplyTargetIds',start);
  const body=js.slice(start,end);

  assert.match(body,/button\.className='olliTalkBetaActionButton primary'/);
  assert.match(body,/button\.addEventListener\('click'/);
  assert.match(body,/appendOlliTalkStructuredDateChoiceButtons\(card,action\)/);
  assert.match(body,/appendOlliTalkStructuredTimeChoiceButtons\(card,action\)/);
});

test('selected choice labels remove the trailing selection word',()=>{
  const start=js.indexOf('function getOlliTalkSelectedChoiceButtonLabel');
  const end=js.indexOf('\n  function getOlliTalkActionStatusLabel',start);
  assert.ok(start>=0 && end>start);
  const body=js.slice(start,end);
  assert.match(body,/replace\(\/\\s\*선택\\s\*\$\//);
});

test('the selected choice bubble owns the visible message time until a later completion bubble arrives',()=>{
  const start=js.indexOf('if(selectedChoiceRow){');
  const end=js.indexOf('\n    if(item?.material_request_id',start);
  assert.ok(start>=0 && end>start);
  const body=js.slice(start,end);
  assert.match(body,/moveOlliTalkMessageMetaToRow/);
  assert.match(body,/item\?\.action\?\.resolved_at \|\| item\?\.action\?\.updated_at \|\| item\?\.created_at/);
});

test('selected choice bubbles use normal incoming bubble styling without a tail',()=>{
  assert.match(css,/\.olliTalkBetaSelectedChoiceBubble\{[\s\S]*--olli-talk-bubble-bg:var\(--olli-talk-incoming-bg\);[\s\S]*color:var\(--olli-talk-incoming-text\);/);
  assert.match(css,/\.olliTalkBetaSelectedChoiceBubble::before,[\s\S]*\.olliTalkBetaSelectedChoiceBubble::after\{[\s\S]*content:none !important;/);
  assert.doesNotMatch(css,/\.olliTalkBetaActionButton\.selectedChoice:disabled/);
});

test('Team Chat loads the stage-3 selected choice bubble assets',()=>{
  assert.match(html,/olli-talk-beta\.css\?v=20261007-choice-bubble-stage3-1/);
  assert.match(html,/olli-talk-beta\.js\?v=20261007-choice-bubble-stage3-1/);
});
