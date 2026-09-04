const ELEMENTARY_ANALYSIS_OPTIONS = {
  strengths: ['상상력이 풍부함','자기 생각이 분명함','몰입력이 좋음','새로운 시도를 함','주제 이해가 빠름','표현 욕구가 강함','이야기를 잘 만듦','관찰하려는 태도가 있음','색 사용이 적극적임','완성하려는 의지가 있음','친구 작품에서 자극을 받음','선생님의 피드백을 수용함'],
  needs: ['아이디어가 너무 많아 정리가 어려움','시작을 망설임','정답을 찾으려 함','실수를 두려워함','친구 반응에 흔들림','설명이 길어지면 멈춤','초반 몰입은 좋으나 후반이 약함','마무리를 빠르게 끝내려 함','관찰보다 상상에 의존함','형태보다 이야기를 우선함','디테일을 생략함','배경을 간단히 처리함','수정 단계에서 불안해함','선택지가 많으면 멈춤','자기 생각은 많지만 정리가 어려움','빠르게 끝내고 싶어함','기준이 없으면 억울해하거나 흔들림','칭찬과 인정에 따라 집중도가 달라짐'],
  blockedStages: ['주제 이해 단계','아이디어 전개 단계','자료 관찰 단계','스케치 시작 단계','큰 형태 잡기 단계','인물 구조 표현 단계','화면 구성 단계','중심 장면 정하기 단계','채색 계획 단계','배경 표현 단계','디테일 추가 단계','수정 단계','마무리 단계','시간 배분 단계','수업 전환 단계','친구와 비교되는 상황','선생님이 확인하는 순간'],
  guideAreas: ['아이디어 전개 지도','화면 구성 및 공간 인식 지도','관찰 기반 표현 지도','집중 조절 및 작업 태도 지도','작업 속도 및 자기 조절 지도','마무리 집중 및 완성도 지도','색 구성 및 표현 계획 지도','선택력 및 판단 기준 지도'],
  teacherActions: ['핵심 장면을 먼저 정하게 함','표현할 요소를 줄여줌','선택지를 2~3개로 제한함','큰 형태부터 잡게 함','몸통, 머리, 팔다리 순서로 나누어 지도함','자료를 보고 특징을 찾게 함','배경 중 중요한 부분만 먼저 정하게 함','마무리할 구역을 지정함','중간 점검 시간을 넣음','작업 순서를 나누어 제시함','색을 먼저 계획하게 함','수정할 부분을 하나만 고르게 함','속도보다 완성 기준을 먼저 잡아줌','친구 반응보다 자기 기준을 확인하게 함','반복적으로 확인 기준을 적용함'],
  futureDirections: ['아이디어를 유지하되 중심 장면을 정리하는 방향','관찰과 상상을 연결하는 방향','빠른 완성보다 마무리 밀도를 높이는 방향','선택 기준을 스스로 세우는 방향','화면의 중심과 보조 요소를 구분하는 방향','작업 순서를 구조화하는 방향','후반 집중을 유지하는 방향','수정 과정을 부담이 아닌 점검으로 받아들이는 방향','속도보다 완성 기준을 인식하는 방향','표현 욕구를 조절 가능한 과정으로 연결하는 방향','자기 생각을 그림 안에서 정리하는 방향','디테일을 완성도의 일부로 인식하는 방향'],
  tendencies: {
    '완벽주의': ['정답: 정답이 있을 것 같아서 시작을 못 함','실수: 틀리면 망친다는 감각이 강함','비교: 친구/형제와 비교하면 급격히 위축','평가: 선생님/부모가 보고 있으면 손이 굳음','통제: 계획이 조금만 깨져도 멈춤'],
    '산만형': ['자극: 주변 소리/사람/물건에 바로 끌림','전환: 활동이 바뀌는 순간 집중이 끊김','과부하: 선택지가 많거나 설명이 길면 멈춤','흥미: 재미가 떨어지면 즉시 딴짓','에너지: 몸이 먼저 움직여야 집중이 살아남','관계: 친구 반응/선생님 시선에 따라 집중이 흔들림'],
    '예민·불안형': ['환경: 소리/냄새/온도/빛 같은 자극에 흔들림','예측불가: 순서가 갑자기 바뀌면 불안 상승','평가: 보고 있거나 비교되는 느낌에 위축','실수: 틀리면 무너지는 느낌이 큼','관계: 친구 말/표정, 선생님 톤에 크게 반응','속도: 느린 자기 모습 자체가 불안'],
    '주도욕·승부욕': ['승리: 1등/완벽/빠름에 집착','주도권: 지시받기보다 내가 정하고 싶어함','인정: 칭찬/주목이 없으면 의욕 저하','규칙: 기준이 불명확하면 억울해함','통제: 내 계획이 깨지면 화/포기','관계: 친구를 이끌거나 지배하려 듦'],
    '소극형': ['노출: 사람들 앞에서 주목받으면 굳음','실수: 틀리면 창피하다고 느껴 시작을 미룸','속도: 느린 자신이 보일까 봐 위축','관계: 친구/선생님 반응에 민감하게 눈치 봄','선택: 선택지가 많으면 멈춤','완성: 결과 부담이 커서 손이 안 나감'],
    '마무리 약한 아이': ['흥미: 처음만 재미있고 반복·정리 단계에서 지루해짐','성취: 했다고 느끼는 순간 끝났다고 판단','체력: 후반에 손/집중력이 떨어짐','디테일: 디테일을 추가 작업으로 인식','시간감각: 초반에 시간을 다 써버림','자기검열: 마무리에서 이상해 보여 포기하거나 덮음']
  }
};

const ELEMENTARY_ANALYSIS_FIELD_LABELS = {
  strengths: '오늘 아이의 강점', needs: '오늘 가장 지도가 필요했던 부분', blockedStages: '막힘이 생긴 수업 단계', tendencies: '아이를 망설이게 한 성향 단서', guideAreas: '핵심 지도 영역', teacherActions: '오늘 적용한 지도 방식', futureDirections: '앞으로의 지도 방향'
};

function getEmptyElementaryAnalysisState() {
  return { strengths: [], needs: [], blockedStages: [], tendencies: [], guideAreas: [], teacherActions: [], futureDirections: [], extraTexts: { strengths: '', needs: '', guideAreas: '', teacherActions: '', futureDirections: '' }, updatedAt: '' };
}
function getElementaryAnalysisKey(student) { return student?.id ? ELEMENTARY_ANALYSIS_PREFIX + student.id : ''; }
function normalizeElementaryAnalysisState(data) { const base = getEmptyElementaryAnalysisState(); const source = data && typeof data === 'object' ? data : {}; ['strengths','needs','blockedStages','tendencies','guideAreas','teacherActions','futureDirections'].forEach(field => { base[field] = Array.isArray(source[field]) ? source[field].filter(Boolean) : []; }); base.extraTexts = { ...base.extraTexts, ...(source.extraTexts && typeof source.extraTexts === 'object' ? source.extraTexts : {}) }; base.updatedAt = source.updatedAt || ''; return base; }
function getElementaryAnalysisByStudent(student) { const key = getElementaryAnalysisKey(student); if (!key) return getEmptyElementaryAnalysisState(); try { const raw = localStorage.getItem(key); return normalizeElementaryAnalysisState(raw ? JSON.parse(raw) : {}); } catch { return getEmptyElementaryAnalysisState(); } }
function setElementaryAnalysisByStudent(student, data) { const key = getElementaryAnalysisKey(student); if (!key) return; const next = normalizeElementaryAnalysisState(data); next.studentId = student.id || ''; next.studentName = student.name || ''; next.updatedAt = new Date().toISOString(); localStorage.setItem(key, JSON.stringify(next)); }
function clearElementaryAnalysisByStudent(student) { const key = getElementaryAnalysisKey(student); if (!key) return; localStorage.removeItem(key); }
function elementaryAnalysisPayloadForCompare(state) {
  const normalized = normalizeElementaryAnalysisState(state);
  return JSON.stringify({
    strengths: normalized.strengths || [],
    needs: normalized.needs || [],
    blockedStages: normalized.blockedStages || [],
    tendencies: normalized.tendencies || [],
    guideAreas: normalized.guideAreas || [],
    teacherActions: normalized.teacherActions || [],
    futureDirections: normalized.futureDirections || [],
    extraTexts: normalized.extraTexts || {}
  });
}
function elementaryAnalysisStatesEqual(a, b) {
  return elementaryAnalysisPayloadForCompare(a) === elementaryAnalysisPayloadForCompare(b);
}
function getElementaryAnalysisHistoryKey(student) { return student?.id ? `${ELEMENTARY_ANALYSIS_PREFIX}${student.id}_history` : ''; }
function getElementaryAnalysisHistoryByStudent(student) {
  const key = getElementaryAnalysisHistoryKey(student);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(Boolean) : [];
  } catch {
    return [];
  }
}
function setElementaryAnalysisHistoryByStudent(student, items) {
  const key = getElementaryAnalysisHistoryKey(student);
  if (!key) return;
  const safe = Array.isArray(items) ? items.slice(0, 3) : [];
  localStorage.setItem(key, JSON.stringify(safe));
}
function archiveElementaryAnalysisSnapshot(student, data) {
  if (!student?.id) return;
  const normalized = normalizeElementaryAnalysisState(data);
  if (!elementaryAnalysisHasContent(normalized)) return;
  const history = getElementaryAnalysisHistoryByStudent(student);
  const createdAt = normalized.updatedAt || new Date().toISOString();
  const item = {
    id: `analysis_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt,
    title: '최근 분석',
    preview: buildElementaryAnalysisSummaryPreview(normalized),
    data: normalized
  };
  const next = [item, ...history].slice(0, 3);
  setElementaryAnalysisHistoryByStudent(student, next);
  return item;
}
function escapeJsSingleQuote(str) { return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function buildElementaryAnalysisChip(field, value) {
  const safeValue = escapeJsSingleQuote(value);
  return `<button type="button" class="elementaryChip" data-field="${field}" data-value="${escapeHtml(value)}" onclick="toggleElementaryAnalysisValue('${field}', '${safeValue}')">${escapeHtml(value)}</button>`;
}
function buildElementaryTendencyChip(group, value) {
  const combined = `${group} / ${value}`;
  const safeGroup = escapeJsSingleQuote(group);
  const safeValue = escapeJsSingleQuote(value);
  return `<button type="button" class="elementaryChip" data-field="tendencies" data-value="${escapeHtml(combined)}" onclick="toggleElementaryTendencyValue('${safeGroup}', '${safeValue}')">${escapeHtml(value)}</button>`;
}
function renderElementaryAnalysisOptions() {
  const map = { strengths: 'elementaryStrengthsGrid', needs: 'elementaryNeedsGrid', blockedStages: 'elementaryBlockedStagesGrid', guideAreas: 'elementaryGuideAreasGrid', teacherActions: 'elementaryTeacherActionsGrid', futureDirections: 'elementaryFutureDirectionsGrid' };
  Object.entries(map).forEach(([field, id]) => {
    const grid = document.getElementById(id);
    if (grid) grid.innerHTML = (ELEMENTARY_ANALYSIS_OPTIONS[field] || []).map(value => buildElementaryAnalysisChip(field, value)).join('');
  });
  const groupGrid = document.getElementById('elementaryTendencyGroupGrid');
  const wrap = document.getElementById('elementaryTendencyOptionsWrap');
  if (groupGrid) {
    groupGrid.innerHTML = Object.keys(ELEMENTARY_ANALYSIS_OPTIONS.tendencies).map(group => {
      const safeGroup = escapeJsSingleQuote(group);
      return `<button type="button" class="elementaryTendencyGroupBtn" data-group="${escapeHtml(group)}" onclick="toggleElementaryTendencyGroup('${safeGroup}')">${escapeHtml(group)}</button>`;
    }).join('');
  }
  if (wrap) {
    wrap.innerHTML = Object.entries(ELEMENTARY_ANALYSIS_OPTIONS.tendencies).map(([group, options]) =>
      `<div class="elementaryTendencyGroup" data-group-panel="${escapeHtml(group)}" style="display:none;"><div class="elementaryTendencyGroupTitle">${escapeHtml(group)}</div><div class="elementaryTendencyGrid">${options.map(value => buildElementaryTendencyChip(group, value)).join('')}</div></div>`
    ).join('');
  }
}
function syncElementaryAnalysisModal(state = getEmptyElementaryAnalysisState()) { const normalized = normalizeElementaryAnalysisState(state); document.querySelectorAll('.elementaryChip').forEach(btn => { const field = btn.dataset.field; const value = btn.dataset.value; const list = normalized[field] || []; btn.classList.toggle('active', list.includes(value)); }); document.querySelectorAll('.elementaryTendencyGroupBtn').forEach(btn => { const group = btn.dataset.group; const hasActive = normalized.tendencies.some(item => String(item).startsWith(group + ' / ')); btn.classList.toggle('active', hasActive); }); }
function getElementaryAnalysisStateFromModal() { const state = getEmptyElementaryAnalysisState(); document.querySelectorAll('.elementaryChip.active').forEach(btn => { const field = btn.dataset.field; const value = btn.dataset.value; if (field && value && Array.isArray(state[field]) && !state[field].includes(value)) state[field].push(value); }); state.extraTexts = { strengths: document.getElementById('elementaryStrengthsEtc')?.value.trim() || '', needs: document.getElementById('elementaryNeedsEtc')?.value.trim() || '', guideAreas: document.getElementById('elementaryGuideAreasEtc')?.value.trim() || '', teacherActions: document.getElementById('elementaryTeacherActionsEtc')?.value.trim() || '', futureDirections: document.getElementById('elementaryFutureDirectionsEtc')?.value.trim() || '' }; elementaryAnalysisDraft = normalizeElementaryAnalysisState(state); return elementaryAnalysisDraft; }
function fillElementaryAnalysisModal(state) { const normalized = normalizeElementaryAnalysisState(state); const extras = normalized.extraTexts || {}; const setVal = (id, value) => { const el = document.getElementById(id); if (el) el.value = value || ''; }; setVal('elementaryStrengthsEtc', extras.strengths); setVal('elementaryNeedsEtc', extras.needs); setVal('elementaryGuideAreasEtc', extras.guideAreas); setVal('elementaryTeacherActionsEtc', extras.teacherActions); setVal('elementaryFutureDirectionsEtc', extras.futureDirections); syncElementaryAnalysisModal(normalized); }
function toggleElementaryAnalysisValue(field, value) { if (!currentMemoStudent) return; const state = getElementaryAnalysisStateFromModal(); const list = Array.isArray(state[field]) ? [...state[field]] : []; const idx = list.indexOf(value); if (idx >= 0) list.splice(idx, 1); else list.push(value); state[field] = list; elementaryAnalysisDraft = normalizeElementaryAnalysisState(state); syncElementaryAnalysisModal(elementaryAnalysisDraft); }
function toggleElementaryTendencyValue(group, value) { toggleElementaryAnalysisValue('tendencies', `${group} / ${value}`); }
function toggleElementaryTendencyGroup(group) { let panel = null; document.querySelectorAll('[data-group-panel]').forEach(el => { if (el.dataset.groupPanel === group) panel = el; }); if (!panel) return; panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; }
function resetElementaryAnalysisModalScroll() {
  const modal = document.getElementById('elementaryAnalysisModal');
  const sheet = modal ? modal.querySelector('.analysisSheetPanel') : null;
  [modal, sheet, document.getElementById('elementaryTendencyOptionsWrap')].forEach(el => {
    if (!el) return;
    try { el.scrollTop = 0; } catch (e) {}
  });
  document.querySelectorAll('#elementaryAnalysisModal .elementaryAnalysisGrid, #elementaryAnalysisModal .elementaryAnalysisTextarea, #elementaryAnalysisModal [data-group-panel]').forEach(el => {
    try { el.scrollTop = 0; } catch (e) {}
  });
}
function openElementaryAnalysisModal() {
  if (!currentMemoStudent || currentMemoType !== 'elementary') return;
  renderElementaryAnalysisOptions();
  // 분석 팝업은 항상 새 입력 상태로 시작합니다.
  // 오늘의 분석 카드는 학생별로 저장해 유지하되, 팝업 선택지/기타 입력칸은 재오픈 시 이전 값이 다시 채워지지 않게 분리합니다.
  elementaryAnalysisDraft = getEmptyElementaryAnalysisState();
  fillElementaryAnalysisModal(elementaryAnalysisDraft);
  document.querySelectorAll('#elementaryAnalysisModal [data-group-panel]').forEach(el => { el.style.display = 'none'; });
  resetElementaryAnalysisModalScroll();
  const modal = document.getElementById('elementaryAnalysisModal');
  if (modal) modal.style.display = 'flex';
  requestAnimationFrame(resetElementaryAnalysisModalScroll);
}
function resetElementaryAnalysisModalView() {
  elementaryAnalysisDraft = getEmptyElementaryAnalysisState();
  fillElementaryAnalysisModal(elementaryAnalysisDraft);
  document.querySelectorAll('[data-group-panel]').forEach(el => { el.style.display = 'none'; });
  resetElementaryAnalysisModalScroll();
}
function closeElementaryAnalysisModal() {
  const modal = document.getElementById('elementaryAnalysisModal');
  if (modal) modal.style.display = 'none';
  resetElementaryAnalysisModalView();
}
function buildElementaryAnalysisMemoText(state, options = {}) {
  const normalized = normalizeElementaryAnalysisState(state);
  const now = new Date();
  const dateLabel = options.forPrompt ? '초등부 분석 선택 데이터' : `${now.getFullYear()}년 ${now.getMonth() + 1}월 기록`;
  const studentName = currentMemoStudent?.name || '학생이름';

  if (options.forPrompt) {
    const lines = [`[${dateLabel}]`];
    const addList = (field) => {
      const list = normalized[field] || [];
      const extra = normalized.extraTexts?.[field] || '';
      if (!list.length && !extra) return;
      lines.push('');
      lines.push(`${ELEMENTARY_ANALYSIS_FIELD_LABELS[field]} :`);
      if (list.length) list.forEach(item => lines.push(`- ${item}`));
      if (extra) lines.push(`- 기타: ${extra}`);
    };
    ['strengths','needs','blockedStages','tendencies','guideAreas','teacherActions','futureDirections'].forEach(addList);
    return lines.join('\n').trim();
  }

  const lines = [];
  lines.push(`${studentName}`);
  lines.push(`[${dateLabel}]`);
  lines.push('');

  const addList = (title, list, extra = '') => {
    if (!list.length && !extra) return;
    lines.push(`**${title}:**`);
    if (list.length) list.forEach(item => lines.push(`- ${item}`));
    if (extra) lines.push(`- 기타: ${extra}`);
    lines.push('');
  };

  addList('오늘 아이의 강점', normalized.strengths || [], normalized.extraTexts?.strengths || '');
  addList('오늘 가장 지도가 필요했던 부분', normalized.needs || [], normalized.extraTexts?.needs || '');
  addList('막힘이 생긴 수업 단계', normalized.blockedStages || '');
  addList('아이를 망설이게 한 성향 단서', normalized.tendencies || []);
  addList('핵심 지도 영역', normalized.guideAreas || [], normalized.extraTexts?.guideAreas || '');
  addList('오늘 적용한 지도 방식', normalized.teacherActions || [], normalized.extraTexts?.teacherActions || '');
  addList('앞으로의 지도 방향', normalized.futureDirections || [], normalized.extraTexts?.futureDirections || '');

  lines.push('');
  lines.push('');
  lines.push('[선생님 직접 메모]');
  lines.push('');
  lines.push('아이가 한 말 :');
  lines.push('');
  lines.push('선생님이 실제로 개입한 순간 :');
  lines.push('');
  lines.push('작품에서 보인 특징 :');
  lines.push('');
  lines.push('최근 성장 또는 변화 :');
  lines.push('');
  lines.push('학부모에게 꼭 전달하고 싶은 성장 포인트 :');
  lines.push('');

  return lines.join('\n').trim();
}
function elementaryAnalysisHasContent(state) {
  const normalized = normalizeElementaryAnalysisState(state);
  const hasList = ['strengths','needs','blockedStages','tendencies','guideAreas','teacherActions','futureDirections'].some(field => Array.isArray(normalized[field]) && normalized[field].length > 0);
  const hasExtra = Object.values(normalized.extraTexts || {}).some(value => String(value || '').trim());
  return hasList || hasExtra;
}
function buildElementaryAnalysisSummaryPreview(state) {
  const normalized = normalizeElementaryAnalysisState(state);
  const parts = [];
  const pick = (field) => {
    const list = Array.isArray(normalized[field]) ? normalized[field].filter(Boolean) : [];
    const extra = String(normalized.extraTexts?.[field] || '').trim();
    if (list.length) parts.push(list[0]);
    else if (extra) parts.push(extra);
  };
  ['strengths','needs','blockedStages','tendencies','guideAreas','teacherActions','futureDirections'].forEach(pick);
  return parts.filter(Boolean).slice(0, 3).join(' · ');
}
function formatElementaryAnalysisSummaryDate(dateValue) {
  const date = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const weekdays = ['일','월','화','수','목','금','토'];
  const ampm = date.getHours() >= 12 ? '오후' : '오전';
  let hour = date.getHours() % 12;
  if (hour === 0) hour = 12;
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()} ${weekdays[date.getDay()]} ${ampm} ${hour}:${minute}`;
}


function getPrimaryElementaryAnalysisDisplay(student) {
  if (!student?.id) return { data: {}, createdAt: '', id: '', source: 'empty' };
  const currentState = getElementaryAnalysisByStudent(student);
  if (elementaryAnalysisHasContent(currentState)) {
    return { data: currentState, createdAt: currentState.updatedAt || new Date().toISOString(), id: '', source: 'current' };
  }
  const history = getElementaryAnalysisHistoryByStudent(student);
  const latest = history.find(item => item && elementaryAnalysisHasContent(item.data || {}));
  if (latest) {
    return { data: latest.data || {}, createdAt: latest.createdAt || latest.data?.updatedAt || '', id: latest.id || '', source: 'history' };
  }
  return { data: currentState, createdAt: currentState.updatedAt || '', id: '', source: 'empty' };
}

function getDisplayedElementaryAnalysisState() {
  if (!currentMemoStudent) {
    return { data: {}, createdAt: '' };
  }
  if (!selectedElementaryAnalysisHistoryId) {
    return getPrimaryElementaryAnalysisDisplay(currentMemoStudent);
  }
  const history = getElementaryAnalysisHistoryByStudent(currentMemoStudent);
  const target = history.find(item => item.id === selectedElementaryAnalysisHistoryId);
  if (!target) {
    return getPrimaryElementaryAnalysisDisplay(currentMemoStudent);
  }
  return { data: target.data || {}, createdAt: target.createdAt || '' };
}
function buildElementaryAnalysisHistoryInnerHtml(student) {
  if (!student?.id) return '';
  const items = getElementaryAnalysisCycleItems(student);
  if (items.length < 2) return '';
  const label = `최근 분석 ${items.map((_, idx) => idx + 1).join(' • ')}`;
  return `
    <div class="elementaryAnalysisHistoryGrid elementaryAnalysisHistoryGridSingle">
      <button type="button" class="elementaryAnalysisHistoryBtn elementaryAnalysisHistoryCycleBtn ${selectedElementaryAnalysisHistoryId ? 'active' : ''}" onclick="event.stopPropagation(); cycleElementaryAnalysisHistoryCard();">
        <div class="elementaryAnalysisHistoryLine">${escapeHtml(label)}</div>
      </button>
    </div>`;
}

function renderElementaryAnalysisSummaryCard(state, options = {}) {
  const wrap = document.getElementById('elementaryAnalysisSummaryWrap');
  if (!wrap) return;

  const normalized = normalizeElementaryAnalysisState(state);
  const hasContent = elementaryAnalysisHasContent(normalized);

  if (!hasContent) {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }

  wrap.style.display = 'inline-flex';
  wrap.innerHTML = `
    <button type="button" class="elementaryAnalysisSummaryCard has-analysis is-collapsed" onclick="event.stopPropagation(); openElementaryAnalysisDetailFromCurrent();" aria-label="분석 결과 보기">
      <span class="elementaryAnalysisSummaryIcon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <rect x="5.2" y="4.6" width="13.6" height="14.8" rx="3"></rect>
          <path d="M8.4 9h7.2"></path>
          <path d="M8.4 12.4h7.2"></path>
          <path d="M8.4 15.8h4.4"></path>
        </svg>
      </span>
    </button>`;
}
function getElementaryAnalysisCycleItems(student) {
  if (!student?.id) return [];
  const currentState = getElementaryAnalysisByStudent(student);
  const items = [];
  if (elementaryAnalysisHasContent(currentState)) {
    items.push({ id: '', data: currentState, createdAt: currentState.updatedAt || '', isCurrent: true });
  }
  getElementaryAnalysisHistoryByStudent(student).slice(0, 2).forEach(item => {
    if (item && elementaryAnalysisHasContent(item.data || {})) items.push(item);
  });
  return items.slice(0, 3);
}
function renderElementaryAnalysisHistoryCards(student, activeId = '') {
  const wrap = document.getElementById('elementaryAnalysisHistoryWrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  wrap.style.display = 'none';
}
function forceRenderCurrentElementaryAnalysisResult() {
  if (!currentMemoStudent) return;
  const displayState = getPrimaryElementaryAnalysisDisplay(currentMemoStudent);
  selectedElementaryAnalysisHistoryId = '';
renderElementaryAnalysisSummaryCard(displayState.data || {}, { title: '분석 결과', createdAt: displayState.createdAt || '' });
  renderElementaryAnalysisHistoryCards(currentMemoStudent);
}
function cycleElementaryAnalysisHistoryCard() {
  if (!currentMemoStudent || currentMemoType !== 'elementary') return;
  const items = getElementaryAnalysisCycleItems(currentMemoStudent);
  if (items.length < 2) return;
  const currentIndex = Math.max(0, items.findIndex(item => (item.id || '') === (selectedElementaryAnalysisHistoryId || '')));
  const nextIndex = (currentIndex + 1) % items.length;
  const next = items[nextIndex];
  selectedElementaryAnalysisHistoryId = next.id || '';
renderElementaryAnalysisSummaryCard(next.data || {}, { title: '분석 결과', createdAt: next.createdAt || next.data?.updatedAt || '' });
  renderElementaryAnalysisHistoryCards(currentMemoStudent);
}

function selectElementaryAnalysisHistoryCard(itemId) {
  if (!currentMemoStudent || currentMemoType !== 'elementary') return;
  const items = getElementaryAnalysisCycleItems(currentMemoStudent);
  const target = items.find(item => (item.id || '') === (itemId || ''));
  if (!target) return;
  selectedElementaryAnalysisHistoryId = target.id || '';
renderElementaryAnalysisSummaryCard(target.data || {}, { title: '분석 결과', createdAt: target.createdAt || target.data?.updatedAt || '' });
  renderElementaryAnalysisHistoryCards(currentMemoStudent);
}
function applyElementaryAnalysisToMemo() {
  if (!currentMemoStudent || currentMemoType !== 'elementary') return;
  const state = getElementaryAnalysisStateFromModal();
  if (!elementaryAnalysisHasContent(state)) {
    const displayState = getPrimaryElementaryAnalysisDisplay(currentMemoStudent);
    selectedElementaryAnalysisHistoryId = '';
renderElementaryAnalysisSummaryCard(displayState.data || {}, { title: '분석 결과', createdAt: displayState.createdAt || '' });
    renderElementaryAnalysisHistoryCards(currentMemoStudent);
    resetElementaryAnalysisModalScroll();
    closeElementaryAnalysisModal();
    showPushToast('선택된 분석 내용이 없어 기존 분석을 유지했습니다.');
    return;
  }
  const previous = getElementaryAnalysisByStudent(currentMemoStudent);
  if (elementaryAnalysisHasContent(previous) && !elementaryAnalysisStatesEqual(previous, state)) {
    archiveElementaryAnalysisSnapshot(currentMemoStudent, previous);
  }
  setElementaryAnalysisByStudent(currentMemoStudent, state);
  const currentState = getElementaryAnalysisByStudent(currentMemoStudent);
  selectedElementaryAnalysisHistoryId = '';
renderElementaryAnalysisSummaryCard(currentState, { title: '분석 결과', createdAt: currentState.updatedAt || new Date().toISOString() });
  renderElementaryAnalysisHistoryCards(currentMemoStudent);
  resetElementaryAnalysisModalScroll();
  closeElementaryAnalysisModal();
  showPushToast('분석 내용이 카드로 정리되었습니다.');
}

/* 초등 분석 상세보기 공용 UI 로직 */
function buildElementaryAnalysisDetailSections(state) {
  const normalized = normalizeElementaryAnalysisState(state);
  const sectionMap = [
    ['오늘 아이의 강점', normalized.strengths || [], normalized.extraTexts?.strengths || ''],
    ['오늘 가장 지도가 필요했던 부분', normalized.needs || [], normalized.extraTexts?.needs || ''],
    ['막힘이 생긴 수업 단계', normalized.blockedStages || [], ''],
    ['아이를 망설이게 한 성향 단서', normalized.tendencies || [], ''],
    ['핵심 지도 영역', normalized.guideAreas || [], normalized.extraTexts?.guideAreas || ''],
    ['오늘 적용한 지도 방식', normalized.teacherActions || [], normalized.extraTexts?.teacherActions || ''],
    ['앞으로의 지도 방향', normalized.futureDirections || [], normalized.extraTexts?.futureDirections || '']
  ];
  return sectionMap.filter(([title, list, extra]) => (Array.isArray(list) && list.length) || String(extra || '').trim());
}
function openElementaryAnalysisDetailModal(state, options = {}) {
  const modal = document.getElementById('elementaryAnalysisDetailModal');
  const body = document.getElementById('elementaryAnalysisDetailBody');
  const titleEl = document.getElementById('elementaryAnalysisDetailTitle');
  if (!modal || !body || !titleEl) {
    console.warn('분석내용 바텀시트 요소를 찾지 못했습니다.', { modal: !!modal, body: !!body, titleEl: !!titleEl });
    return;
  }
  const normalized = normalizeElementaryAnalysisState(state || {});
  titleEl.textContent = options.title || '분석 결과';
  const dateText = formatElementaryAnalysisSummaryDate(options.createdAt || normalized.updatedAt || new Date().toISOString());
  const sections = buildElementaryAnalysisDetailSections(normalized);
  body.innerHTML = `<div class="analysisResultSheetDate">${escapeHtml(dateText)}</div>${sections.map(([title, list, extra]) => `
    <div class="analysisResultSheetSection">
      <div class="analysisResultSheetSectionTitle">${escapeHtml(title)}</div>
      <div class="analysisResultSheetList">
        ${(Array.isArray(list) ? list : []).map(item => `<div class="analysisResultSheetItem">- ${escapeHtml(item)}</div>`).join('')}
        ${String(extra || '').trim() ? `<div class="analysisResultSheetItem">- 기타: ${escapeHtml(String(extra).trim())}</div>` : ''}
      </div>
    </div>`).join('')}`;
  try { body.scrollTop = 0; } catch(e) {}
  try {
    const panel = modal.querySelector('.analysisResultSheetPanel');
    if (panel) panel.scrollTop = 0;
  } catch(e) {}
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
}
function closeElementaryAnalysisDetailModal(event) {
  if (event && event.target && event.target.id !== 'elementaryAnalysisDetailModal') return;
  const modal = document.getElementById('elementaryAnalysisDetailModal');
  if (modal) {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }
}
function openElementaryAnalysisDetailFromCurrent() {
  if (!currentMemoStudent || currentMemoType !== 'elementary') return;
  const displayState = (typeof getDisplayedElementaryAnalysisState === 'function')
    ? getDisplayedElementaryAnalysisState()
    : getPrimaryElementaryAnalysisDisplay(currentMemoStudent);
  const data = displayState?.data || getElementaryAnalysisByStudent(currentMemoStudent);
  const createdAt = displayState?.createdAt || data?.updatedAt || '';
  if (!elementaryAnalysisHasContent(data)) return;
  openElementaryAnalysisDetailModal(data, { title: '분석 결과', createdAt });
}
