'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'packages/common/olli-booking-owner-ui.js'),'utf8');
const css=fs.readFileSync(path.join(root,'packages/common/olli-booking-owner-ui.css'),'utf8');
const pc=fs.readFileSync(path.join(root,'apps/pc/index.html'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/index.html'),'utf8');
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function kstParts(date){
 const m=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(new Date(date)).map(p=>[p.type,p.value]));
 return {ymd:m.year+'-'+m.month+'-'+m.day,hm:m.hour+':'+m.minute};
}
function calendar(rows,selectedDay=''){
 const start=js.indexOf(' function calendarHtml(){');
 const end=js.indexOf(' function bookingsHtml(){',start);
 assert.ok(start>=0&&end>start,'use the actual owner calendar function');
 const context={state:{month:'2026-11',selectedDay,rows},escapeHtml,kstParts,Date,Intl,Map,
  today:()=> '2026-11-03'};
 return vm.runInNewContext(js.slice(start,end)+'\ncalendarHtml();',context);
}
function row(id,start_at,name,status='confirmed'){
 return {id,start_at,name,status,kind:'student'};
}
test('PC calendar lists all confirmed appointments for each date, sorted by KST time, not blue counts',()=>{
 const html=calendar([
  row('b','2026-11-03T05:00:00+09:00','아주이른'), // 05:00
  row('c','2026-11-03T11:30:00+09:00','김하늘'),
  row('a','2026-11-03T09:00:00+09:00','박서준'),
  row('d','2026-11-03T12:00:00+09:00','취소아이','cancelled'),
  row('e','2026-12-01T09:00:00+09:00','다른달'),
  row('f','2026-11-04T10:00:00+09:00','이수빈')
 ],'2026-11-03');
 const day3=html.match(/<button class="obmCalDay[^"]*" type="button" data-day="2026-11-03"[\s\S]*?<\/button>/)?.[0];
 assert.ok(day3,'Nov 3 must be a selectable day button');
 assert.match(day3,/aria-pressed="true"/);
 assert.match(day3,/<span class="obmCalDate">3<\/span>/);
 assert.equal((day3.match(/class="obmCalBooking"/g)||[]).length,3);
 assert.ok(day3.indexOf('05:00')<day3.indexOf('09:00'));
 assert.ok(day3.indexOf('09:00')<day3.indexOf('11:30'));
 assert.ok(day3.includes('박서준')&&day3.includes('김하늘'));
 assert.doesNotMatch(day3,/취소아이|<b>3<\/b>/);
 const day4=html.match(/data-day="2026-11-04"[\s\S]*?<\/button>/)?.[0];
 assert.match(day4,/10:00[\s\S]*?이수빈/);
 assert.doesNotMatch(html,/다른달|취소아이/);
 assert.match(html,/월간 상담 예약 달력/);
 assert.match(html,/data-day="2026-11-03"/);
});
test('consultation names are escaped before inserting appointment cards',()=>{
 const html=calendar([row('a','2026-11-03T11:30:00+09:00','<img src=x onerror=alert(1)>')]);
 assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.doesNotMatch(html,/<img /);
 assert.match(html,/title="11:30 &lt;img/);
});
test('PC date and appointment cards are top-left aligned, with no nested buttons',()=>{
 assert.match(css,/#olliConsultationBookingPanel \.obmCalDay\{[^}]*flex-direction:column;align-items:stretch;justify-content:flex-start/s);
 assert.match(css,/#olliConsultationBookingPanel \.obmCalDate\{[^}]*align-self:flex-start/s);
 assert.match(css,/#olliConsultationBookingPanel \.obmCalBooking\{[^}]*border:1px/s);
 assert.match(css,/#olliConsultationBookingPanel \.obmCalBookingTime/);
 assert.match(css,/#olliConsultationBookingPanel \.obmCalBookingName/);
 const day=calendar([row('x','2026-11-03T11:30:00+09:00','김하늘')]);
 assert.doesNotMatch(day,/class="obmCalBooking"[\s\S]*?<button/);
});
test('remove only PC subheading while keeping mobile heading and refresh action',()=>{
 assert.match(js,/const mobileTitle=state\.mode==='mobile'\?/);
 assert.match(js,/obmHeaderPc/);
 assert.match(js,/data-action="refresh"/);
 assert.match(css,/#olliConsultationBookingPanel \.obmHeaderPc\{justify-content:flex-end/);
 assert.match(pc,/olli-booking-owner-ui\.css\?v=20261027-pc-calendar-cards-1/);
 assert.match(pc,/olli-booking-owner-ui\.js\?v=20261027-pc-calendar-cards-1/);
 assert.match(mobile,/olli-booking-owner-ui\.css\?v=20261027-mobile-count-circle-1/);
 assert.match(mobile,/olli-booking-owner-ui\.js\?v=20261027-mobile-count-circle-1/);
});
