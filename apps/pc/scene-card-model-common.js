/* PC/Phone common scene-card data model and selection state. */
(function initSceneCardModelCommon(global) {
  'use strict';

  if (!Array.isArray(global.SCENE_CARD_OPTIONS)) {
    global.SCENE_CARD_OPTIONS = [
      { id:'start', no:1, title:'시작 반응', question:'주제를 들었을 때 아이의 첫 표정과 말은?', main:'주제를 들었을 때 아이의 첫 반응은 어땠나요?', sub:'그 반응이 수업 흐름에 어떤 영향을 주었나요?', keywords:['첫 반응','표정','망설임','기대','긴장'], color:'#e8a66b', bg:'#fff5eb' },
      { id:'words', no:2, title:'아이의 말', question:'오늘 남기고 싶은 아이의 한마디는?', main:'오늘 아이가 한 말 중 기억나는 문장은 무엇인가요?', sub:'그 말 안에 아이의 감정이나 생각이 어떻게 담겨 있었나요?', keywords:['발화','생각','감정','질문','표현'], color:'#6caed6', bg:'#edf7ff' },
      { id:'choice', no:3, title:'선택', question:'아이가 스스로 고른 색·재료·방법은?', main:'오늘 아이가 스스로 선택한 것은 무엇인가요?', sub:'그 선택이 아이의 주도성이나 자신감과 어떻게 연결되었나요?', keywords:['선택','주도성','결정','취향','자기표현'], color:'#78b965', bg:'#f3fbef' },
      { id:'difficulty', no:4, title:'어려움', question:'잠시 망설이거나 힘들어한 순간은?', main:'오늘 아이가 어려움을 느낀 순간은 어디였나요?', sub:'그 어려움은 기술, 감정, 이해, 관계 중 어디에 가까웠나요?', keywords:['막힘','망설임','불안','난이도','도움'], color:'#d9bf3f', bg:'#fffbe8' },
      { id:'retry', no:5, title:'다시 시도', question:'어려움 뒤에 아이는 어떻게 해보았나요?', main:'어려움 뒤에 아이는 어떻게 다시 시작했나요?', sub:'선생님의 어떤 말이나 도움 뒤에 변화가 생겼나요?', keywords:['재도전','회복','용기','수정','지속'], color:'#a77ad1', bg:'#f7f0ff' },
      { id:'material', no:6, title:'재료 반응', question:'재료를 만났을 때 아이의 감각 반응은?', main:'재료를 만났을 때 아이는 어떻게 반응했나요?', sub:'그 반응이 몰입, 탐색, 표현으로 이어졌나요?', keywords:['재료','감각','탐색','흥미','표현'], color:'#4db58f', bg:'#effbf6' },
      { id:'focus', no:7, title:'몰입', question:'가장 오래 빠져든 순간은 언제였나요?', main:'오늘 아이가 가장 몰입한 순간은 언제였나요?', sub:'무엇이 아이의 집중을 오래 유지하게 했나요?', keywords:['몰입','집중','지속','흥미','깊이'], color:'#db74a0', bg:'#fff1f6' },
      { id:'relation', no:8, title:'관계', question:'친구·선생님과 함께한 따뜻한 장면은?', main:'오늘 관계 안에서 기억나는 장면은 무엇인가요?', sub:'친구나 선생님과의 상호작용이 아이에게 어떤 힘이 되었나요?', keywords:['관계','공감','협력','대화','신뢰'], color:'#6e86cf', bg:'#f1f4ff' },
      { id:'growth', no:9, title:'성장', question:'이전보다 달라진 작은 변화는?', main:'이전보다 달라진 작은 변화는 무엇인가요?', sub:'그 변화가 앞으로 어떤 성장으로 이어질 수 있을까요?', keywords:['성장','변화','자신감','가능성','다음 단계'], color:'#9b9b42', bg:'#fbfbef' }
    ];
  }

  if (!(global.selectedSceneIds instanceof Set)) global.selectedSceneIds = new Set();
  if (!(global.flippedSceneIds instanceof Set)) global.flippedSceneIds = new Set();

  if (!global.SCENE_MEMO_LABELS || typeof global.SCENE_MEMO_LABELS !== 'object') {
    global.SCENE_MEMO_LABELS = {
      start: '시작 반응 :',
      words: '오늘 아이가 한 말 :',
      choice: '아이의 선택 :',
      difficulty: '어려움 :',
      retry: '다시 시도 :',
      material: '재료 반응 :',
      focus: '몰입한 순간 :',
      relation: '관계 형성 순간 :',
      growth: '성장 장면 :'
    };
  }

  global.getSceneById = function getSceneById(id) {
    return global.SCENE_CARD_OPTIONS.find(item => item.id === id);
  };

  global.getSelectedScenePayload = function getSelectedScenePayload() {
    return Array.from(global.selectedSceneIds)
      .map(id => global.getSceneById(id))
      .filter(Boolean);
  };
})(window);
