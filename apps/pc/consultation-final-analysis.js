(function(){
'use strict';

const VERSION='FINAL_2026_09';
const STATUS={
  confirmed:{key:'confirmed',label:'확인됨'},
  partial:{key:'partial',label:'부분 확인'},
  hold:{key:'hold',label:'보류 또는 제외'},
  new:{key:'new',label:'새롭게 발견됨'},
  needs:{key:'needs',label:'추가 관찰 필요'}
};
const RATING_LABELS={'2':'분명히 관찰됨','1':'일부 관찰됨','0':'관찰되지 않음','X':'관찰할 기회가 없었음'};

const c=(id,allowed)=>({id,allowed:Array.isArray(allowed)?allowed:[allowed]});
const OBSERVATION_RULES=[
  {id:'O1R',name:'결과민감 + 회복력형',core:[c('E1','2'),c('E2','2'),c('E3','2')]},
  {id:'O1',name:'결과민감형',core:[c('E1','2'),c('E2','2')]},
  {id:'O2',name:'실패회피 가능형',core:[c('E2','2'),c('E3','0'),c('D2','2')],boost:[c('B3','2')]},
  {id:'O3',name:'조용한 완벽주의 가능형',core:[c('E1','2'),c('E2',['0','1']),c('B3','2')],boost:[c('G1','2'),c('G3','2')]},
  {id:'O4',name:'건강한 독립 문제해결형',core:[c('D1','2'),c('D2','0'),c('D3','2')]},
  {id:'O5A',name:'도움 선요청 · 코칭 반응형',core:[c('D1','0'),c('D2','2'),c('D3','2')]},
  {id:'O5B',name:'도움 선요청 · 지속 의존형',core:[c('D1','0'),c('D2','2'),c('D3','0')]},
  {id:'O6',name:'도움요청이 어려운 독립형',core:[c('D1','2'),c('D2','0'),c('E2','2')],boost:[c('D3','0')]},
  {id:'O7',name:'자기주도 표현형',core:[c('C1','2'),c('C2','2'),c('C3','2')]},
  {id:'O8',name:'선택은 가능하지만 확장이 어려운형',core:[c('C1','2'),c('C2','2'),c('C3','0')]},
  {id:'O9',name:'또래 관찰학습형',core:[c('F1','2'),c('F2','2'),c('C3','2')]},
  {id:'O10',name:'또래 의존 가능형',core:[c('F1','2'),c('F2','2'),c('C1','0'),c('C3','0')],boost:[c('B2','2')]},
  {id:'O11',name:'경쟁·비교 민감형',core:[c('F3','2'),c('E2','2')],boost:[c('F1','2')]},
  {id:'O12',name:'경쟁 에너지형',core:[c('F3','2'),c('E2','2'),c('E3','2'),c('G2','2')]},
  {id:'O13',name:'몰입·완결형',core:[c('G1','2'),c('G2','2'),c('G3','2')],caution:[c('E1','2')]},
  {id:'O14',name:'흥미 몰입형',core:[c('G1','2'),c('G2','0'),c('G3','0')]},
  {id:'O15',name:'시작 에너지는 높지만 마무리 약한형',core:[c('B1','2'),c('C3','2'),c('G3','0')]},
  {id:'O16',name:'신중 준비형',core:[c('B1','0'),c('B2','0'),c('B3','0'),c('C1','2')]},
  {id:'O17',name:'질문 탐구형',core:[c('H2','2'),c('D3','2'),c('C3','2')]},
  {id:'O18',name:'서사 확장형',core:[c('H1','2'),c('H3','2'),c('C3','2')]},
  {id:'O19',name:'지식 설명형',core:[c('H1','2'),c('H2','0'),c('H3','0')]},
  {id:'O20',name:'비언어 사고형',core:[c('H1','0'),c('H2','0'),c('H3','0'),c('C1','2'),c('C3','2')]}
];

const SUPPORT_PATHS={
  1:[[c('C1','2'),c('C3','2')],[c('G1','2'),c('G3','2')]],
  2:[[c('G1','2'),c('G3',['0','1'])]],
  3:[[c('A3','2'),c('G1',['1','2'])],[c('A3','2'),c('B1','2')]],
  4:[[c('B1','2'),c('G3','0')],[c('C3','2'),c('G3','0')]],
  5:[[c('E1','2'),c('E2','2'),c('F1','2')],[c('E2','2'),c('F3','2'),c('B3','2')]],
  6:[[c('E1','2'),c('E2',['0','1']),c('B3','2')]],
  7:[[c('E2','2'),c('E3','0'),c('D2','2')]],
  8:[[c('F3','2'),c('E2','2')],[c('F1','2'),c('F3','2')]],
  9:[[c('F1','2'),c('F2','2'),c('C3','2')]],
  10:[[c('D1','0'),c('D2','2'),c('D3','0')],[c('D1','0'),c('D2','2')]],
  11:[[c('D2','2'),c('D3','2')],[c('D1','2'),c('D2','0'),c('D3','2')]],
  12:[[c('H2','2'),c('D3','2'),c('C3','2')],[c('D1','2'),c('D3','2'),c('H2','2')]],
  13:[[c('D1','2'),c('D2','0'),c('E2','2')]],
  14:[[c('A3','2'),c('A1','2')],[c('A3','2'),c('A2','2')]],
  15:[[c('A3','2'),c('B1','2'),c('A2','0')]],
  16:[[c('B1','0'),c('B2','0'),c('B3','0'),c('C1','2')]],
  17:[[c('A2','0'),c('H1','2')]],
  18:[[c('C1','2'),c('C2','2'),c('A3','2')],[c('C1','2'),c('C2','2')]],
  19:[[c('C1','2'),c('C2','2'),c('H1',['0','1'])]],
  20:[[c('H1','2'),c('H3','2'),c('C3','2')]],
  21:[[c('H1','2'),c('H2','2')],[c('H2','2'),c('D3','2'),c('C3','2')]],
  22:[[c('H1','0'),c('H2','0'),c('H3','0'),c('C1','2'),c('C3','2')]],
  23:[[c('G1','2'),c('G2','2'),c('G3','2')]],
  24:[[c('E2','2'),c('E3','2'),c('G2','2')],[c('F3','2'),c('E2','2'),c('E3','2')]],
  25:[[c('E2','2'),c('D2','2'),c('A2','2')],[c('E2','2'),c('B3','2'),c('D2','2')]],
  26:[[c('F1','2'),c('F2','2'),c('C1','0'),c('C3','0')],[c('F3','2'),c('E2','2'),c('F1','2')]],
  27:[[c('A1','2'),c('B1','0'),c('C1','2')],[c('B1','0'),c('B2','0'),c('B3','0'),c('C1','2')]],
  28:[[c('F3','0'),c('E2','0')]]
};
const PATTERN_TRAITS={
  1:['O7','O13'],2:['O14'],4:['O15'],5:['O1','O1R','O11','O12'],6:['O3'],7:['O2'],8:['O11','O12'],9:['O9'],
  10:['O5B'],11:['O5A','O4'],12:['O17','O4'],13:['O6'],16:['O16'],20:['O18'],21:['O17','O19'],22:['O20'],23:['O13'],
  24:['O1R','O12'],25:['O2','O5A'],26:['O10','O11'],27:['O16']
};

function value(ratings,id){const v=String(ratings?.[id]??'');return ['2','1','0','X'].includes(v)?v:'';}
function condResult(cond,ratings){
  const v=value(ratings,cond.id);
  if(!v||v==='X')return {state:'unknown',value:v};
  return {state:cond.allowed.includes(v)?'match':'opposite',value:v};
}
function evalConditions(conditions,ratings,partialMode){
  const detail=conditions.map(cond=>({cond,...condResult(cond,ratings)}));
  const matches=detail.filter(x=>x.state==='match').length;
  const opposites=detail.filter(x=>x.state==='opposite').length;
  const unknown=detail.filter(x=>x.state==='unknown').length;
  const total=conditions.length;
  if(total&&matches===total)return {level:'strong',matches,opposites,unknown,total,detail};
  const observed=matches+opposites;
  if(partialMode==='survey'){
    if(observed===0||observed<Math.min(2,total))return {level:'unknown',matches,opposites,unknown,total,detail};
    if(matches/Math.max(1,observed)>=0.5&&matches>0)return {level:'partial',matches,opposites,unknown,total,detail};
    return {level:'opposite',matches,opposites,unknown,total,detail};
  }
  const threshold=total<=2?total:total-1;
  if(matches>=threshold&&opposites===0)return {level:'partial',matches,opposites,unknown,total,detail};
  if(observed<Math.ceil(total/2))return {level:'unknown',matches,opposites,unknown,total,detail};
  return {level:'no',matches,opposites,unknown,total,detail};
}
function evidenceFromDetail(detail,ratings){
  const seen=new Set();const items=window.OlliConsultationObservation?.items||[];const itemMap=Object.fromEntries(items.map(item=>[item.id,item]));
  return detail.filter(x=>x.state!=='unknown').map(x=>x.cond.id).filter(id=>!seen.has(id)&&seen.add(id)).map(id=>({
    id,
    text:itemMap[id]?.text||id,
    rating:value(ratings,id),
    ratingLabel:RATING_LABELS[value(ratings,id)]||''
  }));
}
function bestPath(paths,ratings){
  const evaluated=(paths||[]).map(path=>evalConditions(path,ratings,'survey'));
  const rank={strong:4,partial:3,opposite:2,unknown:1};
  evaluated.sort((a,b)=>(rank[b.level]||0)-(rank[a.level]||0)||b.matches-a.matches||a.opposites-b.opposites);
  return evaluated[0]||{level:'unknown',matches:0,opposites:0,unknown:0,total:0,detail:[]};
}
function confidence(level,evidenceCount){
  if(level==='strong')return evidenceCount>=3?{level:'high',dots:'●●●',label:'높음'}:{level:'medium',dots:'●●○',label:'중간'};
  if(level==='partial')return {level:'medium',dots:'●●○',label:'중간'};
  return {level:'low',dots:'●○○',label:'낮음'};
}
function evaluateObservationRules(ratings){
  const results=[];
  for(const rule of OBSERVATION_RULES){
    const core=evalConditions(rule.core,ratings,'observation');
    if(core.level!=='strong'&&core.level!=='partial')continue;
    const boosts=(rule.boost||[]).map(cond=>condResult(cond,ratings)).filter(x=>x.state==='match').length;
    const caution=(rule.caution||[]).map(cond=>condResult(cond,ratings)).some(x=>x.state==='match');
    const ev=evidenceFromDetail(core.detail,ratings);
    results.push({id:rule.id,name:rule.name,level:core.level,confidence:confidence(core.level,ev.length+boosts),evidence:ev,boosts,caution});
  }
  const strongIds=new Set(results.filter(x=>x.level==='strong').map(x=>x.id));
  return results.filter(result=>{
    if(result.id==='O1'&&strongIds.has('O1R'))return false;
    if(result.id==='O5A'&&strongIds.has('O5B'))return false;
    if(result.id==='O5B'&&strongIds.has('O5A'))return false;
    return true;
  }).sort((a,b)=>(({strong:2,partial:1}[b.level]||0)-({strong:2,partial:1}[a.level]||0))||b.evidence.length-a.evidence.length);
}
function hypothesisStatus(pattern,source,ratings){
  const path=bestPath(SUPPORT_PATHS[Number(pattern.id)]||[],ratings);
  const ev=evidenceFromDetail(path.detail,ratings);
  let status=STATUS.needs;
  if(path.level==='strong')status=STATUS.confirmed;
  else if(path.level==='partial')status=STATUS.partial;
  else if(path.level==='opposite')status=STATUS.hold;
  const surveyMatch=pattern.total?`${pattern.matched}/${pattern.total}`:'';
  return {
    patternId:Number(pattern.id),name:pattern.name,source,surveyMatch,
    autoStatus:status.key,statusLabel:status.label,
    confidence:confidence(path.level,ev.length),
    evidence:ev,
    evidenceState:path.level
  };
}
function analyze(surveyAnalysis,observation){
  const ratings=observation?.ratings&&typeof observation.ratings==='object'?observation.ratings:{};
  const completed=!!observation?.is_completed;
  const selectedIds=Array.isArray(observation?.selected_item_ids)?observation.selected_item_ids.map(String):[];
  if(!completed){
    return {version:VERSION,completed:false,hypotheses:[],observationTraits:[],newDiscoveries:[],summary:{confirmed:0,partial:0,hold:0,new:0,needs:0}};
  }
  const primary=Array.isArray(surveyAnalysis?.primary)?surveyAnalysis.primary:[];
  const confirm=Array.isArray(surveyAnalysis?.confirm)?surveyAnalysis.confirm:[];
  const hypotheses=[...primary.map(p=>hypothesisStatus(p,'primary',ratings)),...confirm.map(p=>hypothesisStatus(p,'confirm',ratings))];
  const observationTraits=evaluateObservationRules(ratings);
  const compatible=new Set();
  for(const h of [...primary,...confirm])for(const traitId of PATTERN_TRAITS[Number(h.id)]||[])compatible.add(traitId);
  const newDiscoveries=observationTraits.filter(x=>x.level==='strong'&&!compatible.has(x.id)).map(x=>({
    observationRuleId:x.id,name:x.name,status:STATUS.new.key,statusLabel:STATUS.new.label,confidence:x.confidence,evidence:x.evidence,caution:x.caution
  }));
  const summary={confirmed:0,partial:0,hold:0,new:newDiscoveries.length,needs:0};
  for(const item of hypotheses){if(Object.prototype.hasOwnProperty.call(summary,item.autoStatus))summary[item.autoStatus]++;}
  return {version:VERSION,completed:true,selected_item_ids:selectedIds,hypotheses,observationTraits,newDiscoveries,summary};
}

window.OlliConsultationFinalAnalysis={
  version:VERSION,
  statuses:Object.values(STATUS).map(x=>({...x})),
  observationRules:OBSERVATION_RULES.map(rule=>({id:rule.id,name:rule.name})),
  analyze
};
})();
