'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {chromium}=require('playwright');
const base=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(base,'packages/common/olli-booking-owner-ui.js'),'utf8');
const style=fs.readFileSync(path.join(base,'packages/common/olli-booking-owner-ui.css'),'utf8');
function renderMock(view='calendar',mode='pc'){
  const start=source.indexOf(' function render(){'),end=source.indexOf(' async function refresh(){',start);
  assert.ok(start>=0&&end>start);
  const root={innerHTML:''};
  const state={mode,view,root,month:'2026-10',selectedDay:'',rows:[],error:'',ready:true,loading:false,publicUrl:''};
  const labels=['이달 예약','오늘 상담','신규생 상담','이번 달 미예약 대상'];
  const stats='<div class="obmStats">'+labels.map((name,i)=>'<div><strong>'+(i+1)+'</strong><span>'+name+'</span></div>').join('')+'</div>';
  const days=Array.from({length:35},(_,i)=>'<button class="obmCalDay" type="button"><span class="obmCalDate">'+(i+1)+'</span></button>').join('');
  const week=['월','화','수','목','금','토','일'].map(n=>'<span class="obmDayHead">'+n+'</span>').join('');
  const context={state,escapeHtml:x=>String(x),renderStats:()=>stats,
    calendarHtml:()=>'<div class="obmCalendar">'+week+days+'</div>',
    bookingsHtml:()=>'<div data-booking-list></div>',
    settingsHtml:()=>'<form data-settings></form>',dateLabel:()=>''};
  vm.runInNewContext(source.slice(start,end)+'\nrender();',context);
  return root.innerHTML;
}
test('PC consultation status cards stay ahead of the right controls in one row',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    for(const width of [1440,1280]){
      const page=await browser.newPage({viewport:{width,height:900}});
      await page.setContent('<style>body{margin:0;font-family:Arial,sans-serif}main{margin-left:220px;padding:20px 24px;box-sizing:border-box}</style><main><section id="olliConsultationBookingPanel">'+renderMock()+'</section></main>');
      await page.addStyleTag({content:style});
      const result=await page.evaluate(()=>{
        const panel=document.querySelector('#olliConsultationBookingPanel');
        const toolbar=panel.querySelector('.obmPcToolbar');
        const cards=[...toolbar.querySelectorAll('.obmStats>div')].map(el=>el.getBoundingClientRect().toJSON());
        const month=toolbar.querySelector('.obmMonth').getBoundingClientRect().toJSON();
        const tabs=toolbar.querySelector('.obmTabs').getBoundingClientRect().toJSON();
        const refresh=toolbar.querySelector('[data-action="refresh"]').getBoundingClientRect().toJSON();
        const cal=panel.querySelector('.obmCalendar').getBoundingClientRect().toJSON();
        return {cards,month,tabs,refresh,cal,toolbar:toolbar.getBoundingClientRect().toJSON(),
          scroll:toolbar.scrollWidth,client:toolbar.clientWidth,copy:!!panel.querySelector('[data-action="copy-public-link"]')};
      });
      assert.equal(result.cards.length,4);
      for(const card of result.cards){
        assert.ok(Math.abs(card.y-result.cards[0].y)<2,'cards should stay on one row');
        assert.ok(Math.abs(card.width/card.height-2.5)<0.04,'cards should have a 5:2 ratio');
      }
      assert.ok(result.cards[3].right<result.month.left,'stats must precede month');
      assert.ok(result.month.right<result.tabs.left&&result.tabs.right<result.refresh.left);
      assert.ok(Math.abs(result.month.y-result.cards[0].y)<12,'toolbar controls must align vertically');
      assert.ok(result.scroll<=result.client+2,'toolbar must fit at '+width+'px');
      assert.ok(result.cal.height>=590,'calendar should grow into available viewport');
      assert.equal(result.copy,false,'copy button moved from PC footer to fixed header');
      await page.close();
    }
  }finally{await browser.close();}
});
test('mobile footer still owns its own copy button and booking settings remain untouched',()=>{
  const mobile=renderMock('today','mobile');
  assert.match(mobile,/data-action="copy-public-link"/,'mobile copy button must remain in the footer');
  assert.match(source,/state\.mode==='pc'\s*\? \(state\.publicUrl/);
  assert.match(source,/global\.OlliBookingDashboard=Object\.freeze\(\{open,close,refresh,copyPublicLink,initMobileShortcut\}\)/);
});
