'use strict';
const {createService}=require('./naver-booking-pilot.cjs');
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
 if(process.env.VERCEL_ENV!=='production')return res.status(503).json({ok:false,error:'PRODUCTION_ONLY'});
 try{
  if(!req.body||JSON.stringify(req.body).length>4096)return res.status(400).json({ok:false,error:'INVALID_BODY'});
  const {academyId,sessionToken,action,bookingNumber,studentId}=req.body;
  if(!['status','list','sync','candidates','match'].includes(action))return res.status(400).json({ok:false,error:'INVALID_ACTION'});
  const service=createService();
  await service.requireOwner(sessionToken,academyId);
  if(action==='status')return res.status(200).json({ok:true,configured:service.cfg.ready});
  if(action==='list')return res.status(200).json({ok:true,rows:await service.list()});
  if(action==='sync'){
   const data=await service.sync(bookingNumber);
   return res.status(200).json({ok:true,...data});
  }
  if(action==='candidates')return res.status(200).json({ok:true,...await service.candidates(String(bookingNumber||''))});
  if(action==='match'){
   if(studentId!==null&&typeof studentId!=='string')return res.status(400).json({ok:false,error:'STUDENT_ID_INVALID'});
   return res.status(200).json({ok:true,row:await service.match(String(bookingNumber||''),studentId)});
  }
 }catch(e){
  // Never leak student fields, owner session, TinyFish API key, or provider response.
  console.error('[naver-booking-pilot]',String(e.code||'REQUEST_FAILED').slice(0,60));
  return res.status(e.status||503).json({ok:false,error:e.code||'REQUEST_FAILED'});
 }
};
