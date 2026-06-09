import {
  CLASS_SYSTEM_PROMPT,
  FAIL_SYSTEM_PROMPT,
  ELEMENTARY_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
} from './prompts.js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { promptType = 'class', messages } = req.body || {};

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: 'OPENAI_API_KEY가 Vercel 환경변수에 설정되지 않았습니다.',
      });
    }

    if (!Array.isArray(messages)) {
      return res.status(400).json({
        error: 'messages 형식이 올바르지 않습니다.',
      });
    }

    const promptMap = {
      class: CLASS_SYSTEM_PROMPT,
      fail: FAIL_SYSTEM_PROMPT,
      elementary: ELEMENTARY_SYSTEM_PROMPT,
      summary: SUMMARY_SYSTEM_PROMPT,
    };

    const systemPrompt = promptMap[promptType];

    if (!systemPrompt) {
      return res.status(400).json({
        error: `알 수 없는 promptType입니다: ${promptType}`,
      });
    }

    const input = [];

    // system prompt
    input.push({
      role: 'system',
      content: [
        {
          type: 'input_text',
          text: String(systemPrompt),
        },
      ],
    });

    // chat history
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

    const openaiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5-mini',
        input,
      }),
    });

    const rawText = await openaiRes.text();

    let data;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = { raw: rawText };
    }

    if (!openaiRes.ok) {
      return res.status(openaiRes.status).json({
        error: data?.error?.message || data?.message || 'OpenAI 요청 실패',
        detail: data,
      });
    }

    const replyText =
      data.output_text ||
      data.output
        ?.flatMap((item) => item.content || [])
        ?.filter((item) => item.type === 'output_text')
        ?.map((item) => item.text || '')
        ?.join('\n')
        ?.trim();

    if (!replyText) {
      return res.status(500).json({
        error: '응답 본문이 비어 있습니다.',
        detail: data,
      });
    }

    return res.status(200).json({
      reply: replyText,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || '서버 오류가 발생했습니다.',
    });
  }
}
