function buildSceneCardUserText(extraText) { const selected = getSelectedScenePayload(); const memo = typeof extraText === 'string' ? extraText.trim() : (document.getElementById('sceneMemoInput')?.value || '').trim(); const sceneLines = selected.length ? selected.map(item => `- ${item.no}. ${item.title}\n  메인질문: ${item.main}\n  확장질문: ${item.sub}\n  핵심키워드: ${item.keywords.join(', ')}`).join('\n') : '- 선택된 장면 없음'; return `아래 장면카드 선택 내용과 선생님 메모를 바탕으로 학부모에게 보낼 따뜻하고 전문적인 피드백을 작성해줘.\n\n[선택된 장면카드]\n${sceneLines}\n\n[선생님 메모]\n${memo}`; }


let feedbackLoadingTimer = null;
let feedbackLoadingTypingTimer = null;
let feedbackLoadingStep = 0;
function getFeedbackLoadingSteps(type) {
  return [
    ['선생님의 관찰 기록을 바탕으로', '아이의 수업 상황을 시뮬레이션 중입니다.'],
    ['선생님의 관찰 기록을 바탕으로', '아이의 실패 / 막힘 / 감정변화를 성장의 흐름으로 정리하고 있습니다.'],
    ['선생님의 관찰 기록이', '부모님께 잘 전달 될수 있도록 키워드 요소를 분석 중입니다.']
  ];
}
function typeFeedbackLoadingText(el, text, done) {
  if (!el) { if (done) done(); return; }
  if (feedbackLoadingTypingTimer) {
    clearInterval(feedbackLoadingTypingTimer);
    feedbackLoadingTypingTimer = null;
  }
  let i = 0;
  el.innerHTML = '<span class="feedbackLoadingCursor"></span>';
  feedbackLoadingTypingTimer = setInterval(() => {
    i += 1;
    el.innerHTML = escapeHtml(text.slice(0, i)) + '<span class="feedbackLoadingCursor"></span>';
    if (i >= text.length) {
      clearInterval(feedbackLoadingTypingTimer);
      feedbackLoadingTypingTimer = null;
      if (done) done();
    }
  }, 42);
}
function renderFeedbackLoadingStep(steps) {
  const title = document.getElementById('feedbackLoadingTitle');
  const body = document.getElementById('feedbackLoadingText');
  const step = steps[feedbackLoadingStep];
  if (!step) return;
  typeFeedbackLoadingText(title, step[0], () => {
    typeFeedbackLoadingText(body, step[1]);
  });
}
function showFeedbackLoading(type='class') {
  hideFeedbackLoading();
  const steps = getFeedbackLoadingSteps(type);
  feedbackLoadingStep = 0;
  const overlay = document.createElement('div');
  overlay.id = 'feedbackLoadingOverlay';
  overlay.className = 'feedbackLoadingOverlay';
  overlay.innerHTML = `<div class="feedbackLoadingCard">
    <div class="feedbackLoadingKicker">피드백 문장 정리 중</div>
    <div class="feedbackLoadingTitle" id="feedbackLoadingTitle"></div>
    <div class="feedbackLoadingText" id="feedbackLoadingText"></div>
    <div class="feedbackLoadingDots"><span></span><span></span><span></span></div>
  </div>`;
  document.body.appendChild(overlay);
  renderFeedbackLoadingStep(steps);
  feedbackLoadingTimer = setInterval(() => {
    const nextStep = feedbackLoadingStep + 1;
    if (nextStep >= steps.length) {
      clearInterval(feedbackLoadingTimer);
      feedbackLoadingTimer = null;
      return;
    }
    feedbackLoadingStep = nextStep;
    renderFeedbackLoadingStep(steps);
  }, 9750);
}
function hideFeedbackLoading() {
  if (feedbackLoadingTimer) {
    clearInterval(feedbackLoadingTimer);
    feedbackLoadingTimer = null;
  }
  if (feedbackLoadingTypingTimer) {
    clearInterval(feedbackLoadingTypingTimer);
    feedbackLoadingTypingTimer = null;
  }
  document.querySelectorAll('#feedbackLoadingOverlay, .feedbackLoadingOverlay').forEach(overlay => overlay.remove());
}

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
function resetElementaryMemoAfterFeedbackSave() {
  if (!currentMemoStudent || currentMemoType !== 'elementary') return;
  clearStudentNoteDraftFromSupabase(currentMemoStudent, 'elementary_observation').catch(err => console.warn('노트 초안 삭제 실패:', err.message || err));
  clearMemoByStudent(currentMemoStudent);
  currentMemoStudent = { ...currentMemoStudent, memoUpdatedAt: '' };
  updateMemoStudentMetaDisplay(currentMemoStudent, '');
  clearElementaryAnalysisByStudent(currentMemoStudent);
  elementaryAnalysisDraft = getEmptyElementaryAnalysisState();
  selectedElementaryAnalysisHistoryId = '';
  const memo = document.getElementById('memoEditor');
  if (memo) {
    memo.readOnly = false;
    memo.value = '';
  }
  renderElementaryAnalysisSummaryCard(getEmptyElementaryAnalysisState(), { title: '분석 결과', createdAt: '' });
  renderElementaryAnalysisHistoryCards(currentMemoStudent);
  setMemoSaveStatus('자동 저장');
  if (typeof refreshMemoStudentSelectPopupIfOpen === 'function') refreshMemoStudentSelectPopupIfOpen();
}

function getCurrentMemoStudentName() {
  return currentMemoStudent?.name || document.getElementById('memoStudentName')?.textContent?.trim() || '';
}
async function autoSaveMemoFeedback(text, futureDirection = '') {
  const name = getCurrentMemoStudentName();
  const content = String(text || '').trim();
  if (!name) { alert('학생 이름을 찾지 못했어요.'); return; }
  if (!content) { alert('저장할 피드백 내용이 비어 있어요.'); return; }

  let targetStudent = currentMemoStudent && currentMemoStudent.id && currentMemoStudent.type === 'elementary' ? currentMemoStudent : null;
  if (!targetStudent) {
    const matches = getAllStudents().filter(student =>
      (student.type || 'elementary') === 'elementary' &&
      String(student.name || '').trim() === String(name || '').trim()
    );
    if (matches.length === 1) targetStudent = matches[0];
    else if (matches.length > 1) {
      alert('같은 이름의 학생이 여러 명 있습니다. 학생 목록에서 해당 학생을 다시 선택해 주세요.');
      return;
    }
  }
  if (!targetStudent) {
    alert('피드백을 저장할 학생 정보를 찾지 못했어요.');
    return;
  }

  const year = new Date().getFullYear();
  const date = new Date().toLocaleDateString('ko-KR');
  try {
    const payload = addOlliAcademyToPayload({
      student_id: targetStudent.id,
      student_name: targetStudent.name || name,
      content,
      feedback_type: 'class',
      future_direction: futureDirection || null,
      year,
      date
    }, '초등부 관찰 피드백 저장');
    await saveFeedbackRowVerified('feedbacks', payload, '초등부 관찰 피드백 저장');
    if (typeof refreshRecordsAfterFeedbackSave === 'function') await refreshRecordsAfterFeedbackSave();
    else if (typeof loadRecords === 'function') await loadRecords('');
    if (currentMemoStudent && String(currentMemoStudent.id || '') === String(targetStudent.id || '')) resetElementaryMemoAfterFeedbackSave();
    closeMemoFeedbackPopup();
    showPushToast('피드백을 기록실에 저장했어요.');
  } catch (err) {
    console.error('초등부 관찰 피드백 저장 오류:', err);
    closeMemoFeedbackPopup();
    alert(`피드백 저장 중 오류가 발생했어요.

${err.message || '알 수 없는 오류입니다.'}`);
  }
}

function closeMemoFeedbackPopup() {
  const overlay = document.getElementById('memoFeedbackPopupOverlay');
  if (overlay) overlay.remove();
}
function enterMemoFeedbackEdit(btn) {
  const card = btn.closest('.memoFeedbackPopupCard');
  if (!card) return;
  const textEl = card.querySelector('.memoFeedbackPopupText');
  const current = textEl ? textEl.textContent : '';
  card.classList.add('open');
  card.classList.add('editing');
  if (textEl) {
    textEl.outerHTML = `<textarea class="memoFeedbackEditBox">${escapeHtml(current)}</textarea>`;
    const box = card.querySelector('.memoFeedbackEditBox');
    if (box) {
      box.focus();
      box.selectionStart = box.selectionEnd = box.value.length;
    }
  }
}
function finishMemoFeedbackEdit(btn) {
  const card = btn.closest('.memoFeedbackPopupCard');
  if (!card) return;
  const box = card.querySelector('.memoFeedbackEditBox');
  const edited = box ? box.value.trim() : '';
  if (!edited) { alert('피드백 내용이 비어 있어요.'); return; }
  card._feedbackText = edited;
  card._futureDirection = extractFutureDirectionFromFeedback(edited, card._futureDirection || '');
  if (box) {
    box.outerHTML = `<div class="memoFeedbackPopupText">${escapeHtml(edited)}</div>`;
  }
  card.classList.remove('editing');
}
async function saveElementaryFeedbackDirectly(text, options = {}) {
  const content = String(text || '').trim();
  if (!content) throw new Error('저장할 피드백 내용이 비어 있습니다.');
  const studentName = normalizeTodayFeedbackStudentName(options.studentName || currentMemoStudent?.name || '');
  if (!studentName) throw new Error('아이 이름을 찾지 못했습니다.');
  const selectedStudentId = options.studentId || currentMemoStudent?.id || '';
  const savedStudent = await getOrCreateStudentForSupabaseSave(studentName, 'elementary', selectedStudentId);
  const rawType = options.feedbackType || 'class';
  const tableName = getFeedbackTableNameByType(rawType);
  const feedbackType = tableName === 'fail_feedbacks' ? 'fail' : String(rawType || 'class').toLowerCase();
  const now = new Date();
  const payload = addOlliAcademyToPayload({
    student_id: savedStudent.id,
    student_name: savedStudent.name || studentName,
    content,
    feedback_type: feedbackType,
    year: now.getFullYear(),
    date: now.toLocaleDateString('ko-KR')
  }, tableName === 'fail_feedbacks' ? '초등부 성장 피드백 저장' : '초등부 피드백 저장');
  const savedRow = await saveFeedbackRowVerified(tableName, payload, tableName === 'fail_feedbacks' ? '초등부 성장 피드백 저장' : '초등부 피드백 저장');
  await refreshRecordsAfterFeedbackSave();
  if (tableName === 'feedbacks' && currentMemoStudent && String(currentMemoStudent.id || '') === String(savedStudent.id || '')) resetElementaryMemoAfterFeedbackSave();
  if (tableName === 'fail_feedbacks' && typeof resetGrowthFeedbackAfterSuccessfulSave === 'function') resetGrowthFeedbackAfterSuccessfulSave('elementary');
  return { student: savedStudent, row: savedRow, tableName };
}

async function requestSceneCardFeedbackFromElementary(studentName, text, analysisPromptText, options = {}) {
  if (loading) return;

  const feedbackMonth = String(options.feedbackMonth || getFeedbackMonthLabel()).trim();
  const feedbackMonthNumber = Number(options.feedbackMonthNumber || getFeedbackMonthNumber());
  const combined = `${studentName} 초등부 피드백 기록
피드백 기준 월: ${feedbackMonth}

${text}${analysisPromptText ? `

[초등부 분석 데이터]
${analysisPromptText}` : ''}`;
  const userText = buildSceneCardUserText(combined);

  const btn = document.getElementById('memoFeedbackBtn');
  loading = true;
  showFeedbackLoading('elementary');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '작성 중...';
  }

  try {
    const res = await fetch('/api/chat', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        promptType: options.promptType || 'elementary',
        studentName: normalizeTodayFeedbackStudentName(studentName),
        feedbackMonth,
        feedbackMonthNumber,
        messages:[{ role:'user', content: buildTodayFeedbackRequestContent(userText, studentName, feedbackMonth) }]
      })
    });
    const rawText = await res.text();
    let data;
    try { data = rawText ? JSON.parse(rawText) : {}; } catch { data = { raw: rawText }; }
    if (!res.ok) throw new Error(getApiErrorMessage(res.status, data));
    const rawReply = String(data.reply || '').trim();
    if (!rawReply) throw new Error('응답 본문이 비어 있습니다.');
    const parsed = parseReplyType(rawReply);
    const cleanText = parsed.cleanText || rawReply;
    hideFeedbackLoading();
    const futureDirection = getFutureDirectionFromApiData(data, cleanText);
    await saveElementaryFeedbackDirectly(cleanText, {
      studentName: normalizeTodayFeedbackStudentName(studentName),
      studentId: currentMemoStudent?.id || '',
      feedbackType: options.feedbackType || 'class',
      feedbackMonth,
      feedbackMonthNumber,
      futureDirection
    });
    showPushToast(`${studentName} 피드백을 기록실에 저장했어요.`);
  } catch (err) {
    hideFeedbackLoading();
    console.error('초등부 피드백 생성/저장 오류:', err);
    alert(`초등부 피드백 생성 또는 저장 중 오류가 발생했어요.\n\n${err.message || '알 수 없는 오류입니다.'}`);
  } finally {
    loading = false;

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="memoFeedbackBottomText">피드백 생성</span><span class="memoFeedbackArrowCircle" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path></svg></span>';
    }
  }
}

