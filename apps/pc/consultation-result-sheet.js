(function(){
'use strict';

const VERSION='RESULT_2026_09';
const RATING_LABELS={'2':'분명히 관찰됨','1':'일부 관찰됨','0':'관찰되지 않음','X':'관찰할 기회가 없었음'};
const DATA=window.__olliConsultationResultLibrary||{};
const STRENGTHS=DATA.strengths||{};
const TENDENCIES=DATA.tendencies||{};
const GROWTH=DATA.growth||{};
const METHODS=DATA.methods||{};

const GROWTH_FROM_T={
T1:['G01'],T2:['G03'],T3:['G02','G01'],T4:['G11'],T5:['G05'],T6:['G04'],T7:['G07'],T8:['G08','G04'],T9:['G08'],T10:['G15'],T11:['G14'],T12:['G10'],T13:['G09'],T14:['G12'],T15:['G11'],T16:['G11']
};
const GROWTH_FROM_S={
S1:['G11'],S2:['G11'],S3:['G09'],S4:['G09'],S5:['G11'],S6:['G07'],S7:['G13'],S8:['G09'],S9:['G11'],S10:['G11'],S11:['G04'],S12:['G12'],S13:['G15'],S14:['G01'],S15:['G14']
};
const METHODS_FROM_G={
G01:['M4','M7','M3'],G02:['M3','M4','M7'],G03:['M2','M14','M5'],G04:['M5','M7'],G05:['M2','M14','M1'],G06:['M1','M14'],G07:['M9','M13'],G08:['M8','M7'],G09:['M10','M7'],G10:['M10','M11'],G11:['M1','M12'],G12:['M15','M1'],G13:['M13','M7'],G14:['M3','M11'],G15:['M6','M2']
};
const METHODS_FROM_T={T1:['M4','M7'],T2:['M2','M14'],T3:['M3','M4'],T5:['M2','M14'],T7:['M9'],T8:['M8'],T9:['M8','M7'],T10:['M6'],T11:['M11'],T12:['M11','M10'],T13:['M10'],T14:['M15'],T15:['M12','M15'],T16:['M1']};
const METHODS_FROM_S={S1:['M5','M1'],S2:['M1','M2'],S3:['M4','M7'],S6:['M9'],S7:['M13'],S8:['M1'],S9:['M12','M15'],S10:['M1'],S11:['M5'],S13:['M6'],S14:['M4','M7']};

// 28개 설문 성향의 최종 판정은 관찰로 이미 지지된 S/T 후보의 우선순위에만 반영한다.
// 관찰 근거가 없는 S/T를 새로 만들어내지는 않는다.
const PATTERN_ST={
1:{s:['S1','S4','S5'],t:[]},2:{s:['S4'],t:['T12']},3:{s:[],t:['T11']},4:{s:[],t:['T11','T13']},
5:{s:[],t:['T1','T8','T9']},6:{s:[],t:['T1','T2']},7:{s:[],t:['T3','T5']},8:{s:[],t:['T9']},
9:{s:['S6'],t:['T7']},10:{s:[],t:['T5']},11:{s:['S2'],t:['T2','T4']},12:{s:['S2','S10'],t:['T4','T16']},
13:{s:['S2'],t:['T4']},14:{s:['S13'],t:['T10']},15:{s:['S12'],t:['T11']},16:{s:['S13'],t:['T10']},
17:{s:['S12'],t:[]},18:{s:['S7'],t:['T6']},19:{s:['S7','S11'],t:['T6','T14']},20:{s:['S8','S9'],t:['T15']},
21:{s:['S10'],t:['T16']},22:{s:['S11'],t:['T14']},23:{s:['S3','S5'],t:[]},24:{s:['S3','S14'],t:[]},
25:{s:[],t:['T2','T3']},26:{s:[],t:['T8','T9']},27:{s:['S13'],t:['T10']},28:{s:['S15'],t:[]}
};

function value(ratings,id){const v=String(ratings?.[id]??'');return ['2','1','0','X'].includes(v)?v:'';}
function conditionScore(cond,ratings){
  const v=value(ratings,cond.id);
  if(!v||v==='X')return {known:false,support:false,strong:false,contradiction:false,score:0,rating:v};
  if(cond.dir==='up'){
    if(v==='2')return {known:true,support:true,strong:true,contradiction:false,score:2,rating:v};
    if(v==='1')return {known:true,support:true,strong:false,contradiction:false,score:1,rating:v};
    return {known:true,support:false,strong:false,contradiction:true,score:-2,rating:v};
  }
  if(v==='0')return {known:true,support:true,strong:true,contradiction:false,score:2,rating:v};
  if(v==='2')return {known:true,support:false,strong:false,contradiction:true,score:-2,rating:v};
  return {known:true,support:false,strong:false,contradiction:false,score:0,rating:v};
}
function evaluateRule(code,rule,ratings,answers){
  const detail=(rule.conditions||[]).map(cond=>({cond,...conditionScore(cond,ratings)}));
  let score=detail.reduce((sum,x)=>sum+x.score,0);
  const known=detail.filter(x=>x.known).length;
  const support=detail.filter(x=>x.support).length;
  const strong=detail.filter(x=>x.strong).length;
  const contradictions=detail.filter(x=>x.contradiction).length;
  let surveyBoost=0;
  if(rule.surveyBoost&&String(answers?.[rule.surveyBoost.q]||'')===rule.surveyBoost.value){surveyBoost=1;score+=1;}
  const total=detail.length;
  const enough=total===1?strong>=1:(strong>=1&&support>=Math.max(1,Math.ceil(total*0.6))&&known>=Math.max(1,Math.ceil(total*0.6)));
  const eligible=contradictions===0&&enough;
  const ratio=total?Math.max(0,score)/(total*2+surveyBoost):0;
  return {code,name:rule.name,score,ratio,known,support,strong,contradictions,eligible,detail,surveyBoost};
}
function ranked(table,ratings,answers,boosts){
  return Object.entries(table).map(([code,rule])=>{const item=evaluateRule(code,rule,ratings,answers);item.rankScore=item.ratio+(boosts?.[code]||0);return item;}).filter(x=>x.eligible).sort((a,b)=>b.rankScore-a.rankScore||b.ratio-a.ratio||b.strong-a.strong||b.score-a.score||a.code.localeCompare(b.code,undefined,{numeric:true}));
}
function finalBoosts(finalAnalysis,overrides){
  const strength={},tendency={};
  for(const item of effectiveHypotheses(finalAnalysis,overrides)){
    const weight=item.effectiveStatus==='confirmed'?0.18:item.effectiveStatus==='partial'?0.08:0;
    if(!weight)continue;const map=PATTERN_ST[Number(item.patternId)];if(!map)continue;
    for(const code of map.s||[])strength[code]=(strength[code]||0)+weight;
    for(const code of map.t||[])tendency[code]=(tendency[code]||0)+weight;
  }
  return {strength,tendency};
}
function selectStrengths(candidates){
  const out=[];
  for(const item of candidates){
    if(item.code==='S11'&&out.some(x=>x.code==='S1'))continue;
    if(item.code==='S1'&&out.some(x=>x.code==='S11')){const idx=out.findIndex(x=>x.code==='S11');out.splice(idx,1);}
    out.push(item);if(out.length>=2)break;
  }
  return out;
}
function selectTendencies(candidates){
  const out=[];
  for(const item of candidates){
    if(item.code==='T6'&&out.some(x=>x.code==='T4')&&item.ratio<1)continue;
    out.push(item);if(out.length>=2)break;
  }
  return out;
}
function addWeighted(map,codes,weight){for(const code of codes||[])map.set(code,(map.get(code)||0)+weight);}
function chooseMapped(primary,secondary,mapPrimary,mapSecondary,limit){
  const weights=new Map();
  primary.forEach((item,index)=>addWeighted(weights,mapPrimary[item.code],Math.max(2,6-index*2)));
  secondary.forEach((item,index)=>addWeighted(weights,mapSecondary[item.code],Math.max(1,3-index)));
  return [...weights.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],undefined,{numeric:true})).slice(0,limit).map(([code])=>code);
}
function chooseGrowth(strengths,tendencies,ratings){
  const weights=new Map();
  tendencies.forEach((item,index)=>addWeighted(weights,GROWTH_FROM_T[item.code],6-index*2));
  strengths.forEach((item,index)=>addWeighted(weights,GROWTH_FROM_S[item.code],3-index));
  if(value(ratings,'D1')==='2'&&value(ratings,'D2')==='0'&&value(ratings,'E2')==='2'&&value(ratings,'D3')==='0')addWeighted(weights,['G06'],8);
  if(value(ratings,'C1')==='2'&&value(ratings,'C2')==='2'&&value(ratings,'C3')==='0')addWeighted(weights,['G11'],8);
  const codes=[...weights.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],undefined,{numeric:true})).slice(0,2).map(([code])=>code);
  if(!codes.length&&strengths[0])codes.push((GROWTH_FROM_S[strengths[0].code]||['G11'])[0]);
  if(!codes.length)codes.push('G11');
  return codes;
}
function chooseMethods(strengths,tendencies,growthCodes){
  const weights=new Map();
  growthCodes.forEach((code,index)=>addWeighted(weights,METHODS_FROM_G[code],7-index*2));
  tendencies.forEach((item,index)=>addWeighted(weights,METHODS_FROM_T[item.code],4-index));
  strengths.forEach((item,index)=>addWeighted(weights,METHODS_FROM_S[item.code],2-index));
  let codes=[...weights.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],undefined,{numeric:true})).slice(0,3).map(([code])=>code);
  if(codes.length<2){for(const code of ['M1','M7','M5']){if(!codes.includes(code))codes.push(code);if(codes.length>=2)break;}}
  return codes.slice(0,3);
}
function hash(text){let h=2166136261;for(const ch of String(text||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return Math.abs(h>>>0);}
function hasBatchim(text){const last=String(text||'').trim().slice(-1);const code=last.charCodeAt(0);return code>=0xAC00&&code<=0xD7A3?((code-0xAC00)%28)!==0:false;}
function applyName(text,name){const safe=String(name||'아이').trim()||'아이';return String(text||'').replace(/○○이는/g,`${safe}${hasBatchim(safe)?'이는':'는'}`).replace(/○○/g,safe);}
function sentence(entry,code,name,kind){
  const variants=entry?.variants||[];if(!variants.length)return'';
  const index=hash(`${name}|${kind}|${code}`)%variants.length;
  return applyName(variants[index],name);
}
function publicItem(code,table,name,kind,extra){const entry=table[code];return {code,name:entry?.name||code,sentence:sentence(entry,code,name,kind),...(extra||{})};}
function evidenceItems(selected){
  const seen=new Set();const rows=[];
  for(const candidate of selected){
    for(const item of candidate.detail||[]){
      if(!item.support||seen.has(item.cond.id))continue;
      seen.add(item.cond.id);rows.push({id:item.cond.id,dir:item.cond.dir,rating:item.rating,strong:item.strong});
    }
  }
  return rows.sort((a,b)=>(b.strong?1:0)-(a.strong?1:0));
}
function evidenceSentence(strengths,tendencies,observation){
  const notes=observation?.notes&&typeof observation.notes==='object'?observation.notes:{};
  const itemMap=Object.fromEntries((window.OlliConsultationObservation?.items||[]).map(item=>[item.id,item]));
  const ev=evidenceItems([...strengths,...tendencies]);
  for(const item of ev){const note=String(notes[item.id]||'').trim();if(note)return `수업 기록에서는 다음과 같이 관찰되었습니다 — ${note.replace(/[.。!?]+$/,'')}.`;}
  const item=ev.find(x=>x.rating==='2')||ev[0];
  if(!item)return '이번 결과는 학부모 설문과 체험수업에서 확인된 행동을 함께 비교해 정리했습니다.';
  const text=String(itemMap[item.id]?.text||item.id).replace(/[.。]+$/,'');
  const label=RATING_LABELS[item.rating]||'';
  if(item.rating==='0')return `수업에서는 ‘${text}’ 행동이 관찰되지 않아 이 부분도 함께 반영해 해석했습니다.`;
  return `수업에서는 ‘${text}’는 모습이 ${label||'관찰'}으로 기록되었습니다.`;
}
function consultationText(name,strengthItems,tendencyItems,growthItems,methodItems,evidence){
  const sentences=[];
  if(strengthItems[0])sentences.push(strengthItems[0].sentence);
  if(strengthItems[1])sentences.push(strengthItems[1].sentence);
  if(evidence)sentences.push(evidence);
  if(tendencyItems[0])sentences.push(tendencyItems[0].sentence);
  if(tendencyItems[1])sentences.push(tendencyItems[1].sentence);
  if(growthItems[0])sentences.push(growthItems[0].sentence);
  if(growthItems[1])sentences.push(growthItems[1].sentence);
  methodItems.slice(0,2).forEach(item=>sentences.push(item.sentence));
  return sentences.filter(Boolean).join(' ');
}
function effectiveHypotheses(finalAnalysis,overrides){
  return (finalAnalysis?.hypotheses||[]).map(item=>({...item,effectiveStatus:String(overrides?.[String(item.patternId)]||item.autoStatus||'needs')}));
}
function build(input){
  const name=String(input?.studentName||'').trim()||'아이';
  const answers=input?.answers&&typeof input.answers==='object'?input.answers:{};
  const observation=input?.observation&&typeof input.observation==='object'?input.observation:{};
  const ratings=observation.ratings&&typeof observation.ratings==='object'?observation.ratings:{};
  const hypotheses=effectiveHypotheses(input?.finalAnalysis,input?.overrides||{});
  const boosts=finalBoosts(input?.finalAnalysis,input?.overrides||{});
  const strengths=selectStrengths(ranked(STRENGTHS,ratings,answers,boosts.strength));
  const tendencies=selectTendencies(ranked(TENDENCIES,ratings,answers,boosts.tendency));
  const growthCodes=chooseGrowth(strengths,tendencies,ratings);
  const methodCodes=chooseMethods(strengths,tendencies,growthCodes);
  const strengthItems=strengths.map(item=>publicItem(item.code,STRENGTHS,name,'S',{score:item.score,ratio:item.ratio,evidence:item.detail.filter(x=>x.support).map(x=>({id:x.cond.id,rating:x.rating,dir:x.cond.dir}))}));
  const tendencyItems=tendencies.map(item=>publicItem(item.code,TENDENCIES,name,'T',{score:item.score,ratio:item.ratio,evidence:item.detail.filter(x=>x.support).map(x=>({id:x.cond.id,rating:x.rating,dir:x.cond.dir}))}));
  const growthItems=growthCodes.map(code=>publicItem(code,GROWTH,name,'G'));
  const methodItems=methodCodes.map(code=>publicItem(code,METHODS,name,'M'));
  const evidence=evidenceSentence(strengths,tendencies,observation);
  const text=consultationText(name,strengthItems,tendencyItems,growthItems,methodItems,evidence);
  return {
    version:VERSION,
    studentName:name,
    strengths:strengthItems,
    tendencies:tendencyItems,
    growth:growthItems,
    methods:methodItems,
    evidenceSentence:evidence,
    consultationText:text,
    finalHypotheses:hypotheses,
    finalConfirmed:hypotheses.filter(x=>x.effectiveStatus==='confirmed').map(x=>({patternId:x.patternId,name:x.name})),
    finalPartial:hypotheses.filter(x=>x.effectiveStatus==='partial').map(x=>({patternId:x.patternId,name:x.name})),
    newDiscoveries:(input?.finalAnalysis?.newDiscoveries||[]).map(x=>({id:x.id,name:x.name}))
  };
}

window.OlliConsultationResultSheet={version:VERSION,build,libraries:{strengths:STRENGTHS,tendencies:TENDENCIES,growth:GROWTH,methods:METHODS}};
})();
