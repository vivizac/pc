
(function(){
  var growthHelpMap = {
    'A1. 아이 이름':'피드백을 작성할 아이 이름을 확인해 주세요.',
    'A2. 활동':'오늘 아이가 참여한 활동을 선택해 주세요.',
    'A2-1. 하위상황':'조금 더 구체적인 상황을 선택해 주세요.',
    'A3. 실패유형':'오늘의 막힘이나 실패 장면을 골라 주세요.',
    'A4. 첫반응 - 몸':'몸으로 먼저 보인 반응을 선택해 주세요.',
    'A5. 첫반응 - 말':'말로 표현한 첫 반응을 선택해 주세요.',
    'A6. 첫반응 - 시선':'눈빛과 시선의 반응을 선택해 주세요.',
    'A7. 실패원인':'막힘이 생긴 이유를 추정해 주세요.',
    'A8. 교사개입':'선생님이 어떤 방식으로 도왔는지 선택해 주세요.',
    'A9. 회복전환':'어떤 계기로 다시 해보게 되었는지 선택해 주세요.',
    'A10. 회복결과':'회복 후 보인 결과를 선택해 주세요.',
    'A11. 다음목표':'다음 수업의 성장 목표를 정리해 주세요.',
    'A12. 위험태그':'특별히 더 살펴볼 신호가 있으면 선택해 주세요.',
    'A13. 수업후상태':'수업이 끝난 뒤 아이 상태를 선택해 주세요.',
    'A14. 추가메모':'추가로 남기고 싶은 장면이 있으면 적어 주세요.'
  };

  function buildIntro(count){
    var wrap = document.createElement('div');
    wrap.className = 'growthSurveyIntro';
    wrap.innerHTML = ''
      + '<div class="growthSurveyIntroTitle">성장 피드백 설문</div>'
      + '<div class="growthSurveyIntroText">아이의 실패·막힘 장면을<br>짧게 선택하면 피드백 문장으로 정리돼요.</div>'
      + '<div class="growthSurveyProgress"><strong>진행 1 / ' + count + '</strong><div class="growthSurveyDots"><span class="active"></span><span></span><span></span><span></span></div></div>';
    return wrap;
  }

  function decorateGrowthSurveyBox(box){
    if (!box) return;
    if (!box.querySelector('.growthSurveyIntro')) {
      var count = box.querySelectorAll('.failSurveySection').length || 1;
      box.insertBefore(buildIntro(count), box.firstChild);
    }
    box.querySelectorAll('.failSurveySection').forEach(function(section){
      var title = section.querySelector('.failSurveySectionTitle');
      if (!title) return;
      var key = title.textContent.trim();
      if (!section.querySelector('.failSurveySectionHelp') && growthHelpMap[key]) {
        var help = document.createElement('div');
        help.className = 'failSurveySectionHelp';
        help.textContent = growthHelpMap[key];
        title.insertAdjacentElement('afterend', help);
      }
    });
  }

  function initGrowthSurveyRefresh(){
    decorateGrowthSurveyBox(document.getElementById('failGrowthInputArea'));
    decorateGrowthSurveyBox(document.getElementById('elementaryFailGrowthInputArea'));
  }

  document.addEventListener('DOMContentLoaded', initGrowthSurveyRefresh);
  window.addEventListener('load', initGrowthSurveyRefresh);
})();
