
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
    return normalizeKcfStudentType(student) === 'elementary' ? 'elementary' : 'class';
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

  function getKcfSelectedStudentForName(studentName){
    var selectedId = String(window.__kcfSelectedStudentId || '').trim();
    if (!selectedId || typeof findStudentById !== 'function') return null;
    var student = findStudentById(selectedId);
    if (!student) return null;
    if (String(student.name || '').trim() !== String(studentName || '').trim()) return null;
    return student;
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
    window.__kcfSelectedStudentId = String(student.id || '');
    var input = document.getElementById('kcfInput');
    if (input) {
      var lines = String(input.value || '').split(/\n/);
      if (lines.length <= 1 && !String(lines[0] || '').trim()) input.value = (student.name || '') + '\n';
      else {
        lines[0] = student.name || '';
        input.value = lines.join('\n');
      }
      if (typeof autoResizeKinderChatFeedbackInput === 'function') autoResizeKinderChatFeedbackInput(input);
      if (typeof saveKinderChatFeedbackDraft === 'function') saveKinderChatFeedbackDraft();
      input.focus();
    }
    if (typeof closeKinderChatFeedbackStudentManagePopup === 'function') closeKinderChatFeedbackStudentManagePopup();
  };

  async function continueKinderChatFeedbackSubmit(parsed, student){
    var input = document.getElementById('kcfInput');
    var text = input ? String(input.value || '').trim() : '';
    var feedbackJobId = 'fbjob_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    var studentType = normalizeKcfStudentType(student);
    var studentName = String(student && student.name || parsed.studentName || '').trim();
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

    if (typeof addKinderChatDocumentMessage === 'function') addKinderChatDocumentMessage(studentName, getKcfStudentFeedbackLabel(student, 'class'), parsed.body || text, 'minute', photoSnapshot);
    if (typeof addKinderChatMessage === 'function') addKinderChatMessage('bot', '관찰 내용을 부모님께 잘 전달될 수 있도록 정리해둘게요.\n다음 학생 기록을 이어서 작성해 주세요.');
    if (typeof startTodayFeedbackRequest === 'function') {
      startTodayFeedbackRequest({
        id: feedbackJobId,
        promptType: getKcfStudentPromptType(student, 'class'),
        userText: parsed.body || text,
        studentName: studentName,
        studentId: student.id || '',
        studentDivision: studentType,
        feedbackType: 'class',
        label: getKcfStudentFeedbackLabel(student, 'class'),
        sourcePage: 'kinderChatFeedback',
        silent: true,
        attachments: photoSnapshot ? [photoSnapshot] : []
      });
    }

    if (input) {
      input.value = '';
      if (typeof autoResizeKinderChatFeedbackInput === 'function') autoResizeKinderChatFeedbackInput(input);
    }
    window.__kcfSelectedStudentId = '';
    if (typeof clearKinderChatFeedbackPhoto === 'function') clearKinderChatFeedbackPhoto();
    if (typeof clearKinderChatFeedbackDraft === 'function') clearKinderChatFeedbackDraft();
    if (typeof clearKinderChatFeedbackKeyword === 'function') clearKinderChatFeedbackKeyword();
    if (typeof updateKinderChatFeedbackBadge === 'function') updateKinderChatFeedbackBadge();
  }

  window.submitKinderChatFeedback = async function(){
    var input = document.getElementById('kcfInput');
    if (!input) return;
    var text = String(input.value || '').trim();
    if (!text) {
      setKinderChatFeedbackWarning('학생 이름과 관찰 내용을 적어주세요.');
      return;
    }
    var parsed = parseKinderChatFeedbackInput(text);
    if (!parsed.studentName || parsed.lines.length < 2) {
      setKinderChatFeedbackWarning('첫 줄에는 학생 이름을, 아래에는 관찰 내용을 적어주세요.');
      return;
    }

    var selectedStudent = getKcfSelectedStudentForName(parsed.studentName);
    var candidates = selectedStudent ? [selectedStudent] : findKcfStudentsByName(parsed.studentName);
    if (!candidates.length) {
      setKinderChatFeedbackWarning('등록된 학생이 없습니다. 학생관리에서 먼저 등록해 주세요.');
      alert('등록된 학생이 없습니다.\n학생관리에서 먼저 등록해 주세요.');
      return;
    }
    if (candidates.length > 1) {
      setKinderChatFeedbackWarning('같은 이름의 학생이 있어요. 학생을 선택해 주세요.');
      openKinderChatFeedbackSaveStudentPicker('', candidates, 'submit', { parsed: parsed });
      return;
    }
    setKinderChatFeedbackWarning('');
    await continueKinderChatFeedbackSubmit(parsed, candidates[0]);
  };

  var originalCreateTodayFeedbackItem = window.createTodayFeedbackItem;
  if (typeof originalCreateTodayFeedbackItem === 'function' && !originalCreateTodayFeedbackItem.__kcfStudentIdPatched) {
    var patchedCreate = function(options){
      var item = originalCreateTodayFeedbackItem.call(this, options || {});
      if (item && options && options.studentId) {
        try { updateTodayFeedbackItem(item.id, { studentId:String(options.studentId || '') }); item.studentId = String(options.studentId || ''); } catch(e) {}
      }
      return item;
    };
    patchedCreate.__kcfStudentIdPatched = true;
    window.createTodayFeedbackItem = patchedCreate;
  }

  var originalStartTodayFeedbackRequest = window.startTodayFeedbackRequest;
  if (typeof originalStartTodayFeedbackRequest === 'function' && !originalStartTodayFeedbackRequest.__kcfStudentIdPatched) {
    var patchedStart = function(options){
      var item = originalStartTodayFeedbackRequest.call(this, options || {});
      if (item && options && options.studentId) {
        try { updateTodayFeedbackItem(item.id, { studentId:String(options.studentId || '') }); item.studentId = String(options.studentId || ''); } catch(e) {}
      }
      return item;
    };
    patchedStart.__kcfStudentIdPatched = true;
    window.startTodayFeedbackRequest = patchedStart;
  }

  var originalSaveTodayFeedbackItem = window.saveTodayFeedbackItem;
  if (typeof originalSaveTodayFeedbackItem === 'function' && !originalSaveTodayFeedbackItem.__kcfStudentIdPatched) {
    var patchedSave = function(id, btn, selectedStudentId){
      var item = (typeof getTodayFeedbackItemById === 'function') ? getTodayFeedbackItemById(id) : null;
      var directId = String(selectedStudentId || item?.studentId || item?.savedStudentId || '');
      return originalSaveTodayFeedbackItem.call(this, id, btn, directId);
    };
    patchedSave.__kcfStudentIdPatched = true;
    window.saveTodayFeedbackItem = patchedSave;
  }

  window.openKinderChatFeedbackSaveStudentPicker = function(itemId, candidates, mode, submitPayload){
    var overlay = document.getElementById('kcfSaveStudentPickerOverlay');
    var list = document.getElementById('kcfSaveStudentPickerList');
    if (!overlay || !list || !Array.isArray(candidates) || !candidates.length) return;
    var safeMode = mode === 'submit' ? 'submit' : 'save';
    window.kcfPendingSaveStudentPicker = {
      itemId: String(itemId || ''),
      selectedStudentId: String(candidates[0].id || ''),
      mode: safeMode,
      submitPayload: submitPayload || null
    };
    var titleEl = overlay.querySelector('.kcfSaveStudentPickerTitle');
    var guideEl = overlay.querySelector('.kcfSaveStudentPickerGuide');
    var saveBtn = overlay.querySelector('.kcfSaveStudentSaveBtn');
    if (titleEl) titleEl.textContent = '학생을 선택해 주세요';
    if (guideEl) guideEl.textContent = safeMode === 'submit' ? '같은 이름의 학생이 있어요. 피드백을 작성할 학생을 선택해 주세요.' : '같은 이름의 학생이 있어요. 기록실에 저장할 학생을 선택해 주세요.';
    if (saveBtn) saveBtn.textContent = safeMode === 'submit' ? '피드백 전송' : '기록실 저장';
    list.innerHTML = candidates.map(function(student, index){
      var id = String(student.id || '');
      var active = index === 0 ? ' active' : '';
      return '<button type="button" class="kcfSaveStudentOption' + active + '" data-student-id="' + escapeHtml(id) + '" onclick="selectKinderChatFeedbackSaveStudent(\'' + escapeHtml(id) + '\')"><span class="kcfSaveStudentCheck" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"></path></svg></span><span><span class="kcfSaveStudentName">' + escapeHtml(getKcfStudentPickerName(student)) + '</span><span class="kcfSaveStudentMeta">' + escapeHtml(window.getKinderChatFeedbackStudentMetaLine(student)) + '</span></span></button>';
    }).join('');
    overlay.classList.add('show');
  };

  window.selectKinderChatFeedbackSaveStudent = function(studentId){
    if (!window.kcfPendingSaveStudentPicker) window.kcfPendingSaveStudentPicker = { itemId:'', selectedStudentId:'', mode:'save', submitPayload:null };
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
    var pending = window.kcfPendingSaveStudentPicker || { itemId:'', selectedStudentId:'', mode:'save', submitPayload:null };
    var selectedId = String(pending.selectedStudentId || '');
    window.closeKinderChatFeedbackSaveStudentPicker();
    if (!selectedId) return;
    if (pending.mode === 'submit') {
      var student = (typeof findStudentById === 'function') ? findStudentById(selectedId) : null;
      if (!student) {
        alert('선택한 학생 정보를 찾지 못했습니다.');
        return;
      }
      window.__kcfSelectedStudentId = selectedId;
      var parsed = pending.submitPayload && pending.submitPayload.parsed;
      if (parsed) continueKinderChatFeedbackSubmit(parsed, student);
      return;
    }
    if (pending.itemId && typeof saveTodayFeedbackItem === 'function') saveTodayFeedbackItem(pending.itemId, null, selectedId);
  };

  document.addEventListener('DOMContentLoaded', function(){
    try {
      var input = document.getElementById('kcfInput');
      if (input) {
        input.addEventListener('input', function(){
          var parsed = (typeof parseKinderChatFeedbackInput === 'function') ? parseKinderChatFeedbackInput(input.value || '') : { studentName:'' };
          var selected = getKcfSelectedStudentForName(parsed.studentName);
          if (!selected) window.__kcfSelectedStudentId = '';
        });
      }
    } catch (err) {
      console.warn('1분 피드백 초등부 패치 초기화 실패:', err);
    }
  });
})();
