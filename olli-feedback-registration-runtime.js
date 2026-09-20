
/* 2026-06-27: 1분 피드백 초등부 사용 + 전송 전 등록 학생 검증 + 동명이인 선택 연결 */
(function(){
  function getKcfAllActiveStudents(){
    try {
      var list = (typeof getAllStudents === 'function') ? getAllStudents() : [];
      return (Array.isArray(list) ? list : []).filter(function(student){
        if (!student || !String(student.name || '').trim()) return false;
        var status = (typeof getStudentStatus === 'function') ? getStudentStatus(student) : String(student.status || 'active');
        return status !== 'withdrawn' && status !== 'inactive';
      });
    } catch (err) {
      console.warn('1분 피드백 학생 목록 확인 실패:', err);
      return [];
    }
  }

  function normalizeKcfStudentType(student){
    return (student && String(student.type || student.division || '').trim() === 'kinder') ? 'kinder' : 'elementary';
  }

  function getKcfStudentGradeLabel(student){
    var type = normalizeKcfStudentType(student);
    if (type === 'kinder') {
      var age = String(student.age || student.studentAge || student.birthAge || '').replace(/[^0-9]/g, '');
      return age ? age + '세' : '유치부';
    }
    var grade = String(student.grade || '').replace(/[^0-9]/g, '');
    return grade ? grade + '학년' : '초등부';
  }

  function getKcfStudentDivisionLabel(student){
    return normalizeKcfStudentType(student) === 'kinder' ? '유치부' : '초등부';
  }

  function getKcfStudentPickerName(student){
    var prefix = getKcfStudentGradeLabel(student);
    var name = String(student && student.name || '').trim() || '이름 없음';
    return prefix ? prefix + ' ' + name : name;
  }

  function getKcfStudentPromptType(student, feedbackType){
    if (String(feedbackType || 'class') === 'fail') return 'fail';
    return 'class';
  }

  function getKcfStudentFeedbackLabel(student, feedbackType){
    var division = getKcfStudentDivisionLabel(student);
    if (String(feedbackType || 'class') === 'fail') return division + ' 성장 피드백';
    return division + ' 1분 피드백';
  }

  function findKcfStudentsByName(studentName){
    var name = String(studentName || '').trim();
    if (!name) return [];
    return getKcfAllActiveStudents().filter(function(student){
      return String(student.name || '').trim() === name;
    });
  }

  function getKcfSelectedStudent(){
    var selectedId = '';
    try {
      var autoSelection = window.KcfAutoMode && typeof window.KcfAutoMode.getSelection === 'function'
        ? window.KcfAutoMode.getSelection()
        : null;
      if (autoSelection && autoSelection.studentId) selectedId = String(autoSelection.studentId || '').trim();
    } catch (err) {}
    if (!selectedId) {
      try {
        var manualSelection = typeof window.getKinderChatFeedbackManualSelection === 'function'
          ? window.getKinderChatFeedbackManualSelection()
          : null;
        if (manualSelection && manualSelection.studentId) selectedId = String(manualSelection.studentId || '').trim();
      } catch (err) {}
    }
    if (!selectedId) selectedId = String(window.__kcfSelectedStudentId || '').trim();
    if (!selectedId || typeof findStudentById !== 'function') return null;
    return findStudentById(selectedId) || null;
  }

  function setKcfSelectedStudent(student){
    var id = String(student && student.id || '').trim();
    var name = String(student && student.name || '').trim();
    var division = normalizeKcfStudentType(student);
    window.__kcfSelectedStudentId = id;
    window.__kcfSelectedStudentName = name;
    window.__kcfSelectedStudentDivision = division;
    if (typeof window.setKinderChatFeedbackManualSelection === 'function') {
      try { window.setKinderChatFeedbackManualSelection(student); } catch (err) {}
    }
  }

  function clearKcfSelectedStudent(){
    window.__kcfSelectedStudentId = '';
    window.__kcfSelectedStudentName = '';
    window.__kcfSelectedStudentDivision = '';
    if (typeof window.clearKinderChatFeedbackManualSelection === 'function') {
      try { window.clearKinderChatFeedbackManualSelection(); } catch (err) {}
    }
  }

  window.getKinderChatFeedbackSaveStudentCandidates = function(studentName, studentDivision){
    var name = String(studentName || '').trim();
    if (!name) return [];
    var all = findKcfStudentsByName(name);
    var division = String(studentDivision || '').trim();
    if (!division) return all;
    var byDivision = all.filter(function(student){ return normalizeKcfStudentType(student) === division; });
    return byDivision.length ? byDivision : all;
  };

  window.getKinderChatFeedbackStudentMetaLine = function(student){
    student = student || {};
    var type = normalizeKcfStudentType(student);
    var parts = [];
    if (type === 'elementary') {
      var school = String(student.school || '').trim();
      var grade = String(student.grade || '').replace(/[^0-9]/g, '');
      var classNo = String(student.className || student.class_no || '').replace(/[^0-9]/g, '');
      if (school) parts.push(school.replace(/초등학교$/,'초'));
      if (grade) parts.push(grade + '학년');
      if (classNo) parts.push(classNo + '반');
    } else {
      var kindergarten = String(student.kindergarten || student.kindergartenName || student.kinder || '').trim();
      var age = String(student.age || student.studentAge || student.birthAge || '').replace(/[^0-9]/g, '');
      if (kindergarten) parts.push(kindergarten);
      if (age) parts.push(age + '세');
    }
    var teacher = String(student.teacher || student.homeroom_teacher || student.homeroomTeacher || student.teacherName || '').trim();
    var days = String(student.lesson_day || student.lessonDay || student.days || student.day || '').trim();
    if (teacher) parts.push(teacher);
    if (days) parts.push(days);
    if (!parts.length) parts.push(getKcfStudentDivisionLabel(student));
    return parts.join(' · ');
  };

  window.getKinderChatFeedbackStudentManageStudents = function(){
    var students = getKcfAllActiveStudents();
    if (typeof kcfStudentManageSortDay !== 'undefined' && kcfStudentManageSortDay) {
      students = students.filter(function(student){
        return typeof kinderChatFeedbackStudentMatchesDay === 'function'
          ? kinderChatFeedbackStudentMatchesDay(student, kcfStudentManageSortDay)
          : true;
      });
    }
    return students.slice().sort(function(a,b){
      var typeA = normalizeKcfStudentType(a);
      var typeB = normalizeKcfStudentType(b);
      if (typeA !== typeB) return typeA === 'kinder' ? -1 : 1;
      var ga = Number(String(typeA === 'kinder' ? a.age : a.grade || '').replace(/[^0-9]/g,'')) || 999;
      var gb = Number(String(typeB === 'kinder' ? b.age : b.grade || '').replace(/[^0-9]/g,'')) || 999;
      if (ga !== gb) return ga - gb;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
    });
  };

  window.renderKinderChatFeedbackStudentManagePopup = function(){
    var popup = document.getElementById('kcfStudentManagePopup');
    if (!popup) return;
    var manageMode = (typeof isKinderChatFeedbackStudentManageMode === 'function') && isKinderChatFeedbackStudentManageMode();
    var title = manageMode ? '원생 설정' : '원생 목록';
    var students = window.getKinderChatFeedbackStudentManageStudents();
    if (!students.length) {
      var emptyText = (typeof kcfStudentManageSortDay !== 'undefined' && kcfStudentManageSortDay && !manageMode) ? kcfStudentManageSortDay + '요일 등원 학생이 없습니다.' : '등록된 학생이 없습니다.';
      popup.innerHTML = renderKinderChatFeedbackStudentManageHeader(title) + '<div class="memoStudentSelectList"><div class="memoStudentSelectEmpty">' + escapeHtml(emptyText) + '</div></div>' + renderKinderChatFeedbackStudentManageControls();
      return;
    }
    var rows = students.map(function(student){
      var studentId = escapeHtml(String(student.id || ''));
      var meta = window.getKinderChatFeedbackStudentMetaLine(student);
      var textBlock = '<span class="memoStudentSelectName">' + escapeHtml(getKcfStudentPickerName(student)) + '</span>' + (meta ? '<span class="memoStudentSelectMeta">' + escapeHtml(meta) + '</span>' : '');
      if (manageMode) {
        return '<div class="memoStudentSelectOption manageMode"><span class="memoStudentSelectTextBlock">' + textBlock + '</span><button type="button" class="memoStudentInfoDotsBtn" onclick="openKinderChatFeedbackStudentInfoFromManage(\'' + studentId + '\', event)" aria-label="학생정보 수정">•••</button></div>';
      }
      return '<div class="memoStudentSelectOption"><button type="button" class="memoStudentSelectNameBtn" onclick="selectKinderChatFeedbackStudentFromManage(\'' + studentId + '\', event)">' + textBlock + '</button></div>';
    }).join('');
    popup.innerHTML = renderKinderChatFeedbackStudentManageHeader(title) + '<div class="memoStudentSelectList">' + rows + '</div>' + renderKinderChatFeedbackStudentManageControls();
  };

  window.selectKinderChatFeedbackStudentFromManage = function(studentId, event){
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    var student = (typeof findStudentById === 'function') ? findStudentById(studentId) : null;
    if (!student) return;
    setKcfSelectedStudent(student);
    var input = document.getElementById('kcfInput');
    if (input) {
      if (typeof autoResizeKinderChatFeedbackInput === 'function') autoResizeKinderChatFeedbackInput(input);
      if (typeof saveKinderChatFeedbackDraft === 'function') saveKinderChatFeedbackDraft();
      try { input.focus(); } catch (err) {}
    }
    if (typeof closeKinderChatFeedbackStudentManagePopup === 'function') closeKinderChatFeedbackStudentManagePopup();
  };

  function renderKcfCommandRoute(commandRoute, fallbackText){
    if (!commandRoute) return;
    if (typeof addKinderChatMessage === 'function') {
      addKinderChatMessage('user', String(commandRoute.text || fallbackText || ''));
      var rawMessage = String(commandRoute.message || '');
      if (rawMessage) {
        if (
          commandRoute.kind === 'command_confirmation'
          && typeof window.renderKinderChatFeedbackCommandConfirmation === 'function'
        ) {
          var displayMessage = rawMessage
            .replace(/\n?['‘’"]?확인['‘’"]?\s*또는\s*['‘’"]?취소['‘’"]?라고\s*입력해\s*주세요\.?/g, '')
            .trim();
          addKinderChatMessage('bot', displayMessage || '이 작업을 진행할까요?');
          try { window.renderKinderChatFeedbackCommandConfirmation(commandRoute); } catch (err) {}
        } else {
          addKinderChatMessage('bot', rawMessage);
        }
      }
    }
  }

  function clearKcfInlineInput(input){
    if (!input) return;
    input.value = '';
    if (typeof clearKinderChatFeedbackDraft === 'function') clearKinderChatFeedbackDraft();
    if (typeof autoResizeKinderChatFeedbackInput === 'function') autoResizeKinderChatFeedbackInput(input);
    try { input.dispatchEvent(new Event('input', { bubbles:true })); } catch (err) {}
  }

  async function continueKinderChatFeedbackSubmit(body, student, autoSubmitContext){
    var input = document.getElementById('kcfInput');
    var text = String(body || (input ? input.value || '' : '')).trim();
    if (!text || !student) return;
    var feedbackJobId = 'fbjob_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    var studentType = normalizeKcfStudentType(student);
    var studentName = String(student.name || '').trim();
    var photoSnapshot = null;

    if (typeof kcfPendingPhoto !== 'undefined' && kcfPendingPhoto) {
      setKinderChatFeedbackWarning('사진을 저장하고 있어요.');
      try {
        photoSnapshot = await uploadKinderChatFeedbackPhotoToSupabase(kcfPendingPhoto, feedbackJobId, studentName);
        setKinderChatFeedbackWarning('');
      } catch (err) {
        setKinderChatFeedbackWarning(err.message || '사진을 저장하지 못했습니다.');
        return;
      }
    }

    if (typeof addKinderChatDocumentMessage === 'function') addKinderChatDocumentMessage(studentName, getKcfStudentFeedbackLabel(student, 'class'), text, 'minute', photoSnapshot);
    var canUseKinderChatLive =
      typeof window.getKinderChatFeedbackTopMode === 'function' &&
      window.getKinderChatFeedbackTopMode() === 'live' &&
      typeof window.startKinderChatFeedbackLiveRequest === 'function';
    if (!canUseKinderChatLive && typeof addKinderChatMessage === 'function') {
      addKinderChatMessage('bot', '관찰 내용을 부모님께 잘 전달될 수 있도록 정리해둘게요.\n다음 학생 기록을 이어서 작성해 주세요.');
    }
    var requestOptions = {
      id: feedbackJobId,
      promptType: getKcfStudentPromptType(student, 'class'),
      userText: text,
      studentName: studentName,
      studentId: student.id || '',
      studentDivision: studentType,
      feedbackType: 'class',
      label: getKcfStudentFeedbackLabel(student, 'class'),
      sourcePage: 'kinderChatFeedback',
      silent: true,
      attachments: photoSnapshot ? [photoSnapshot] : []
    };
    var feedbackItem = null;
    if (typeof startTodayFeedbackRequest === 'function') feedbackItem = startTodayFeedbackRequest(requestOptions);
    if (window.KcfAutoMode && typeof window.KcfAutoMode.onFeedbackRequestStarted === 'function') {
      try { window.KcfAutoMode.onFeedbackRequestStarted(requestOptions, feedbackItem); } catch (err) {}
    }
    if (typeof markKcfStudentFeedbackSent === 'function') {
      try { markKcfStudentFeedbackSent(String(student.id || '')); } catch (err) {}
    }
    if (window.KcfAutoMode && typeof window.KcfAutoMode.completeSuccessfulSubmit === 'function') {
      try { window.KcfAutoMode.completeSuccessfulSubmit(autoSubmitContext || null); } catch (err) {}
    }

    var autoSelection = window.KcfAutoMode && typeof window.KcfAutoMode.getSelection === 'function'
      ? window.KcfAutoMode.getSelection()
      : null;
    if (!autoSelection || !autoSelection.studentId) clearKcfSelectedStudent();
    if (input) {
      input.value = '';
      if (typeof autoResizeKinderChatFeedbackInput === 'function') autoResizeKinderChatFeedbackInput(input);
    }
    if (typeof clearKinderChatFeedbackPhoto === 'function') clearKinderChatFeedbackPhoto();
    if (typeof clearKinderChatFeedbackDraft === 'function') clearKinderChatFeedbackDraft();
    if (typeof clearKinderChatFeedbackKeyword === 'function') clearKinderChatFeedbackKeyword();
    if (typeof updateKinderChatFeedbackBadge === 'function') updateKinderChatFeedbackBadge();
  }

  window.submitKinderChatFeedback = async function(){
    var input = document.getElementById('kcfInput');
    if (!input) return;
    var text = String(input.value || '').trim();
    var compactCommand = text.replace(/\s+/g, '');
    var guideCommand = compactCommand === '가이드'
      ? 'show'
      : ((compactCommand === '가이드삭제' || compactCommand === '가이드숨김') ? 'hide' : '');
    if (guideCommand) {
      if (typeof window.setKinderChatFeedbackGuideVisibility === 'function') {
        try { window.setKinderChatFeedbackGuideVisibility(guideCommand === 'show'); } catch (err) {}
      }
      clearKcfInlineInput(input);
      if (typeof setKinderChatFeedbackWarning === 'function') setKinderChatFeedbackWarning('');
        return;
    }
    if (window.KcfAutoMode && typeof window.KcfAutoMode.isEditing === 'function' && window.KcfAutoMode.isEditing()) {
      if (typeof window.KcfAutoMode.saveSubmittedRecordEdit === 'function') await window.KcfAutoMode.saveSubmittedRecordEdit();
      return;
    }
    if (text === '학생') {
      clearKcfInlineInput(input);
      if (typeof setKinderChatFeedbackWarning === 'function') setKinderChatFeedbackWarning('');
      if (typeof openKinderChatFeedbackStudentManagePopup === 'function') openKinderChatFeedbackStudentManagePopup();
        return;
    }
    if (!text) {
      setKinderChatFeedbackWarning('수업기록을 적어주세요.');
      return;
    }

    var autoSubmitContext = window.KcfAutoMode && typeof window.KcfAutoMode.captureSubmitContext === 'function'
      ? window.KcfAutoMode.captureSubmitContext()
      : null;
    var selectedStudent = getKcfSelectedStudent();

    if (
      window.__olliCommandsMovedToTalk !== true &&
      window.OlliCommandRouter &&
      typeof window.OlliCommandRouter.route === 'function'
    ) {
      try {
        var commandRoute = await window.OlliCommandRouter.route(text, {
          source: 'one_minute_feedback',
          selectedStudent: selectedStudent || null,
          autoSubmitContext: autoSubmitContext || null
        });
        if (commandRoute && commandRoute.handled === true) {
          renderKcfCommandRoute(commandRoute, text);
          if (commandRoute.clearInput !== false) clearKcfInlineInput(input);
          if (typeof setKinderChatFeedbackWarning === 'function') setKinderChatFeedbackWarning('');
                return;
        }
      } catch (err) {
        console.warn('올리 명령 라우터 처리 실패, 기존 피드백 흐름을 계속합니다:', err);
      }
    }

    if (!selectedStudent) {
      if (typeof addKinderChatMessage === 'function') {
        addKinderChatMessage('user', text);
        addKinderChatMessage('bot', '아직 이 문장은 실행 가능한 명령으로 연결되지 않았어요.');
      }
      clearKcfInlineInput(input);
      if (typeof setKinderChatFeedbackWarning === 'function') setKinderChatFeedbackWarning('');
        return;
    }
    setKinderChatFeedbackWarning('');
    await continueKinderChatFeedbackSubmit(text, selectedStudent, autoSubmitContext);
  };

  window.submitKinderChatFeedbackCommandChoice = async function(choice){
    var input = document.getElementById('kcfInput');
    if (!input || typeof window.submitKinderChatFeedback !== 'function') return false;
    var normalized = String(choice || '').trim().toLowerCase();
    var commandText = normalized === 'confirm' ? '확인' : '취소';
    input.value = commandText;
    try { input.dispatchEvent(new Event('input', { bubbles:true })); } catch (err) {}
    await window.submitKinderChatFeedback();
    return true;
  };

  window.openKinderChatFeedbackSaveStudentPicker = function(itemId, candidates){
    var overlay = document.getElementById('kcfSaveStudentPickerOverlay');
    var list = document.getElementById('kcfSaveStudentPickerList');
    if (!overlay || !list || !Array.isArray(candidates) || !candidates.length) return;
    window.kcfPendingSaveStudentPicker = {
      itemId: String(itemId || ''),
      selectedStudentId: String(candidates[0].id || '')
    };
    var titleEl = overlay.querySelector('.kcfSaveStudentPickerTitle');
    var guideEl = overlay.querySelector('.kcfSaveStudentPickerGuide');
    var saveBtn = overlay.querySelector('.kcfSaveStudentSaveBtn');
    if (titleEl) titleEl.textContent = '학생을 선택해 주세요';
    if (guideEl) guideEl.textContent = '같은 이름의 학생이 있어요. 기록실에 저장할 학생을 선택해 주세요.';
    if (saveBtn) saveBtn.textContent = '기록실 저장';
    list.innerHTML = candidates.map(function(student, index){
      var id = String(student.id || '');
      var active = index === 0 ? ' active' : '';
      return '<button type="button" class="kcfSaveStudentOption' + active + '" data-student-id="' + escapeHtml(id) + '" onclick="selectKinderChatFeedbackSaveStudent(\'' + escapeHtml(id) + '\')"><span class="kcfSaveStudentCheck" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"></path></svg></span><span><span class="kcfSaveStudentName">' + escapeHtml(getKcfStudentPickerName(student)) + '</span><span class="kcfSaveStudentMeta">' + escapeHtml(window.getKinderChatFeedbackStudentMetaLine(student)) + '</span></span></button>';
    }).join('');
    overlay.classList.add('show');
  };

  window.selectKinderChatFeedbackSaveStudent = function(studentId){
    if (!window.kcfPendingSaveStudentPicker) window.kcfPendingSaveStudentPicker = { itemId:'', selectedStudentId:'' };
    window.kcfPendingSaveStudentPicker.selectedStudentId = String(studentId || '');
    document.querySelectorAll('#kcfSaveStudentPickerOverlay .kcfSaveStudentOption').forEach(function(btn){
      btn.classList.toggle('active', String(btn.dataset.studentId || '') === String(studentId || ''));
    });
  };

  window.closeKinderChatFeedbackSaveStudentPicker = function(event){
    if (event && event.target && event.target.id !== 'kcfSaveStudentPickerOverlay') return;
    var overlay = document.getElementById('kcfSaveStudentPickerOverlay');
    if (overlay) overlay.classList.remove('show');
  };

  window.confirmKinderChatFeedbackSaveStudentPicker = function(){
    var pending = window.kcfPendingSaveStudentPicker || { itemId:'', selectedStudentId:'' };
    var selectedId = String(pending.selectedStudentId || '');
    window.closeKinderChatFeedbackSaveStudentPicker();
    if (!selectedId) return;
    if (pending.itemId && typeof saveTodayFeedbackItem === 'function') saveTodayFeedbackItem(pending.itemId, null, selectedId);
  };
})();
