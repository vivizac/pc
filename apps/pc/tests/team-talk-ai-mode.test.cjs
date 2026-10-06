const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const settings = fs.readFileSync('olli-settings-team-talk-common.js', 'utf8');
const talk = fs.readFileSync('pc-team-talk.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('shared Team Talk settings no longer expose an AI or rule-mode toggle', () => {
  assert.doesNotMatch(settings, /aiEnabled/);
  assert.doesNotMatch(settings, /olliTeamTalkToggleAi/);
  assert.doesNotMatch(settings, /olli-team-talk-ai-mode-changed/);
  assert.doesNotMatch(settings, /<strong>올리 AI<\/strong>/);
  assert.match(settings, /botNotificationsEnabled:\s*false/);
});

test('PC composer removes the assistant toggle button and keeps mention/send controls', () => {
  assert.doesNotMatch(html, /id="olliPcTeamTalkOlli"/);
  assert.match(html, /id="olliPcTeamTalkMention"/);
  assert.match(html, /id="olliPcTeamTalkSend"/);
  assert.doesNotMatch(talk, /toggleOlliMode|setOlliMode|syncAssistantUi|olliModeActive/);
});

test('PC mention picker offers Olli as the integrated assistant target', () => {
  assert.match(talk, /olliAiMentionSelected:\s*false/);
  assert.match(talk, /create\('span', '', '올리'\)/);
  assert.match(talk, /state\.olliAiMentionSelected = true/);
  assert.doesNotMatch(talk, /isAiEnabled\(/);
  assert.match(talk, /const olliRequested = olliAiMentionRequested \|\| directOlliRequested \|\| pendingOlliWorkflow/);
  assert.match(talk, /const turn = await resolveAiTurn\(commandText, current/);
  assert.match(html, /pc-team-talk\.js\?v=20261006-mention-only-1/);
});

test('PC AI requests carry the active AI conversation context but never the full Team Talk history', () => {
  assert.match(talk, /sessionToken:current\?\.sessionToken \|\| ''/);
  assert.match(talk, /aiConversationMessages:\s*\[\]/);
  assert.match(talk, /messages:buildAiConversationMessages\(commandText\)/);
  assert.match(talk, /return state\.aiConversationMessages\.concat\(currentMessage\)/);
  assert.doesNotMatch(talk, /messages:\s*state\.messages/);
});

test('normal PC messages still keep the existing mention path', () => {
  assert.match(talk, /const mentionIds = olliRequested \? \[\] : resolveMentionIds\(body\)/);
  assert.match(talk, /olli_team_chat_set_mentions/);
});


test('shared Team Talk settings row routes through the module opener before opening detail', () => {
  assert.match(settings, /id="settingsTeamTalkRow" onclick="openOlliTeamTalkSettings\(\)"/);
  assert.match(settings, /function openDetail\(\)[\s\S]*registerSettingsDetail\(\)[\s\S]*global\.openSettingsDetail\('teamTalk'\)/);
});

test('shared Team Talk settings back button closes the detail screen and restores normal Settings navigation', () => {
  assert.match(settings, /function bindTeamTalkDetailBackButton\(\)[\s\S]*setAttribute\('onclick', 'closeOlliTeamTalkSettings\(\)'\)/);
  assert.match(settings, /function closeDetailFallback\(\)[\s\S]*detail\.style\.display = 'none'[\s\S]*settings\.style\.display = 'flex'/);
  assert.match(settings, /restoreSettingsDetailBackButton\(\)/);
  assert.match(settings, /global\.closeOlliTeamTalkSettings = closeDetail/);
});

test('shared Team Talk settings opener falls back to the existing detail screen when standard navigation does not open it', () => {
  assert.match(settings, /function openDetailFallback\(\)/);
  assert.match(settings, /document\.getElementById\('settingsDetailScreen'\)/);
  assert.match(settings, /titlePill\.textContent = '팀톡 배경설정'/);
  assert.match(settings, /body\.innerHTML = detailHtml\(\)/);
  assert.match(settings, /detail\.style\.display = 'flex'/);
  assert.match(settings, /if \(detail && detail\.style\.display === 'flex'\) return true/);
  assert.match(settings, /return openDetailFallback\(\)/);
});


test('shared Team Talk automatic alerts remain available as an unrelated setting', () => {
  assert.match(settings, /<span>픽업 등록<\/span>/);
  assert.match(settings, /<span>픽업 취소<\/span>/);
  assert.match(settings, /등록과 취소가 생기면 팀톡에 자동으로 알려줍니다/);
  assert.doesNotMatch(settings, /AI 사용 여부와 관계없이/);
});


test('PC Olli activation comes only from @올리 or an active Olli workflow', () => {
  const sendStart = talk.indexOf('async function sendMessage');
  const sendEnd = talk.indexOf('async function callFileApi', sendStart);
  const sendSource = talk.slice(sendStart, sendEnd);

  assert.match(sendSource, /const directOlliRequested = \/\^\\s\*@올리/);
  assert.match(sendSource, /const pendingOlliWorkflow = hasPendingOlliCommand\(\)/);
  assert.match(sendSource, /const olliRequested = olliAiMentionRequested \|\| directOlliRequested \|\| pendingOlliWorkflow/);
  assert.doesNotMatch(sendSource, /isAiEnabled|usingAi|resolveBotTurn/);
});


test('PC Olli context grows turn by turn without depending on a mode setting', () => {
  assert.match(talk, /return state\.aiConversationMessages\.concat\(currentMessage\)/);
  assert.match(talk, /state\.aiConversationMessages\.push\([\s\S]*role:'user'[\s\S]*role:'assistant'/);
  assert.match(talk, /if \(!olliRequested\) state\.aiConversationMessages = \[\]/);
  assert.doesNotMatch(talk, /handleAiModeChanged|isAiEnabled|olli-team-talk-ai-mode-changed/);
});


test('PC shows a one-second three-dot typing state only for the first Olli response', () => {
  assert.match(talk, /appendPersistedMessage\(payload\.message, current\.memberId\)/);
  assert.match(talk, /const isOlliWorkflowFollowup = olliRequested/);
  assert.match(talk, /if \(olliRequested && !isOlliWorkflowFollowup\) \{[\s\S]{0,180}state\.assistantReplyPending = true;[\s\S]{0,180}syncAssistantTypingIndicator\(\)/);
  assert.match(talk, /create\('span', 'olliPcTeamTalkTypingDot'\)/);
  assert.match(talk, /1000-\(Date\.now\(\)-firstReplyStartedAt\)/);
});


test('PC swaps the AI typing row directly into the saved AI bubble without rebuilding the chat list', () => {
  assert.match(talk, /const assistantMessage = await saveAssistantReply/);
  assert.match(talk, /replaceAssistantTypingWithMessage\(assistantMessage, current\.memberId\)/);
  assert.match(talk, /loadMessages\(\{ showLoading: false, followBottom: true, render:false \}\)/);
  assert.match(talk, /if \(options\.render === false\) state\.messages/);
});


test('PC pending makeup cancellation reason bypasses interpreter and keeps reason controls', () => {
  const pendingIndex = talk.indexOf('pendingStructuredMakeupCancel=state.pendingActionReason?.__structuredMakeupCancel');
  const interpretIndex = talk.indexOf('await interpretOlliSystemLanguage', pendingIndex);
  assert.ok(pendingIndex >= 0);
  assert.ok(interpretIndex > pendingIndex);
  assert.match(talk,/return resolveStructuredMakeupCancelTurn\(\{/);
  assert.match(talk,/noReason\.textContent='사유 없음'/);
  assert.match(talk,/inputButton\.textContent='사유 입력'/);
});
