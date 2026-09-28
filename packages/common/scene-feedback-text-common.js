/* PC/Phone common scene-card feedback text helpers. */

function buildSceneCardUserText(extraText) { const selected = getSelectedScenePayload(); const memo = typeof extraText === 'string' ? extraText.trim() : (document.getElementById('sceneMemoInput')?.value || '').trim(); const sceneLines = selected.length ? selected.map(item => `- ${item.no}. ${item.title}\n  메인질문: ${item.main}\n  확장질문: ${item.sub}\n  핵심키워드: ${item.keywords.join(', ')}`).join('\n') : '- 선택된 장면 없음'; return `아래 장면카드 선택 내용과 선생님 메모를 바탕으로 학부모에게 보낼 따뜻하고 전문적인 피드백을 작성해줘.\n\n[선택된 장면카드]\n${sceneLines}\n\n[선생님 메모]\n${memo}`; }

function extractFutureDirectionFromFeedback(text, fallback = '') {
  const direct = String(fallback || '').trim();
  if (direct) return direct;

  const source = String(text || '').replace(/\r/g, '').trim();
  if (!source) return '';

  const pattern = /(?:^|\n)\s*(?:\d+[.)]\s*)?(?:앞으로의\s*지도\s*방향|앞으로의\s*지도방향|향후\s*지도\s*방향|다음\s*지도\s*방향|다음\s*수업\s*방향|앞으로의\s*수업\s*방향|다음\s*단계\s*수업\s*방향|다음\s*수업에서\s*이어갈\s*방향)\s*[:：]?\s*([\s\S]*?)(?=\n\s*(?:\d+[.)]\s*)?(?:[가-힣A-Za-z ]{2,30})\s*[:：]|\n\s*\d+[.)]\s|$)/i;

  const match = source.match(pattern);
  if (match && match[1]) {
    const extracted = match[1]
      .split('\n')
      .map(line => line.replace(/^\s*[-•·]\s*/, '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (extracted) return extracted;
  }

  // 제목형 문단이 없을 때는 마지막 의미 있는 문단을 앞으로의 지도 방향으로 사용합니다.
  const paragraphs = source
    .split(/\n{2,}/)
    .map(p => p.replace(/\[TYPE:[A-Z]+\]/gi, '').trim())
    .filter(Boolean);

  const lastParagraph = [...paragraphs].reverse().find(p => {
    const compact = p.replace(/\s+/g, '');
    if (!compact) return false;
    if (/^(안녕하세요|오늘|이번수업)/.test(compact) && compact.length < 35) return false;
    return compact.length >= 18;
  });

  if (lastParagraph) {
    return lastParagraph
      .split('\n')
      .map(line => line.replace(/^\s*[-•·]\s*/, '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return '';
}
function getFutureDirectionFromApiData(data, feedbackText) {
  const candidates = [
    data?.futureDirection,
    data?.future_direction,
    data?.forwardDirection,
    data?.guideDirection,
    data?.guidanceDirection,
    data?.nextDirection,
    data?.next_direction,
    data?.nextStepDirection,
    data?.next_step_direction,
    data?.metadata?.futureDirection,
    data?.meta?.futureDirection,
    data?.result?.futureDirection
  ];
  const direct = candidates.map(v => String(v || '').trim()).find(Boolean) || '';
  return extractFutureDirectionFromFeedback(feedbackText, direct);
}
function getMemoFutureDirectionLine(feedbackText, explicitDirection = '') {
  const extracted = extractFutureDirectionFromFeedback(feedbackText, explicitDirection);
  if (extracted) return `앞으로의 지도방향 : ${extracted}`;

  const compact = String(feedbackText || '')
    .replace(/\[TYPE:[A-Z]+\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return compact
    ? `앞으로의 지도방향 : ${compact.slice(0, 160)}${compact.length > 160 ? '…' : ''}`
    : '';
}
