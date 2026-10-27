'use strict';
// This allowlist is used only for Solapi consultation notification URLs.
// Preserve legacy Naver destinations; accept our own stable booking page
// only when it matches the server-configured public HTTPS origin exactly.
function isAllowedConsultationBookingUrl(raw, env = process.env) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password ||
      (url.port && url.port !== '443')) return false;
  const legacyNaver = url.hostname === 'naver.me' ||
    url.hostname === 'naver.com' || url.hostname.endsWith('.naver.com');
  if (legacyNaver) return true;
  let origin;
  try { origin = new URL(env.OLLI_BOOKING_PUBLIC_ORIGIN); }
  catch { return false; }
  if (origin.protocol !== 'https:' || origin.username || origin.password ||
      origin.search || origin.hash || origin.pathname !== '/' ||
      (origin.port && origin.port !== '443')) return false;
  const slug = url.searchParams.get('academy');
  return url.origin === origin.origin &&
    url.pathname === '/consultation-booking.html' &&
    url.hash === '' && url.searchParams.size === 1 &&
    /^[0-9a-f]{36}$/.test(slug || '') &&
    url.search === '?academy=' + slug;
}
module.exports = { isAllowedConsultationBookingUrl };
