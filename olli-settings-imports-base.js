let attendancePhotoImportState = {
  imageName: '',
  imageDataUrl: '',
  imageItems: [],
  analyzing: false,
  analysisProgress: '',
  importRunning: false,
  candidates: [],
  errorMessage: '',
  rawReply: ''
};


let studentBulkImportState = {
  division: 'elementary',
  rawText: '',
  candidates: [],
  importRunning: false,
  errorMessage: ''
};

let existingFeedbackImportState = {
  fileName: '',
  fileSize: 0,
  fileType: '',
  fileText: '',
  fileDataUrl: '',
  analyzing: false,
  importRunning: false,
  statusMessage: '',
  errorMessage: '',
  rawReply: '',
  candidates: []
};

let studentManagementActiveTab = 'bulk';

function getStudentManagementActiveTab() {
  return ['bulk', 'feedback', 'photo'].includes(studentManagementActiveTab) ? studentManagementActiveTab : 'bulk';
}
function setStudentManagementTab(tab) {
  studentManagementActiveTab = ['bulk', 'feedback', 'photo'].includes(tab) ? tab : 'bulk';
  refreshSettingsAttendancePhotoImportDetail();
}
function renderStudentManagementTabs() {
  const active = getStudentManagementActiveTab();
  const tab = (key, label) => '<button type="button" class="studentManagementTabBtn' + (active === key ? ' active' : '') + '" onclick="setStudentManagementTab(\'' + key + '\')">' + label + '</button>';
  return '<div class="studentManagementTabRow">'
    + tab('bulk', '요일·시간 업로드')
    + tab('feedback', '기존 피드백')
    + tab('photo', '출석부 사진')
    + '</div>';
}

/* P0: settings-storage 다음 순서에서 공통 재전송 브리지를 한 번만 로드합니다. */
(function loadOlliStorageRetryBridgeP0() {
  if (window.__olliStorageRetryBridgeLoaderP0) return;
  window.__olliStorageRetryBridgeLoaderP0 = true;
  const script = document.createElement('script');
  script.src = 'olli-storage-retry-bridge.js?v=20260909-p0-1';
  script.async = false;
  script.dataset.olliStorageRetryBridge = 'p0';
  script.onerror = () => console.error('P0 저장 재전송 브리지를 불러오지 못했습니다.');
  (document.head || document.documentElement).appendChild(script);
})();
