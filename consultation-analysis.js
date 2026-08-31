(function(){
'use strict';

const VERSION='SURVEY_2026_09';
const PATTERNS=[{"id":1,"name":"미술 자발 몰입형","conditions":[{"q":"Q1","allowed":["YES"]},{"q":"Q2","allowed":["YES"]},{"q":"Q3","allowed":["YES"]}],"questions":["집에서 스스로 시작하나요?","좋아하는 주제가 따로 있나요?","완성했을 때 만족감을 크게 느끼나요?"],"observations":["교사 안내 전 스스로 재료를 고르는지","추가 표현을 자발적으로 넣는지","완성 후 설명까지 이어지는지"],"direction":"선택권을 많이 주고, 자기 주도적 확장을 도와주면 좋다."},{"id":2,"name":"선택적 몰입형","conditions":[{"q":"Q1","allowed":["MID"]},{"q":"Q2","allowed":["YES"]},{"q":"Q3","allowed":["MID"]}],"questions":["어떤 주제에서 오래 하나요?","만들기와 그리기 중 무엇을 더 좋아하나요?"],"observations":["주제에 따라 집중 시간이 크게 달라지는지","흥미 없는 과제에서는 속도가 급격히 떨어지는지"],"direction":"아이가 반응하는 주제를 빨리 발견해 연결해 주는 것이 중요하다."},{"id":3,"name":"경험부족 잠재형","conditions":[{"q":"Q1","allowed":["NO"]},{"q":"Q10","allowed":["YES"]},{"q":"Q2","allowed":["MID"]}],"questions":["집에서 미술활동 기회가 적은 편인가요?","만들기 재료를 보면 관심은 보이나요?"],"observations":["처음 보는 재료를 만져보는 속도","교사의 제안에 반응하는 정도","첫 시작 이후 집중이 붙는지"],"direction":"미술 흥미가 낮다고 단정하지 말고, 다양한 재료 경험으로 문을 열어준다."},{"id":4,"name":"시작은 빠르나 마무리 약한형","conditions":[{"q":"Q10","allowed":["YES"]},{"q":"Q2","allowed":["MID","YES"]},{"q":"Q3","allowed":["NO"]}],"questions":["새로 시작하는 건 좋아하는데 마무리는 어려워하나요?","싫증을 빨리 내는 편인가요?"],"observations":["초반 반응은 좋은데 후반 집중이 떨어지는지","중간에 다른 아이디어로 옮겨가는지"],"direction":"과제를 잘게 나누고, 작은 완료 경험을 자주 만들어주는 것이 좋다."},{"id":5,"name":"결과민감 비교형","conditions":[{"q":"Q4","allowed":["YES"]},{"q":"Q5","allowed":["YES"]},{"q":"Q6","allowed":["YES"]},{"q":"Q7","allowed":["YES"]}],"questions":["친구 그림을 보고 속상해하나요?","지면 화를 내나요, 위축되나요?","“이상해”, “못 그리겠어” 같은 말을 자주 하나요?"],"observations":["친구 작품을 자주 보는지","시작 전 교사 확인을 많이 받는지","실수 후 감정 흔들림이 큰지"],"direction":"정답 제시보다, 자기 기준의 작은 성공 경험을 쌓게 해야 한다."},{"id":6,"name":"조용한 완벽형","conditions":[{"q":"Q4","allowed":["YES"]},{"q":"Q6","allowed":["YES"]},{"q":"Q3","allowed":["YES"]},{"q":"Q5","allowed":["MID","NO"]}],"questions":["마음에 안 들면 지우고 다시 하나요?","잘 안되면 조용히 멈추는 편인가요?"],"observations":["지우개 사용 빈도","같은 부분 반복 수정","말수는 적지만 손이 자주 멈추는지"],"direction":"“실수하지 않기”보다 “여러 번 해보며 좋아진다”는 경험을 주는 것이 중요하다."},{"id":7,"name":"실패회피형","conditions":[{"q":"Q4","allowed":["YES"]},{"q":"Q6","allowed":["YES"]},{"q":"Q3","allowed":["NO"]}],"questions":["어려워 보이면 아예 안 하려고 하나요?","처음부터 “못해”라고 말하나요?"],"observations":["첫 선을 쉽게 못 긋는지","조금 어려워지면 교사를 바로 찾는지","중단 빈도"],"direction":"난이도를 낮춘 단계별 성공경험이 필요하다."},{"id":8,"name":"경쟁민감형","conditions":[{"q":"Q5","allowed":["YES"]},{"q":"Q7","allowed":["YES"]}],"questions":["지면 다시 하자고 하나요, 울거나 화내나요?","친구가 칭찬받을 때 반응이 어떤가요?"],"observations":["친구 작품 칭찬 시 표정 변화","“누가 더 잘했어?” 질문 여부","활동을 경쟁처럼 받아들이는지"],"direction":"타인 비교가 아니라 어제의 나보다 오늘의 나에 초점을 맞추게 한다."},{"id":9,"name":"배움모방형","conditions":[{"q":"Q5","allowed":["YES"]},{"q":"Q10","allowed":["YES"]},{"q":"Q3","allowed":["YES"]}],"questions":["보고 따라한 뒤 자기 방식으로 바꾸기도 하나요?","새로운 표현을 금방 자기 것으로 만드나요?"],"observations":["친구 표현을 참고해 변형하는지","그대로 복사하는지, 자기식으로 발전시키는지"],"direction":"모방을 막기보다 모방 후 변형 질문을 던져 자기표현으로 연결한다."},{"id":10,"name":"그림 도움의존형","conditions":[{"q":"Q6","allowed":["YES"]},{"q":"Q8","allowed":["YES"]},{"q":"Q3","allowed":["NO"]}],"questions":["혼자 해보기 전에 먼저 도와달라고 하나요?","일상에서도 비슷한가요?"],"observations":["과제 시작 전 도움 요청","어려움이 생길 때 스스로 시도하는지","작은 문제도 교사에게 맡기는지"],"direction":"“혼자 다 하게 하기”가 아니라 혼자 시도 → 필요한 부분만 도움받기 구조를 만든다."},{"id":11,"name":"시범 후 독립형","conditions":[{"q":"Q6","allowed":["YES"]},{"q":"Q8","allowed":["NO"]},{"q":"Q3","allowed":["YES"]}],"questions":["한 번 보여주면 다음에는 혼자 하나요?","구조를 이해하면 금방 따라오나요?"],"observations":["시범 직후 수행력 변화","단계 이해 후 독립성이 높아지는지"],"direction":"완성 그림을 대신 그려주기보다, 핵심 구조만 간단히 언어로 짚어주면 좋다."},{"id":12,"name":"질문형 자기해결러","conditions":[{"q":"Q6","allowed":["NO"]},{"q":"Q8","allowed":["NO"]},{"q":"Q14","allowed":["YES"]}],"questions":["궁금한 것을 자주 묻나요?","답을 들으면 바로 시도하나요?"],"observations":["질문의 질","질문 후 실제 행동으로 이어지는지","설명을 자기 방식으로 바꾸는지"],"direction":"정답을 주기보다 생각을 확장시키는 질문을 활용한다."},{"id":13,"name":"도움요청이 서툰 독립형","conditions":[{"q":"Q6","allowed":["NO"]},{"q":"Q8","allowed":["NO"]},{"q":"Q4","allowed":["YES"]}],"questions":["힘들어도 참고 혼자 하려고 하나요?","도움받는 것을 싫어하나요?"],"observations":["조용히 멈추는지","어려워도 말 없이 버티는지","감정이 안으로 쌓이는지"],"direction":"도움을 요청하는 것도 능력이라는 경험을 주는 것이 필요하다."},{"id":14,"name":"호기심 신중형","conditions":[{"q":"Q10","allowed":["YES"]},{"q":"Q11","allowed":["YES"]}],"questions":["장소는 금방 보는데 사람과는 천천히 친해지나요?","처음에는 조용하다가 익숙해지면 달라지나요?"],"observations":["재료에는 손이 가지만 말수는 적은지","2~3차시 후 표현량이 늘어나는지"],"direction":"첫 수업 반응만 보고 판단하지 말고, 적응 시간을 보장해야 한다."},{"id":15,"name":"빠른 탐색 적응형","conditions":[{"q":"Q10","allowed":["YES"]},{"q":"Q11","allowed":["NO"]}],"questions":["처음 가는 곳에서도 바로 참여하나요?","새로운 친구에게 먼저 다가가나요?"],"observations":["재료 탐색 속도","교사/친구와의 접촉 빈도","활동 시작 속도"],"direction":"에너지를 잘 활용하되, 산만해지지 않도록 방향을 잡아준다."},{"id":16,"name":"안정선호 신중형","conditions":[{"q":"Q10","allowed":["NO"]},{"q":"Q11","allowed":["YES"]},{"q":"Q8","allowed":["YES"]}],"questions":["새로운 활동은 조금 부담스러워하나요?","익숙한 방식은 편안해하나요?"],"observations":["규칙 설명 후 안정되는지","반복 활동에서 더 잘하는지","변화에 민감한지"],"direction":"예측 가능한 수업 구조가 큰 도움이 된다."},{"id":17,"name":"사회적 개방형","conditions":[{"q":"Q11","allowed":["NO"]},{"q":"Q14","allowed":["YES"]}],"questions":["이야기를 하며 집중이 높아지나요?","친구와 함께할 때 더 잘하나요?"],"observations":["대화량","또래 반응에 따라 집중이 달라지는지","교사와 상호작용이 작품에 어떤 영향을 주는지"],"direction":"말을 막기보다, 대화가 표현으로 연결되도록 방향을 잡아준다."},{"id":18,"name":"디자인 민감형","conditions":[{"q":"Q9","allowed":["YES"]},{"q":"Q1","allowed":["YES","MID"]},{"q":"Q2","allowed":["YES"]}],"questions":["색을 고를 때 오래 고민하나요?","예쁜 것, 멋있는 것에 기준이 분명한가요?"],"observations":["색 선택 방식","배치와 구성에 대한 관심","작은 차이를 빨리 발견하는지"],"direction":"관찰드로잉, 색채, 디자인 요소를 강점으로 확장하기 좋다."},{"id":19,"name":"시각선택 뚜렷형","conditions":[{"q":"Q9","allowed":["YES"]},{"q":"Q14","allowed":["NO","MID"]}],"questions":["설명보다 보여주는 걸 더 잘하나요?","“이 색이 더 좋아” 같은 선택은 분명한가요?"],"observations":["비언어적 선택의 선명도","말은 적지만 결과물의 의도가 뚜렷한지"],"direction":"말보다 이미지, 비교 자료, 실제 예시가 더 효과적일 수 있다."},{"id":20,"name":"이야기 표현형","conditions":[{"q":"Q12","allowed":["YES"]},{"q":"Q13","allowed":["YES"]},{"q":"Q14","allowed":["YES"]}],"questions":["책을 읽고 자기 생각을 많이 말하나요?","그림에도 이야기를 붙이나요?"],"observations":["작품 설명 길이","등장인물, 사건, 감정 설정","원인-결과를 연결하는지"],"direction":"“그다음에는 어떤 일이 생길까?” 같은 질문이 매우 효과적이다."},{"id":21,"name":"지식탐구형","conditions":[{"q":"Q12","allowed":["YES"]},{"q":"Q14","allowed":["YES"]},{"q":"Q13","allowed":["MID"]}],"questions":["공룡, 우주, 자동차 같은 지식을 자주 말하나요?","좋아하는 주제에 몰입하나요?"],"observations":["그림 속에 정보 요소를 넣는지","설명이 스토리보다 사실 중심인지"],"direction":"관심 지식을 시각표현으로 연결해주면 강점이 잘 살아난다."},{"id":22,"name":"비언어 표현형","conditions":[{"q":"Q12","allowed":["NO","MID"]},{"q":"Q13","allowed":["NO"]},{"q":"Q14","allowed":["NO"]},{"q":"Q1","allowed":["YES","MID"]}],"questions":["말보다 행동이나 그림으로 보여주는 편인가요?","설명은 짧아도 표현은 오래 하나요?"],"observations":["작업 중 몰입도","설명은 적지만 표현은 풍부한지","감정이나 생각이 결과물에 드러나는지"],"direction":"말이 적다고 표현력이 낮다고 보지 않는다. 비언어적 표현 통로를 충분히 열어준다."},{"id":23,"name":"끈기 완결형","conditions":[{"q":"Q2","allowed":["YES"]},{"q":"Q3","allowed":["YES"]},{"q":"Q4","allowed":["NO"]}],"questions":["한 번 시작한 것은 끝내려 하나요?","완성 자체에서 만족을 느끼나요?"],"observations":["과제 중단 빈도","차분한 진행","완성 후 정리 태도"],"direction":"조금 더 높은 난이도나 구조화된 과제에도 도전해볼 수 있다."},{"id":24,"name":"감정기복 도전형","conditions":[{"q":"Q7","allowed":["YES"]},{"q":"Q3","allowed":["YES"]},{"q":"Q4","allowed":["YES"]}],"questions":["지면 다시 하려고 하나요?","화가 나도 끝까지 하려 하나요?"],"observations":["감정이 올라간 뒤 회복 속도","다시 시도하는지","스스로 기준을 높게 잡는지"],"direction":"경쟁심을 꺾기보다, 건강한 도전 에너지로 바꾸는 방향이 중요하다."},{"id":25,"name":"낮은 자신감 보호형","conditions":[{"q":"Q4","allowed":["YES"]},{"q":"Q6","allowed":["YES"]},{"q":"Q11","allowed":["YES"]},{"q":"Q14","allowed":["NO","MID"]}],"questions":["처음에는 말이 없고, 어려우면 도와달라고 하나요?","친구 앞에서 더 위축되나요?"],"observations":["입실 직후 태도","선생님에게 기대는 정도","익숙해진 뒤 변화가 있는지"],"direction":"안전감 형성이 먼저다. 처음부터 잘하게 하는 것보다, 편안하게 시작하게 만드는 것이 우선이다."},{"id":26,"name":"또래영향 민감형","conditions":[{"q":"Q5","allowed":["YES"]},{"q":"Q11","allowed":["NO"]},{"q":"Q14","allowed":["YES"]}],"questions":["친구가 하면 나도 하고 싶어하나요?","친구 칭찬이나 반응에 예민한가요?"],"observations":["친구 작품 따라가기","또래 대화가 표현에 미치는 영향","집단 분위기에 따라 수행이 달라지는지"],"direction":"또래 자극을 잘 활용하되, 자기표현으로 다시 돌아오게 도와야 한다."},{"id":27,"name":"조심스러운 관찰자형","conditions":[{"q":"Q11","allowed":["YES"]},{"q":"Q14","allowed":["NO"]},{"q":"Q1","allowed":["MID","NO"]}],"questions":["새로운 환경에서 먼저 보기부터 하나요?","말은 적지만 보고 배우는 편인가요?"],"observations":["처음 10분 행동","주변 관찰 빈도","2회차 이후 변화"],"direction":"빠른 반응을 요구하지 말고, 관찰 시간이 이 아이의 준비 과정임을 이해해야 한다."},{"id":28,"name":"자기기준 안정형","conditions":[{"q":"Q4","allowed":["NO"]},{"q":"Q5","allowed":["NO"]},{"q":"Q7","allowed":["NO"]}],"questions":["친구보다 자기 작품 자체에 더 집중하나요?","지거나 비교되는 상황을 크게 의식하지 않나요?"],"observations":["또래 작품에 대한 관심 정도","자기 속도 유지","외부 평가에 대한 반응"],"direction":"자기 기준이 장점으로 잘 자라도록, 개별 성장 피드백을 충분히 준다."}];
const AXES={"미술 흥미·몰입":["Q1","Q2","Q3"],"결과·비교·실패":["Q4","Q5","Q6","Q7"],"독립성·도움요청":["Q6","Q8","Q3"],"탐색·적응":["Q9","Q10","Q11"],"언어·사고·이야기":["Q12","Q13","Q14"]};
const LABELS={YES:'그렇다',MID:'중간',NO:'아니다'};

function normalizeAnswers(input){
  const out={};
  for(let i=1;i<=14;i++){
    const q='Q'+i;
    const v=String((input&&input[q])||'').toUpperCase();
    out[q]=(v==='YES'||v==='MID'||v==='NO')?v:'';
  }
  return out;
}
function isOpposite(actual,allowed){
  if(!actual||!Array.isArray(allowed))return false;
  return (actual==='YES'&&allowed.includes('NO')&&!allowed.includes('YES'))||
         (actual==='NO'&&allowed.includes('YES')&&!allowed.includes('NO'));
}
function conditionText(c){
  const labels=(c.allowed||[]).map(v=>LABELS[v]||v);
  return `${c.q} ${labels.join('/')}`;
}
function relatedAxes(pattern){
  const qs=pattern.conditions.map(c=>c.q);
  const scored=Object.entries(AXES).map(([name,items])=>({name,count:qs.filter(q=>items.includes(q)).length}));
  const picked=scored.filter(x=>x.count>=2);
  if(picked.length)return picked.sort((a,b)=>b.count-a.count).map(x=>x.name);
  const max=Math.max(...scored.map(x=>x.count));
  return scored.filter(x=>x.count===max&&x.count>0).map(x=>x.name);
}
function uniquePush(target,items,limit){
  for(const item of items||[]){
    if(target.length>=limit)break;
    if(!item||target.includes(item))continue;
    target.push(item);
  }
}
function evaluatePattern(pattern,answers){
  let matched=0,opposites=0;
  const detail=pattern.conditions.map(c=>{
    const actual=answers[c.q]||'';
    const ok=c.allowed.includes(actual);
    if(ok)matched++;
    else if(isOpposite(actual,c.allowed))opposites++;
    return {q:c.q,actual,allowed:c.allowed.slice(),matched:ok};
  });
  const total=pattern.conditions.length;
  const exact=matched===total;
  const near=!exact&&total>=3&&matched===total-1;
  return {
    id:pattern.id,name:pattern.name,total,matched,opposites,exact,near,
    ratio:total?matched/total:0,
    conditionText:pattern.conditions.map(conditionText).join(' + '),
    detail,
    questions:pattern.questions.slice(),
    observations:pattern.observations.slice(),
    direction:pattern.direction,
    axes:relatedAxes(pattern)
  };
}
function analyze(input){
  const answers=normalizeAnswers(input);
  const evaluated=PATTERNS.map(p=>evaluatePattern(p,answers));
  const primary=evaluated.filter(x=>x.exact).sort((a,b)=>b.total-a.total||a.id-b.id);
  const confirm=evaluated.filter(x=>x.near).sort((a,b)=>a.opposites-b.opposites||b.ratio-a.ratio||b.total-a.total||a.id-b.id);
  const source=primary.concat(confirm);
  const axes=[];
  const questions=[];
  const observations=[];
  const directions=[];
  for(const item of source){
    uniquePush(axes,item.axes,5);
    uniquePush(questions,item.questions,6);
    uniquePush(observations,item.observations,10);
    uniquePush(directions,[item.direction],4);
  }
  return {
    version:VERSION,
    primary,
    confirm,
    axes,
    questions,
    observations,
    directions,
    needsObservation:primary.length===0&&confirm.length===0
  };
}

window.OlliConsultationAnalysis={
  version:VERSION,
  patterns:PATTERNS.map(p=>({...p,conditions:p.conditions.map(c=>({q:c.q,allowed:c.allowed.slice()}))})),
  analyze
};
})();
