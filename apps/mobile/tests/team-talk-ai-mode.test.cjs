const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const talk = fs.readFileSync('olli-talk-beta.js', 'utf8');
const api = fs.readFileSync('api/chat.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('olli-talk-beta.css', 'utf8');


test('phone routes Olli activation through direct or picker @올리 without an AI mode setting', () => {
  assert.doesNotMatch(html, /id="olliTalkOlliTriggerBtn"/);
  assert.doesNotMatch(talk, /toggleOlliTalkOlliMode/);
  assert.match(talk, /const directOlliRequested = \/\^\\s\*@올리/);
  assert.match(talk, /const olliRequested = olliAiMentionRequested \|\| directOlliRequested/);
  assert.doesNotMatch(talk, /isOlliTalkAiEnabled/);
  assert.match(talk, /resolveOlliTalkAiTurn/);
});


test('phone mention picker exposes Olli as a virtual assistant target, never as a teacher recipient', () => {
  assert.match(talk, /const OLLI_TALK_AI_MENTION_ID = '__olli_ai__'/);
  assert.match(talk, /display_name:'올리'[\s\S]{0,100}is_olli_ai:true/);
  assert.match(talk, /const candidates = \[OLLI_TALK_AI_MENTION, \.\.\.olliTalkMembers\]/);
  assert.match(talk, /mentionLabel = member\?\.is_olli_ai === true \? '@올리 · AI'/);
  assert.match(talk, /if \(member\?\.is_olli_ai === true\) return/);
  assert.doesNotMatch(talk, /설정에서 올리 AI를 켜/);
});

test('selected mention is a blue prefix token before the textarea', () => {
  const prefixIndex = html.indexOf('id="olliTalkSelectedMentionPrefix"');
  const inputIndex = html.indexOf('id="olliTalkBetaInput"');
  assert.ok(prefixIndex >= 0 && inputIndex > prefixIndex);
  assert.match(talk, /function syncOlliTalkSelectedMentionPrefix\(\)/);
  assert.match(talk, /input\.setRangeText\('', info\.start, info\.end, 'end'\)/);
  assert.match(css, /\.olliTalkSelectedMentionPrefix\{[\s\S]*?margin-right:\.38em[\s\S]*?color:#1687F8/);
});


test('Olli mention keeps bounded conversation context only while that mention stays active', () => {
  assert.match(talk, /let olliTalkAiConversationMessages = \[\]/);
  assert.match(talk, /function buildOlliTalkAiConversationMessages\(commandText, context\)/);
  assert.match(talk, /messages:buildOlliTalkAiConversationMessages\(commandText, context\)/);
  assert.match(talk, /if \(olliTalkAiConversationMessages\.length > 12\)/);
  assert.match(talk, /recordOlliTalkAiConversationTurn\(commandText, turn\.replyText\)/);
  assert.doesNotMatch(talk, /handleOlliTalkAiModeChanged|olli-team-talk-ai-mode-changed/);
});


test('AI server accepts talk requests without a Team Chat AI setting gate', () => {
  assert.match(api, /'talk',\s*\]\);/);
  assert.doesNotMatch(api, /assertTeamTalkAiEnabled/);
  assert.doesNotMatch(api, /ai_enabled !== true/);
  assert.doesNotMatch(api, /TEAM_TALK_SETTINGS_RPC_URL/);
});

test('normal phone messages still register notification recipients and create tasks', () => {
  assert.match(talk, /if \(!olliRequested\) \{[\s\S]{0,320}registerOlliTalkMessageRecipients\(Number\(payload\.message\.id\),mentionedIds,context\)/);
  assert.match(talk, /if \(!olliRequested\) \{[\s\S]{0,620}parseOlliTalkTaskItems/);
});

test('AI mention stays active across sends until the mention control is pressed again', () => {
  assert.match(talk, /function getOlliTalkPersistentMentionPrefix\(\)/);
  assert.match(talk, /const persistentMentionPrefix = olliTalkMentionModeActive[\s\S]{0,140}getOlliTalkPersistentMentionPrefix\(\)/);
  assert.match(talk, /input\.value = ''[\s\S]{0,180}if \(!persistentMentionPrefix\)/);
  assert.match(talk, /syncOlliTalkSelectedMentionPrefix\(\)/);
  assert.match(talk, /if \(olliTalkMentionModeActive\) \{[\s\S]*?clearOlliTalkMentionDraft\(\);[\s\S]*?olliTalkMentionModeActive = false;[\s\S]*?input\.blur\(\)/);
});

test('restored mention path preserves the current multi-message Agent response renderer', () => {
  assert.match(talk, /const assistantMessages=Array\.isArray\(turn\.assistantMessages\)/);
  assert.match(talk, /replaceOlliTalkAssistantTypingWithMessage\(assistantMessages\[0\],context\.memberId\)/);
  assert.match(talk, /assistantMessages\.slice\(1\)\.forEach/);
});

test('waitlist cancellation Agent bridge remains intact while restoring mentions', () => {
  assert.match(talk, /function isOlliTalkWaitlistCancelAgentCandidate/);
  assert.match(talk, /mode:'waitlist_cancel_prepare'/);
  assert.match(talk, /action_type \|\| ''\)\.trim\(\)!=='cancel_waitlist'/);
});


test('mention-only Team Chat assets are cache-busted', () => {
  assert.match(html, /olli-talk-beta\.js\?v=20261006-mention-only-1/);
  assert.match(html, /olli-talk-beta\.css\?v=20261006-action-spacing-1/);
});
