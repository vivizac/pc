const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const js = fs.readFileSync('olli-talk-beta.js', 'utf8');
const css = fs.readFileSync('olli-talk-beta.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('mobile AI mutations are prepared before normal OpenAI replies', () => {
  const prepareIndex = js.indexOf('router.prepareAction(commandText');
  const aiIndex = js.indexOf('const resolved=await resolveOlliTalkAiReply(commandText,context)');
  assert.ok(prepareIndex >= 0);
  assert.ok(aiIndex > prepareIndex);
  assert.match(js, /prepared\.kind==='action_pending'/);
  assert.match(js, /prepared\.kind==='action_needs_reason'/);
});

test('mobile action card renders below AI bubble and uses shared action metadata', () => {
  assert.match(js, /function createOlliTalkActionCard\(action\)/);
  assert.match(js, /incomingLayout\.appendChild\(createOlliTalkActionCard\(item\.action\)\)/);
  assert.match(css, /\.olliTalkBetaIncomingLayout \.olliTalkBetaActionCard/);
  assert.match(css, /grid-row:3/);
  assert.match(css, /\.olliTalkBetaActionButton\.primary/);
});

test('mobile buttons execute or cancel by action id only', () => {
  assert.match(js, /'olli_team_chat_action_execute'/);
  assert.match(js, /'olli_team_chat_action_cancel'/);
  assert.match(js, /p_action_id:actionId/);

  const handlerStart = js.indexOf('async function handleOlliTalkActionCard');
  const handlerEnd = js.indexOf('function createOlliTalkActionCard', handlerStart);
  const handler = js.slice(handlerStart, handlerEnd);
  assert.doesNotMatch(handler, /p_action_payload/);
  assert.doesNotMatch(handler, /studentId/);
  assert.doesNotMatch(handler, /sessionDate/);
});

test('mobile keeps reason-required mutations out of OpenAI and creates card after reason', () => {
  assert.match(js, /let olliTalkPendingActionReason = null/);
  assert.match(js, /olliTalkPendingActionReason=Object\.assign\(\{\},prepared\.payload\)/);
  assert.match(js, /Object\.assign\(\{\},olliTalkPendingActionReason,\{reason:/);
  assert.match(js, /saveOlliTalkActionReply\(context,confirmation,command,replyToMessageId\)/);
});

test('mobile action result refreshes authoritative Team Talk list', () => {
  assert.match(js, /await loadOlliTalkBetaMessages\(\{[\s\S]*localFirst:false,[\s\S]*scrollMode:'follow-if-near-bottom'/);
  assert.match(js, /window\.dispatchEvent\(new CustomEvent\('olli:schedule-changed'/);
  assert.match(js, /OlliPhoneStudentScheduleService\?\.clearWeekCache/);
});

test('mobile asset versions are bumped for action-card delivery', () => {
  assert.match(html, /olli-talk-beta\.css\?v=20260921-action-card-step4-1/);
  assert.match(html, /olli-talk-beta\.js\?v=20260921-action-card-step4-1/);
});
