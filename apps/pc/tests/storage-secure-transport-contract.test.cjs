const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'olli-storage-core.js'), 'utf8');

test('storage core supports session_rpc without changing existing table transport defaults', () => {
  assert.match(source, /transport: 'table'/);
  assert.match(source, /\['table', 'session_rpc'\]\.includes\(spec\.server\.transport\)/);
  assert.match(source, /function usesSessionRpc\(spec\)/);
  assert.match(source, /function callSessionRpc\(spec, action, identity, payload, options\)/);
  assert.match(source, /localStorage\.getItem\('olli_account_session_token_v1'\)/);
  assert.match(source, /error\.code = 'NO_ACCOUNT_SESSION'/);
  assert.match(source, /p_session_token: sessionToken/);
  assert.match(source, /p_academy_id: identity\.academyId \|\| null/);
  assert.match(source, /p_identity: identityPayload\(spec, identity\)/);
  assert.match(source, /p_payload: payload && typeof payload === 'object'/);
  assert.match(source, /global\.supabase\('POST', \`rpc\/\$\{rpcName\}\`, body\)/);
});

test('session_rpc is opt-in and table transport remains the current path', () => {
  assert.match(source, /if \(usesSessionRpc\(spec\)\) \{\s*return callSessionRpc\(spec, 'read'/);
  assert.match(source, /if \(usesSessionRpc\(spec\)\) \{\s*return callSessionRpc\(spec, 'write'/);
  assert.match(source, /return global\.supabase\('GET',/);
  assert.match(source, /return global\.supabase\('DELETE',/);
});

test('secure RPC rejection is surfaced to normal pending and blocked handling', () => {
  assert.match(source, /result\.ok === false/);
  assert.match(source, /error\.code = normalizeString\(result\.code \|\| 'SERVER_RPC_REJECTED'\)/);
  assert.match(source, /throw error/);
});
