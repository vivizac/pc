const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const talk = fs.readFileSync('olli-talk-beta.js', 'utf8');
const api = fs.readFileSync('api/chat.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('phone composer removes the Bot trigger while keeping explicit @올리 routing', () => {
  assert.doesNotMatch(html, /id="olliTalkOlliTriggerBtn"/);
  assert.doesNotMatch(talk, /toggleOlliTalkOlliMode/);
  assert.match(talk, /const directOlliRequested = \/\^\\s\*@올리/);
  assert.match(talk, /const olliRequested = olliAiMentionRequested \|\| directOlliRequested/);
  assert.match(talk, /const usingAi = olliAiMentionRequested \|\| isOlliTalkAiEnabled\(\)/);
  assert.match(talk, /resolveOlliTalkAiTurn/);
  assert.match(talk, /resolveOlliTalkBotTurn/);
});

test('phone mention picker offers Olli as a virtual AI target without registering Olli as a teacher recipient', () => {
  assert.match(talk, /const OLLI_TALK_AI_MENTION_ID = '__olli_ai__'/);
  assert.match(talk, /display_name:'올리'[\s\S]{0,80}is_olli_ai:true/);
  assert.match(talk, /const candidates = \[OLLI_TALK_AI_MENTION, \.\.\.olliTalkMembers\]/);
  assert.match(talk, /mentionLabel = member\?\.is_olli_ai === true \? '@올리 · AI'/);
  assert.match(talk, /if \(member\?\.is_olli_ai === true\) return/);
  assert.match(talk, /olliAiMentionRequested && !isOlliTalkAiEnabled\(\)/);
  assert.match(talk, /const usingAi = olliAiMentionRequested \|\| isOlliTalkAiEnabled\(\)/);
  assert.match(html, /olli-talk-beta\.js\?v=20260930-keyboard-offset-message-lift-1/);
});

test('phone AI mention keeps bounded conversation context while the Olli mention remains active', () => {
  assert.match(talk, /let olliTalkAiConversationMessages = \[\]/);
  assert.match(talk, /function buildOlliTalkAiConversationMessages\(commandText, context\)/);
  assert.match(talk, /return olliTalkAiConversationMessages\.concat\(current\)/);
  assert.match(talk, /messages:buildOlliTalkAiConversationMessages\(commandText, context\)/);
  assert.match(talk, /if \(olliTalkAiConversationMessages\.length > 12\)/);
  assert.match(talk, /recordOlliTalkAiConversationTurn\(commandText, turn\.replyText\)/);
});

test('AI server accepts talk prompt only after Team Talk AI setting check', () => {
  assert.match(api, /'talk',\s*\]\);/);
  assert.match(api, /if \(promptType === 'talk'\) \{\s*await assertTeamTalkAiEnabled\(body\);/);
  assert.match(api, /data\?\.ai_enabled !== true/);
});

test('normal phone messages keep mention recipients and task creation behavior', () => {
  assert.match(talk, /if \(!olliRequested\) \{[\s\S]{0,260}registerOlliTalkMessageRecipients\(Number\(payload\.message\.id\),mentionedIds,context\)/);
  assert.match(talk, /if \(!olliRequested\) \{[\s\S]{0,520}parseOlliTalkTaskItems/);
});

test('button-bound Olli mode code is removed and direct @올리 parsing remains', () => {
  assert.doesNotMatch(talk, /setOlliTalkOlliMode/);
  assert.doesNotMatch(talk, /olliTalkOlliModeActive/);
  assert.doesNotMatch(talk, /window\.toggleOlliTalkOlliMode/);
  assert.match(talk, /function stripOlliTalkOlliPrefix\(value\)/);
});

test('AI setting changes clear pending action state and the active AI conversation context', () => {
  assert.match(talk, /function handleOlliTalkAiModeChanged\(\)\{[\s\S]*olliTalkPendingActionReason = null;[\s\S]*resetOlliTalkAiConversation\(\)/);
  assert.doesNotMatch(talk, /syncOlliTalkAssistantUi/);
});

test('phone shows the saved user bubble immediately and only AI gets the animated typing indicator', () => {
  assert.match(talk, /appendOlliTalkPersistedMessage\(payload\.message, context\.memberId\)/);
  assert.match(talk, /if \(olliRequested && \(olliAiMentionRequested \|\| isOlliTalkAiEnabled\(\)\)\) \{[\s\S]{0,140}olliTalkAssistantReplyPending = true;[\s\S]{0,140}syncOlliTalkAssistantTypingIndicator\(\)/);
  assert.doesNotMatch(talk, /if \(olliRequested\) \{\s*olliTalkAssistantReplyPending = true/);
  assert.match(talk, /finally \{[\s\S]{0,140}olliTalkAssistantReplyPending = false;[\s\S]{0,140}syncOlliTalkAssistantTypingIndicator\(\)/);
  assert.match(talk, /className = 'olliTalkBetaTypingDot'/);
});

test('phone swaps the AI typing row directly into the saved AI bubble without rebuilding the chat list', () => {
  assert.match(talk, /const assistantMessage = await saveOlliTalkOlliReply/);
  assert.match(talk, /replaceOlliTalkAssistantTypingWithMessage\(assistantMessage, context\.memberId\)/);
  assert.match(talk, /loadOlliTalkBetaMessages\(\{ showLoading:false, localFirst:false, scrollMode:'bottom', render:false \}\)/);
  assert.match(talk, /if \(options\.render !== false\) \{\s*renderOlliTalkServerMessages/);
});

test('phone selected mention becomes a dedicated prefix token while the textarea keeps the caret after it', () => {
  assert.match(html, /id="olliTalkSelectedMentionPrefix"[^>]*hidden/);
  assert.match(talk, /function syncOlliTalkSelectedMentionPrefix\(\)/);
  assert.match(talk, /input\.setRangeText\('', info\.start, info\.end, 'end'\)/);
});

test('phone mention mode keeps @ active until a selected teacher has actual message text', () => {
  assert.match(talk, /let olliTalkMentionModeActive = false/);
  assert.match(talk, /const canSend = olliTalkMentionModeActive \? isOlliTalkMentionMessageReady\(\) : hasText/);
  assert.match(talk, /hasOlliTalkSelectedMentionInInput\(\)[\s\S]{0,120}getOlliTalkMentionMessageText\(input\.value\)\.length > 0/);
  assert.match(talk, /trigger\.classList\.toggle\('active', olliTalkMentionModeActive\)/);
});

test('phone send button preserves composer focus so the keyboard does not close and reopen', () => {
  assert.match(talk, /sendButton\.addEventListener\('pointerdown',[\s\S]{0,260}event\.preventDefault\(\)[\s\S]{0,260}composerInput\.focus\(\{ preventScroll:true \}\)/);
  assert.match(talk, /sendButton\.addEventListener\('click', sendOlliTalkBetaMessage\)/);
});

test('phone mention mode stays active across sends until @ is pressed again', () => {
  assert.match(talk, /function getOlliTalkPersistentMentionPrefix\(\)/);
  assert.match(talk, /const persistentMentionPrefix = olliTalkMentionModeActive[\s\S]{0,120}getOlliTalkPersistentMentionPrefix\(\)/);
  assert.match(talk, /input\.value = ''/);
  assert.match(talk, /syncOlliTalkSelectedMentionPrefix\(\)/);
  assert.match(talk, /if \(!persistentMentionPrefix\) \{[\s\S]{0,120}olliTalkMentionModeActive = false/);
  assert.doesNotMatch(talk, /input\.value = '';[\s\S]{0,120}olliTalkMentionModeActive = false/);
});

test('pressing active @ always cancels mention mode and clears the mention draft', () => {
  assert.match(talk, /if \(olliTalkMentionModeActive\) \{[\s\S]*clearOlliTalkMentionDraft\(\);[\s\S]*olliTalkMentionModeActive = false;[\s\S]*input\.blur\(\)/);
  assert.match(talk, /olliTalkMentionSelections\.clear\(\)/);
});

test('phone bot exposes pickup write capability and refreshes shared command runtime versions', () => {
  assert.match(talk, /픽업·하원 픽업 등록/);
  assert.match(html, /olli-command-schedule-common\.js\?v=20260921-pickup-write-1/);
  assert.match(html, /olli-command-router-common\.js\?v=20260921-pickup-write-1/);
});
