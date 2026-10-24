// Authenticated Vercel cron invokes shared server summary worker; never public browser code.
module.exports=require('./_lib/consultation-summary-cron.cjs');
