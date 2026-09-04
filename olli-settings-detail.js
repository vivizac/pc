function renderSettingsDetailHtml(data) {
  return typeof data.html === 'function' ? data.html() : data.html;
}

async function openSettingsDetail(type){
  const data = settingsDetailData[type];
  if(!data) return;
  const detail = document.getElementById('settingsDetailScreen');
  const settings = document.getElementById('settingsPageScreen');
  const titlePill = document.getElementById('settingsDetailTitlePill');
  const body = document.getElementById('settingsDetailBody');
  if(!detail || !body) return;

  settingsCurrentDetailType = type;
  if (settings) settings.style.display = 'flex';
  if (titlePill) titlePill.textContent = data.title;

  // 데이터가 필요한 설정 페이지도 먼저 화면을 열고, 최신 데이터는 뒤에서 조용히 갱신합니다.
  try {
    body.innerHTML = data.instantRender ? renderSettingsDetailHtml(data) : '<div class="settingsLoadingText">불러오는 중입니다...</div>';
    if (type === 'attendancePrint') settingsAttendanceScheduleFitText(body);
  } catch (renderError) {
    body.innerHTML = '<div class="settingsLoadingText">화면을 준비하고 있습니다.</div>';
  }

  // 기존 슬라이드 함수와 충돌하지 않도록 설정 상세도 독립 오버레이로 표시
  detail.style.display = 'flex';
  detail.style.position = 'fixed';
  detail.style.inset = '0';
  detail.style.transform = 'translateX(0)';
  detail.style.opacity = '1';
  detail.style.pointerEvents = 'auto';
  detail.style.zIndex = '91000';

  try {
    if (typeof data.beforeOpen === 'function') await data.beforeOpen();
    if (settingsCurrentDetailType !== type || detail.style.display === 'none') return;
    body.innerHTML = renderSettingsDetailHtml(data);
    if (type === 'attendancePrint') settingsAttendanceScheduleFitText(body);
  } catch (err) {
    if (settingsCurrentDetailType !== type || detail.style.display === 'none') return;
    olliSettingsState.lastError = err.message || String(err);
    body.innerHTML = data.instantRender
      ? (renderSettingsErrorIfNeeded() + renderSettingsDetailHtml(data))
      : renderSettingsErrorIfNeeded();
  }
}

function closeSettingsDetail(){
  settingsCurrentDetailType = '';
  const detail = document.getElementById('settingsDetailScreen');
  const settings = document.getElementById('settingsPageScreen');

  if(detail) {
    detail.style.display = 'none';
    detail.style.transform = '';
    detail.style.opacity = '';
    detail.style.pointerEvents = '';
  }

  if(settings) settings.style.display = 'flex';
}

// 설정 상세 페이지 버튼은 기존 openSettingsDetail 함수를 전역에 명시적으로 노출합니다.
// 인라인 onclick이 전역 window에서 함수를 찾기 때문에, 이 연결이 끊기면 팝업 버튼은 살아 있어도
// 페이지 이동형 설정 버튼만 반응하지 않을 수 있습니다.
window.openSettingsDetail = openSettingsDetail;
window.closeSettingsDetail = closeSettingsDetail;

document.addEventListener('DOMContentLoaded', function(){
  settingsApplyStateToUI();
});
