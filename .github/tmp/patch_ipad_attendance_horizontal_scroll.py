from pathlib import Path

path = Path('pc-timetable.css')
text = path.read_text(encoding='utf-8')
marker = '/* iPad 출석부: 고정 학생정보 3열 + 날짜 가로 스크롤 */'
if marker in text:
    raise SystemExit('iPad attendance scroll styles already exist')

addition = r'''

/* iPad 출석부: 고정 학생정보 3열 + 날짜 가로 스크롤 */
@media (min-width:700px) and (max-width:1400px) and (hover:none) and (pointer:coarse) {
  #recordRoomScreen .olliTtAttendanceRegisterScroll {
    overflow-x: auto !important;
    overflow-y: auto !important;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
  }
  #recordRoomScreen .olliTtAttendanceSheet {
    width: 1500px !important;
    min-width: 1500px !important;
    max-width: none !important;
    overflow: visible;
  }
  #recordRoomScreen .olliTtAttendanceTable {
    width: 1500px !important;
    min-width: 1500px !important;
    max-width: none !important;
    table-layout: fixed !important;
  }

  /* 학생정보 3열은 왼쪽에 고정하고 날짜 열만 가로로 이동 */
  #recordRoomScreen .olliTtAttendanceTable th.nameCol,
  #recordRoomScreen .olliTtAttendanceTable td.nameCol {
    position: sticky !important;
    left: 0;
    z-index: 5;
    width: 64px !important;
    min-width: 64px !important;
    max-width: 64px !important;
  }
  #recordRoomScreen .olliTtAttendanceTable th.schoolGradeCol,
  #recordRoomScreen .olliTtAttendanceTable td.schoolGradeCol {
    position: sticky !important;
    left: 64px;
    z-index: 5;
    width: 51px !important;
    min-width: 51px !important;
    max-width: 51px !important;
    background: #fff !important;
  }
  #recordRoomScreen .olliTtAttendanceTable th.personalityCol,
  #recordRoomScreen .olliTtAttendanceTable td.personalityCol {
    position: sticky !important;
    left: 115px;
    z-index: 5;
    width: 20px !important;
    min-width: 20px !important;
    max-width: 20px !important;
    background: #fff !important;
    box-shadow: 5px 0 8px rgba(27,39,58,.055);
  }
  #recordRoomScreen .olliTtAttendanceTable tbody td.nameCol {
    background: #fafbfc !important;
  }
  #recordRoomScreen .olliTtAttendanceTable thead th.nameCol,
  #recordRoomScreen .olliTtAttendanceTable thead th.schoolGradeCol,
  #recordRoomScreen .olliTtAttendanceTable thead th.personalityCol {
    z-index: 7;
    background: #f8f9fb !important;
  }
}
'''

path.write_text(text.rstrip() + addition, encoding='utf-8')
