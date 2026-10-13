const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = fs.readFileSync('api/chat.js', 'utf8');
const live = fs.readFileSync('kinder-feedback.js', 'utf8');

test('all production text prompt types share one privacy path before OpenAI fetch', () => {
  for (const promptType of ['class', 'fail', 'elementary', 'summary', 'kinder_one_month', 'memo_voice_cleanup']) {
    assert.match(chat, new RegExp("'" + promptType + "'"));
  }

  const privacyIndex = chat.indexOf('const privacyResult = await preparePrivacyMessages');
  const sanitizedIndex = chat.indexOf('requestMessages = privacyPrepared.messages');
  const guardIndex = chat.indexOf('privacyGateway.assertPreparedPrivacyEgress');
  const openAiIndex = chat.indexOf("fetch('https://api.openai.com/v1/responses'");

  assert.ok(privacyIndex >= 0);
  assert.ok(sanitizedIndex > privacyIndex);
  assert.ok(guardIndex > sanitizedIndex);
  assert.ok(openAiIndex > guardIndex);
  assert.match(chat, /if \(!isWarmup\) \{[\s\S]*preparePrivacyMessages/);
});

test('privacy transport keeps real identity server-side and sanitizes only AI messages', () => {
  assert.match(chat, /studentId = String\(/);
  assert.match(chat, /studentName = String\(/);
  assert.match(chat, /inferStudentNameFromMessages\(messages\)/);
  assert.match(chat, /preparePrivacySafeMessages/);
  assert.match(chat, /input\.filter\(\(item\) => item\?\.role !== 'system'\)/);
});

test('non-stream and stream replies restore request-bound student alias', () => {
  assert.match(chat, /function restorePrivacyResponseAliases\(text, studentName\)/);
  assert.match(chat, /restorePrivacyResponseAliases\(rawReplyText, responseStudentName\)/);
  assert.match(chat, /createPrivacyStreamRewriter\(options\.studentName \|\| ''\)/);
  assert.match(chat, /responseRewriter\.push\(delta\)/);
  assert.match(chat, /responseRewriter\.flush\(\)/);
});

test('phone streaming request forwards request-bound job and student id without logging the student name', () => {
  assert.match(live, /jobId: item\.id,/);
  assert.match(live, /studentId: item\.studentId,/);
  assert.match(live, /studentName: item\.studentName,/);
  const logStart = live.indexOf("console.info('[OLLI AI] feedback first stream chunk'");
  const logEnd = live.indexOf('});', logStart);
  const logBlock = live.slice(logStart, logEnd + 3);
  assert.doesNotMatch(logBlock, /studentName/);
});


test('kinder fail feedback also forwards selected student id to the privacy server', () => {
  assert.match(live, /promptType:'fail',[\s\S]{0,220}studentId: String\(window\.__kcfSelectedStudentId \|\| ''\)/);
});


test('privacy stream rewriter keeps Unicode code points intact across carry boundaries', () => {
  const start = chat.indexOf('function createPrivacyStreamRewriter(studentName)');
  const end = chat.indexOf('function extractReplyText', start);
  const rewriter = chat.slice(start, end);
  assert.match(rewriter, /const codePoints = Array\.from\(combined\)/);
  assert.match(rewriter, /codePoints\.slice\(0, cut\)\.join\(''\)/);
  assert.match(rewriter, /codePoints\.slice\(cut\)\.join\(''\)/);
  assert.doesNotMatch(rewriter, /combined\.slice\(0, cut\)/);
});


test('only feedback-generation requests use GPT-6.1 Sol medium', () => {
  const vm = require('node:vm');
  const start = chat.indexOf('const FEEDBACK_GENERATION_PROMPT_TYPES');
  const end = chat.indexOf('function getServerKey()', start);
  assert.ok(start >= 0 && end > start);
  const resolve = vm.runInNewContext(chat.slice(start, end) + '\nresolveChatModel', {
    process: { env: { OPENAI_MODEL: 'gpt-5-mini' } },
  });
  for (const type of ['class', 'fail', 'elementary', 'summary', 'kinder_one_month']) {
    assert.equal(resolve(type), 'gpt-6.1-sol');
  }
  for (const type of ['talk', 'memo_voice_cleanup']) {
    assert.equal(resolve(type), 'gpt-5-mini');
  }
  assert.match(chat, /model: resolveChatModel\(telemetry\.promptType\)/);
  assert.match(chat, /const model = resolveChatModel\(promptType\);/);
  const resolveEffort = vm.runInNewContext(chat.slice(start, end) + '\nresolveChatReasoningEffort', {
    process: { env: { OPENAI_MODEL: 'gpt-5-mini' } },
  });
  for (const type of ['class', 'fail', 'elementary', 'summary', 'kinder_one_month']) {
    assert.equal(resolveEffort(type), 'medium');
  }
  for (const type of ['talk', 'memo_voice_cleanup']) {
    assert.equal(resolveEffort(type), 'medium');
  }
  assert.match(chat, /reasoning: \{\s*effort: resolveChatReasoningEffort\(promptType\)/);
});
