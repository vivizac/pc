(function pcRecordEditorModule(global) {
  'use strict';
  if (global.__OLLI_PC_RECORD_EDITOR_EXACT_V1__) return;
  global.__OLLI_PC_RECORD_EDITOR_EXACT_V1__ = true;

  const ELEMENTARY_HTML = "<!-- PAGE: 초등부 노트 -->\n<div class=\"pageScreen\" data-elementary-page-name=\"초등부 노트\" data-page-key=\"student-memo\" data-page-name=\"초등부 노트\" id=\"studentMemoScreen\">\n<div class=\"memoPageInner\">\n<div class=\"memoHeader\">\n<div class=\"memoHeaderLeftActions\">\n<button aria-label=\"뒤로가기\" class=\"memoRecordRoomBtn\" id=\"memoRecordRoomBtn\" onclick=\"showRecordRoom()\" title=\"뒤로가기\" type=\"button\">\n<svg aria-hidden=\"true\" viewbox=\"0 0 24 24\"><path d=\"M15.5 5l-7 7 7 7\"></path></svg>\n</button>\n<div class=\"memoStudentNameWrap memoModeWrap\" id=\"memoModeWrap\">\n<button aria-label=\"노트 모드 선택\" class=\"memoNamePill memoModePill\" id=\"memoStudentNameBtn\" onclick=\"toggleMemoModeMenu(event)\" title=\"노트 모드 선택\" type=\"button\">\n<span class=\"memoStudentName memoModeTitle\" id=\"memoStudentName\">학생 노트</span>\n<svg aria-hidden=\"true\" viewbox=\"0 0 24 24\"><path d=\"M7 10l5 5 5-5\"></path></svg>\n</button>\n<div class=\"memoModeSub\" id=\"memoModeSub\">관찰 모드</div>\n<div aria-label=\"노트 모드 선택\" class=\"memoModeDropup\" id=\"memoModeDropup\"></div>\n</div>\n</div>\n</div>\n<div aria-hidden=\"true\" class=\"memoTopFadeLayer\" id=\"memoTopFadeLayer\"></div>\n<div class=\"memoEditorWrap\" id=\"elementaryMemoWrap\">\n<div class=\"elementaryAnalysisBlock\" id=\"elementaryAnalysisBlock\">\n<div class=\"memoAnalysisTitleRow\">\n<div aria-label=\"학생 정보\" class=\"memoStudentMetaBlock\" id=\"memoStudentMetaBlock\">\n<div class=\"memoStudentNameLine\">\n<div class=\"memoPageStudentName\" id=\"memoPageStudentName\">학생 이름</div>\n<div class=\"elementaryAnalysisSummaryWrap\" id=\"elementaryAnalysisSummaryWrap\" style=\"display:none;\"></div>\n<div class=\"memoStudentUpdatedDate\" hidden=\"\" id=\"memoStudentUpdatedDate\"></div>\n</div>\n</div>\n</div>\n<div class=\"elementaryAnalysisHistoryWrap\" id=\"elementaryAnalysisHistoryWrap\" style=\"display:none;\"></div>\n</div>\n<textarea class=\"memoEditor\" id=\"memoEditor\" placeholder=\"관찰 내용을 기록해 주세요.\"></textarea>\n</div>\n<div class=\"memoFeedbackResultArea\" id=\"memoFeedbackResultArea\"></div>\n<div class=\"memoBottomBar\">\n<button aria-label=\"오늘의 분석 설문\" class=\"memoBottomIconBtn memoBottomAnalysisBtn\" id=\"memoBottomAnalysisBtn\" onclick=\"openElementaryAnalysisModal()\" title=\"오늘의 분석 설문\" type=\"button\">\n<svg aria-hidden=\"true\" viewbox=\"0 0 24 24\"><rect height=\"14.8\" rx=\"3\" width=\"13.6\" x=\"5.2\" y=\"4.6\"></rect><path d=\"M8.4 9h7.2\"></path><path d=\"M8.4 12.4h7.2\"></path><path d=\"M8.4 15.8h4.4\"></path></svg>\n</button>\n</div>\n<button aria-label=\"피드백 생성\" class=\"cardGenerateBtn memoFeedbackBottomBtn\" id=\"memoFeedbackBtn\" onclick=\"handleMemoHeaderAction()\" type=\"button\">\n<svg aria-hidden=\"true\" viewbox=\"0 0 24 24\"><path d=\"M12 19V5\"></path><path d=\"M5 12l7-7 7 7\"></path></svg>\n</button>\n</div>\n</div>\n";
  const KINDER_HTML = "<!-- PAGE: 유치부 대화형 1분 피드백 -->\n<div class=\"pageScreen\" data-page-key=\"kinder-chat-feedback\" data-page-name=\"1분 피드백\" id=\"kinderChatFeedbackScreen\">\n<div class=\"kcfInner\">\n<div aria-label=\"1분 피드백 도구\" class=\"kcfCardTools\">\n<button aria-label=\"장면카드\" class=\"kcfCardToolBtn kcfSceneCardBtn\" onclick=\"openSceneCardsFromAnyPage()\" title=\"장면카드\" type=\"button\">\n<svg aria-hidden=\"true\" viewbox=\"0 0 24 24\"><rect x=\"4.5\" y=\"5\" width=\"7\" height=\"7\" rx=\"1.4\"></rect><rect x=\"12.5\" y=\"5\" width=\"7\" height=\"7\" rx=\"1.4\"></rect><rect x=\"4.5\" y=\"13\" width=\"7\" height=\"6\" rx=\"1.4\"></rect><rect x=\"12.5\" y=\"13\" width=\"7\" height=\"6\" rx=\"1.4\"></rect></svg>\n</button>\n<button aria-label=\"임시 보관함\" class=\"kcfCardToolBtn kcfInboxBtn\" onclick=\"openKinderChatFeedbackInbox()\" title=\"임시 보관함\" type=\"button\">\n<svg aria-hidden=\"true\" viewbox=\"0 0 24 24\">\n<path d=\"M8.2 5.4h7.6\"></path>\n<path d=\"M7.2 8.2h9.6\"></path>\n<rect height=\"8.2\" rx=\"1.9\" width=\"12.8\" x=\"5.6\" y=\"10.4\"></rect>\n<path d=\"M10 14.4h4\"></path>\n</svg>\n<span class=\"kcfInboxBadge\" id=\"kcfInboxBadge\"></span>\n</button>\n</div>\n<div class=\"kcfChatArea\" id=\"kcfChatArea\">\n</div>\n<div class=\"kcfComposerWrap\">\n<div class=\"kcfQuestionGuide\" id=\"kcfQuestionGuide\"></div>\n<div aria-label=\"관찰 키워드\" class=\"kcfKeywordScroller\" id=\"kcfKeywordScroller\">\n<button class=\"kcfKeywordBtn\" data-kcf-keyword=\"material\" type=\"button\">재료 탐색</button>\n<button class=\"kcfKeywordBtn\" data-kcf-keyword=\"thought\" type=\"button\">생각 표현</button>\n<button class=\"kcfKeywordBtn\" data-kcf-keyword=\"confidence\" type=\"button\">자신감</button>\n<button class=\"kcfKeywordBtn\" data-kcf-keyword=\"help\" type=\"button\">도움 요청</button>\n<button class=\"kcfKeywordBtn\" data-kcf-keyword=\"transition\" type=\"button\">망설임→전환</button>\n<button class=\"kcfKeywordBtn\" data-kcf-keyword=\"joy\" type=\"button\">즐겁게 참여</button>\n<button class=\"kcfKeywordBtn\" data-kcf-keyword=\"friend\" type=\"button\">친구와 협력</button>\n<button class=\"kcfKeywordBtn\" data-kcf-keyword=\"focus\" type=\"button\">집중</button>\n</div>\n<div class=\"kcfComposer\">\n<div aria-live=\"polite\" class=\"kcfPhotoPreview\" id=\"kcfPhotoPreview\"></div>\n<textarea class=\"kcfInput\" id=\"kcfInput\" placeholder=\"첫 줄에 이름, 아래에 관찰 내용을 적어주세요\" rows=\"1\"></textarea>\n<div class=\"kcfComposerBottom\">\n<button aria-label=\"사진 추가\" class=\"kcfToolBtn\" onclick=\"openKinderChatFeedbackPhotoPicker(event)\" type=\"button\">\n<svg viewbox=\"0 0 24 24\"><path d=\"M12 5v14\"></path><path d=\"M5 12h14\"></path></svg>\n</button>\n<div class=\"kcfStudentManageWrap\" id=\"kcfStudentManageWrap\">\n<button aria-label=\"원생 목록\" class=\"kcfToolBtn kcfStudentManageBtn\" id=\"kcfStudentManageBtn\" onclick=\"toggleKinderChatFeedbackStudentManagePopup(event)\" title=\"원생 목록\" type=\"button\">\n<svg aria-hidden=\"true\" viewbox=\"0 0 24 24\"><circle cx=\"12\" cy=\"8.6\" r=\"4.1\"></circle><path d=\"M5.9 20.1c.8-3.6 3.1-5.6 6.1-5.6s5.3 2 6.1 5.6\"></path></svg>\n</button>\n<div aria-label=\"원생 목록\" class=\"memoStudentSelectPopup\" id=\"kcfStudentManagePopup\"></div>\n</div>\n<div aria-hidden=\"true\" class=\"kcfComposerSpacer\"></div>\n<button aria-label=\"피드백 전송\" class=\"kcfSendBtn\" id=\"kcfSendBtn\" onclick=\"submitKinderChatFeedback()\" type=\"button\">\n<svg viewbox=\"0 0 24 24\"><path d=\"M12 19V5\"></path><path d=\"M6 11l6-6 6 6\"></path></svg>\n</button>\n</div>\n<div class=\"kcfInputWarning\" id=\"kcfInputWarning\"></div>\n<input accept=\"image/*\" class=\"kcfPhotoInputHidden\" id=\"kcfPhotoInput\" onchange=\"handleKinderChatFeedbackPhotoChange(event)\" type=\"file\"/>\n</div>\n</div>\n</div>\n</div>\n<div class=\"kcfInboxOverlay\" id=\"kcfInboxOverlay\" onclick=\"closeKinderChatFeedbackInbox(event)\">\n<div class=\"kcfInboxSheet\" onclick=\"event.stopPropagation()\">\n<div class=\"kcfInboxHandle\"></div>\n<div class=\"kcfInboxHead\">\n<div class=\"kcfInboxTitleWrap\">\n<div class=\"kcfInboxTitle\">임시 보관함</div>\n<div class=\"kcfInboxSub\">임시 저장된 피드백을 최신순으로 확인해요.</div>\n</div>\n<button aria-label=\"닫기\" class=\"kcfInboxClose\" onclick=\"closeKinderChatFeedbackInbox()\" type=\"button\">×</button>\n</div>\n<div class=\"kcfInboxBody\" id=\"kcfInboxBody\"></div>\n</div>\n</div>\n<div class=\"kcfSaveStudentPickerOverlay\" id=\"kcfSaveStudentPickerOverlay\" onclick=\"closeKinderChatFeedbackSaveStudentPicker(event)\">\n<div class=\"kcfSaveStudentPickerCard\" onclick=\"event.stopPropagation()\">\n<div class=\"kcfSaveStudentPickerHead\">\n<div class=\"kcfSaveStudentPickerTitle\">학생을 선택해 주세요</div>\n<div class=\"kcfSaveStudentPickerGuide\">같은 이름의 학생이 있어요. 기록실에 저장할 학생을 선택해 주세요.</div>\n</div>\n<div class=\"kcfSaveStudentPickerList\" id=\"kcfSaveStudentPickerList\"></div>\n<div class=\"kcfSaveStudentPickerActions\">\n<button class=\"kcfSaveStudentSaveBtn\" onclick=\"confirmKinderChatFeedbackSaveStudentPicker()\" type=\"button\">기록실 저장</button>\n</div>\n</div>\n</div>\n<div class=\"kcfGrowthOverlay\" id=\"kcfGrowthOverlay\" onclick=\"closeKinderChatFeedbackGrowthSheet(event)\">\n<div class=\"kcfGrowthSheet\" onclick=\"event.stopPropagation()\">\n<div class=\"kcfGrowthHead\">\n<div class=\"kcfGrowthTitleWrap\">\n<div class=\"kcfGrowthTitle\">성장 피드백</div>\n<div class=\"kcfGrowthSub\">설문 모드</div>\n</div>\n<button aria-label=\"닫기\" class=\"kcfGrowthClose\" onclick=\"closeKinderChatFeedbackGrowthSheet()\" type=\"button\">×</button>\n</div>\n<div class=\"kcfGrowthBody\" id=\"kcfGrowthBody\">\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A1. 아이 이름</div><input class=\"kcfGrowthInput\" id=\"kcfgA1\" placeholder=\"예: 김하윤\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A2. 활동</div><div class=\"kcfGrowthGrid\" id=\"kcfgA2Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"kcfgA2Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A2-1. 하위상황</div><div class=\"kcfGrowthGrid\" id=\"kcfgA2SubGrid\"></div><input class=\"kcfGrowthOtherInput\" id=\"kcfgA2_1Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A3. 실패유형</div><div class=\"kcfGrowthGrid\" id=\"kcfgA3Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"kcfgA3Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A4. 첫반응 - 몸</div><div class=\"kcfGrowthGrid\" id=\"kcfgA4Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"kcfgA4Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A5. 첫반응 - 말</div><div class=\"kcfGrowthGrid\" id=\"kcfgA5Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"kcfgA5Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A6. 첫반응 - 시선</div><div class=\"kcfGrowthGrid\" id=\"kcfgA6Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"kcfgA6Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A7. 실패원인</div><div class=\"kcfGrowthGrid\" id=\"kcfgA7Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"kcfgA7Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A8. 교사개입</div><div class=\"kcfGrowthGrid\" id=\"kcfgA8Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"kcfgA8Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A9. 회복전환</div><div class=\"kcfGrowthGrid\" id=\"kcfgA9Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"kcfgA9Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A10. 회복결과</div><div class=\"kcfGrowthGrid\" id=\"kcfgA10Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"kcfgA10Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A11. 다음목표</div><div class=\"kcfGrowthGrid\" id=\"kcfgA11Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"kcfgA11Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A12. 위험태그</div><div class=\"kcfGrowthGrid\" id=\"kcfgA12Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"kcfgA12Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A13. 수업후상태</div><div class=\"kcfGrowthGrid\" id=\"kcfgA13Grid\"></div></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A14. 추가메모</div><textarea class=\"kcfGrowthTextarea\" id=\"kcfgA14\" placeholder=\"없으면 비워두셔도 됩니다.\"></textarea></div>\n</div>\n<div class=\"kcfGrowthGenerateWrap\">\n<button aria-label=\"성장 피드백 생성\" class=\"kcfGrowthGenerateBtn\" id=\"kcfGrowthGenerateBtn\" onclick=\"submitKinderChatFeedbackGrowthSheet()\" type=\"button\">\n        성장 피드백 생성\n      </button>\n</div>\n</div>\n</div>\n<div class=\"kcfGrowthOverlay\" id=\"elementaryGrowthOverlay\" onclick=\"closeElementaryGrowthFeedbackSheet(event)\">\n<div class=\"kcfGrowthSheet\" onclick=\"event.stopPropagation()\">\n<div class=\"kcfGrowthHead\">\n<div class=\"kcfGrowthTitleWrap\">\n<div class=\"kcfGrowthTitle\">성장피드백</div>\n<div class=\"kcfGrowthSub\">초등부 설문 모드</div>\n</div>\n<button aria-label=\"닫기\" class=\"kcfGrowthClose\" onclick=\"closeElementaryGrowthFeedbackSheet()\" type=\"button\">×</button>\n</div>\n<div class=\"kcfGrowthBody\" id=\"elementaryGrowthBody\">\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A1. 아이 이름</div><input class=\"kcfGrowthInput\" id=\"ecfgA1\" placeholder=\"예: 김하윤\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A2. 활동</div><div class=\"kcfGrowthGrid\" id=\"ecfgA2Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"ecfgA2Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A2-1. 하위상황</div><div class=\"kcfGrowthGrid\" id=\"ecfgA2SubGrid\"></div><input class=\"kcfGrowthOtherInput\" id=\"ecfgA2_1Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A3. 실패유형</div><div class=\"kcfGrowthGrid\" id=\"ecfgA3Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"ecfgA3Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A4. 첫반응 - 몸</div><div class=\"kcfGrowthGrid\" id=\"ecfgA4Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"ecfgA4Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A5. 첫반응 - 말</div><div class=\"kcfGrowthGrid\" id=\"ecfgA5Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"ecfgA5Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A6. 첫반응 - 시선</div><div class=\"kcfGrowthGrid\" id=\"ecfgA6Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"ecfgA6Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A7. 실패원인</div><div class=\"kcfGrowthGrid\" id=\"ecfgA7Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"ecfgA7Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A8. 교사개입</div><div class=\"kcfGrowthGrid\" id=\"ecfgA8Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"ecfgA8Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A9. 회복전환</div><div class=\"kcfGrowthGrid\" id=\"ecfgA9Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"ecfgA9Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A10. 회복결과</div><div class=\"kcfGrowthGrid\" id=\"ecfgA10Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"ecfgA10Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A11. 다음목표</div><div class=\"kcfGrowthGrid\" id=\"ecfgA11Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"ecfgA11Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A12. 위험태그</div><div class=\"kcfGrowthGrid\" id=\"ecfgA12Grid\"></div><input class=\"kcfGrowthOtherInput\" id=\"ecfgA12Other\" placeholder=\"기타 내용을 입력해 주세요.\"/></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A13. 수업후상태</div><div class=\"kcfGrowthGrid\" id=\"ecfgA13Grid\"></div></div>\n<div class=\"kcfGrowthSection\"><div class=\"kcfGrowthSectionTitle\">A14. 추가메모</div><textarea class=\"kcfGrowthTextarea\" id=\"ecfgA14\" placeholder=\"관찰노트 내용이나 아이의 말, 교사의 개입을 추가로 적어 주세요.\"></textarea></div>\n</div>\n<div class=\"kcfGrowthGenerateWrap\">\n<button aria-label=\"성장피드백 생성\" class=\"kcfGrowthGenerateBtn\" id=\"elementaryGrowthGenerateBtn\" onclick=\"submitElementaryGrowthFeedbackSheet()\" type=\"button\">\n        성장피드백 생성\n      </button>\n</div>\n</div>\n</div>\n";
  const state = { host: null, screen: null, student: null, division: '' };

  function restoreRecordRoomVisibility() {
    const room = document.getElementById('recordRoomScreen');
    if (room) room.style.display = 'flex';
    if (state.screen) state.screen.style.display = 'flex';
  }

  function saveDraft() {
    try {
      if (state.division === 'elementary' && typeof global.saveCurrentMemo === 'function') {
        Promise.resolve(global.saveCurrentMemo({ silent: true })).catch(() => {});
      } else if (state.division === 'kinder' && typeof global.saveKinderChatFeedbackDraft === 'function') {
        global.saveKinderChatFeedbackDraft();
      }
    } catch (_) {}
  }

  function unmount(options) {
    const shouldSave = !options || options.save !== false;
    if (shouldSave) saveDraft();
    if (state.host) state.host.replaceChildren();
    state.host = null;
    state.screen = null;
    state.student = null;
    state.division = '';
    restoreRecordRoomVisibility();
  }

  function openEmbeddedElementaryRecord(student) {
    const session = typeof global.beginObservationMemoSession === 'function'
      ? global.beginObservationMemoSession(student.id)
      : null;
    if (!session || session.type !== 'elementary') return false;
    try { if (typeof global.closeMemoModeMenu === 'function') global.closeMemoModeMenu(); } catch (_) {}
    try { if (typeof global.closeMemoStudentSelectPopup === 'function') global.closeMemoStudentSelectPopup(); } catch (_) {}
    if (state.screen) {
      state.screen.style.display = 'flex';
      state.screen.setAttribute('data-current-memo-type', 'elementary');
    }
    if (typeof global.renderObservationMemoScreenChrome === 'function') global.renderObservationMemoScreenChrome(session);
    if (typeof global.renderObservationMemoInitialView === 'function') global.renderObservationMemoInitialView(session);
    if (typeof global.refreshObservationMemoVersionHistoryButton === 'function') {
      requestAnimationFrame(global.refreshObservationMemoVersionHistoryButton);
    }
    restoreRecordRoomVisibility();
    return true;
  }

  function openEmbeddedKinderRecord() {
    if (state.screen) state.screen.style.display = 'flex';
    try { if (typeof global.bindKinderChatFeedbackKeyboardOffset === 'function') global.bindKinderChatFeedbackKeyboardOffset(); } catch (_) {}
    try { if (typeof global.loadKinderChatFeedbackDraft === 'function') global.loadKinderChatFeedbackDraft(); } catch (_) {}
    try { if (typeof global.updateKinderChatFeedbackBadge === 'function') global.updateKinderChatFeedbackBadge(); } catch (_) {}
    try { if (typeof global.updateKinderChatFeedbackKeyboardOffset === 'function') global.updateKinderChatFeedbackKeyboardOffset(); } catch (_) {}
    restoreRecordRoomVisibility();
    return true;
  }

  function mount(host, student) {
    if (!host || !student) return false;
    const division = student.type === 'kinder' ? 'kinder' : 'elementary';
    const currentId = String(state.student && state.student.id || '');
    const nextId = String(student.id || '');
    if (state.host === host && state.screen && state.division === division && currentId === nextId) {
      restoreRecordRoomVisibility();
      return true;
    }

    unmount({ save: true });
    state.host = host;
    state.student = student;
    state.division = division;
    host.innerHTML = division === 'kinder' ? KINDER_HTML : ELEMENTARY_HTML;

    const screenId = division === 'kinder' ? 'kinderChatFeedbackScreen' : 'studentMemoScreen';
    state.screen = host.querySelector('#' + screenId);
    if (!state.screen) {
      host.innerHTML = '<div class="pcAttendanceEditorUnavailable">작성 화면을 불러오지 못했습니다.</div>';
      return false;
    }
    state.screen.classList.add('pcAttendanceEmbeddedEditor');

    try {
      if (division === 'elementary' && typeof global.openStudentMemoPageById === 'function') {
        openEmbeddedElementaryRecord(student);
      } else if (division === 'kinder' && typeof global.openKinderChatFeedbackPage === 'function') {
        openEmbeddedKinderRecord();
        if (typeof global.selectKinderChatFeedbackStudentFromManage === 'function') {
          global.selectKinderChatFeedbackStudentFromManage(student.id, null);
        }
      }
    } catch (error) {
      console.warn('PC 기록 작성화면 연결 실패:', error);
    }

    restoreRecordRoomVisibility();
    return true;
  }

  global.OlliPcRecordEditor = Object.freeze({ mount, unmount, saveDraft });
})(window);
