from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]

# 1) consultation-survey.css: make student list narrower and detail wider + tab styles
css_path = root / 'consultation-survey.css'
css = css_path.read_text(encoding='utf-8')
old = ".consultationManagerGrid{display:grid;grid-template-columns:minmax(0,1fr) 480px;gap:18px;align-items:start;}"
new = ".consultationManagerGrid{display:grid;grid-template-columns:minmax(360px,430px) minmax(560px,1fr);gap:18px;align-items:start;}"
if old not in css:
    raise SystemExit('consultationManagerGrid base rule not found')
css = css.replace(old, new, 1)
old = ".consultationListHeader{display:grid;grid-template-columns:minmax(150px,1.3fr) 90px 130px 120px;gap:12px;padding:14px 20px;border-bottom:1px solid #eceef1;color:#9a9ea6;font-size:11.5px;font-weight:800;}"
new = ".consultationListHeader{display:grid;grid-template-columns:minmax(110px,1fr) 52px 84px 92px;gap:8px;padding:14px 14px;border-bottom:1px solid #eceef1;color:#9a9ea6;font-size:11px;font-weight:800;}"
if old not in css:
    raise SystemExit('consultationListHeader rule not found')
css = css.replace(old, new, 1)
old = ".consultationListRow{width:100%;display:grid;grid-template-columns:minmax(150px,1.3fr) 90px 130px 120px;gap:12px;align-items:center;padding:16px 20px;border:0;border-bottom:1px solid #f0f1f3;background:#fff;text-align:left;font-family:inherit;cursor:pointer;color:#202226;}"
new = ".consultationListRow{width:100%;display:grid;grid-template-columns:minmax(110px,1fr) 52px 84px 92px;gap:8px;align-items:center;padding:14px 14px;border:0;border-bottom:1px solid #f0f1f3;background:#fff;text-align:left;font-family:inherit;cursor:pointer;color:#202226;}"
if old not in css:
    raise SystemExit('consultationListRow rule not found')
css = css.replace(old, new, 1)
old = "@media(max-width:1200px){.consultationManagerGrid{grid-template-columns:minmax(0,1fr) 400px}.consultationListHeader,.consultationListRow{grid-template-columns:minmax(130px,1.2fr) 80px 110px 105px}}"
new = "@media(max-width:1200px){.consultationManagerGrid{grid-template-columns:minmax(330px,380px) minmax(480px,1fr)}.consultationListHeader,.consultationListRow{grid-template-columns:minmax(98px,1fr) 48px 78px 88px;gap:7px;padding-left:12px;padding-right:12px}}"
if old not in css:
    raise SystemExit('consultation 1200 media rule not found')
css = css.replace(old, new, 1)
insert_after = ".consultationDetailMeta{margin-top:5px;font-size:12.5px;color:#92969e;}"
tab_css = """
.consultationDetailTabs{position:sticky;top:0;z-index:5;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:0 -4px 4px;padding:12px 4px 10px;background:#fff;border-bottom:1px solid #eceef1;}
.consultationDetailTab{height:38px;border:0;border-radius:12px;background:#f4f5f7;color:#7d828a;font-family:inherit;font-size:12px;font-weight:800;cursor:pointer;}
.consultationDetailTab:hover{background:#eceff3;color:#454a51;}
.consultationDetailTab.active{background:#111;color:#fff;}
.consultationDetailTabPanel[hidden]{display:none;}
.consultationSurveyAnswersFold{margin-top:18px;border:1px solid #e6e8ec;border-radius:16px;background:#fbfbfc;overflow:hidden;}
.consultationSurveyAnswersFold>summary{list-style:none;cursor:pointer;padding:13px 14px;font-size:12px;font-weight:850;color:#666c74;display:flex;align-items:center;justify-content:space-between;gap:10px;}
.consultationSurveyAnswersFold>summary::-webkit-details-marker{display:none;}
.consultationSurveyAnswersFold>summary:after{content:'펼치기';font-size:10.5px;font-weight:750;color:#a0a4ab;}
.consultationSurveyAnswersFold[open]>summary:after{content:'접기';}
.consultationSurveyAnswersFold .consultationAnswerList{max-height:none;padding:0 12px 12px;}
""".strip()
if tab_css not in css:
    if insert_after not in css:
        raise SystemExit('consultationDetailMeta anchor not found')
    css = css.replace(insert_after, insert_after + '\n' + tab_css, 1)
css_path.write_text(css, encoding='utf-8')

# 2) consultation-survey-core.js: tab state + compact survey panel
core_path = root / 'consultation-survey-core.js'
core = core_path.read_text(encoding='utf-8')
anchor = "let analysisLoadPromise=null;"
if anchor not in core:
    raise SystemExit('analysisLoadPromise anchor not found')
core = core.replace(anchor, anchor + "\nconst detailTabById=new Map();", 1)

start = core.find("function renderEmpty(){")
end = core.find("window.openConsultationSurveyDetail=", start)
if start < 0 or end < 0:
    raise SystemExit('render detail block not found')
replacement = r'''function renderEmpty(){const box=document.getElementById('consultationSurveyDetailCard');if(box){box.removeAttribute('data-consultation-selected-id');box.innerHTML='<div class="consultationDetailEmpty">명단에서 학생을 선택하면<br>설문 응답과 분석 준비 내용을 확인할 수 있습니다.</div>';}}
function defaultDetailTab(row){
  const status=String(row?.status||'survey_completed');
  if(status==='observation_waiting'||status==='observation_in_progress')return 'observation';
  if(status==='final_analysis_waiting'||status==='ready'||status==='completed')return 'final';
  return 'survey';
}
function activeDetailTab(id,row){return detailTabById.get(String(id||''))||defaultDetailTab(row);}
window.setConsultationDetailTab=function(id,tab){
  const allowed=['survey','observation','final'];
  const next=allowed.includes(String(tab))?String(tab):'survey';
  detailTabById.set(String(id||''),next);
  window.syncConsultationDetailTabs();
};
window.syncConsultationDetailTabs=function(){
  const box=document.getElementById('consultationSurveyDetailCard');if(!box)return;
  const id=String(box.dataset.consultationSelectedId||selectedId||'');
  const row=rows.find(r=>String(r.id)===id);if(!id||!row)return;
  const active=activeDetailTab(id,row);
  box.querySelectorAll('[data-consultation-tab]').forEach(btn=>btn.classList.toggle('active',btn.dataset.consultationTab===active));
  box.querySelectorAll('[data-consultation-tab-panel]').forEach(panel=>{panel.hidden=panel.dataset.consultationTabPanel!==active;});
};
function renderDetail(id){
  const box=document.getElementById('consultationSurveyDetailCard');const row=rows.find(r=>String(r.id)===String(id));if(!box||!row)return renderEmpty();
  const answers=row.answers&&typeof row.answers==='object'?row.answers:{};
  box.dataset.consultationSelectedId=String(id);
  box.innerHTML=`<div class="consultationDetailTop"><div><div class="consultationDetailName">${esc(row.student_name||'학생')}</div><div class="consultationDetailMeta">${esc(row.student_age||'')}${row.parent_phone4?' · 연락처 뒤 '+esc(row.parent_phone4):''} · ${esc(dateLabel(row.created_at))}</div></div><span class="consultationStatus">${esc(statusLabel(row.status))}</span></div><div class="consultationDetailTabs" role="tablist" aria-label="상담 분석 단계"><button type="button" class="consultationDetailTab" data-consultation-tab="survey" onclick="setConsultationDetailTab('${esc(id)}','survey')">학부모 설문</button><button type="button" class="consultationDetailTab" data-consultation-tab="observation" onclick="setConsultationDetailTab('${esc(id)}','observation')">수업 관찰</button><button type="button" class="consultationDetailTab" data-consultation-tab="final" onclick="setConsultationDetailTab('${esc(id)}','final')">최종 분석</button></div><div class="consultationDetailTabPanel" data-consultation-tab-panel="survey"><div class="consultationDetailSection"><div class="consultationDetailSectionTitle">학부모 설문 분석</div>${renderAutomaticAnalysis(answers)}</div><details class="consultationSurveyAnswersFold"><summary>학부모 설문 답변 14문항</summary><div class="consultationAnswerList">${QUESTIONS.map((q,i)=>`<div class="consultationAnswerItem"><div class="consultationAnswerQ">${i+1}. ${esc(q.text)}</div><div class="consultationAnswerA">${esc(answerLabel(answers[q.id],q))}</div></div>`).join('')}</div></details></div>`;
  window.syncConsultationDetailTabs();
}
'''
core = core[:start] + replacement + core[end:]
core_path.write_text(core, encoding='utf-8')

# Helper for extension sections

def patch_section(path_name, dataset_name, panel_name, body_assignment_marker):
    path = root / path_name
    text = path.read_text(encoding='utf-8')
    old = f"section.className='consultationDetailSection';section.dataset.{dataset_name}='1';"
    new = f"section.className='consultationDetailSection consultationDetailTabPanel';section.dataset.{dataset_name}='1';section.dataset.consultationTabPanel='{panel_name}';"
    if old not in text:
        raise SystemExit(f'{path_name}: section creation anchor not found')
    text = text.replace(old, new, 1)
    if body_assignment_marker not in text:
        raise SystemExit(f'{path_name}: body assignment marker not found')
    text = text.replace(body_assignment_marker, body_assignment_marker + "\n  if(typeof window.syncConsultationDetailTabs==='function')window.syncConsultationDetailTabs();", 1)
    path.write_text(text, encoding='utf-8')

patch_section(
    'consultation-observation-ui.js',
    'consultationObservationSection',
    'observation',
    "  body.innerHTML=formHtml(id,draft);"
)
patch_section(
    'consultation-final-analysis-ui.js',
    'consultationFinalSection',
    'final',
    "  body.innerHTML=completedHtml(id,state);"
)
patch_section(
    'consultation-result-sheet-ui.js',
    'consultationResultSection',
    'final',
    "  body.innerHTML=result?contentHtml(id,result):'<div class=\"consultationAnalysisWaiting\">상담 결과를 계산하지 못했습니다.</div>';"
)

print('consultation detail tabs patch applied')
