'use strict';
// Stage 1: confirmed notification email only. Student identity needs booking detail.
const SENDER = 'naverbooking_noreply@navercorp.com';
function problem(code) { const e=new Error(code); e.code=code; return e; }
function fromAddress(value) {
  const raw=String(value||'').trim();
  const bracketed=raw.match(/<([^<>]+)>\s*$/);
  return (bracketed ? bracketed[1] : raw.split(/\s+/).at(-1)||'').toLowerCase();
}
function getField(body, label) {
  const lines=String(body).replace(/\r/g,'').split('\n').map(s=>s.trim());
  const index=lines.indexOf(label);
  return index<0 ? '' : (lines.slice(index+1).find(Boolean)||'');
}
function parseKoreanTime(text) {
  const m=String(text||'').match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})\.\s*(?:\(([월화수목금토일])\)\s*)?(오전|오후)\s*(\d{1,2}):(\d{2})$/);
  if(!m) throw problem('BOOKING_DATE_FORMAT_UNRECOGNIZED');
  const [y,mo,d,h,mi]=[+m[1],+m[2],+m[3],+m[6],+m[7]];
  const valid=new Date(Date.UTC(y,mo-1,d));
  if(y<2020||y>2100||valid.getUTCFullYear()!==y||valid.getUTCMonth()!==mo-1||valid.getUTCDate()!==d||h<1||h>12||mi>59)
    throw problem('BOOKING_DATE_INVALID');
  if(m[4] && m[4]!==['일','월','화','수','목','금','토'][valid.getUTCDay()])
    throw problem('BOOKING_WEEKDAY_MISMATCH');
  const two=n=>String(n).padStart(2,'0');
  const hh=h%12+(m[5]==='오후'?12:0);
  return String(y)+'-'+two(mo)+'-'+two(d)+'T'+two(hh)+':'+two(mi)+':00+09:00';
}
function parseNaverBookingConfirmation(input, {academyName}={}) {
  if(!input||typeof input!=='object') throw problem('BOOKING_MAIL_REQUIRED');
  if(fromAddress(input.from)!==SENDER) throw problem('BOOKING_SENDER_UNVERIFIED');
  const academy=String(academyName||'').trim();
  if(!academy||academy.length>150) throw problem('BOOKING_ACADEMY_REQUIRED');
  if(String(input.subject||'').trim()!=='[네이버 예약] '+academy+' 새로운 예약이 확정 되었습니다.')
    throw problem('BOOKING_SUBJECT_UNRECOGNIZED');
  const body=String(input.body||'');
  if(!body||body.length>150000||!body.includes(academy)||!body.includes('새로운 예약이 확정'))
    throw problem('BOOKING_BODY_INVALID');
  const number=getField(body,'예약번호');
  if(!/^\d{8,20}$/.test(number)) throw problem('BOOKING_NUMBER_INVALID');
  const product=getField(body,'예약상품');
  if(!product||product.length>200) throw problem('BOOKING_PRODUCT_INVALID');
  const appliedAt=getField(body,'예약신청 일시');
  if(!/^\d{4}\.\d{1,2}\.\d{1,2}\.\s+\d{2}:\d{2}:\d{2}$/.test(appliedAt))
    throw problem('BOOKING_APPLICATION_TIME_INVALID');
  const startAt=parseKoreanTime(getField(body,'이용일시'));
  const rawId=String(input.messageId||'').trim();
  if(rawId&&!/^[a-zA-Z0-9_-]{6,200}$/.test(rawId)) throw problem('BOOKING_MESSAGE_ID_INVALID');
  const link=body.match(/\]\((https:\/\/partner\.booking\.naver\.com\/bizes\/\d+\/booking-list-view\/bookings\/\d+)\)/);
  let detailUrl=null, businessId=null;
  if(link) {
    const u=new URL(link[1]);
    const parts=u.pathname.match(/^\/bizes\/(\d+)\/booking-list-view\/bookings\/(\d+)$/);
    if(parts&&parts[2]===number&&!u.username&&!u.password&&!u.search&&!u.hash){
      detailUrl=u.href; businessId=parts[1];
    }
  }
  return {
    source:'naver_booking_email', sourceMessageId:rawId||null,
    academyName:academy, bookingNumber:number, businessId, detailUrl,
    status:'confirmed', product, startAt, appliedAtRaw:appliedAt,
    maskedBooker:getField(body,'예약자명').slice(0,100)||null,
    studentName:null, studentAgeOrGrade:null, studentId:null,
    matchStatus:'detail_required'
  };
}
module.exports={SENDER,fromAddress,parseKoreanTime,parseNaverBookingConfirmation};
