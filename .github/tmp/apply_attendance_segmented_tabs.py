from pathlib import Path

js = Path('pc-timetable.js')
text = js.read_text(encoding='utf-8')
old = """    title.innerHTML = '<div class=\"olliTtDivisionTabs\" role=\"tablist\" aria-label=\"출석부 부서 선택\">'\n      + ['elementary', 'kinder', 'combined'].map((division) => `<button type=\"button\" class=\"olliTtDivisionTab ${state.attendanceDivision === division ? 'active' : ''}\" data-tt-attendance-division=\"${division}\">${division === 'elementary' ? '초등부' : (division === 'kinder' ? '유치부' : '통합')}</button>`).join('') + '</div>'\n"""
new = """    title.innerHTML = '<div class=\"olliTtDivisionTabs olliTtAttendanceDivisionTabs\" role=\"tablist\" aria-label=\"출석부 부서 선택\">'\n      + ['combined', 'elementary', 'kinder'].map((division) => `<button type=\"button\" class=\"olliTtDivisionTab ${state.attendanceDivision === division ? 'active' : ''}\" data-tt-attendance-division=\"${division}\">${division === 'combined' ? '전체' : (division === 'elementary' ? '초등부' : '유치부')}</button>`).join('') + '</div>'\n"""
if old not in text:
    raise SystemExit('attendance header pattern not found')
js.write_text(text.replace(old, new, 1), encoding='utf-8')

css = Path('pc-timetable.css')
style = css.read_text(encoding='utf-8')
marker = '/* 출석부 전용 세그먼트 부서 버튼 */'
block = r'''

/* 출석부 전용 세그먼트 부서 버튼 */
#olliPcTopbar .olliTtAttendanceDivisionTabs{
  display:inline-flex;
  align-items:stretch;
  gap:0;
  overflow:hidden;
  border:1px solid #dbe5ef;
  border-radius:16px;
  background:#fff;
  box-shadow:0 1px 2px rgba(24,39,75,.03);
}
#olliPcTopbar .olliTtAttendanceDivisionTabs .olliTtDivisionTab{
  min-width:94px;
  height:40px;
  padding:0 22px;
  border:0;
  border-right:1px solid #dbe5ef;
  border-radius:0;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  color:#303742;
  background:#fff;
  font:800 calc(14px * var(--olli-text-scale)) 'Pretendard',sans-serif;
  letter-spacing:-.035em;
  box-shadow:none;
  cursor:pointer;
}
#olliPcTopbar .olliTtAttendanceDivisionTabs .olliTtDivisionTab:last-child{border-right:0;}
#olliPcTopbar .olliTtAttendanceDivisionTabs .olliTtDivisionTab:hover:not(.active){
  color:#1f2732;
  background:#f7faff;
}
#olliPcTopbar .olliTtAttendanceDivisionTabs .olliTtDivisionTab.active{
  color:#fff;
  background:#74aaf6;
}
#olliPcTopbar .olliTtAttendanceDivisionTabs .olliTtDivisionTab:focus-visible{
  position:relative;
  z-index:1;
  outline:2px solid rgba(10,132,255,.28);
  outline-offset:-2px;
  border-radius:0;
}
'''
if marker not in style:
    anchor = "#olliPcTopbar .olliTtDivisionTab:focus-visible { outline: 2px solid rgba(10,132,255,.28); outline-offset: 5px; border-radius: 3px; }"
    if anchor not in style:
        raise SystemExit('css anchor not found')
    style = style.replace(anchor, anchor + block, 1)
css.write_text(style, encoding='utf-8')

for temp in [
    Path('.github/workflows/apply-attendance-segmented-tabs.yml'),
    Path('.github/tmp/apply_attendance_segmented_tabs.py'),
]:
    if temp.exists():
        temp.unlink()
