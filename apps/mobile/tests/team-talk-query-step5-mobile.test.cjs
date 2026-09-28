const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const js = fs.readFileSync('olli-talk-beta.js', 'utf8');
const css = fs.readFileSync('olli-talk-beta.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('mobile AI checks Olli read queries before OpenAI', () => {
  const queryIndex = js.indexOf("typeof router.runQuery==='function'");
  const openAiIndex = js.indexOf('const resolved=await resolveOlliTalkAiReply(commandText,context)', queryIndex);
  assert.ok(queryIndex >= 0);
  assert.ok(openAiIndex > queryIndex);
});

test('mobile read results are persisted as AI messages but excluded from OpenAI history', () => {
  const queryIndex = js.indexOf("typeof router.runQuery==='function'");
  const openAiIndex = js.indexOf('const resolved=await resolveOlliTalkAiReply(commandText,context)', queryIndex);
  const block = js.slice(queryIndex, openAiIndex);

  assert.match(block, /router\.runQuery\(commandText/);
  assert.match(block, /saveOlliTalkOlliReply\(context,queryMessage,replyToMessageId\)/);
  assert.match(block, /recordAi:false/);
  assert.doesNotMatch(block, /recordOlliTalkAiConversationTurn/);
  assert.doesNotMatch(block, /resolveOlliTalkAiReply/);
});

test('mobile keeps mutation preparation ahead of read queries', () => {
  const prepareIndex = js.indexOf("typeof router.prepareAction==='function'");
  const queryIndex = js.indexOf("typeof router.runQuery==='function'");
  assert.ok(prepareIndex >= 0);
  assert.ok(queryIndex > prepareIndex);
});

test('mobile refreshes shared query-tool assets from PC main', () => {
  assert.match(html, /olli-talk-beta\\.js\\?v=20260923-student-info-link-1/);
  assert.match(html, /olli-talk-beta\\.css\\?v=20260923-student-info-link-1/);
  assert.match(html, /olli-command-schedule-common\.js\?v=20260921-query-tools-1/);
  assert.match(html, /olli-command-router-common\\.js\\?v=20260923-student-info-query-1/);
});

test('mobile student info command persists a clickable student-info link instead of opening the sheet during send', () => {
  assert.match(js, /function resolveOlliTalkStudentInfoCommand\(commandText\)/);
  assert.match(js, /router\.parseStudentInfoLookupIntent\(commandText\)/);
  assert.match(js, /window\.getAllStudents/);
  assert.match(js, /\[학생정보 열기\]\(olli-student-info:/);
  assert.doesNotMatch(
    js.slice(
      js.indexOf('function resolveOlliTalkStudentInfoCommand'),
      js.indexOf('async function resolveOlliTalkBotTurn')
    ),
    /openStudentInfoById/
  );

  const botLookup = js.indexOf('const studentInfo=resolveOlliTalkStudentInfoCommand(commandText);');
  const botPrepare = js.indexOf("if(!router || typeof router.prepareAction!=='function')", botLookup);
  assert.ok(botLookup >= 0);
  assert.ok(botPrepare > botLookup);

  const aiStart = js.indexOf('async function resolveOlliTalkAiTurn');
  const aiLookup = js.indexOf('const studentInfo=resolveOlliTalkStudentInfoCommand(commandText);', aiStart);
  const aiPrepare = js.indexOf("if(router && typeof router.prepareAction==='function')", aiLookup);
  assert.ok(aiLookup > aiStart);
  assert.ok(aiPrepare > aiLookup);
});

test('student-info reply renders a link-style button that opens the existing sheet only on tap', () => {
  assert.match(js, /function parseOlliTalkStudentInfoLink\(value\)/);
  assert.match(js, /function createOlliTalkStudentInfoLinkButton\(studentId\)/);
  assert.match(js, /window\.openStudentInfoById\(String\(studentId \|\| ''\)\)/);
  assert.match(js, /olliTalkBetaStudentInfoLinkButton/);
  assert.match(css, /\.olliTalkBetaStudentInfoLinkButton/);
  assert.match(html, /olli-talk-beta\.js\?v=20260923-student-info-link-1/);
  assert.match(html, /olli-talk-beta\.css\?v=20260923-student-info-link-1/);
});

test('mobile exposes one direct student-info opener backed by the existing info modals', () => {
  const operations = fs.readFileSync('olli-data-student-operations.js', 'utf8');
  assert.match(operations, /function openStudentInfoById\(studentId\)/);
  assert.match(operations, /studentInfoModalTarget = student/);
  assert.match(operations, /openKinderInfoModal\(\)/);
  assert.match(operations, /openElementaryInfoModal\(\)/);
  assert.match(operations, /window\.openStudentInfoById = openStudentInfoById/);
  assert.match(html, /olli-data-student-operations\.js\?v=20260923-student-info-search-1/);
});

test('mobile offers a small Olli reply button for eligible own normal messages', () => {
  assert.match(js, /shouldOfferOlliTalkReply\(item,own,options\.olliReplyTargetIds\)/);
  assert.match(js, /router\.isOlliReplyCandidate\(body\)/);
  assert.match(js, /olliTalkBetaReplySuggestionButton/);
  assert.match(js, /allowSuggestedQuery:true/);
  assert.match(js, /reply_to_message_id/);
  assert.match(js, /removeOlliTalkReplySuggestion/);
  assert.match(css, /\.olliTalkBetaReplySuggestionButton/);
});
