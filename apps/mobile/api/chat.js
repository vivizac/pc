const SUPABASE_URL = 'https://fvkxipjwgeyosgnfhdnx.supabase.co';
const SERVER_PROMPT_RPC_URL =
  `${SUPABASE_URL}/rest/v1/rpc/olli_server_get_ai_prompt`;
const TEAM_TALK_SETTINGS_RPC_URL =
  `${SUPABASE_URL}/rest/v1/rpc/olli_team_talk_settings_get`;
const ALLOWED_PROMPT_TYPES = new Set([
  'class',
  'fail',
  'elementary',
  'summary',
  'kinder_one_month',
  'memo_voice_cleanup',
  'talk',
]);
const AI_USAGE_LOG_URL = `${SUPABASE_URL}/rest/v1/olli_ai_usage_logs`;

function getServerKey() {
  return (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  );
}

function safeLogText(value, maxLength = 300) {
  return String(value || '').trim().slice(0, maxLength) || null;
}

function getTelemetryContext(req, body = {}) {
  const academyId = safeLogText(body.academyId || body.academy_id, 100);
  const academyName = safeLogText(body.academyName || body.academy_name, 120);
  const promptType = safeLogText(body.promptType || 'class', 40) || 'class';
  const requestId = safeLogText(req.headers['x-vercel-id'] || req.headers['x-request-id'], 160);
  return { academyId, academyName, promptType, requestId };
}

function extractUsage(data) {
  const usage = data && typeof data === 'object' ? data.usage || {} : {};
  const inputDetails = usage.input_tokens_details || usage.inputTokensDetails || {};
  return {
    inputTokens: Number(usage.input_tokens || usage.inputTokens || 0) || 0,
    outputTokens: Number(usage.output_tokens || usage.outputTokens || 0) || 0,
    cachedTokens: Number(inputDetails.cached_tokens || inputDetails.cachedTokens || 0) || 0,
    cacheWriteTokens: Number(inputDetails.cache_write_tokens || inputDetails.cacheWriteTokens || 0) || 0,
  };
}

function supportsExplicitPromptCache(model) {
  return /^gpt-5\.6(?:-|$)/i.test(String(model || '').trim());
}

function getPromptCacheKey(promptType) {
  return `olli-feedback-${String(promptType || 'class').trim() || 'class'}`.slice(0, 64);
}

function estimateCostKrw({ inputTokens = 0, outputTokens = 0 }) {
  const inputRate = Number(process.env.AI_INPUT_COST_KRW_PER_M_TOKENS || 0);
  const outputRate = Number(process.env.AI_OUTPUT_COST_KRW_PER_M_TOKENS || 0);
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate)) return 0;
  return Math.round(((inputTokens / 1000000) * inputRate + (outputTokens / 1000000) * outputRate) * 10000) / 10000;
}

async function writeUsageLog(entry) {
  const serverKey = getServerKey();
  if (!serverKey) return;

  try {
    const response = await fetch(AI_USAGE_LOG_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serverKey,
        Authorization: `Bearer ${serverKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        academy_id: entry.academyId || null,
        academy_name: entry.academyName || null,
        feature: entry.promptType,
        model: entry.model || null,
        input_tokens: entry.inputTokens || 0,
        output_tokens: entry.outputTokens || 0,
        estimated_cost_krw: estimateCostKrw(entry),
        success: entry.success === true,
        error_code: entry.errorCode || null,
        error_message: safeLogText(entry.errorMessage),
        latency_ms: Math.max(0, Math.round(entry.latencyMs || 0)),
        request_id: entry.requestId || null,
      }),
    });
    if (!response.ok) console.warn('[OLLI AI] usage log write failed:', response.status);
  } catch (error) {
    console.warn('[OLLI AI] usage log write failed:', error?.message || error);
  }
}

async function assertTeamTalkAiEnabled(body = {}) {
  const serverKey = getServerKey();
  const sessionToken = String(body.sessionToken || body.session_token || '').trim();
  const academyId = String(body.academyId || body.academy_id || '').trim();

  if (!serverKey) {
    const error = new Error('SUPABASE_SECRET_KEY가 서버 환경변수에 설정되지 않았습니다.');
    error.statusCode = 500;
    throw error;
  }
  if (!sessionToken || !academyId) {
    const error = new Error('올리 AI를 사용하려면 로그인 세션과 학원 정보가 필요합니다.');
    error.statusCode = 401;
    throw error;
  }

  const response = await fetch(TEAM_TALK_SETTINGS_RPC_URL, {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:serverKey,
      Authorization:`Bearer ${serverKey}`
    },
    body:JSON.stringify({
      p_session_token:sessionToken,
      p_academy_id:academyId
    })
  });

  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { data = { raw }; }

  if (!response.ok) {
    const error = new Error(data?.message || data?.error || '올리 AI 사용 권한을 확인하지 못했습니다.');
    error.statusCode = response.status === 401 ? 401 : 403;
    throw error;
  }
  if (!data?.ok || data?.ai_enabled !== true) {
    const error = new Error('현재 학원 설정에서 올리 AI가 꺼져 있습니다.');
    error.statusCode = 403;
    throw error;
  }
  return true;
}

async function loadSystemPrompt(promptType) {
  if (!ALLOWED_PROMPT_TYPES.has(promptType)) {
    const error = new Error(`알 수 없는 promptType입니다: ${promptType}`);
    error.statusCode = 400;
    throw error;
  }

  const serverKey = getServerKey();

  if (!serverKey) {
    throw new Error(
      'SUPABASE_SECRET_KEY가 서버 환경변수에 설정되지 않았습니다.'
    );
  }

  const promptRes = await fetch(SERVER_PROMPT_RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serverKey,
    },
    body: JSON.stringify({
      p_prompt_type: promptType,
    }),
  });

  const rawText = await promptRes.text();

  let data;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = { raw: rawText };
  }

  if (!promptRes.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      '공용 프롬프트를 불러오지 못했습니다.'
    );
  }

  if (!data?.ok || !data?.prompt) {
    throw new Error(
      data?.error || '활성화된 공용 프롬프트가 없습니다.'
    );
  }

  console.info(
    `[OLLI AI] Loaded ${promptType} prompt v${data.version} from Supabase private store.`
  );

  return String(data.prompt);
}

function buildResponseInput(messages, systemPrompt, options = {}) {
  const input = [];
  const systemContent = {
    type: 'input_text',
    text: String(systemPrompt),
  };
  if (options.explicitSystemCache === true) {
    systemContent.prompt_cache_breakpoint = { mode: 'explicit' };
  }

  input.push({
    role: 'system',
    content: [systemContent],
  });

  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const content = [];

    if (typeof msg.content === 'string') {
      content.push({
        type: role === 'assistant' ? 'output_text' : 'input_text',
        text: msg.content,
      });
    } else if (Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if (item.type === 'text' && item.text) {
          content.push({
            type: role === 'assistant' ? 'output_text' : 'input_text',
            text: item.text,
          });
        }

        if (
          role === 'user' &&
          item.type === 'image_url' &&
          item.image_url &&
          item.image_url.url
        ) {
          content.push({
            type: 'input_image',
            image_url: item.image_url.url,
          });
        }
      }
    }

    if (content.length > 0) {
      input.push({ role, content });
    }
  }

  return input;
}


function getPrivacyMessageText(messages) {
  const chunks = [];
  (Array.isArray(messages) ? messages : []).forEach((message) => {
    if (typeof message?.content === 'string') {
      chunks.push(message.content);
      return;
    }
    if (!Array.isArray(message?.content)) return;
    message.content.forEach((item) => {
      if (item && typeof item.text === 'string') chunks.push(item.text);
    });
  });
  return chunks.join('\n');
}

function inferStudentNameFromMessages(messages) {
  const text = getPrivacyMessageText(messages);
  if (!text) return '';
  const patterns = [
    /(?:아이|학생)\s*이름\s*[:：]\s*([가-힣]{2,6})/,
    /(?:^|\n)\s*-?\s*이름\s*[:：]\s*([가-힣]{2,6})/m,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return String(match[1]).trim();
  }
  return '';
}

function getPrivacyRequestInput(body, promptType, messages) {
  const privacyContext =
    body?.privacyContext &&
    typeof body.privacyContext === 'object' &&
    !Array.isArray(body.privacyContext)
      ? body.privacyContext
      : {};
  const explicitSubject =
    privacyContext.subject &&
    typeof privacyContext.subject === 'object' &&
    !Array.isArray(privacyContext.subject)
      ? privacyContext.subject
      : {};

  const studentName = String(
    body?.studentName ||
    body?.student_name ||
    explicitSubject.name ||
    explicitSubject.studentName ||
    inferStudentNameFromMessages(messages) ||
    ''
  ).trim();
  const studentId = String(
    body?.studentId ||
    body?.student_id ||
    explicitSubject.id ||
    explicitSubject.studentId ||
    explicitSubject.student_id ||
    ''
  ).trim();

  return {
    jobId:String(body?.jobId || body?.feedbackJobId || privacyContext.jobId || '').trim(),
    requestType:promptType,
    studentDivision:String(body?.studentDivision || privacyContext.studentDivision || '').trim(),
    subject:{
      ...explicitSubject,
      ...(studentId ? { id:studentId } : {}),
      ...(studentName ? { name:studentName } : {}),
      ...(Array.isArray(body?.studentAliases) ? { aliases:body.studentAliases } : {}),
    },
    relatedStudents:Array.isArray(privacyContext.relatedStudents)
      ? privacyContext.relatedStudents
      : [],
    sensitiveEntities:Array.isArray(privacyContext.sensitiveEntities)
      ? privacyContext.sensitiveEntities
      : [],
    extraForbiddenValues:Array.isArray(privacyContext.extraForbiddenValues)
      ? privacyContext.extraForbiddenValues
      : [],
    messages,
  };
}

async function preparePrivacyMessages(body, promptType, messages) {
  const privacyGatewayModule = await import('./_lib/ai-privacy-gateway.cjs');
  const privacyGateway = privacyGatewayModule.default || privacyGatewayModule;
  const prepared = privacyGateway.preparePrivacySafeMessages(
    getPrivacyRequestInput(body, promptType, messages)
  );
  return { privacyGateway, prepared };
}

const OLLI_COMPOUND_KOREAN_SURNAMES = new Set([
  '남궁', '황보', '제갈', '선우', '독고', '동방', '사공', '서문',
]);

function getFeedbackDisplayStudentName(name) {
  const original = String(name || '').trim();
  const compact = original.replace(/\s+/g, '');
  if (!compact || !/^[가-힣]+$/.test(compact)) return original;
  if (compact.length === 3) return compact.slice(1);
  if (
    compact.length === 4 &&
    OLLI_COMPOUND_KOREAN_SURNAMES.has(compact.slice(0, 2))
  ) {
    return compact.slice(2);
  }
  return compact;
}

function restorePrivacyResponseAliases(text, studentName) {
  let output = String(text || '');
  const displayName = getFeedbackDisplayStudentName(studentName);
  if (displayName) output = output.replace(/학생\s*A/g, displayName);
  output = output.replace(/학생\s*[B-Z]/g, '다른 친구');
  return output;
}

function createPrivacyStreamRewriter(studentName) {
  let carry = '';
  return {
    push(chunk) {
      const combined = carry + String(chunk || '');
      const codePoints = Array.from(combined);
      if (codePoints.length <= 8) {
        carry = combined;
        return '';
      }
      const cut = codePoints.length - 8;
      const ready = codePoints.slice(0, cut).join('');
      carry = codePoints.slice(cut).join('');
      return restorePrivacyResponseAliases(ready, studentName);
    },
    flush() {
      const ready = carry;
      carry = '';
      return restorePrivacyResponseAliases(ready, studentName);
    },
  };
}

function extractReplyText(data) {
  return (
    data.output_text ||
    data.output
      ?.flatMap((item) => item.content || [])
      ?.filter((item) => item.type === 'output_text')
      ?.map((item) => item.text || '')
      ?.join('\n')
      ?.trim()
  );
}

function extractDeltaFromSsePayload(payload) {
  if (!payload || payload === '[DONE]') return '';

  let data;
  try {
    data = JSON.parse(payload);
  } catch {
    return '';
  }

  // Responses API emits both incremental delta events and final/done events.
  // Only forward true output_text deltas so the final full text is not appended again.
  if (data?.type !== 'response.output_text.delta') return '';
  return typeof data.delta === 'string' ? data.delta : '';
}

async function streamOpenAiResponse(openaiRes, res, options = {}) {
  if (!openaiRes.body || typeof openaiRes.body.getReader !== 'function') {
    throw new Error('스트리밍 응답을 읽을 수 없습니다.');
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const reader = openaiRes.body.getReader();
  const decoder = new TextDecoder();
  const responseRewriter = createPrivacyStreamRewriter(options.studentName || '');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let boundaryIndex = buffer.indexOf('\n\n');
    while (boundaryIndex !== -1) {
      const block = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);

      const dataLines = block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());

      if (dataLines.length > 0) {
        const delta = extractDeltaFromSsePayload(dataLines.join('\n'));
        if (delta) {
          const visibleDelta = responseRewriter.push(delta);
          if (visibleDelta) res.write(visibleDelta);
        }
      }

      boundaryIndex = buffer.indexOf('\n\n');
    }
  }

  if (buffer.trim()) {
    const dataLines = buffer
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());

    if (dataLines.length > 0) {
      const delta = extractDeltaFromSsePayload(dataLines.join('\n'));
      if (delta) {
        const visibleDelta = responseRewriter.push(delta);
        if (visibleDelta) res.write(visibleDelta);
      }
    }
  }

  const finalVisibleText = responseRewriter.flush();
  if (finalVisibleText) res.write(finalVisibleText);
  res.end();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const startedAt = Date.now();
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  let telemetry = getTelemetryContext(req, body);
  let usageLogged = false;

  async function logUsage(result = {}) {
    if (usageLogged) return;
    usageLogged = true;
    await writeUsageLog({
      ...telemetry,
      model: process.env.OPENAI_MODEL || 'gpt-5-mini',
      latencyMs: Date.now() - startedAt,
      ...result,
    });
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    await logUsage({
      success: false,
      errorCode: 'HTTP_405',
      errorMessage: 'Method not allowed',
    });
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { promptType = 'class', messages, stream = false, warmup = false } = body;
    telemetry = getTelemetryContext(req, { ...body, promptType });

    if (!process.env.OPENAI_API_KEY) {
      await logUsage({
        success: false,
        errorCode: 'OPENAI_API_KEY_MISSING',
        errorMessage: 'OPENAI_API_KEY가 서버 환경변수에 설정되지 않았습니다.',
      });
      return res.status(500).json({
        error: 'OPENAI_API_KEY가 Vercel 환경변수에 설정되지 않았습니다.',
      });
    }

    if (!Array.isArray(messages)) {
      await logUsage({
        success: false,
        errorCode: 'INVALID_MESSAGES',
        errorMessage: 'messages 형식이 올바르지 않습니다.',
      });
      return res.status(400).json({
        error: 'messages 형식이 올바르지 않습니다.',
      });
    }

    if (promptType === 'talk') {
      await assertTeamTalkAiEnabled(body);
    }

    let systemPrompt;
    try {
      systemPrompt = await loadSystemPrompt(promptType);
    } catch (error) {
      if (error?.statusCode === 400) {
        await logUsage({
          success: false,
          errorCode: 'INVALID_PROMPT_TYPE',
          errorMessage: error.message,
        });
        return res.status(400).json({
          error: error.message,
        });
      }
      throw error;
    }

    const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
    const isWarmup = warmup === true;
    const explicitPromptCache = supportsExplicitPromptCache(model);
    let privacyPrepared = null;
    let privacyGateway = null;
    let responseStudentName = String(body.studentName || body.student_name || '').trim();

    let requestMessages = isWarmup && !explicitPromptCache
      ? [{
          role: 'user',
          content: '프롬프트 캐시 준비 요청입니다. "준비"라고만 답하세요.',
        }]
      : messages;

    if (!isWarmup) {
      const privacyResult = await preparePrivacyMessages(body, promptType, requestMessages);
      privacyPrepared = privacyResult.prepared;
      privacyGateway = privacyResult.privacyGateway;
      requestMessages = privacyPrepared.messages;
      responseStudentName = privacyPrepared.subjectName || responseStudentName;
    }

    const input = buildResponseInput(requestMessages, systemPrompt, {
      explicitSystemCache: explicitPromptCache,
    });

    if (privacyPrepared && privacyGateway) {
      privacyGateway.assertPreparedPrivacyEgress(
        input.filter((item) => item?.role !== 'system'),
        privacyPrepared
      );
    }
    const openAiBody = {
      model,
      input,
      reasoning: {
        effort: 'minimal',
      },
      prompt_cache_key: getPromptCacheKey(promptType),
    };

    if (explicitPromptCache) {
      openAiBody.prompt_cache_options = {
        mode: 'explicit',
        ttl: '30m',
        ...(isWarmup ? { prewarm: true } : {}),
      };
    } else if (isWarmup) {
      // Older models do not support prompt_cache_options.prewarm.
      // Run a tiny hidden request with the same stable system-prefix instead.
      openAiBody.max_output_tokens = 32;
    }

    if (!isWarmup && stream === true) openAiBody.stream = true;

    const openaiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(openAiBody),
    });

    if (isWarmup) {
      const rawWarmup = await openaiRes.text();
      let warmupData;
      try {
        warmupData = rawWarmup ? JSON.parse(rawWarmup) : {};
      } catch {
        warmupData = { raw: rawWarmup };
      }

      if (!openaiRes.ok) {
        const message = warmupData?.error?.message || warmupData?.message || 'OpenAI 캐시 준비 요청 실패';
        await logUsage({
          success: false,
          promptType: `${promptType}_warmup`,
          errorCode: `OPENAI_HTTP_${openaiRes.status}`,
          errorMessage: message,
        });
        return res.status(openaiRes.status).json({
          error: message,
          detail: warmupData,
        });
      }

      const usage = extractUsage(warmupData);
      await logUsage({
        success: true,
        promptType: `${promptType}_warmup`,
        ...usage,
      });
      return res.status(200).json({
        ok: true,
        warmed: true,
        model,
        inputTokens: usage.inputTokens,
        cachedTokens: usage.cachedTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
      });
    }

    if (stream === true) {
      if (!openaiRes.ok) {
        const rawError = await openaiRes.text();
        let errorData;
        try {
          errorData = rawError ? JSON.parse(rawError) : {};
        } catch {
          errorData = { raw: rawError };
        }
        const message = errorData?.error?.message || errorData?.message || 'OpenAI 요청 실패';
        await logUsage({
          success: false,
          errorCode: `OPENAI_HTTP_${openaiRes.status}`,
          errorMessage: message,
        });
        return res.status(openaiRes.status).json({
          error: message,
          detail: errorData,
        });
      }

      await streamOpenAiResponse(openaiRes, res, {
        studentName:responseStudentName,
      });
      await logUsage({ success: true });
      return;
    }

    const rawText = await openaiRes.text();
    let data;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = { raw: rawText };
    }

    if (!openaiRes.ok) {
      const message = data?.error?.message || data?.message || 'OpenAI 요청 실패';
      await logUsage({
        success: false,
        errorCode: `OPENAI_HTTP_${openaiRes.status}`,
        errorMessage: message,
      });
      return res.status(openaiRes.status).json({
        error: message,
        detail: data,
      });
    }

    const rawReplyText = extractReplyText(data);
    const replyText = restorePrivacyResponseAliases(rawReplyText, responseStudentName);
    if (!replyText) {
      await logUsage({
        success: false,
        errorCode: 'EMPTY_RESPONSE',
        errorMessage: '응답 본문이 비어 있습니다.',
      });
      return res.status(500).json({
        error: '응답 본문이 비어 있습니다.',
        detail: data,
      });
    }

    const usage = extractUsage(data);
    await logUsage({ success: true, ...usage });
    return res.status(200).json({ reply: replyText });
  } catch (error) {
    await logUsage({
      success: false,
      errorCode: safeLogText(error?.code || error?.name || 'SERVER_ERROR', 80),
      errorMessage: error?.message || '서버 오류가 발생했습니다.',
    });
    if (res.writableEnded) return;
    return res.status(Number(error?.statusCode || 500)).json({
      error: error.message || '서버 오류가 발생했습니다.',
    });
  }
}
