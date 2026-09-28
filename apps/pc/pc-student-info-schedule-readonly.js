(function pcStudentInfoScheduleReadonly(global){
  'use strict';
  if (global.__OLLI_PC_STUDENT_INFO_SCHEDULE_READONLY_V1__) return;
  global.__OLLI_PC_STUDENT_INFO_SCHEDULE_READONLY_V1__ = true;

  function applyReadonly(){
    document.querySelectorAll('#recordRoomScreen .pcStudentInfoCard .pcStudentInfoSchedule').forEach((schedule) => {
      const title = schedule.querySelector('.pcStudentInfoScheduleTitle');
      if (title) title.textContent = '수업 시간 · 시간표에서 변경';
      schedule.querySelectorAll('button').forEach((button) => {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        button.tabIndex = -1;
      });
      if (!schedule.querySelector('.pcStudentInfoScheduleReadonlyGuide')) {
        const guide = document.createElement('div');
        guide.className = 'pcStudentInfoScheduleReadonlyGuide';
        guide.textContent = '수업 요일·시간·클래스는 시간표의 학생 수업시간 설정에서만 변경할 수 있습니다.';
        schedule.appendChild(guide);
      }
    });
  }

  if (!document.getElementById('olliPcStudentInfoScheduleReadonlyStyle')) {
    const style = document.createElement('style');
    style.id = 'olliPcStudentInfoScheduleReadonlyStyle';
    style.textContent = `
      #recordRoomScreen .pcStudentInfoCard .pcStudentInfoSchedule button:disabled{cursor:default;opacity:1;pointer-events:none;}
      #recordRoomScreen .pcStudentInfoCard .pcStudentInfoSchedule .infoDayBtn:not(.active),
      #recordRoomScreen .pcStudentInfoCard .pcStudentInfoSchedule .infoTimeBtn:not(.active){color:#a2a7ae;background:#f0f2f4;}
      #recordRoomScreen .pcStudentInfoScheduleReadonlyGuide{margin-top:9px;padding-top:8px;border-top:1px solid #eceef1;color:#9aa0a8;font-size:9.8px;font-weight:600;line-height:1.45;}
    `;
    document.head.appendChild(style);
  }

  let timer = 0;
  function queueApply(){ clearTimeout(timer); timer = setTimeout(applyReadonly, 0); }
  const observer = new MutationObserver(queueApply);
  observer.observe(document.body, { childList:true, subtree:true });
  document.addEventListener('click', (event) => {
    if (event.target.closest('#recordRoomScreen .pcAttendanceStudentInfoBtn')) setTimeout(applyReadonly, 20);
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', queueApply, { once:true });
  else queueApply();
})(window);
