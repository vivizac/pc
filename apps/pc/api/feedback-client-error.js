// Only the shared feedback service may write these diagnostics; forward without storing tokens.
const UPSTREAM = 'https://vivizac-feedback.vercel.app/api/feedback-client-error';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  try {
    const response = await fetch(UPSTREAM, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify(req.body || {})
    });
    const text = await response.text();
    res.statusCode = response.status;
    res.setHeader('Content-Type','application/json');
    return res.end(text);
  } catch (_) {
    return res.status(502).json({error:'Diagnostic upstream unavailable'});
  }
}
