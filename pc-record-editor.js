(function pcRecordEditorModule(global) {
  'use strict';

  const KINDER_KEYWORDS = {
    material: { label: '재료 탐색', questions: ['아이가 어떤 재료에 관심을 보였나요?', '재료를 어떻게 사용해 보았나요?', '새로운 표현으로 이어진 부분이 있었나요?'] },
    thought: { label: '생각 표현', questions: ['아이가 직접 말한 생각은 무엇이었나요?', '그 생각이 그림에서 어떻게 표현되었나요?', '특별히 인상 깊었던 말은 무엇인가요?'] },
    confidence: { label: '자신감', questions: ['아이가 스스로 해보려 한 장면은 무엇이었나요?', '완성 후 표정이나 말은 어땠나요?', '이전보다 자신감이 보인 부분은 무엇인가요?'] },
    help: { label: '도움 요청', questions: ['아이가 어떤 순간에 도움을 요청했나요?', '도움을 받은 뒤 다시 시도했나요?', '그 과정에서 성장으로 보인 부분은 무엇인가요?'] },
    transition: { label: '망설임→전환', questions: ['아이가 처음 망설인 장면은 무엇이었나요?', '어떤 도움을 받고 다시 시도했나요?', '다시 시도한 뒤 모습은 어땠나요?'] },
    joy: { label: '즐겁게 참여', questions: ['아이가 즐거워한 장면은 언제였나요?', '웃거나 말로 표현한 반응이 있었나요?', '활동에 몰입한 모습은 어땠나요?'] },
    friend: { label: '친구와 협력', questions: ['친구와 어떤 상호작용이 있었나요?', '양보하거나 도와준 장면이 있었나요?', '협력 후 아이의 반응은 어땠나요?'] },
    focus: { label: '집중', questions: ['아이가 집중한 장면은 무엇이었나요?', '얼마나 오래 이어가려 했나요?', '집중이 표현으로 이어진 부분은 무엇인가요?'] }
  };

  const state = {
    host: null,
    student: null,
    division: '',
    sessionToken: 0,
    saveTimer: null,
    queueTimer: null,
    activeKeyword: '',
    saving: false
  };

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function esc(value) {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(String(value ?? ''));
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }
  function sameStudent(student) {
    return !!student && !!state.student && clean(student.id) === clean(state.student.id);
  }
  function clearSaveTimer() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }
  function clearQueueTimer() {
    if (state.queueTimer) clearInterval(state.queueTimer);
    state.queueTimer = null;
  }
  function setStatus(text, tone) {
    const el = document.getElementById('pcRecordEditorStatus');
    if (!el) return;
    el.textContent = clean(text);
    el.dataset.tone = tone || '';
  }

  async function saveDraftNow(options = {}) {
    clearSaveTimer();
    const student = state.student;
    if (!student || !state.host) return null;
    const inputSelector = state.division === 'kinder' ? '#pcKinderFeedbackInput' : '#memoEditor';
    const input = state.host?.querySelector(inputSelector) || document.querySelector(inputSelector);
    if (!input || typeof global.persistObservationMemoDraft !== 'function') return null;
    const token = state.sessionToken;
    const noteType = state.division === 'kinder' ? 'kinder_risk' : 'elementary_observation';
    setStatus('저장 중…');
    state.saving = true;
    try {
      const result = await global.persistObservationMemoDraft(student, input.value || '', { noteType });
      if (token !== state.sessionToken || !sameStudent(student)) return result;
      if (result && result.student) {
        state.student = result.student;
        try { global.currentMemoStudent = result.student; } catch (_) {}
      }
      setStatus(result?.state === 'pending' ? '동기화 대기' : '자동 저장', result?.state === 'pending' ? 'pending' : 'saved');
      return result;
    } catch (error) {
      if (token === state.sessionToken) setStatus('저장 확인 필요', 'error');
      if (!options.silent) console.warn('PC 기록 초안 저장 실패:', error && (error.message || error));
      return null;
    } finally {
      state.saving = false;
    }
  }

  function scheduleDraftSave() {
    clearSaveTimer();
    setStatus('작성 중…');
    state.saveTimer = setTimeout(() => saveDraftNow({ silent: true }), 650);
  }

  function elementaryHtml(student) {
    return '<div class="pcRecordEditor pcRecordEditorElementary">'
      + '<div class="pcRecordEditorScroll">'
      + '<div class="pcRecordEditorHead"><div><div class="pcRecordEditorStudentName" id="memoPageStudentName">'+esc(student.name || '학생 이름')+'</div><div class="pcRecordEditorMeta"><span id="pcRecordEditorStatus">자동 저장</span><span class="memoStudentUpdatedDate" id="memoStudentUpdatedDate" hidden></span></div></div></div>'
      + '<div class="elementaryAnalysisBlock pcRecordAnalysisBlock" id="elementaryAnalysisBlock">'
      + '<div class="elementaryAnalysisSummaryWrap" id="elementaryAnalysisSummaryWrap" style="display:none;"></div>'
      + '<div class="elementaryAnalysisHistoryWrap" id="elementaryAnalysisHistoryWrap" style="display:none;"></div>'
      + '</div>'
      + '<textarea class="pcRecordEditorTextarea memoEditor" id="memoEditor" placeholder="관찰 내용을 기록해 주세요."></textarea>'
      + '<div class="memoFeedbackResultArea" id="memoFeedbackResultArea"></div>'
      + '</div>'
      + '<div class="pcRecordEditorActions">'
      + '<button type="button" class="pcRecordEditorToolBtn" id="memoBottomAnalysisBtn" aria-label="오늘의 분석 설문" title="오늘의 분석 설문">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><rect height="14.8" rx="3" width="13.6" x="5.2" y="4.6"></rect><path d="M8.4 9h7.2M8.4 12.4h7.2M8.4 15.8h4.4"></path></svg></button>'
      + '<button type="button" class="pcRecordEditorSendBtn memoFeedbackBottomBtn" id="memoFeedbackBtn"><span class="memoFeedbackBottomText">피드백 생성</span><span class="memoFeedbackArrowCircle" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path></svg></span></button>'
      + '</div></div>';
  }

  function kinderKeywordHtml() {
    return Object.entries(KINDER_KEYWORDS).map(([key, item]) =>
      '<button type="button" class="pcKinderKeywordBtn" data-pc-kinder-keyword="'+esc(key)+'">'+esc(item.label)+'</button>'
    ).join('');
  }

  function kinderHtml(student) {
    return '<div class="pcRecordEditor pcRecordEditorKinder">'
      + '<div class="pcRecordEditorHead pcKinderEditorHead"><div><div class="pcRecordEditorStudentName">'+esc(student.name || '학생 이름')+'</div><div class="pcRecordEditorMeta"><span>1분 피드백</span><span id="pcRecordEditorStatus">자동 저장</span></div></div><button type="button" class="pcKinderQueueToggle" data-pc-kinder-queue-toggle>보관함</button></div>'
      + '<div class="pcKinderQueue" id="pcKinderQueue"></div>'
      + '<div class="pcKinderComposerWrap">'
      + '<div class="pcKinderQuestionGuide" id="pcKinderQuestionGuide"></div>'
      + '<div class="pcKinderKeywordScroller" aria-label="관찰 키워드">'+kinderKeywordHtml()+'</div>'
      + '<div class="pcKinderComposer">'
      + '<textarea class="pcKinderFeedbackInput" id="pcKinderFeedbackInput" rows="1" placeholder="관찰 내용을 적어주세요."></textarea>'
      + '<div class="pcKinderComposerBottom"><span class="pcKinderComposerHint">선택한 학생에게 바로 연결됩니다.</span><button type="button" class="pcRecordEditorSendBtn pcKinderSendBtn" data-pc-kinder-send aria-label="피드백 생성"><span>피드백 생성</span><span class="memoFeedbackArrowCircle" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path></svg></span></button></div>'
      + '<div class="pcKinderInputWarning" id="pcKinderInputWarning"></div>'
      + '</div></div></div>';
  }

  function renderKinderGuide() {
    const guide = document.getElementById('pcKinderQuestionGuide');
    if (!guide) return;
    const item = KINDER_KEYWORDS[state.activeKeyword];
    if (!item) {
      guide.innerHTML = '';
      guide.classList.remove('show');
      return;
    }
    guide.innerHTML = '<ul>'+item.questions.map((question) => '<li><span class="pcKinderQuestionIcon" aria-hidden="true">⌕</span><span>'+esc(question)+'</span></li>').join('')+'</ul>';
    guide.classList.add('show');
  }

  function toggleKinderKeyword(key) {
    state.activeKeyword = state.activeKeyword === key ? '' : key;
    state.host?.querySelectorAll('[data-pc-kinder-keyword]').forEach((button) => {
      button.classList.toggle('active', button.dataset.pcKinderKeyword === state.activeKeyword);
    });
    renderKinderGuide();
  }

  function kinderQueueItems() {
    const student = state.student;
    if (!student || typeof global.getTodayFeedbackItemsRaw !== 'function') return [];
    const id = clean(student.id);
    const name = clean(student.name);
    return global.getTodayFeedbackItemsRaw().filter((item) => {
      if (!item || item.studentDivision !== 'kinder') return false;
      const itemId = clean(item.studentId || item.savedStudentId || item.student_id);
      if (itemId) return itemId === id;
      return item.sourcePage === 'pcRecordEditor' && clean(item.studentName) === name;
    }).sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
  }

  function renderKinderQueue(forceOpen) {
    const queue = document.getElementById('pcKinderQueue');
    if (!queue || state.division !== 'kinder') return;
    const items = kinderQueueItems();
    const wasOpen = queue.classList.contains('show');
    if (forceOpen === true) queue.classList.add('show');
    else if (forceOpen === false) queue.classList.remove('show');
    else if (wasOpen) queue.classList.add('show');
    if (!items.length) {
      queue.innerHTML = '<div class="pcKinderQueueEmpty">아직 작성한 피드백이 없습니다.</div>';
      return;
    }
    queue.innerHTML = items.map((item) => {
      const status = clean(item.status || 'generating');
      const result = clean(item.resultText);
      const saved = !!(item.saved || item.reviewed);
      const statusText = status === 'generating' ? '정리 중' : (status === 'error' ? '오류' : (status === 'review' ? '확인 필요' : (saved ? '저장완료' : '도착')));
      const content = status === 'error' ? clean(item.errorMessage || '피드백 생성 중 오류가 발생했습니다.') : (result || clean(item.sourceText));
      return '<article class="pcKinderQueueCard '+esc(status)+(saved ? ' saved' : '')+'" data-pc-kinder-item="'+esc(item.id)+'">'
        + '<div class="pcKinderQueueCardHead"><strong>'+esc(statusText)+'</strong><span>'+esc(item.feedbackMonth || '')+'</span></div>'
        + '<div class="pcKinderQueueCardText">'+esc(content || '관찰 내용을 정리하고 있습니다.')+'</div>'
        + ((!saved && (status === 'done' || status === 'review') && result) ? '<button type="button" class="pcKinderQueueSave" data-pc-kinder-save="'+esc(item.id)+'">기록실 저장</button>' : '')
        + '</article>';
    }).join('');
  }

  async function saveKinderQueueItem(itemId, button) {
    const student = state.student;
    if (!student || typeof global.saveTodayFeedbackItem !== 'function') return;
    if (button) button.disabled = true;
    try {
      const saved = await global.saveTodayFeedbackItem(itemId, button || null, student.id);
      if (saved === false) return;
      renderKinderQueue(true);
      if (global.OlliPcPersonalityRecords?.refreshSelected) {
        await global.OlliPcPersonalityRecords.refreshSelected();
      }
    } catch (error) {
      console.warn('PC 유치부 피드백 저장 실패:', error && (error.message || error));
      if (typeof global.showPushToast === 'function') global.showPushToast('피드백 저장을 확인해 주세요.');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function submitKinderFeedback() {
    const input = document.getElementById('pcKinderFeedbackInput');
    const warning = document.getElementById('pcKinderInputWarning');
    const student = state.student;
    if (!input || !student) return;
    const text = clean(input.value);
    if (!text) {
      if (warning) { warning.textContent = '관찰 내용을 적어주세요.'; warning.classList.add('show'); }
      return;
    }
    if (warning) { warning.textContent = ''; warning.classList.remove('show'); }
    if (typeof global.startTodayFeedbackRequest !== 'function') {
      if (warning) { warning.textContent = '피드백 생성 기능을 불러오지 못했습니다.'; warning.classList.add('show'); }
      return;
    }
    const item = global.startTodayFeedbackRequest({
      promptType: 'class',
      userText: text,
      studentName: student.name,
      studentDivision: 'kinder',
      feedbackType: 'class',
      label: '유치부 1분 피드백',
      sourcePage: 'pcRecordEditor',
      silent: true
    });
    if (item?.id && typeof global.updateTodayFeedbackItem === 'function') {
      global.updateTodayFeedbackItem(item.id, { studentId: student.id, sourcePage: 'pcRecordEditor' });
    }
    input.value = '';
    await saveDraftNow({ silent: true });
    state.activeKeyword = '';
    state.host?.querySelectorAll('[data-pc-kinder-keyword]').forEach((button) => button.classList.remove('active'));
    renderKinderGuide();
    renderKinderQueue(true);
    if (typeof global.showPushToast === 'function') global.showPushToast(`${student.name} 피드백을 정리하고 있어요.`);
  }

  function bindElementary() {
    const input = document.getElementById('memoEditor');
    const analysis = document.getElementById('memoBottomAnalysisBtn');
    const generate = document.getElementById('memoFeedbackBtn');
    if (input) input.addEventListener('input', scheduleDraftSave);
    if (input) input.addEventListener('blur', () => saveDraftNow({ silent: true }));
    if (analysis) analysis.addEventListener('click', () => {
      if (typeof global.openElementaryAnalysisModal === 'function') global.openElementaryAnalysisModal();
    });
    if (generate) generate.addEventListener('click', async () => {
      await saveDraftNow({ silent: true });
      if (typeof global.requestElementaryFeedback === 'function') global.requestElementaryFeedback();
    });
  }

  function bindKinder() {
    const input = document.getElementById('pcKinderFeedbackInput');
    if (input) input.addEventListener('input', scheduleDraftSave);
    if (input) input.addEventListener('blur', () => saveDraftNow({ silent: true }));
    state.host?.querySelectorAll('[data-pc-kinder-keyword]').forEach((button) => {
      button.addEventListener('click', () => toggleKinderKeyword(button.dataset.pcKinderKeyword));
    });
    state.host?.querySelector('[data-pc-kinder-send]')?.addEventListener('click', submitKinderFeedback);
    state.host?.querySelector('[data-pc-kinder-queue-toggle]')?.addEventListener('click', () => {
      const queue = document.getElementById('pcKinderQueue');
      renderKinderQueue(!(queue && queue.classList.contains('show')));
    });
    state.host?.addEventListener('click', (event) => {
      const save = event.target.closest('[data-pc-kinder-save]');
      if (save) saveKinderQueueItem(save.dataset.pcKinderSave, save);
    });
  }

  async function loadKinderDraft(student, token) {
    const input = document.getElementById('pcKinderFeedbackInput');
    if (!input || typeof global.getMemoEntryByStudent !== 'function') return;
    const local = global.getMemoEntryByStudent(student);
    input.value = local?.content || '';
    if (typeof global.reconcileObservationMemoDraft !== 'function') return;
    try {
      const result = await global.reconcileObservationMemoDraft(student, 'kinder_risk');
      if (token !== state.sessionToken || !sameStudent(student)) return;
      if (!clean(input.value) || result?.adoptedRemote) input.value = result?.content || input.value;
      setStatus('자동 저장', 'saved');
    } catch (error) {
      console.warn('PC 유치부 초안 불러오기 실패:', error && (error.message || error));
    }
  }

  async function mount(host, student) {
    if (!host || !student) return false;
    if (sameStudent(student) && state.host === host && host.firstElementChild) return true;
    unmount({ save: true });
    state.host = host;
    state.student = student;
    state.division = student.type === 'kinder' ? 'kinder' : 'elementary';
    state.activeKeyword = '';
    state.sessionToken += 1;
    const token = state.sessionToken;

    let session = null;
    if (typeof global.beginObservationMemoSession === 'function') {
      session = global.beginObservationMemoSession(student.id);
      if (session?.student) state.student = session.student;
    } else {
      try { global.currentMemoStudent = student; global.currentMemoType = state.division; } catch (_) {}
    }

    host.innerHTML = state.division === 'kinder' ? kinderHtml(state.student) : elementaryHtml(state.student);
    host.dataset.pcRecordDivision = state.division;
    host.dataset.pcRecordStudentId = clean(state.student.id);

    if (state.division === 'elementary') {
      bindElementary();
      if (session && typeof global.renderObservationMemoInitialView === 'function') {
        global.renderObservationMemoInitialView(session);
      } else {
        const input = document.getElementById('memoEditor');
        const local = typeof global.getMemoEntryByStudent === 'function' ? global.getMemoEntryByStudent(state.student) : null;
        if (input) input.value = local?.content || '';
      }
      setStatus('자동 저장', 'saved');
    } else {
      bindKinder();
      await loadKinderDraft(state.student, token);
      if (token !== state.sessionToken || !state.student || clean(state.student.id) !== clean(student.id)) return false;
      renderKinderQueue(false);
      clearQueueTimer();
      state.queueTimer = setInterval(() => {
        if (token !== state.sessionToken || state.division !== 'kinder') return;
        renderKinderQueue();
      }, 1200);
    }
    return true;
  }

  function unmount(options = {}) {
    const shouldSave = options.save !== false;
    const previousHost = state.host;
    const previousStudent = state.student;
    const previousDivision = state.division;
    const inputSelector = previousDivision === 'kinder' ? '#pcKinderFeedbackInput' : '#memoEditor';
    const previousInput = previousHost?.querySelector(inputSelector);
    const capturedText = previousInput ? String(previousInput.value || '') : '';
    const noteType = previousDivision === 'kinder' ? 'kinder_risk' : 'elementary_observation';

    clearSaveTimer();
    clearQueueTimer();
    if (previousHost) {
      previousHost.innerHTML = '';
      delete previousHost.dataset.pcRecordDivision;
      delete previousHost.dataset.pcRecordStudentId;
    }
    state.host = null;
    state.student = null;
    state.division = '';
    state.activeKeyword = '';
    state.sessionToken += 1;

    if (shouldSave && previousStudent && typeof global.persistObservationMemoDraft === 'function') {
      Promise.resolve(global.persistObservationMemoDraft(previousStudent, capturedText, { noteType }))
        .catch((error) => console.warn('PC 기록 초안 종료 저장 실패:', error && (error.message || error)));
    }
    return true;
  }

  function getSelectedKinderStudent() {
    if (state.student?.type === 'kinder') return state.student;
    try {
      const students = global.OlliPcCore?.activeStudents?.('kinder') || [];
      return students[0] || null;
    } catch (_) { return null; }
  }

  function openPcKinderFeedbackCompatibility() {
    const student = getSelectedKinderStudent();
    const openSection = global.pcOpenSection;
    if (typeof openSection !== 'function') return;
    return Promise.resolve(openSection('attendance')).then(() => {
      const target = student || getSelectedKinderStudent();
      if (target && global.OlliPcPersonalityRecords?.selectStudent) {
        return global.OlliPcPersonalityRecords.selectStudent(target.id);
      }
    });
  }

  global.OlliPcRecordEditor = { mount, unmount, saveDraftNow, renderKinderQueue };
  // PC 저장소에 남아 있는 과거 진입 버튼이 모바일 화면을 다시 열지 않도록 PC 에디터로 연결합니다.
  global.openKinderChatFeedbackPage = openPcKinderFeedbackCompatibility;
})(window);
