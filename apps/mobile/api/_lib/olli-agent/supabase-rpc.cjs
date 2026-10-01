'use strict';

const SUPABASE_URL = 'https://fvkxipjwgeyosgnfhdnx.supabase.co';
const RPC_NAME_PATTERN = /^[a-z0-9_]+$/i;

function getServerKey() {
  return String(
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();
}

function httpError(message, statusCode = 500, code = 'SUPABASE_RPC_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function callSupabaseRpc(name, params = {}) {
  const rpcName = String(name || '').trim();
  if (!RPC_NAME_PATTERN.test(rpcName)) {
    throw httpError('Supabase RPC 이름이 올바르지 않습니다.', 500, 'INVALID_RPC_NAME');
  }

  const serverKey = getServerKey();
  if (!serverKey) {
    throw httpError(
      'SUPABASE_SECRET_KEY가 서버 환경변수에 설정되지 않았습니다.',
      500,
      'SUPABASE_SECRET_KEY_MISSING'
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(rpcName)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serverKey,
        Authorization: `Bearer ${serverKey}`,
      },
      body: JSON.stringify(params || {}),
    }
  );

  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      `Supabase RPC 요청에 실패했습니다. (${response.status})`;
    const statusCode = response.status === 401 ? 401 : response.status === 403 ? 403 : 500;
    throw httpError(message, statusCode, 'SUPABASE_RPC_HTTP_ERROR');
  }

  return data;
}

module.exports = {
  SUPABASE_URL,
  callSupabaseRpc,
  getServerKey,
};
