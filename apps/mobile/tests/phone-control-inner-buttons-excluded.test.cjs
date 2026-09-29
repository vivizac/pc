const fs=require('fs');
const test=require('node:test');
const assert=require('node:assert/strict');

const unified=fs.readFileSync('olli-phone-control-style.css','utf8');
const kcf=fs.readFileSync('kinder-feedback.css','utf8');

test('buttons inside glass shells are excluded from the global TeamTalk effect',()=>{
  for(const selector of [
    '#kinderChatFeedbackScreen .kcfComposer .kcfAttachBtn',
    '#kinderChatFeedbackScreen .kcfComposer .kcfTeacherBtn',
    '#kinderChatFeedbackScreen .kcfComposer .kcfVoiceBtn',
    '#kinderChatFeedbackScreen .kcfComposer .kcfSendBtn',
    '#olliTalkBetaScreen .olliTalkBetaComposer .olliTalkFileAddBtn',
    '#olliTalkBetaScreen .olliTalkBetaComposer .olliTalkOlliTriggerBtn',
    '#olliTalkBetaScreen .olliTalkBetaComposer .olliTalkMentionTriggerBtn',
    '#olliTalkBetaScreen .olliTalkBetaComposer .olliTalkBetaSendBtn',
    '#studentMemoScreen[data-memo-body-view="editor"] #memoEditorUtilityGroup > button'
  ]) assert.ok(!unified.includes(selector), selector);
  assert.ok(!unified.includes('.olliWorkTab{'));
  assert.ok(!unified.includes('.olliWorkTab.active{'));
});

test('QuickNote composer child controls use their original component visuals',()=>{
  assert.match(kcf, /#kinderChatFeedbackScreen \.kcfAttachBtn \{[\s\S]*border:none;[\s\S]*background:transparent;/);
  assert.match(kcf, /#kinderChatFeedbackScreen \.kcfVoiceBtn \{[\s\S]*border:none;[\s\S]*background:transparent;/);
});

test('outer shells and standalone buttons stay unified',()=>{
  assert.match(unified, /\.olliWorkTabs,/);
  assert.match(unified, /#kinderChatFeedbackScreen \.kcfComposer,/);
  assert.match(unified, /#olliTalkBetaScreen \.olliTalkBetaComposer,/);
  assert.match(unified, /#observationRosterScreen \.memoRosterUtilityBar \.memoRosterUtilityBtn,/);
  assert.match(unified, /#studentMemoScreen\[data-memo-body-view="editor"\] \.memoBottomBar #memoBottomAnalysisBtn/);
  assert.ok(!unified.includes('#memoRosterBackBtn'));
});


test('observation search uses academy button shadow while memo send is excluded from global glass',()=>{
  assert.match(
    unified,
    /#observationRosterScreen \.memoRosterSearchPill\{[\s\S]*box-shadow:var\(--olli-phone-academy-button-shadow\) !important;/
  );
  assert.doesNotMatch(
    unified,
    /#studentMemoScreen\[data-memo-body-view="editor"\] #memoFeedbackBtn/
  );
  assert.doesNotMatch(unified, /--olli-phone-glass-button-shadow:/);
});


test('memo send button is a clean source-owned circle without legacy card or glass effects',()=>{
  const base=fs.readFileSync('olli-phone-base.css','utf8');
  const roster=fs.readFileSync('olli-observation-roster-phone.css','utf8');
  const html=fs.readFileSync('index.html','utf8');
  assert.match(html, /class="memoFeedbackBottomBtn" id="memoFeedbackBtn"/);
  assert.doesNotMatch(html, /class="cardGenerateBtn memoFeedbackBottomBtn" id="memoFeedbackBtn"/);
  assert.match(base, /#studentMemoScreen \.memoFeedbackBottomBtn \{[\s\S]*border: none;[\s\S]*box-shadow: none;[\s\S]*backdrop-filter: none;[\s\S]*-webkit-backdrop-filter: none;[\s\S]*appearance: none;[\s\S]*-webkit-appearance: none;/);
  assert.match(roster, /#studentMemoScreen\[data-memo-body-view="editor"\] #memoFeedbackBtn \{[\s\S]*width:44px;[\s\S]*height:44px;[\s\S]*border-radius:50%;/);
});
