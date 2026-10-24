'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseNaverBookingConfirmation,parseKoreanTime}=require('../packages/common/api/_lib/naver-booking-mail.cjs');
const academyName='테스트미술학원';
const number='1234567890';
const body=[
  'NAVER 예약', academyName, '새로운 예약이 확정 되었습니다.', '',
  '예약자명', '최*기님', '예약신청 일시', '2026.10.24. 09:12:59',
  '예약번호', number, '예약상품', '재원생 정기 상담',
  '이용일시', '2026.10.31.(토) 오전 10:00',
  '[자세히 보기](https://partner.booking.naver.com/bizes/937262/booking-list-view/bookings/'+number+')'
].join('\n');
const mail={from:'"네이버 예약" naverbooking_noreply@navercorp.com',
 subject:'[네이버 예약] '+academyName+' 새로운 예약이 확정 되었습니다.',
 messageId:'abcde0123456789', body};
const parse=(item=mail,options={academyName})=>parseNaverBookingConfirmation(item,options);
test('confirmed mail includes safe reservation fields and Korean local time',()=>{
 const out=parse();
 assert.equal(out.startAt,'2026-10-31T10:00:00+09:00');
 assert.equal(out.bookingNumber,number);
 assert.equal(out.businessId,'937262');
 assert.equal(out.product,'재원생 정기 상담');
 assert.equal(out.status,'confirmed');
 assert.equal(out.sourceMessageId,mail.messageId);
});
test('student identity remains unresolved: guardian is not the student',()=>{
 const out=parse();
 assert.equal(out.studentId,null);
 assert.equal(out.studentName,null);
 assert.equal(out.studentAgeOrGrade,null);
 assert.equal(out.matchStatus,'detail_required');
});
test('rejects spoofed sender or wrong academy',()=>{
 assert.throws(()=>parse({...mail,from:'naverbooking_noreply@navercorp.com.evil.example'}),{code:'BOOKING_SENDER_UNVERIFIED'});
 assert.throws(()=>parse(mail,{academyName:'다른학원'}),{code:'BOOKING_SUBJECT_UNRECOGNIZED'});
 assert.throws(()=>parse({...mail,subject:'[네이버 예약] 다른학원 '+academyName+' 새로운 예약이 확정 되었습니다.'}),{code:'BOOKING_SUBJECT_UNRECOGNIZED'});
});
test('ignores unsupported reservation change and cancellation formats',()=>{
 for(const action of ['취소','변경']){
  assert.throws(()=>parse({...mail,subject:'[네이버 예약] '+academyName+' 예약이 '+action+'되었습니다.'}),{code:'BOOKING_SUBJECT_UNRECOGNIZED'});
 }
});
test('validates reservation number and appointment weekday',()=>{
 assert.throws(()=>parse({...mail,body:body.replace('예약번호\n'+number,'예약번호\nnope')}),{code:'BOOKING_NUMBER_INVALID'});
 assert.throws(()=>parse({...mail,body:body.replace('(토)','(금)')}),{code:'BOOKING_WEEKDAY_MISMATCH'});
 assert.throws(()=>parse({...mail,body:body.replace('2026.10.31.(토)','2026.02.30.(월)')}),{code:'BOOKING_DATE_INVALID'});
});
test('handles midnight and noon in Korea local time',()=>{
 assert.equal(parseKoreanTime('2026.10.31.(토) 오전 12:00'),'2026-10-31T00:00:00+09:00');
 assert.equal(parseKoreanTime('2026.10.31.(토) 오후 12:00'),'2026-10-31T12:00:00+09:00');
});
test('mismatched detail link is not trusted',()=>{
 const out=parse({...mail,body:body.replace('bookings/'+number,'bookings/9999999999')});
 assert.equal(out.detailUrl,null);
 assert.equal(out.businessId,null);
});
test('refuses unsafe Gmail message identifiers',()=>{
 assert.throws(()=>parse({...mail,messageId:'../../hello'}),{code:'BOOKING_MESSAGE_ID_INVALID'});
});


test('generic unnamed email can be scoped to an already verified Naver booking business ID',()=>{
 const generic={...mail,subject:'[네이버 예약] 새로운 예약이 확정 되었습니다.',
   body:body.replace('\n'+academyName+'\n','\n')};
 const out=parse(generic,{businessId:'937262'});
 assert.equal(out.bookingNumber,number);
 assert.equal(out.businessId,'937262');
 assert.equal(out.academyName,null);
 assert.equal(out.studentId,null);
 const configured=parse(generic,{academyName,businessId:'937262'});
 assert.equal(configured.academyName,academyName);
});
test('name-free messages must not enter Olli without registered business ID',()=>{
 const generic={...mail,subject:'[네이버 예약] 새로운 예약이 확정 되었습니다.',
  body:body.replace('\n'+academyName+'\n','\n')};
 assert.throws(()=>parse(generic,{academyName}),{code:'BOOKING_BUSINESS_ID_REQUIRED'});
 assert.throws(()=>parse(generic,{}),{code:'BOOKING_SCOPE_REQUIRED'});
 assert.throws(()=>parse(generic,{businessId:'1'}),{code:'BOOKING_BUSINESS_ID_MISMATCH'});
});
test('another academy can use its own registered business ID without being named in configuration',()=>{
 const other='새로운미술학원';
 const otherMail={...mail,subject:'[네이버 예약] '+other+' 새로운 예약이 확정 되었습니다.',
   body:body.replace(academyName,other)};
 const out=parse(otherMail,{businessId:'937262'});
 assert.equal(out.academyName,other);
 assert.equal(out.businessId,'937262');
 assert.throws(()=>parse(otherMail,{academyName}),{code:'BOOKING_SUBJECT_UNRECOGNIZED'});
});
test('shared mailboxes cannot assign another business reservation to this academy',()=>{
 assert.throws(()=>parse(mail,{academyName,businessId:'937263'}),{code:'BOOKING_BUSINESS_ID_MISMATCH'});
 assert.throws(()=>parse({...mail,body:body.replace('bookings/'+number,'bookings/9999999999')},{businessId:'937262'}),{code:'BOOKING_DETAIL_LINK_UNVERIFIED'});
 assert.throws(()=>parse({...mail,body:body.replace('https://partner.booking.naver.com','https://malicious.example.com')},{businessId:'937262'}),{code:'BOOKING_DETAIL_LINK_UNVERIFIED'});
});
test('conflicting academy name in body is rejected even when business ID is present',()=>{
 assert.throws(()=>parse({...mail,body:body.replace('\n'+academyName+'\n','\n다른미술학원\n')},{academyName,businessId:'937262'}),{code:'BOOKING_BODY_ACADEMY_MISMATCH'});
});
