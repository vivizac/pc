(function(){
'use strict';

const VERSION='OBSERVATION_2026_09';
const ITEMS=[
{id:'A1',group:'A',groupName:'새로운 환경 적응',text:'입실 후 주변 환경과 사람을 충분히 살핀 뒤 활동한다.',questions:['Q10','Q11']},
{id:'A2',group:'A',groupName:'새로운 환경 적응',text:'처음 만난 선생님의 질문에 바로 반응하기보다 시간이 필요하다.',questions:['Q11','Q14']},
{id:'A3',group:'A',groupName:'새로운 환경 적응',text:'새로운 재료나 도구에는 먼저 관심을 보이고 탐색한다.',questions:['Q9','Q10']},
{id:'B1',group:'B',groupName:'활동 시작 방식',text:'설명이 끝나면 비교적 바로 활동을 시작한다.',questions:['Q6','Q10','Q8']},
{id:'B2',group:'B',groupName:'활동 시작 방식',text:'시작하기 전 선생님이나 친구의 결과를 확인하려 한다.',questions:['Q4','Q5','Q6']},
{id:'B3',group:'B',groupName:'활동 시작 방식',text:'“어떻게 해요?”, “이렇게 하는 거 맞아요?” 등의 확인 질문을 반복한다.',questions:['Q4','Q6','Q8']},
{id:'C1',group:'C',groupName:'선택과 자기주도성',text:'색·재료·표현방법을 스스로 선택한다.',questions:['Q1','Q9','Q10']},
{id:'C2',group:'C',groupName:'선택과 자기주도성',text:'교사가 여러 선택지를 주면 자신의 선호를 분명하게 표현한다.',questions:['Q9','Q8']},
{id:'C3',group:'C',groupName:'선택과 자기주도성',text:'주어진 활동 외에 자신의 아이디어를 추가한다.',questions:['Q1','Q10','Q14']},
{id:'D1',group:'D',groupName:'도움 요청과 문제해결',text:'어려움이 생겼을 때 먼저 혼자 방법을 찾아본다.',questions:['Q6','Q8','Q3']},
{id:'D2',group:'D',groupName:'도움 요청과 문제해결',text:'충분히 시도하기 전에 선생님에게 도움을 요청한다.',questions:['Q6','Q8']},
{id:'D3',group:'D',groupName:'도움 요청과 문제해결',text:'질문이나 힌트를 받은 뒤 스스로 다시 해결하려 한다.',questions:['Q6','Q8','Q14']},
{id:'E1',group:'E',groupName:'결과 민감도와 실패 반응',text:'마음에 들지 않는 부분을 반복적으로 지우거나 수정한다.',questions:['Q4','Q6']},
{id:'E2',group:'E',groupName:'결과 민감도와 실패 반응',text:'원하는 결과가 나오지 않으면 표정·말·행동에서 속상함이 나타난다.',questions:['Q4','Q7']},
{id:'E3',group:'E',groupName:'결과 민감도와 실패 반응',text:'실패하거나 마음에 들지 않아도 다시 시도한다.',questions:['Q4','Q3','Q7']},
{id:'F1',group:'F',groupName:'또래 비교와 사회적 반응',text:'친구 작품을 자주 살펴본다.',questions:['Q5','Q7']},
{id:'F2',group:'F',groupName:'또래 비교와 사회적 반응',text:'친구의 표현이나 아이디어를 자신의 작업에 가져온다.',questions:['Q5']},
{id:'F3',group:'F',groupName:'또래 비교와 사회적 반응',text:'친구가 칭찬받거나 자신보다 먼저 완성했을 때 반응이 달라진다.',questions:['Q5','Q7']},
{id:'G1',group:'G',groupName:'집중·지속·마무리',text:'흥미가 지속되는 동안 한 활동에 안정적으로 집중한다.',questions:['Q1','Q2']},
{id:'G2',group:'G',groupName:'집중·지속·마무리',text:'어려운 과정이 생겨도 활동을 이어가려고 한다.',questions:['Q4','Q3']},
{id:'G3',group:'G',groupName:'집중·지속·마무리',text:'완성 단계까지 스스로 마무리하려는 행동이 나타난다.',questions:['Q2','Q3']},
{id:'H1',group:'H',groupName:'언어·사고·표현 방식',text:'자신의 그림이나 생각에 대해 이야기를 많이 한다.',questions:['Q12','Q13','Q14']},
{id:'H2',group:'H',groupName:'언어·사고·표현 방식',text:'“왜?”, “어떻게?” 등의 질문을 통해 정보를 얻는다.',questions:['Q13','Q14']},
{id:'H3',group:'H',groupName:'언어·사고·표현 방식',text:'그림 안에 사건·인물·상황 등을 만들어 이야기를 확장한다.',questions:['Q12','Q13','Q14']}
];
const ITEM_MAP=Object.fromEntries(ITEMS.map(item=>[item.id,item]));
const DEFAULT_IDS=['A3','B1','C1','D1','E2','F1','G3','H2'];
const RATINGS=[
{value:'2',label:'분명히 관찰됨'},
{value:'1',label:'일부 관찰됨'},
{value:'0',label:'관찰되지 않음'},
{value:'X',label:'관찰할 기회가 없었음'}
];

function addWeight(weights,q,amount){if(q)weights[q]=(weights[q]||0)+amount;}
function selectItems(analysis){
  const primary=Array.isArray(analysis?.primary)?analysis.primary:[];
  const confirm=Array.isArray(analysis?.confirm)?analysis.confirm:[];
  const weights={};
  for(const pattern of primary){for(const detail of pattern.detail||[])addWeight(weights,detail.q,4);}
  for(const pattern of confirm){for(const detail of pattern.detail||[])addWeight(weights,detail.q,detail.matched?3:1);}
  const sourceCount=primary.length+confirm.length;
  const target=sourceCount?Math.min(10,Math.max(6,6+Math.min(4,sourceCount))):8;
  const ranked=ITEMS.map((item,index)=>({
    item,index,
    score:item.questions.reduce((sum,q)=>sum+(weights[q]||0),0)
  })).sort((a,b)=>b.score-a.score||a.index-b.index);
  const picked=[];
  for(const entry of ranked){
    if(picked.length>=target)break;
    if(entry.score<=0)break;
    picked.push(entry.item);
  }
  for(const id of DEFAULT_IDS){
    if(picked.length>=target)break;
    const item=ITEM_MAP[id];
    if(item&&!picked.some(x=>x.id===id))picked.push(item);
  }
  for(const item of ITEMS){
    if(picked.length>=target)break;
    if(!picked.some(x=>x.id===item.id))picked.push(item);
  }
  return picked.map(item=>({...item,questions:item.questions.slice()}));
}
function normalizeSelected(ids){
  if(!Array.isArray(ids))return[];
  const seen=new Set();
  return ids.map(String).filter(id=>ITEM_MAP[id]&&!seen.has(id)&&seen.add(id)).map(id=>({...ITEM_MAP[id],questions:ITEM_MAP[id].questions.slice()}));
}

window.OlliConsultationObservation={
  version:VERSION,
  items:ITEMS.map(item=>({...item,questions:item.questions.slice()})),
  ratings:RATINGS.map(item=>({...item})),
  selectItems,
  normalizeSelected,
  getItem(id){const item=ITEM_MAP[String(id||'')];return item?{...item,questions:item.questions.slice()}:null;}
};
})();
