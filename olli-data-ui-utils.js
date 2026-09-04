function formatRegDate(student) {
  if (!student) return '';
  if (student.enrolled_at) {
    const parts = String(student.enrolled_at).split('-');
    if (parts.length >= 3) return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }
  const year = student.year || getCurrentYear();
  const month = student.month || '';
  const day = student.day || '';
  if (!month || !day) return '';
  return `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
}

function getElementaryMetaBits(student) {
  const metaText = getElementaryMetaText(student);
  return metaText ? [metaText] : [];
}

function getKinderMetaText(student) {
  const personality = formatElementaryPersonalityDisplay(student);
  const kindergarten = normalizeRecordInfoValue(student?.kindergarten, student?.kindergarten_name, student?.kindergartenName);
  const age = normalizeRecordInfoValue(student?.age, student?.student_age, student?.studentAge);
  const teacherName = getStudentTeacherDisplay(student);
  const lessonDay = normalizeLessonDayDisplay(normalizeRecordInfoValue(student?.lesson_day, student?.lessonDay, student?.class_day, student?.classDay));
  return [personality, kindergarten, age ? `${age}세` : '', teacherName, lessonDay].filter(Boolean).join(' / ');
}

function getKinderMetaBits(student) {
  const metaText = getKinderMetaText(student);
  return metaText ? [metaText] : [];
}

function getRecordModeLabel(mode) {
  if (currentRecordView === 'academy') return '학원 관리';
  if (currentRecordView === 'elementary') return '초등부';
  if (currentRecordView === 'kinder') return '유치부';
  if (mode === 'fail') return '성장 피드백';
  if (mode === 'summary') return '종합 피드백';
  return '수업 피드백';
}
function getChatModeLabel(mode) { return '설문지'; }

function fmt(t) {
  return String(t).split('\n').map(l => `<p>${l.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') || '&nbsp;'}</p>`).join('');
}
function escapeTemplateLiteral(str) { return String(str).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${'); }
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function copyIconSvg() { return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.8" y="8.2" width="11.8" height="11.8" rx="2.4"></rect><rect x="8.4" y="3.6" width="11.8" height="11.8" rx="2.4"></rect></svg>`; }
function shareIconSvg() { return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.8V4.2"></path><path d="M8.2 8l3.8-3.8L15.8 8"></path><path d="M5.4 14.8v2.3c0 1.5 1.2 2.7 2.7 2.7h7.8c1.5 0 2.7-1.2 2.7-2.7v-2.3"></path></svg>`; }
function checkIconSvg() { return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>`; }

function showOlliCopySuccess(btn, options = {}) {
  if (!btn) return;
  const restoreHtml = Object.prototype.hasOwnProperty.call(options, 'restoreHtml')
    ? String(options.restoreHtml ?? '')
    : btn.innerHTML;
  const restoreDisabled = Object.prototype.hasOwnProperty.call(options, 'restoreDisabled')
    ? !!options.restoreDisabled
    : !!btn.disabled;

  if (btn._olliCopySuccessTimer) clearTimeout(btn._olliCopySuccessTimer);

  btn.innerHTML = '✓';
  btn.disabled = true;
  btn.classList.add('copied');

  btn._olliCopySuccessTimer = setTimeout(() => {
    if (!btn || !btn.isConnected) return;
    btn.innerHTML = restoreHtml;
    btn.disabled = restoreDisabled;
    btn.classList.remove('copied');
    btn._olliCopySuccessTimer = null;
  }, 1200);
}

async function cp(btn, text) {
  let copied = false;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch (err) {
    copied = false;
  }

  if (!copied) {
    try {
      const temp = document.createElement('textarea');
      temp.value = text;
      temp.setAttribute('readonly', '');
      temp.style.position = 'fixed';
      temp.style.left = '-9999px';
      temp.style.top = '0';
      document.body.appendChild(temp);
      temp.focus();
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
      copied = true;
    } catch (err) {
      copied = false;
    }
  }

  if (copied && btn) showOlliCopySuccess(btn);
}
function openSaveModal(text) {
  currentFeedbackToSave = text;
  document.getElementById('saveModal').style.display = 'flex';
  document.getElementById('studentName').value = '';
  document.getElementById('studentName').focus();
}
function closeSaveModal() { hideModalOnly('saveModal'); currentFeedbackToSave = ''; }
async function confirmSave() {
  const name = document.getElementById('studentName').value.trim();
  if (!name) { alert('아이 이름을 입력해 주세요!'); return; }

  const year = new Date().getFullYear();
  const date = new Date().toLocaleDateString('ko-KR');
  const isSummary = currentSaveType === 'summary';
  const tableName = isSummary ? 'summary_feedbacks' : getFeedbackTableNameByType(currentSaveType);
  const studentDivision = getPreferredStudentTypeForSave();
  const normalizedFeedbackType = tableName === 'fail_feedbacks' ? 'fail' : currentSaveType;
  let payload;

  try {
    const savedStudent = await getOrCreateStudentForSupabaseSave(name, studentDivision);

    payload = isSummary
      ? addOlliAcademyToPayload({
          student_id: savedStudent.id,
          student_name: savedStudent.name || name,
          content: currentFeedbackToSave,
          year,
          date
        }, '종합 피드백 저장')
      : addOlliAcademyToPayload({
          student_id: savedStudent.id,
          student_name: savedStudent.name || name,
          content: currentFeedbackToSave,
          feedback_type: normalizedFeedbackType,
          year,
          date
        }, tableName === 'fail_feedbacks' ? '실패·성장 피드백 저장' : '피드백 저장');

    await saveFeedbackRowVerified(tableName, payload, isSummary ? '종합 피드백 저장' : (tableName === 'fail_feedbacks' ? '실패·성장 피드백 저장' : '피드백 저장'));

    closeSaveModal();

    const recordRoomScreen = document.getElementById('recordRoomScreen');
    const recordVisible = recordRoomScreen && recordRoomScreen.style.display !== 'none';
    if (recordVisible && typeof loadRecords === 'function') {
      await loadRecords('');
    }

    const mainPage = document.getElementById('mainPageScreen');
    const isOneMinuteVisible = mainPage && mainPage.style.display !== 'none';
    if (isOneMinuteVisible && typeof resetOneMinuteFeedback === 'function') {
      resetOneMinuteFeedback();
    }
  } catch (err) {
    console.error('피드백 저장 오류:', err);
    alert(`저장 중 오류가 발생했어요.\n\n${err.message || '알 수 없는 오류입니다.'}`);
  }
}

async function shareText(text) {
  if (navigator.share) {
    try { await navigator.share({ text }); return true; } catch (err) { if (err && err.name === 'AbortError') return false; }
  }
  await navigator.clipboard.writeText(text);
  alert('공유 기능을 사용할 수 없어 복사로 대신 저장했어요.');
  return true;
}
function parseReplyType(rawText) {
  const text = String(rawText || '').trim();
  if (text.startsWith('[TYPE:FAIL]')) return { type: 'fail', cleanText: text.replace(/^\[TYPE:FAIL\]\s*/i, '') };
  if (text.startsWith('[TYPE:CLASS]')) return { type: 'class', cleanText: text.replace(/^\[TYPE:CLASS\]\s*/i, '') };
  if (text.startsWith('[TYPE:SUMMARY]')) return { type: 'summary', cleanText: text.replace(/^\[TYPE:SUMMARY\]\s*/i, '') };
  if (text.startsWith('[TYPE:KINDER_ONE_MONTH]')) return { type: 'kinder_one_month', cleanText: text.replace(/^\[TYPE:KINDER_ONE_MONTH\]\s*/i, '') };
  if (text.startsWith('[TYPE]')) return { type: 'kinder_one_month', cleanText: text.replace(/^\[TYPE\]\s*/i, '') };
  return { type: 'class', cleanText: text };
}
function getApiErrorMessage(status, data) {
  const msg = data?.error || data?.message || data?.detail?.error?.message || '알 수 없는 오류가 발생했습니다.';
  if (status === 400) return `요청 형식 오류(400)\n${msg}`;
  if (status === 401) return `인증 오류(401)\n${msg}`;
  if (status === 403) return `권한 오류(403)\n${msg}`;
  if (status === 404) return `API 경로 오류(404)\n${msg}`;
  if (status === 429) return `한도 초과(429)\n${msg}`;
  if (status >= 500) return `서버 오류(${status})\n${msg}`;
  return `요청 실패(${status})\n${msg}`;
}
const FAIL_SURVEY_OPTIONS = {
  A2: [['1','가위'],['2','풀'],['3','색칠/물감'],['4','연필/선따라/그리기'],['5','스티커/오려붙이기'],['6','조형'],['7','관계/차례'],['8','기타']],
  A2_1: { '1': [['1','선이어긋남'],['2','모서리찢어짐'],['3','종이접혀잘림'],['4','작은부분어려움'],['5','손이멈춤']], '2': [['1','양조절어려움'],['2','종이들뜸'],['3','손에풀묻어불편'],['4','붙인위치틀어짐'],['5','마르는시간답답']], '3': [['1','색번짐'],['2','선밖으로나감'],['3','진하기조절어려움'],['4','크레파스/붓뭉침'],['5','색이생각과다름']], '4': [['1','선흔들림'],['2','진하게눌러지워지지않음'],['3','크기커짐/작아짐'],['4','비례마음에안듦'],['5','반복수정']], '5': [['1','위치마음에안듦'],['2','떼다찢어짐'],['3','손에달라붙음'],['4','순서꼬임'],['5','정렬어려움']], '6': [['1','붙인부분떨어짐'],['2','형태무너짐'],['3','힘조절어려움'],['4','세부표현어려움'],['5','손에달라붙음']], '7': [['1','기다리기어려움'],['2','내차례늦다고느낌'],['3','친구먼저해서속상'],['4','공유어려움'],['5','규칙헷갈림']], '8': [['1','기타상황']] },
  A3: [['1','기술'],['2','표현'],['3','계획'],['4','규칙'],['5','사회성'],['6','집중'],['7','기타']],
  A4: [['1','멈춤'],['2','도구내림'],['3','작품가림'],['4','구김'],['5','찢음'],['6','던짐'],['7','자리이탈'],['8','울음'],['9','위축'],['10','포기'],['11','다시잡음'],['12','소리지름'],['13','기타']],
  A5: [['1','안돼'],['2','망했어'],['3','못해'],['4','해줘'],['5','어떻게해?'],['6','다시할래'],['7','도와주세요'],['8','말없음'],['9','싫어요'],['10','기타']],
  A6: [['1','작품응시'],['2','선생님확인'],['3','주변눈치'],['4','무시/회피'],['5','기타']],
  A7: [['1','소근육/도구미숙'],['2','방법/순서혼란'],['3','난이도과부하'],['4','시간압박'],['5','규칙이해부족'],['6','감정흔들림'],['7','또래/환경영향'],['8','컨디션'],['9','자신감부족'],['10','기타']],
  A8: [['1','관찰후질문'],['2','시범'],['3','단계쪼개기'],['4','대안제시'],['5','휴식후재시작'],['6','규칙다시안내'],['7','신뢰언어'],['8','친구와연결'],['9','감정공유'],['10','개입거의없음'],['11','기타']],
  A9: [['1','스스로도구잡음'],['2','속도줄여재시도'],['3','다른방식재시도'],['4','작은부분시작'],['5','어떻게해? 질문'],['6','자리돌아와마무리'],['7','친구에게양보'],['8','친구와협력'],['9','놀이로전환'],['10','규칙지키기'],['11','전환없음'],['12','기타']],
  A10: [['1','끝까지완성'],['2','부분완성'],['3','실패했지만재도전'],['4','도움받아완성'],['5','중단'],['6','다른활동전환'],['7','기타']],
  A11: [['1','자신감상승'],['2','기술보완'],['3','표현확장'],['4','계획세우기'],['5','규칙/차례적응'],['6','집중력루틴'],['7','아이마음공감'],['8','기타']],
  A12: [['1','안전'],['2','강한감정폭발'],['3','자해/타해시도'],['4','심한위축/공포'],['5','또래괴롭힘'],['6','반복회피/거부'],['7','특이행동'],['8','해당없음'],['9','기타']],
  A13: [['1','기분많이좋아짐'],['2','평소와동일'],['3','속상한마음조금남음'],['4','많이속상한상태'],['5','잘모르겠음']]
};
const FAIL_SURVEY_MULTI_MAX = { A3:3, A4:3, A5:3, A6:3, A7:3, A8:3, A9:2, A11:3 };
