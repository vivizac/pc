const MAX_HTML_BYTES = 700 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 4500;

function isPrivateIpv4(address) {
  const parts = String(address || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIp(address) {
  const value = String(address || '').trim().toLowerCase();
  if (!value) return true;
  if (value.includes('.')) {
    const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIpv4(mapped[1]) : isPrivateIpv4(value);
  }
  return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb');
}

async function assertPublicUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch (_) {
    const error = new Error('올바른 링크가 아닙니다.');
    error.statusCode = 400;
    throw error;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const error = new Error('http/https 링크만 지원합니다.');
    error.statusCode = 400;
    throw error;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    const error = new Error('허용되지 않는 링크입니다.');
    error.statusCode = 400;
    throw error;
  }

  const dns = await import('node:dns/promises');
  const net = await import('node:net');
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      const error = new Error('허용되지 않는 링크입니다.');
      error.statusCode = 400;
      throw error;
    }
  } else {
    const resolved = await dns.lookup(hostname, { all:true, verbatim:true });
    if (!resolved.length || resolved.some((entry) => isPrivateIp(entry.address))) {
      const error = new Error('허용되지 않는 링크입니다.');
      error.statusCode = 400;
      throw error;
    }
  }

  return parsed;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .trim();
}

function getAttribute(tag, name) {
  const match = String(tag || '').match(new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", 'i'));
  return decodeHtml(match ? (match[1] ?? match[2] ?? match[3] ?? '') : '');
}

function extractMeta(html) {
  const meta = new Map();
  const tags = String(html || '').match(/<meta\\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = (getAttribute(tag, 'property') || getAttribute(tag, 'name')).toLowerCase();
    const content = getAttribute(tag, 'content');
    if (key && content && !meta.has(key)) meta.set(key, content);
  }
  const titleMatch = String(html || '').match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i);
  return {
    title: meta.get('og:title') || meta.get('twitter:title') || decodeHtml(titleMatch?.[1] || ''),
    description: meta.get('og:description') || meta.get('twitter:description') || meta.get('description') || '',
    image: meta.get('og:image:secure_url') || meta.get('og:image') || meta.get('twitter:image') || '',
    siteName: meta.get('og:site_name') || ''
  };
}

async function readTextWithLimit(response) {
  if (!response.body?.getReader) {
    const text = await response.text();
    return text.slice(0, MAX_HTML_BYTES);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let output = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_HTML_BYTES) {
      try { await reader.cancel(); } catch (_) {}
      break;
    }
    output += decoder.decode(value, { stream:true });
  }
  output += decoder.decode();
  return output;
}

async function fetchHtml(initialUrl) {
  let current = await assertPublicUrl(initialUrl);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current.href, {
        method:'GET',
        redirect:'manual',
        signal:controller.signal,
        headers:{
          'User-Agent':'Mozilla/5.0 (compatible; OlliLinkPreview/1.0)',
          'Accept':'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.6'
        }
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301,302,303,307,308].includes(response.status)) {
      if (redirect >= MAX_REDIRECTS) throw new Error('링크 이동 횟수가 너무 많습니다.');
      const location = response.headers.get('location');
      if (!location) throw new Error('이동할 링크를 찾지 못했습니다.');
      current = await assertPublicUrl(new URL(location, current).href);
      continue;
    }

    if (!response.ok) {
      const error = new Error('링크 정보를 불러오지 못했습니다.');
      error.statusCode = response.status >= 400 && response.status < 500 ? 422 : 502;
      throw error;
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return { finalUrl:current.href, html:'' };
    }

    return { finalUrl:current.href, html:await readTextWithLimit(response) };
  }

  throw new Error('링크 정보를 불러오지 못했습니다.');
}

function cleanText(value, maxLength) {
  return decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).slice(0, maxLength);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok:false, error:'GET만 지원합니다.' });
  }

  try {
    const rawUrl = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;
    const { finalUrl, html } = await fetchHtml(rawUrl);
    const final = new URL(finalUrl);
    const meta = extractMeta(html);

    let image = '';
    if (meta.image) {
      try {
        const resolved = new URL(meta.image, finalUrl);
        if (['http:', 'https:'].includes(resolved.protocol)) image = resolved.href;
      } catch (_) {}
    }

    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    return res.status(200).json({
      ok:true,
      url:finalUrl,
      domain:final.hostname,
      title:cleanText(meta.title || meta.siteName || final.hostname, 180),
      description:cleanText(meta.description, 260),
      image,
      site_name:cleanText(meta.siteName, 100)
    });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      ok:false,
      error:String(error?.message || '링크 미리보기를 불러오지 못했습니다.')
    });
  }
}
