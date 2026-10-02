const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const talk = fs.readFileSync('pc-team-talk.js', 'utf8');

test('PC AI pickup add is routed before the legacy action path — shared dispatch contract', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'pickup_cancel'/);
  assert.match(dispatch,/case 'pickup_update'/);
  assert.match(dispatch,/case 'pickup_add'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('PC pickup bridge reuses the shared pickup parser', () => {
  assert.match(talk, /parsePickupMutationIntent\(commandText\)/);
});


test('PC pickup Agent uses the saved message id and returns the persisted action message', () => {
  const start = talk.indexOf('async function resolvePickupAddAgentTurn');
  const end = talk.indexOf('async function saveAssistantReply', start);
  const block = talk.slice(start, end);

  assert.match(block, /mode:'pickup_prepare'/);
  assert.match(block, /sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.match(block, /assistantMessage:data\.message/);
  assert.match(block, /recordAi:false/);
});

test('PC bot path remains independent from the pickup Agent bridge', () => {
  const start = talk.indexOf('async function resolveBotTurn');
  const end = talk.indexOf('function buildAiConversationMessages', start);
  const block = talk.slice(start, end);

  assert.doesNotMatch(block, /resolvePickupAddAgentTurn|isPickupAddAgentCandidate/);
});


test('PC AI pickup update is routed before add and legacy action paths — shared dispatch contract', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'pickup_cancel'/);
  assert.match(dispatch,/case 'pickup_update'/);
  assert.match(dispatch,/case 'pickup_add'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('PC pickup update bridge uses shared update parser and persisted production action', () => {
  assert.match(talk, /parsePickupUpdateMutationIntent\(commandText\)/);

  const start = talk.indexOf('async function resolvePickupUpdateAgentTurn');
  const end = talk.indexOf('async function resolvePickupAddAgentTurn', start);
  const block = talk.slice(start, end);

  assert.match(block, /mode:'pickup_update_prepare'/);
  assert.match(block, /sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.match(block, /update_pickup_arrival/);
  assert.match(block, /update_pickup_dropoff/);
  assert.match(block, /assistantMessage:data\.message/);
  assert.match(block, /recordAi:false/);
  assert.doesNotMatch(block, /saveAssistantReply|saveAssistantAction|olli_team_chat_send_ai|olli_team_chat_send_action/);
});

test('PC bot path remains independent from pickup update Agent bridge', () => {
  const start = talk.indexOf('async function resolveBotTurn');
  const end = talk.indexOf('function buildAiConversationMessages', start);
  const block = talk.slice(start, end);

  assert.doesNotMatch(block, /resolvePickupUpdateAgentTurn|isPickupUpdateAgentCandidate|pickup_update_prepare/);
});

test('PC AI pickup cancel is routed before update, add and legacy action paths — shared dispatch contract', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'pickup_cancel'/);
  assert.match(dispatch,/case 'pickup_update'/);
  assert.match(dispatch,/case 'pickup_add'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('PC pickup cancel bridge uses shared cancel parser and persisted production action', () => {
  assert.match(talk, /parsePickupCancelMutationIntent\(commandText\)/);

  const start = talk.indexOf('async function resolvePickupCancelAgentTurn');
  const end = talk.indexOf('async function resolvePickupUpdateAgentTurn', start);
  const block = talk.slice(start, end);

  assert.match(block, /mode:'pickup_cancel_prepare'/);
  assert.match(block, /sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.match(block, /cancel_pickup/);
  assert.match(block, /cancel_pickup_dropoff/);
  assert.match(block, /assistantMessage:data\.message/);
  assert.match(block, /recordAi:false/);
  assert.doesNotMatch(block, /saveAssistantReply|saveAssistantAction|olli_team_chat_send_ai|olli_team_chat_send_action/);
});

test('PC bot path remains independent from pickup cancel Agent bridge', () => {
  const start = talk.indexOf('async function resolveBotTurn');
  const end = talk.indexOf('function buildAiConversationMessages', start);
  const block = talk.slice(start, end);

  assert.doesNotMatch(block, /resolvePickupCancelAgentTurn|isPickupCancelAgentCandidate|pickup_cancel_prepare/);
});

