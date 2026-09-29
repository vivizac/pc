
/* v40-fix-12: 앱 첫 화면 로그인 표시 */
function shouldShowOlliLoginOnStart() {
  const academyId = localStorage.getItem('olli_current_academy_id');
  const academyCode = localStorage.getItem('olli_current_academy_code');
  const ownerLoggedIn = localStorage.getItem('olli_owner_logged_in') === 'true';
  const teacherLoggedIn = localStorage.getItem('olli_teacher_logged_in') === 'true';

  // 원장/선생님 로그인 상태 또는 학원 정보가 있으면 기존 앱으로 진입.
  return !(ownerLoggedIn || teacherLoggedIn || academyId || academyCode);
}

// 시작 화면 표시는 메인 시작 라우터에서 한 번만 처리합니다.
