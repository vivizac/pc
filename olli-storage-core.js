/* ─────────────────────────────────────────────────────────────
   올리로그 저장 구조 통합 6단계
   - 기존 저장 코드는 변경하지 않습니다.
   - 아래 기반 함수는 기능별 전환 단계에서만 명시적으로 사용합니다.
   - 자동 이관, 자동 서버 저장, 자동 재전송은 아직 실행하지 않습니다.
───────────────────────────────────────────────────────────── */
(function initializeOlliStorageFoundation(global) {
  'use strict';

  if (global.OlliStorageCore && global.OlliStorageCore.foundationVersion) return;

  const FOUNDATION_VERSION = '1.0.0-step6';
  const STORAGE_SCHEMA_VERSION = 1;
  const VALID_SCOPES = new Set(['device', 'user', 'academy', 'member', 'student', 'record', 'file', 'platform']);
  const VALID_PERSISTENCE = new Set(['local_only', 'server_source', 'local_first_sync', 'append_only_server', 'two_phase_file']);
  const ROLE_ORDER = Object.freeze({ teacher: 1, manager: 2, owner: 3, super_admin: 4 });
  const SAFE_ID_PATTERN = /[^a-zA-Z0-9._:-]/g;

  function nowIso() {
    return new Date().toISOString();
  }

  function cloneValue(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') {
      try { return structuredClone(value); } catch (_) {}
    }
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }

  function createId(prefix) {
    const safePrefix = String(prefix || 'id').replace(SAFE_ID_PATTERN, '_');
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return `${safePrefix}_${global.crypto.randomUUID()}`;
    }
    return `${safePrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  function normalizeString(value) {
    return String(value == null ? '' : value).trim();
  }

  function normalizeRole(value) {
    const role = normalizeString(value).toLowerCase();
    return ROLE_ORDER[role] ? role : 'teacher';
  }

  function stableNormalize(value) {
    if (Array.isArray(value)) return value.map(stableNormalize);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((acc, key) => {
        acc[key] = stableNormalize(value[key]);
        return acc;
      }, {});
    }
    return value;
  }

  function valuesEqual(left, right) {
    try { return JSON.stringify(stableNormalize(left)) === JSON.stringify(stableNormalize(right)); }
    catch (_) { return left === right; }
  }

  function safeJsonParse(raw, fallback) {
    if (raw == null || raw === '') return cloneValue(fallback);
    try { return JSON.parse(raw); } catch (_) { return cloneValue(fallback); }
  }

  function encodeFilterValue(value) {
    return encodeURIComponent(String(value));
  }

  function normalizeServerFieldName(key) {
    const map = {
      academyId: 'academy_id',
      studentId: 'student_id',
      memberId: 'member_id',
      recordId: 'record_id',
      fileId: 'file_id',
      userId: 'user_id',
      noteType: 'note_type',
      localRecordId: 'local_record_id',
      clientMutationId: 'client_mutation_id'
    };
    return map[key] || key;
  }

  function readLegacyCurrentContext() {
    return {
      academyId: normalizeString(localStorage.getItem('olli_current_academy_id')),
      academyName: normalizeString(localStorage.getItem('olli_current_academy_name')),
      academyCode: normalizeString(localStorage.getItem('olli_current_academy_code')),
      memberId: normalizeString(localStorage.getItem('olli_current_member_id')),
      memberName: normalizeString(localStorage.getItem('olli_current_member_name')),
      userId: normalizeString(localStorage.getItem('olli_current_user_id')),
      role: normalizeRole(
        localStorage.getItem('olli_owner_logged_in') === 'true'
          ? 'owner'
          : (localStorage.getItem('olli_current_member_role') || 'teacher')
      ),
      contextVersion: 1,
      switchedAt: nowIso()
    };
  }

  const AcademyContext = (function createAcademyContextModule() {
    let current = readLegacyCurrentContext();
    let accessibleAcademies = [];
    const runtimeCleaners = new Set();

    function getCurrent() {
      return cloneValue(current);
    }

    function requireCurrent(operationName) {
      if (!current.academyId) {
        const error = new Error(`${operationName || '학원 데이터 작업'}을 할 수 없습니다. 현재 학원 ID가 없습니다.`);
        error.code = 'CONTEXT_MISSING';
        throw error;
      }
      return getCurrent();
    }

    function captureToken() {
      return Object.freeze({
        academyId: current.academyId,
        contextVersion: current.contextVersion
      });
    }

    function isTokenCurrent(token) {
      return !!token
        && normalizeString(token.academyId) === current.academyId
        && Number(token.contextVersion) === Number(current.contextVersion);
    }

    function setCurrent(nextContext, options) {
      const opts = Object.assign({ persistLegacyKeys: true }, options || {});
      const academyId = normalizeString(nextContext && (nextContext.academyId || nextContext.academy_id));
      if (!academyId) {
        const error = new Error('학원 컨텍스트를 변경할 수 없습니다. academyId가 없습니다.');
        error.code = 'CONTEXT_MISSING';
        throw error;
      }

      current = {
        academyId,
        academyName: normalizeString(nextContext.academyName || nextContext.academy_name),
        academyCode: normalizeString(nextContext.academyCode || nextContext.academy_code),
        memberId: normalizeString(nextContext.memberId || nextContext.member_id),
        memberName: normalizeString(nextContext.memberName || nextContext.member_name),
        userId: normalizeString(nextContext.userId || nextContext.user_id),
        role: normalizeRole(nextContext.role),
        contextVersion: Number(current.contextVersion || 0) + 1,
        switchedAt: nowIso()
      };

      if (opts.persistLegacyKeys) {
        localStorage.setItem('olli_current_academy_id', current.academyId);
        localStorage.setItem('olli_current_academy_name', current.academyName);
        localStorage.setItem('olli_current_academy_code', current.academyCode);
        localStorage.setItem('olli_current_member_id', current.memberId);
        localStorage.setItem('olli_current_member_name', current.memberName);
        localStorage.setItem('olli_current_member_role', current.role);
      }
      return getCurrent();
    }

    function registerRuntimeCleaner(cleaner) {
      if (typeof cleaner !== 'function') throw new TypeError('runtime cleaner는 함수여야 합니다.');
      runtimeCleaners.add(cleaner);
      return function unregister() { runtimeCleaners.delete(cleaner); };
    }

    function clearRuntime(reason) {
      runtimeCleaners.forEach(cleaner => {
        try { cleaner(reason || 'academy_switch'); }
        catch (error) { console.warn('Olli runtime cleaner failed:', error); }
      });
    }

    function setAccessible(list) {
      accessibleAcademies = (Array.isArray(list) ? list : []).map(item => ({
        academyId: normalizeString(item.academyId || item.academy_id || item.id),
        academyName: normalizeString(item.academyName || item.academy_name || item.name),
        academyCode: normalizeString(item.academyCode || item.academy_code),
        region: normalizeString(item.region || item.academy_region),
        memberId: normalizeString(item.memberId || item.member_id),
        memberName: normalizeString(item.memberName || item.member_name),
        role: normalizeRole(item.role),
        membershipStatus: normalizeString(item.membershipStatus || item.membership_status || item.status || 'active')
      })).filter(item => item.academyId && item.membershipStatus === 'active');
      return getAccessible();
    }

    function getAccessible() {
      return cloneValue(accessibleAcademies);
    }

    function hasAccessTo(academyId) {
      const target = normalizeString(academyId);
      return accessibleAcademies.some(item => item.academyId === target);
    }

    function can(permission) {
      const role = current.role;
      const matrix = {
        view_class: ['teacher', 'manager', 'owner', 'super_admin'],
        write_feedback: ['teacher', 'manager', 'owner', 'super_admin'],
        view_academy_management: ['manager', 'owner', 'super_admin'],
        manage_students: ['manager', 'owner', 'super_admin'],
        manage_teachers: ['manager', 'owner', 'super_admin'],
        manage_academy_settings: ['manager', 'owner', 'super_admin'],
        manage_billing: ['owner', 'super_admin'],
        transfer_ownership: ['owner', 'super_admin'],
        delete_academy: ['owner', 'super_admin'],
        platform_admin: ['super_admin']
      };
      const allowed = matrix[permission];
      return Array.isArray(allowed) ? allowed.includes(role) : false;
    }

    return Object.freeze({
      getCurrent,
      requireCurrent,
      setCurrent,
      captureToken,
      isTokenCurrent,
      registerRuntimeCleaner,
      clearRuntime,
      setAccessible,
      getAccessible,
      hasAccessTo,
      can
    });
  })();

  const FeatureRegistry = (function createFeatureRegistryModule() {
    const registry = new Map();

    function validateSpec(rawSpec) {
      const spec = cloneValue(rawSpec || {});
      spec.feature = normalizeString(spec.feature);
      if (!spec.feature) throw new Error('저장 기능명(feature)이 없습니다.');
      if (!/^[a-z0-9_:-]+$/i.test(spec.feature)) throw new Error(`올바르지 않은 기능명입니다: ${spec.feature}`);
      spec.scope = normalizeString(spec.scope || 'device');
      if (!VALID_SCOPES.has(spec.scope)) throw new Error(`지원하지 않는 저장 범위입니다: ${spec.scope}`);
      spec.persistence = normalizeString(spec.persistence || 'local_only');
      if (!VALID_PERSISTENCE.has(spec.persistence)) throw new Error(`지원하지 않는 저장 방식입니다: ${spec.persistence}`);
      spec.version = Number(spec.version || 1);
      spec.label = normalizeString(spec.label || spec.feature);
      spec.identity = Object.assign({
        requiresAcademyId: ['academy', 'member', 'student', 'record', 'file'].includes(spec.scope),
        requiresStudentId: ['student', 'record', 'file'].includes(spec.scope),
        requiresMemberId: spec.scope === 'member',
        requiresRecordId: spec.scope === 'record',
        requiresFileId: spec.scope === 'file'
      }, spec.identity || {});
      spec.local = Object.assign({ enabled: true, defaultValue: null, legacyKeys: [], migrationPolicy: 'manual' }, spec.local || {});
      spec.server = Object.assign({ kind: null, table: null, operation: 'patch', identityColumns: [], valueColumns: [], requiredColumns: [], selectColumns: [] }, spec.server || {});
      spec.verification = Object.assign({ mode: 'read_after_write', compareFields: [] }, spec.verification || {});
      spec.conflict = Object.assign({ policy: 'latest_valid_update', protectPendingLocal: true }, spec.conflict || {});
      spec.permissions = Object.assign({ read: ['teacher', 'manager', 'owner'], write: ['teacher', 'manager', 'owner'] }, spec.permissions || {});
      spec.diagnostics = Object.assign({ serverRequired: spec.persistence !== 'local_only', adminVisible: true }, spec.diagnostics || {});
      return spec;
    }

    function register(rawSpec) {
      const spec = validateSpec(rawSpec);
      if (registry.has(spec.feature)) throw new Error(`이미 등록된 저장 기능입니다: ${spec.feature}`);
      registry.set(spec.feature, Object.freeze(spec));
      return get(spec.feature);
    }

    function upsert(rawSpec) {
      const spec = validateSpec(rawSpec);
      registry.set(spec.feature, Object.freeze(spec));
      return get(spec.feature);
    }

    function get(feature) {
      const spec = registry.get(normalizeString(feature));
      return spec ? cloneValue(spec) : null;
    }

    function requireSpec(feature) {
      const spec = get(feature);
      if (!spec) {
        const error = new Error(`등록되지 않은 저장 기능입니다: ${feature}`);
        error.code = 'FEATURE_NOT_REGISTERED';
        throw error;
      }
      return spec;
    }

    function has(feature) {
      return registry.has(normalizeString(feature));
    }

    function list() {
      return Array.from(registry.values()).map(cloneValue);
    }

    return Object.freeze({ register, upsert, get, require: requireSpec, has, list, validateSpec });
  })();

  function resolveIdentity(spec, input) {
    const context = AcademyContext.getCurrent();
    const source = input || {};
    const identity = {
      academyId: normalizeString(source.academyId || source.academy_id || context.academyId),
      studentId: normalizeString(source.studentId || source.student_id),
      memberId: normalizeString(source.memberId || source.member_id || context.memberId),
      recordId: normalizeString(source.recordId || source.record_id),
      fileId: normalizeString(source.fileId || source.file_id),
      userId: normalizeString(source.userId || source.user_id || context.userId),
      noteType: normalizeString(source.noteType || source.note_type),
      localRecordId: normalizeString(source.localRecordId || source.local_record_id)
    };

    const required = spec.identity || {};
    const missing = [];
    if (required.requiresAcademyId && !identity.academyId) missing.push('academyId');
    if (required.requiresStudentId && !identity.studentId) missing.push('studentId');
    if (required.requiresMemberId && !identity.memberId) missing.push('memberId');
    if (required.requiresRecordId && !identity.recordId) missing.push('recordId');
    if (required.requiresFileId && !identity.fileId) missing.push('fileId');
    if (required.requiresNoteType && !identity.noteType) missing.push('noteType');
    if (required.requiresLocalRecordId && !identity.localRecordId) missing.push('localRecordId');
    if (missing.length) {
      const error = new Error(`${spec.label} 저장 식별값이 없습니다: ${missing.join(', ')}`);
      error.code = 'IDENTITY_MISSING';
      error.missing = missing;
      throw error;
    }
    return identity;
  }

  function makeStorageKey(input) {
    const data = input || {};
    const scope = normalizeString(data.scope || 'device');
    const feature = normalizeString(data.feature);
    const version = Number(data.version || STORAGE_SCHEMA_VERSION);
    if (!VALID_SCOPES.has(scope)) throw new Error(`지원하지 않는 로컬 저장 범위입니다: ${scope}`);
    if (!feature) throw new Error('로컬 저장 키에 feature가 없습니다.');

    const parts = ['olli', `v${version}`, scope];
    const pushId = (label, value, required) => {
      const normalized = normalizeString(value);
      if (required && !normalized) {
        const error = new Error(`로컬 저장 키에 ${label}가 없습니다.`);
        error.code = 'IDENTITY_MISSING';
        throw error;
      }
      if (normalized) parts.push(normalized.replace(SAFE_ID_PATTERN, '_'));
    };

    pushId('academyId', data.academyId, ['academy', 'member', 'student', 'record', 'file'].includes(scope));
    pushId('studentId', data.studentId, ['student', 'record', 'file'].includes(scope));
    pushId('memberId', data.memberId, scope === 'member');
    pushId('recordId', data.recordId, scope === 'record');
    pushId('fileId', data.fileId, scope === 'file');
    pushId('userId', data.userId, scope === 'user');
    parts.push(feature.replace(SAFE_ID_PATTERN, '_'));
    return parts.join(':');
  }

  function getFeatureStorageKey(feature, identity) {
    const spec = FeatureRegistry.require(feature);
    if (spec.local && typeof spec.local.key === 'function') {
      const custom = spec.local.key(cloneValue(identity));
      if (!custom) throw new Error(`${spec.label} 로컬 키 함수가 빈 값을 반환했습니다.`);
      return custom;
    }
    return makeStorageKey(Object.assign({ scope: spec.scope, feature: spec.feature, version: spec.version }, identity));
  }

  const LocalStore = Object.freeze({
    read(feature, context, options) {
      const spec = FeatureRegistry.require(feature);
      const identity = resolveIdentity(spec, context);
      const key = getFeatureStorageKey(feature, identity);
      const fallback = options && Object.prototype.hasOwnProperty.call(options, 'fallback')
        ? options.fallback
        : spec.local.defaultValue;
      const parsed = safeJsonParse(localStorage.getItem(key), null);
      if (!parsed) return cloneValue(fallback);
      if (options && options.rawEnvelope) return parsed;
      return Object.prototype.hasOwnProperty.call(parsed, 'data') ? cloneValue(parsed.data) : cloneValue(parsed);
    },

    write(feature, context, value, options) {
      const spec = FeatureRegistry.require(feature);
      const identity = resolveIdentity(spec, context);
      const key = getFeatureStorageKey(feature, identity);
      const existing = safeJsonParse(localStorage.getItem(key), null);
      const opts = options || {};
      const mutationId = opts.clientMutationId || (existing && existing.client_mutation_id) || createId('mutation');
      const envelope = {
        schema_version: STORAGE_SCHEMA_VERSION,
        feature: spec.feature,
        academy_id: identity.academyId || null,
        student_id: identity.studentId || null,
        member_id: identity.memberId || null,
        record_id: identity.recordId || null,
        file_id: identity.fileId || null,
        note_type: identity.noteType || null,
        local_record_id: identity.localRecordId || null,
        data: cloneValue(value),
        local_updated_at: opts.localUpdatedAt || nowIso(),
        client_mutation_id: mutationId,
        sync_status: opts.syncStatus || (spec.persistence === 'local_only' ? 'synced' : 'pending'),
        last_synced_at: opts.lastSyncedAt || (existing && existing.last_synced_at) || null,
        retry_count: Number(opts.retryCount != null ? opts.retryCount : ((existing && existing.retry_count) || 0))
      };
      localStorage.setItem(key, JSON.stringify(envelope));
      return cloneValue(envelope);
    },

    remove(feature, context) {
      const spec = FeatureRegistry.require(feature);
      const identity = resolveIdentity(spec, context);
      const key = getFeatureStorageKey(feature, identity);
      localStorage.removeItem(key);
      return true;
    },

    has(feature, context) {
      const spec = FeatureRegistry.require(feature);
      const identity = resolveIdentity(spec, context);
      return localStorage.getItem(getFeatureStorageKey(feature, identity)) != null;
    },

    key(feature, context) {
      const spec = FeatureRegistry.require(feature);
      return getFeatureStorageKey(feature, resolveIdentity(spec, context));
    }
  });

  const FeatureFlags = (function createFeatureFlagsModule() {
    const KEY = 'olli:v1:device:storage_feature_flags';
    function readAll() { return safeJsonParse(localStorage.getItem(KEY), {}); }
    function get(feature) {
      const all = readAll();
      return normalizeString(all[feature] || 'legacy');
    }
    function set(feature, mode) {
      const normalized = normalizeString(mode);
      if (!['legacy', 'shadow', 'common'].includes(normalized)) throw new Error(`지원하지 않는 저장 기능 모드입니다: ${mode}`);
      const all = readAll();
      all[feature] = normalized;
      localStorage.setItem(KEY, JSON.stringify(all));
      return normalized;
    }
    function list() { return cloneValue(readAll()); }
    return Object.freeze({ get, set, list, key: KEY });
  })();

  const SyncQueue = (function createSyncQueueModule() {
    function keyForAcademy(academyId) {
      return makeStorageKey({ scope: 'academy', academyId, feature: 'sync_queue', version: STORAGE_SCHEMA_VERSION });
    }
    function read(academyId) {
      const id = normalizeString(academyId);
      if (!id) return [];
      const list = safeJsonParse(localStorage.getItem(keyForAcademy(id)), []);
      return Array.isArray(list) ? list : [];
    }
    function write(academyId, items) {
      const id = normalizeString(academyId);
      if (!id) throw new Error('동기화 큐에 academyId가 없습니다.');
      localStorage.setItem(keyForAcademy(id), JSON.stringify(Array.isArray(items) ? items.slice(0, 1000) : []));
    }
    function enqueue(item, options) {
      const academyId = normalizeString(item && (item.academy_id || item.academyId));
      if (!academyId) {
        const error = new Error('동기화 큐 항목에 academy_id가 없습니다.');
        error.code = 'CONTEXT_MISSING';
        throw error;
      }
      const next = Object.assign({
        queue_id: createId('queue'),
        feature: '',
        operation: 'update',
        academy_id: academyId,
        student_id: null,
        member_id: null,
        record_id: null,
        file_id: null,
        note_type: null,
        local_record_id: null,
        client_mutation_id: createId('mutation'),
        payload: {},
        created_at: nowIso(),
        last_attempt_at: null,
        next_retry_at: null,
        retry_count: 0,
        status: 'pending',
        error_code: null,
        error_message: null,
        context_version: AcademyContext.getCurrent().contextVersion
      }, cloneValue(item));
      const list = read(academyId);
      const coalesce = !options || options.coalesce !== false;
      if (coalesce && next.operation !== 'create' && next.operation !== 'upload') {
        const index = list.findIndex(existing =>
          existing.feature === next.feature
          && existing.operation === next.operation
          && String(existing.student_id || '') === String(next.student_id || '')
          && String(existing.member_id || '') === String(next.member_id || '')
          && String(existing.record_id || '') === String(next.record_id || '')
          && String(existing.file_id || '') === String(next.file_id || '')
          && String(existing.note_type || '') === String(next.note_type || '')
          && String(existing.local_record_id || '') === String(next.local_record_id || '')
        );
        if (index >= 0) list[index] = Object.assign({}, list[index], next, { queue_id: list[index].queue_id, created_at: list[index].created_at });
        else list.push(next);
      } else {
        list.push(next);
      }
      write(academyId, list);
      return cloneValue(next);
    }
    function update(academyId, queueId, patch) {
      const list = read(academyId);
      const index = list.findIndex(item => item.queue_id === queueId);
      if (index < 0) return null;
      list[index] = Object.assign({}, list[index], cloneValue(patch || {}));
      write(academyId, list);
      return cloneValue(list[index]);
    }
    function remove(academyId, queueId) {
      const list = read(academyId).filter(item => item.queue_id !== queueId);
      write(academyId, list);
      return true;
    }
    function clear(academyId) {
      const id = normalizeString(academyId);
      if (id) localStorage.removeItem(keyForAcademy(id));
    }
    return Object.freeze({ keyForAcademy, read, write, enqueue, update, remove, clear });
  })();

  const Diagnostics = (function createDiagnosticsModule() {
    function key(academyId) {
      const id = normalizeString(academyId);
      return id
        ? makeStorageKey({ scope: 'academy', academyId: id, feature: 'storage_diagnostics' })
        : 'olli:v1:device:storage_diagnostics';
    }
    function list(academyId) {
      const items = safeJsonParse(localStorage.getItem(key(academyId)), []);
      return Array.isArray(items) ? items : [];
    }
    function record(issue) {
      const academyId = normalizeString(issue && (issue.academyId || issue.academy_id || AcademyContext.getCurrent().academyId));
      const items = list(academyId);
      items.unshift(Object.assign({
        issue_id: createId('issue'),
        feature: 'unknown',
        resource: '',
        operation: '',
        academy_id: academyId || null,
        student_id: null,
        error_code: 'UNKNOWN',
        error_message: '',
        created_at: nowIso()
      }, cloneValue(issue || {})));
      localStorage.setItem(key(academyId), JSON.stringify(items.slice(0, 500)));
      if (typeof global.recordOlliStorageIssue === 'function') {
        try {
          global.recordOlliStorageIssue({
            feature: issue && issue.feature,
            resource: issue && issue.resource,
            operation: issue && issue.operation,
            message: issue && (issue.error_message || issue.message)
          });
        } catch (_) {}
      }
      return cloneValue(items[0]);
    }
    function clear(academyId) { localStorage.removeItem(key(academyId)); }
    function registrySnapshot() {
      return FeatureRegistry.list().map(spec => ({
        feature: spec.feature,
        label: spec.label,
        scope: spec.scope,
        persistence: spec.persistence,
        table: spec.server && spec.server.table,
        requiredColumns: cloneValue(spec.server && spec.server.requiredColumns),
        serverRequired: !!(spec.diagnostics && spec.diagnostics.serverRequired),
        mode: FeatureFlags.get(spec.feature)
      }));
    }
    function snapshot(academyId) {
      return {
        foundationVersion: FOUNDATION_VERSION,
        academyId: normalizeString(academyId || AcademyContext.getCurrent().academyId),
        context: AcademyContext.getCurrent(),
        features: registrySnapshot(),
        syncQueue: SyncQueue.read(academyId || AcademyContext.getCurrent().academyId),
        issues: list(academyId || AcademyContext.getCurrent().academyId),
        createdAt: nowIso()
      };
    }
    return Object.freeze({ key, list, record, clear, registrySnapshot, snapshot });
  })();

  function classifyError(error) {
    const message = String(error && (error.message || error) || '');
    if (!navigator.onLine) return 'NETWORK_OFFLINE';
    if (/row-level security|rls/i.test(message)) return 'RLS_DENIED';
    if (/column .* does not exist|schema cache.*column/i.test(message)) return 'COLUMN_NOT_FOUND';
    if (/relation .* does not exist|table.*not found/i.test(message)) return 'TABLE_NOT_FOUND';
    if (/check constraint/i.test(message)) return 'CHECK_CONSTRAINT_FAILED';
    if (error && error.code) return error.code;
    return 'SERVER_WRITE_FAILED';
  }

  const ServerAdapter = (function createServerAdapterModule() {
    function ensureAvailable() {
      if (typeof global.isSupabaseConfigured === 'function' && !global.isSupabaseConfigured()) {
        const error = new Error('Supabase 설정이 없습니다.');
        error.code = 'SERVER_UNAVAILABLE';
        throw error;
      }
      if (typeof global.supabase !== 'function') {
        const error = new Error('Supabase 요청 함수가 없습니다.');
        error.code = 'SERVER_UNAVAILABLE';
        throw error;
      }
    }

    function resolveServerIdentityValue(column, spec, identity) {
      const camel = Object.keys(identity).find(key => normalizeServerFieldName(key) === column);
      if (camel) return identity[camel];
      if (Object.prototype.hasOwnProperty.call(identity, column)) return identity[column];
      // students.id, feedbacks.id, feedback_photos.id처럼 서버 PK가 id인 테이블은 공통 identity의 recordId/studentId/fileId로 연결합니다.
      if (column === 'id') {
        if (identity.recordId) return identity.recordId;
        if (identity.studentId) return identity.studentId;
        if (identity.fileId) return identity.fileId;
      }
      return undefined;
    }

    function identityPayload(spec, identity) {
      const payload = {};
      (spec.server.identityColumns || []).forEach(column => {
        const value = resolveServerIdentityValue(column, spec, identity);
        if (value != null && value !== '') payload[column] = value;
      });
      return payload;
    }

    function buildIdentityFilter(spec, identity) {
      return (spec.server.identityColumns || []).map(column => {
        const value = resolveServerIdentityValue(column, spec, identity);
        if (value == null || value === '') {
          const error = new Error(`${spec.label} 서버 식별값이 없습니다: ${column}`);
          error.code = 'IDENTITY_MISSING';
          throw error;
        }
        return `${column}=eq.${encodeFilterValue(value)}`;
      }).join('&');
    }

    async function read(spec, identity, options) {
      ensureAvailable();
      const select = (spec.server.selectColumns && spec.server.selectColumns.length)
        ? spec.server.selectColumns.join(',')
        : '*';
      const filter = buildIdentityFilter(spec, identity);
      const limit = options && options.limit ? Number(options.limit) : 1;
      const rows = await global.supabase('GET', `${spec.server.table}?select=${encodeURIComponent(select)}&${filter}&limit=${limit}`);
      return Array.isArray(rows) ? rows : (rows ? [rows] : []);
    }

    async function write(spec, identity, data, options) {
      ensureAvailable();
      const identityData = identityPayload(spec, identity);
      const isPlainObject = !!data && typeof data === 'object' && !Array.isArray(data);
      const source = isPlainObject ? data : null;
      const valueData = {};
      if (spec.server.valueColumns && spec.server.valueColumns.length) {
        if (spec.server.valueColumns.length === 1 && (!source || !Object.prototype.hasOwnProperty.call(source, spec.server.valueColumns[0]))) {
          valueData[spec.server.valueColumns[0]] = cloneValue(data);
        } else {
          spec.server.valueColumns.forEach(column => {
            if (source && Object.prototype.hasOwnProperty.call(source, column)) valueData[column] = cloneValue(source[column]);
          });
        }
      } else if (source) {
        Object.assign(valueData, cloneValue(source));
      }
      const payload = Object.assign({}, identityData, valueData);
      if (spec.server.addUpdatedAt !== false && spec.server.requiredColumns.includes('updated_at')) payload.updated_at = nowIso();
      const operation = normalizeString((options && options.operation) || spec.server.operation || 'patch').toLowerCase();

      if (operation === 'post' || operation === 'insert') {
        return global.supabase('POST', spec.server.table, payload);
      }
      if (operation === 'upsert') {
        const conflict = (spec.server.identityColumns || []).join(',');
        return global.supabase('POST', `${spec.server.table}?on_conflict=${encodeURIComponent(conflict)}`, payload);
      }
      if (operation === 'patch' || operation === 'update') {
        const filter = buildIdentityFilter(spec, identity);
        const patchData = Object.assign({}, valueData);
        if (Object.prototype.hasOwnProperty.call(payload, 'updated_at')) patchData.updated_at = payload.updated_at;
        let rows = await global.supabase('PATCH', `${spec.server.table}?${filter}`, patchData);
        if ((!Array.isArray(rows) || !rows.length) && spec.server.createIfMissing) {
          rows = await global.supabase('POST', spec.server.table, payload);
        }
        return rows;
      }
      throw new Error(`지원하지 않는 서버 저장 작업입니다: ${operation}`);
    }

    async function remove(spec, identity, options) {
      ensureAvailable();
      const operation = normalizeString((spec.server && spec.server.operation) || 'delete').toLowerCase();
      const protectedFeedbackDeleteFeatures = new Set([
        'general_feedbacks_by_student_delete',
        'growth_feedbacks_by_student_delete',
        'summary_feedbacks_by_student_delete'
      ]);
      if (protectedFeedbackDeleteFeatures.has(spec.feature) && operation !== 'soft_delete') {
        const error = new Error(`${spec.label}는 실제 DELETE를 사용할 수 없습니다. soft_delete만 허용됩니다.`);
        error.code = 'HARD_DELETE_BLOCKED';
        throw error;
      }
      const filter = buildIdentityFilter(spec, identity);
      if (operation === 'soft_delete') {
        const context = AcademyContext.getCurrent();
        const columns = spec.server.valueColumns || [];
        const payload = {};
        if (columns.includes('is_deleted')) payload.is_deleted = true;
        if (columns.includes('deleted_at')) payload.deleted_at = nowIso();
        if (columns.includes('deleted_by')) payload.deleted_by = normalizeString((options && options.deletedBy) || context.memberId || context.userId || localStorage.getItem('olli_current_member_id') || localStorage.getItem('olli_current_user_id') || '');
        if (columns.includes('delete_reason')) payload.delete_reason = normalizeString((options && options.reason) || 'student_deleted');
        if (!Object.keys(payload).length) {
          const error = new Error(`${spec.label} soft delete payload가 비어 있습니다.`);
          error.code = 'SERVER_WRITE_FAILED';
          throw error;
        }
        return global.supabase('PATCH', `${spec.server.table}?${filter}`, payload);
      }
      return global.supabase('DELETE', `${spec.server.table}?${filter}`);
    }

    function verifyReturnedRow(spec, identity, expectedData, rows) {
      if (!spec.verification || spec.verification.mode === 'none') return { verified: true, row: null };
      const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);
      const row = list[0];
      if (!row || typeof row !== 'object') {
        const error = new Error(`${spec.label} 요청은 전송됐지만 서버에서 저장된 행을 확인하지 못했습니다.`);
        error.code = 'SERVER_ROW_NOT_RETURNED';
        throw error;
      }
      const identityData = identityPayload(spec, identity);
      Object.keys(identityData).forEach(field => {
        if (String(row[field] == null ? '' : row[field]) !== String(identityData[field])) {
          const error = new Error(`${spec.label} 서버 식별값이 일치하지 않습니다: ${field}`);
          error.code = 'SERVER_VERIFY_FAILED';
          throw error;
        }
      });
      (spec.verification.compareFields || []).forEach(field => {
        const singleValueColumn = spec.server.valueColumns && spec.server.valueColumns.length === 1
          ? spec.server.valueColumns[0]
          : '';
        const expected = (expectedData && typeof expectedData === 'object' && !Array.isArray(expectedData) && Object.prototype.hasOwnProperty.call(expectedData, field))
          ? expectedData[field]
          : (field === singleValueColumn ? expectedData : identityData[field]);
        if (!valuesEqual(row[field], expected)) {
          const error = new Error(`${spec.label} 서버 저장값이 일치하지 않습니다: ${field}`);
          error.code = 'SERVER_VERIFY_FAILED';
          throw error;
        }
      });
      return { verified: true, row: cloneValue(row) };
    }

    async function verify(spec, identity, expectedData) {
      if (!spec.verification || spec.verification.mode === 'none') return { verified: true, row: null };
      const rows = await read(spec, identity, { limit: 1 });
      return verifyReturnedRow(spec, identity, expectedData, rows);
    }

    return Object.freeze({ ensureAvailable, read, write, remove, verify, verifyReturnedRow, buildIdentityFilter, identityPayload });
  })();

  function assertFeaturePermission(spec, action) {
    const contextRole = AcademyContext.getCurrent().role;
    let role = contextRole;
    try {
      // 다학원 전환/권한 테스트 후 AcademyContext가 오래된 role을 들고 있으면
      // 설정 저장이 실제 권한과 다르게 차단될 수 있어 최신 역할값을 우선 확인합니다.
      if (typeof global.getOlliCurrentRole === 'function') {
        const latestRole = normalizeRole(global.getOlliCurrentRole());
        if (latestRole) role = latestRole;
      } else {
        const latestRole = normalizeRole(localStorage.getItem('olli_current_member_role') || '');
        if (latestRole) role = latestRole;
      }
    } catch (_) {}
    const allowed = spec.permissions && spec.permissions[action];
    if (Array.isArray(allowed) && !allowed.includes(role) && !(role === 'super_admin')) {
      const error = new Error(`${spec.label} ${action === 'write' ? '저장' : '조회'} 권한이 없습니다. 현재 역할: ${role || 'unknown'}`);
      error.code = 'PERMISSION_DENIED';
      throw error;
    }
  }

  const AppDataService = (function createAppDataServiceModule() {
    function clearMatchingQueue(spec, identity) {
      if (!identity.academyId) return;
      const current = SyncQueue.read(identity.academyId);
      const filtered = current.filter(item => !(
        item.feature === spec.feature
        && String(item.student_id || '') === String(identity.studentId || '')
        && String(item.member_id || '') === String(identity.memberId || '')
        && String(item.record_id || '') === String(identity.recordId || '')
      ));
      if (filtered.length !== current.length) SyncQueue.write(identity.academyId, filtered);
    }

    async function save(feature, input) {
      const spec = FeatureRegistry.require(feature);
      const data = input || {};
      const mode = FeatureFlags.get(feature);
      if (mode === 'legacy' && !data.forceCommon) {
        return { ok: false, skipped: true, reason: 'FEATURE_FLAG_LEGACY', feature: spec.feature };
      }
      assertFeaturePermission(spec, 'write');
      const identity = resolveIdentity(spec, data);
      const token = AcademyContext.captureToken();
      const clientMutationId = data.clientMutationId || createId('mutation');
      const payload = cloneValue(data.data);
      const localEnvelope = spec.local.enabled
        ? LocalStore.write(feature, identity, payload, { clientMutationId, syncStatus: spec.persistence === 'local_only' ? 'synced' : 'pending' })
        : null;

      if (spec.persistence === 'local_only') {
        return { ok: true, localSaved: true, serverSaved: false, verified: true, pending: false, feature: spec.feature, clientMutationId };
      }

      try {
        const rows = await ServerAdapter.write(spec, identity, payload, data.serverOptions);
        if (!AcademyContext.isTokenCurrent(token)) {
          const error = new Error('이전 학원의 늦은 서버 응답입니다.');
          error.code = 'STALE_ACADEMY_RESPONSE';
          throw error;
        }
        const verified = (spec.verification && spec.verification.mode === 'custom_returned_row')
          ? ServerAdapter.verifyReturnedRow(spec, identity, payload || {}, rows)
          : await ServerAdapter.verify(spec, identity, payload || {});
        clearMatchingQueue(spec, identity);
        if (spec.local.enabled) {
          const syncedPayload = (spec.verification && spec.verification.mode === 'custom_returned_row' && verified && verified.row && payload && typeof payload === 'object' && !Array.isArray(payload))
            ? Object.assign({}, payload, verified.row)
            : payload;
          LocalStore.write(feature, identity, syncedPayload, {
            clientMutationId,
            syncStatus: 'synced',
            lastSyncedAt: nowIso(),
            retryCount: 0,
            localUpdatedAt: localEnvelope && localEnvelope.local_updated_at
          });
        }
        return {
          ok: true,
          localSaved: !!spec.local.enabled,
          serverSaved: true,
          verified: true,
          pending: false,
          feature: spec.feature,
          academyId: identity.academyId || null,
          studentId: identity.studentId || null,
          recordId: identity.recordId || null,
          serverRows: cloneValue(rows),
          serverRow: verified.row,
          clientMutationId
        };
      } catch (error) {
        const errorCode = classifyError(error);
        if (!data.suppressQueue) SyncQueue.enqueue({
          feature: spec.feature,
          operation: (spec.server && spec.server.operation) || 'update',
          academy_id: identity.academyId,
          student_id: identity.studentId || null,
          member_id: identity.memberId || null,
          record_id: identity.recordId || null,
          file_id: identity.fileId || null,
          note_type: identity.noteType || null,
          local_record_id: identity.localRecordId || null,
          client_mutation_id: clientMutationId,
          payload,
          status: ['TABLE_NOT_FOUND', 'COLUMN_NOT_FOUND', 'PERMISSION_DENIED', 'RLS_DENIED', 'CHECK_CONSTRAINT_FAILED'].includes(errorCode) ? 'blocked' : 'pending',
          error_code: errorCode,
          error_message: String(error && (error.message || error) || ''),
          context_version: token.contextVersion
        }, { coalesce: spec.persistence !== 'append_only_server' });
        Diagnostics.record({
          feature: spec.feature,
          resource: spec.server && spec.server.table,
          operation: 'save',
          academy_id: identity.academyId || null,
          student_id: identity.studentId || null,
          error_code: errorCode,
          error_message: String(error && (error.message || error) || '')
        });
        return {
          ok: !!spec.local.enabled,
          localSaved: !!spec.local.enabled,
          serverSaved: false,
          verified: false,
          pending: true,
          queued: true,
          feature: spec.feature,
          academyId: identity.academyId || null,
          studentId: identity.studentId || null,
          recordId: identity.recordId || null,
          clientMutationId,
          errorCode,
          error: error
        };
      }
    }

    function load(feature, input) {
      const spec = FeatureRegistry.require(feature);
      const data = input || {};
      assertFeaturePermission(spec, 'read');
      const identity = resolveIdentity(spec, data);
      const token = AcademyContext.captureToken();
      const localEnvelope = spec.local.enabled ? LocalStore.read(feature, identity, { rawEnvelope: true, fallback: null }) : null;
      const localData = localEnvelope && Object.prototype.hasOwnProperty.call(localEnvelope, 'data') ? cloneValue(localEnvelope.data) : cloneValue(localEnvelope);

      const refreshPromise = (async () => {
        if (spec.persistence === 'local_only' || data.backgroundRefresh === false) return { refreshed: false, reason: 'LOCAL_ONLY_OR_DISABLED' };
        try {
          const rows = await ServerAdapter.read(spec, identity, { limit: data.limit || 1 });
          if (!AcademyContext.isTokenCurrent(token)) return { refreshed: false, stale: true, errorCode: 'STALE_ACADEMY_RESPONSE' };
          const row = rows[0] || null;
          if (!row) return { refreshed: false, row: null };
          const pending = localEnvelope && localEnvelope.sync_status === 'pending';
          if (pending && spec.conflict.protectPendingLocal) {
            const localTime = Date.parse(localEnvelope.local_updated_at || '') || 0;
            const serverTime = Date.parse(row.updated_at || '') || 0;
            if (!serverTime || localTime >= serverTime) {
              return { refreshed: false, protectedPending: true, row };
            }
            clearMatchingQueue(spec, identity);
          }
          const serverData = {};
          (spec.server.valueColumns || []).forEach(column => { serverData[column] = cloneValue(row[column]); });
          const normalizedServerData = (spec.server.valueColumns || []).length === 1
            ? serverData[spec.server.valueColumns[0]]
            : serverData;
          if (spec.local.enabled && !valuesEqual(localData, normalizedServerData)) {
            LocalStore.write(feature, identity, normalizedServerData, { syncStatus: 'synced', lastSyncedAt: nowIso(), retryCount: 0 });
          }
          return { refreshed: true, changed: !valuesEqual(localData, normalizedServerData), data: cloneValue(normalizedServerData), row: cloneValue(row) };
        } catch (error) {
          Diagnostics.record({
            feature: spec.feature,
            resource: spec.server && spec.server.table,
            operation: 'load',
            academy_id: identity.academyId || null,
            student_id: identity.studentId || null,
            error_code: classifyError(error),
            error_message: String(error && (error.message || error) || '')
          });
          return { refreshed: false, error, errorCode: classifyError(error) };
        }
      })();

      return { feature: spec.feature, localData, localEnvelope: cloneValue(localEnvelope), refreshPromise };
    }

    async function remove(feature, input) {
      const spec = FeatureRegistry.require(feature);
      const data = input || {};
      assertFeaturePermission(spec, 'write');
      const identity = resolveIdentity(spec, data);
      const token = AcademyContext.captureToken();
      try {
        const rows = spec.persistence === 'local_only' ? [] : await ServerAdapter.remove(spec, identity, data);
        if (!AcademyContext.isTokenCurrent(token)) {
          const error = new Error('이전 학원의 늦은 삭제 응답입니다.');
          error.code = 'STALE_ACADEMY_RESPONSE';
          throw error;
        }
        if (spec.local.enabled) LocalStore.remove(feature, identity);
        return { ok: true, deleted: true, feature: spec.feature, rows: cloneValue(rows) };
      } catch (error) {
        const errorCode = classifyError(error);
        if (identity.academyId && !data.suppressQueue) {
          SyncQueue.enqueue({
            feature: spec.feature,
            operation: normalizeString((spec.server && spec.server.operation) || 'delete') || 'delete',
            academy_id: identity.academyId,
            student_id: identity.studentId || null,
            member_id: identity.memberId || null,
            record_id: identity.recordId || null,
            file_id: identity.fileId || null,
            note_type: identity.noteType || null,
            local_record_id: identity.localRecordId || null,
            payload: { deleteMode: data.deleteMode || 'soft', reason: data.reason || '' },
            error_code: errorCode,
            error_message: String(error && (error.message || error) || '')
          }, { coalesce: true });
        }
        Diagnostics.record({
          feature: spec.feature,
          resource: spec.server && spec.server.table,
          operation: 'delete',
          academy_id: identity.academyId || null,
          student_id: identity.studentId || null,
          error_code: errorCode,
          error_message: String(error && (error.message || error) || '')
        });
        return { ok: false, deleted: false, pending: true, feature: spec.feature, errorCode, error };
      }
    }

    return Object.freeze({ save, load, remove });
  })();

  const MigrationManager = (function createMigrationManagerModule() {
    const migrations = new Map();
    function register(feature, migrateFunction) {
      if (!FeatureRegistry.has(feature)) throw new Error(`이관할 기능이 등록되지 않았습니다: ${feature}`);
      if (typeof migrateFunction !== 'function') throw new TypeError('이관 함수가 필요합니다.');
      migrations.set(feature, migrateFunction);
    }
    function preview(feature, context) {
      const spec = FeatureRegistry.require(feature);
      const identity = resolveIdentity(spec, context || {});
      const targetExists = spec.local.enabled ? LocalStore.has(feature, identity) : false;
      const legacy = (spec.local.legacyKeys || []).map(key => ({ key, exists: localStorage.getItem(key) != null }));
      return { feature, identity, targetExists, legacy };
    }
    async function run(feature, context, options) {
      const migration = migrations.get(feature);
      if (!migration) throw new Error(`등록된 이관 함수가 없습니다: ${feature}`);
      return migration({
        feature: FeatureRegistry.require(feature),
        identity: resolveIdentity(FeatureRegistry.require(feature), context || {}),
        options: cloneValue(options || {}),
        LocalStore,
        Diagnostics
      });
    }
    function list() { return Array.from(migrations.keys()); }
    return Object.freeze({ register, preview, run, list });
  })();

  // 공통 저장 명세를 등록합니다. 상담기준은 7단계에서 이 명세를 실제 사용합니다.
  FeatureRegistry.register({
    feature: 'consultation_rules',
    label: '상담기준',
    version: 1,
    scope: 'academy',
    persistence: 'server_source',
    local: {
      enabled: true,
      defaultValue: ['after_1', 'after_3', 'every_6', 'every_12'],
      legacyKeys: ['olli_consultation_rules_v1', 'olli_consultation_months_v1'],
      migrationPolicy: 'only_when_target_empty'
    },
    server: {
      kind: 'table_row',
      table: 'academy_settings',
      operation: 'patch',
      createIfMissing: true,
      identityColumns: ['academy_id'],
      valueColumns: ['consultation_rules'],
      requiredColumns: ['academy_id', 'consultation_rules', 'updated_at'],
      selectColumns: ['academy_id', 'consultation_rules', 'updated_at']
    },
    verification: { mode: 'read_after_write', compareFields: ['academy_id', 'consultation_rules'] },
    conflict: { policy: 'latest_valid_update', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });


  FeatureRegistry.register({
    feature: 'consultation_progress',
    label: '상담 진행상태',
    version: 1,
    scope: 'academy',
    persistence: 'server_source',
    local: {
      enabled: true,
      defaultValue: { version: 1, tracking_started_month: '', completed: {} },
      legacyKeys: [],
      migrationPolicy: 'only_when_target_empty'
    },
    server: {
      kind: 'table_row',
      table: 'academy_settings',
      operation: 'patch',
      createIfMissing: true,
      identityColumns: ['academy_id'],
      valueColumns: ['consultation_progress'],
      requiredColumns: ['academy_id', 'consultation_progress', 'updated_at'],
      selectColumns: ['academy_id', 'consultation_progress', 'updated_at']
    },
    verification: { mode: 'read_after_write', compareFields: ['academy_id', 'consultation_progress'] },
    conflict: { policy: 'latest_valid_update', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner', 'super_admin'], write: ['manager', 'owner', 'super_admin'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });

  FeatureRegistry.register({
    feature: 'elementary_group_feedback_months',
    label: '그룹별 피드백 발송월',
    version: 1,
    scope: 'academy',
    persistence: 'server_source',
    local: {
      enabled: true,
      defaultValue: {},
      legacyKeys: ['olli_elementary_group_feedback_months_v1'],
      migrationPolicy: 'only_when_target_empty'
    },
    server: {
      kind: 'table_row',
      table: 'academy_settings',
      operation: 'patch',
      createIfMissing: true,
      identityColumns: ['academy_id'],
      valueColumns: ['elementary_group_feedback_months'],
      requiredColumns: ['academy_id', 'elementary_group_feedback_months', 'updated_at'],
      selectColumns: ['academy_id', 'elementary_group_feedback_months', 'updated_at']
    },
    verification: { mode: 'read_after_write', compareFields: ['academy_id', 'elementary_group_feedback_months'] },
    conflict: { policy: 'latest_valid_update', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });


  FeatureRegistry.register({
    feature: 'general_feedback',
    label: '일반 피드백',
    version: 1,
    scope: 'record',
    persistence: 'append_only_server',
    local: {
      enabled: true,
      defaultValue: null,
      legacyKeys: [],
      migrationPolicy: 'manual'
    },
    server: {
      kind: 'table_row',
      table: 'feedbacks',
      operation: 'post',
      createIfMissing: false,
      identityColumns: ['academy_id', 'student_id'],
      valueColumns: ['student_name', 'content', 'feedback_type', 'future_direction', 'year', 'date', 'feedback_month', 'feedback_month_number'],
      requiredColumns: ['academy_id', 'student_id', 'student_name', 'content'],
      selectColumns: ['id', 'academy_id', 'student_id', 'student_name', 'content', 'feedback_type', 'future_direction', 'year', 'date', 'created_at']
    },
    verification: { mode: 'custom_returned_row', compareFields: ['academy_id', 'student_id', 'content'] },
    conflict: { policy: 'append_only', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['teacher', 'manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });

  FeatureRegistry.register({
    feature: 'growth_feedback',
    label: '성장 피드백',
    version: 1,
    scope: 'record',
    persistence: 'append_only_server',
    local: {
      enabled: true,
      defaultValue: null,
      legacyKeys: [],
      migrationPolicy: 'manual'
    },
    server: {
      kind: 'table_row',
      table: 'fail_feedbacks',
      operation: 'post',
      createIfMissing: false,
      identityColumns: ['academy_id', 'student_id'],
      valueColumns: ['student_name', 'content', 'feedback_type', 'year', 'date'],
      requiredColumns: ['academy_id', 'student_id', 'student_name', 'content'],
      selectColumns: ['id', 'academy_id', 'student_id', 'student_name', 'content', 'feedback_type', 'year', 'date', 'created_at']
    },
    verification: { mode: 'custom_returned_row', compareFields: ['academy_id', 'student_id', 'content'] },
    conflict: { policy: 'append_only', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['teacher', 'manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });

  FeatureRegistry.register({
    feature: 'summary_feedback',
    label: '종합 피드백',
    version: 1,
    scope: 'record',
    persistence: 'append_only_server',
    local: {
      enabled: true,
      defaultValue: null,
      legacyKeys: [],
      migrationPolicy: 'manual'
    },
    server: {
      kind: 'table_row',
      table: 'summary_feedbacks',
      operation: 'post',
      createIfMissing: false,
      identityColumns: ['academy_id', 'student_id'],
      valueColumns: ['student_name', 'content', 'summary_months', 'year', 'date'],
      requiredColumns: ['academy_id', 'student_id', 'student_name', 'content'],
      selectColumns: ['id', 'academy_id', 'student_id', 'student_name', 'content', 'summary_months', 'year', 'date', 'created_at']
    },
    verification: { mode: 'custom_returned_row', compareFields: ['academy_id', 'student_id', 'content'] },
    conflict: { policy: 'append_only', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['teacher', 'manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });

  FeatureRegistry.register({
    feature: 'general_feedback_edit',
    label: '일반 피드백 수정',
    version: 1,
    scope: 'record',
    identity: { requiresAcademyId: true, requiresStudentId: true, requiresRecordId: true },
    persistence: 'server_source',
    local: { enabled: true, defaultValue: null, legacyKeys: [], migrationPolicy: 'manual' },
    server: {
      kind: 'table_row',
      table: 'feedbacks',
      operation: 'patch',
      createIfMissing: false,
      identityColumns: ['academy_id', 'id'],
      valueColumns: ['content', 'updated_at'],
      requiredColumns: ['academy_id', 'id', 'content'],
      selectColumns: ['id', 'academy_id', 'student_id', 'student_name', 'content', 'feedback_type', 'future_direction', 'year', 'date', 'created_at', 'updated_at']
    },
    verification: { mode: 'custom_returned_row', compareFields: ['content'] },
    conflict: { policy: 'latest_valid_update', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['teacher', 'manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });

  FeatureRegistry.register({
    feature: 'growth_feedback_edit',
    label: '성장 피드백 수정',
    version: 1,
    scope: 'record',
    identity: { requiresAcademyId: true, requiresStudentId: true, requiresRecordId: true },
    persistence: 'server_source',
    local: { enabled: true, defaultValue: null, legacyKeys: [], migrationPolicy: 'manual' },
    server: {
      kind: 'table_row',
      table: 'fail_feedbacks',
      operation: 'patch',
      createIfMissing: false,
      identityColumns: ['academy_id', 'id'],
      valueColumns: ['content', 'updated_at'],
      requiredColumns: ['academy_id', 'id', 'content'],
      selectColumns: ['id', 'academy_id', 'student_id', 'student_name', 'content', 'feedback_type', 'year', 'date', 'created_at', 'updated_at']
    },
    verification: { mode: 'custom_returned_row', compareFields: ['content'] },
    conflict: { policy: 'latest_valid_update', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['teacher', 'manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });

  FeatureRegistry.register({
    feature: 'summary_feedback_edit',
    label: '종합 피드백 수정',
    version: 1,
    scope: 'record',
    identity: { requiresAcademyId: true, requiresStudentId: true, requiresRecordId: true },
    persistence: 'server_source',
    local: { enabled: true, defaultValue: null, legacyKeys: [], migrationPolicy: 'manual' },
    server: {
      kind: 'table_row',
      table: 'summary_feedbacks',
      operation: 'patch',
      createIfMissing: false,
      identityColumns: ['academy_id', 'id'],
      valueColumns: ['content', 'updated_at'],
      requiredColumns: ['academy_id', 'id', 'content'],
      selectColumns: ['id', 'academy_id', 'student_id', 'student_name', 'content', 'summary_months', 'year', 'date', 'created_at', 'updated_at']
    },
    verification: { mode: 'custom_returned_row', compareFields: ['content'] },
    conflict: { policy: 'latest_valid_update', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['teacher', 'manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });


  FeatureRegistry.register({
    feature: 'summary_feedback_by_id_delete',
    label: '종합 피드백 개별 삭제',
    version: 1,
    scope: 'record',
    identity: { requiresAcademyId: true, requiresRecordId: true },
    persistence: 'server_source',
    local: { enabled: false, defaultValue: null, legacyKeys: [], migrationPolicy: 'manual' },
    server: {
      kind: 'table_row',
      table: 'summary_feedbacks',
      operation: 'soft_delete',
      createIfMissing: false,
      identityColumns: ['academy_id', 'id'],
      valueColumns: ['is_deleted', 'deleted_at', 'deleted_by', 'delete_reason'],
      requiredColumns: ['academy_id', 'id', 'is_deleted'],
      selectColumns: ['id', 'academy_id', 'student_id', 'is_deleted', 'deleted_at', 'deleted_by', 'delete_reason']
    },
    verification: { mode: 'none', compareFields: [] },
    conflict: { policy: 'delete_with_queue', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['teacher', 'manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });

  FeatureRegistry.register({
    feature: 'student_profile',
    label: '학생정보',
    version: 1,
    scope: 'student',
    identity: { requiresAcademyId: true, requiresStudentId: true },
    persistence: 'server_source',
    local: {
      enabled: true,
      defaultValue: null,
      legacyKeys: [],
      migrationPolicy: 'manual'
    },
    server: {
      kind: 'table_row',
      table: 'students',
      operation: 'upsert',
      createIfMissing: true,
      identityColumns: ['id'],
      valueColumns: ['academy_id', 'academy_name', 'academy_region', 'name', 'division', 'enrolled_at', 'kindergarten', 'age', 'lesson_day', 'lesson_time', 'group_no', 'group_months', 'feedback_months', 'personality', 'school', 'grade', 'class_no', 'teacher', 'homeroom_teacher', 'status', 'withdrawn_at', 'paused_at', 'status_changed_at'],
      requiredColumns: ['id', 'academy_id', 'name'],
      selectColumns: ['id', 'academy_id', 'academy_name', 'academy_region', 'name', 'division', 'enrolled_at', 'kindergarten', 'age', 'lesson_day', 'lesson_time', 'group_no', 'group_months', 'feedback_months', 'personality', 'school', 'grade', 'class_no', 'teacher', 'homeroom_teacher', 'status', 'withdrawn_at', 'paused_at', 'status_changed_at', 'updated_at']
    },
    verification: { mode: 'custom_returned_row', compareFields: ['id', 'academy_id', 'name'] },
    conflict: { policy: 'latest_valid_update', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['teacher', 'manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });

  FeatureRegistry.register({
    feature: 'student_status',
    label: '학생 상태',
    version: 1,
    scope: 'student',
    identity: { requiresAcademyId: true, requiresStudentId: true },
    persistence: 'server_source',
    local: {
      enabled: true,
      defaultValue: null,
      legacyKeys: [],
      migrationPolicy: 'manual'
    },
    server: {
      kind: 'table_row',
      table: 'students',
      operation: 'patch',
      createIfMissing: false,
      identityColumns: ['academy_id', 'id'],
      valueColumns: ['status', 'withdrawn_at', 'paused_at', 'status_changed_at'],
      requiredColumns: ['academy_id', 'id', 'status'],
      selectColumns: ['id', 'academy_id', 'status', 'withdrawn_at', 'paused_at', 'status_changed_at', 'updated_at']
    },
    verification: { mode: 'custom_returned_row', compareFields: ['academy_id', 'id', 'status'] },
    conflict: { policy: 'latest_valid_update', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['teacher', 'manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });

  FeatureRegistry.register({
    feature: 'student_soft_delete',
    label: '학생 삭제/삭제함 이동',
    version: 2,
    scope: 'student',
    identity: { requiresAcademyId: true, requiresStudentId: true },
    persistence: 'server_source',
    local: {
      enabled: true,
      defaultValue: null,
      legacyKeys: [],
      migrationPolicy: 'manual'
    },
    server: {
      kind: 'table_row',
      table: 'students',
      operation: 'patch',
      createIfMissing: false,
      identityColumns: ['academy_id', 'id'],
      valueColumns: ['is_deleted', 'deleted_at', 'deleted_by', 'delete_reason'],
      requiredColumns: ['academy_id', 'id', 'is_deleted'],
      selectColumns: ['id', 'academy_id', 'is_deleted', 'deleted_at', 'deleted_by', 'delete_reason', 'status', 'status_changed_at', 'updated_at']
    },
    verification: { mode: 'read_after_write', compareFields: ['academy_id', 'id', 'is_deleted'] },
    conflict: { policy: 'latest_valid_update', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['teacher', 'manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });

  FeatureRegistry.register({
    feature: 'general_feedbacks_by_student_delete',
    label: '일반 피드백 학생별 삭제',
    version: 1,
    scope: 'student',
    identity: { requiresAcademyId: true, requiresStudentId: true },
    persistence: 'server_source',
    local: { enabled: false, defaultValue: null, legacyKeys: [], migrationPolicy: 'manual' },
    server: {
      kind: 'table_rows',
      table: 'feedbacks',
      operation: 'soft_delete',
      createIfMissing: false,
      identityColumns: ['academy_id', 'student_id'],
      valueColumns: ['is_deleted', 'deleted_at', 'deleted_by', 'delete_reason'],
      requiredColumns: ['academy_id', 'student_id', 'is_deleted'],
      selectColumns: ['id', 'academy_id', 'student_id', 'is_deleted', 'deleted_at', 'deleted_by', 'delete_reason']
    },
    verification: { mode: 'none', compareFields: [] },
    conflict: { policy: 'delete_with_queue', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });

  FeatureRegistry.register({
    feature: 'growth_feedbacks_by_student_delete',
    label: '성장 피드백 학생별 삭제',
    version: 1,
    scope: 'student',
    identity: { requiresAcademyId: true, requiresStudentId: true },
    persistence: 'server_source',
    local: { enabled: false, defaultValue: null, legacyKeys: [], migrationPolicy: 'manual' },
    server: {
      kind: 'table_rows',
      table: 'fail_feedbacks',
      operation: 'soft_delete',
      createIfMissing: false,
      identityColumns: ['academy_id', 'student_id'],
      valueColumns: ['is_deleted', 'deleted_at', 'deleted_by', 'delete_reason'],
      requiredColumns: ['academy_id', 'student_id', 'is_deleted'],
      selectColumns: ['id', 'academy_id', 'student_id', 'is_deleted', 'deleted_at', 'deleted_by', 'delete_reason']
    },
    verification: { mode: 'none', compareFields: [] },
    conflict: { policy: 'delete_with_queue', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });

  FeatureRegistry.register({
    feature: 'summary_feedbacks_by_student_delete',
    label: '종합 피드백 학생별 삭제',
    version: 1,
    scope: 'student',
    identity: { requiresAcademyId: true, requiresStudentId: true },
    persistence: 'server_source',
    local: { enabled: false, defaultValue: null, legacyKeys: [], migrationPolicy: 'manual' },
    server: {
      kind: 'table_rows',
      table: 'summary_feedbacks',
      operation: 'soft_delete',
      createIfMissing: false,
      identityColumns: ['academy_id', 'student_id'],
      valueColumns: ['is_deleted', 'deleted_at', 'deleted_by', 'delete_reason'],
      requiredColumns: ['academy_id', 'student_id', 'is_deleted'],
      selectColumns: ['id', 'academy_id', 'student_id', 'is_deleted', 'deleted_at', 'deleted_by', 'delete_reason']
    },
    verification: { mode: 'none', compareFields: [] },
    conflict: { policy: 'delete_with_queue', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });


  FeatureRegistry.register({
    feature: 'feedback_photo',
    label: '수업사진',
    version: 1,
    scope: 'academy',
    identity: { requiresAcademyId: true, requiresFileId: true },
    persistence: 'two_phase_file',
    local: {
      enabled: true,
      defaultValue: null,
      legacyKeys: [],
      migrationPolicy: 'manual',
      key(identity) {
        return makeStorageKey({ scope: 'academy', academyId: identity.academyId, feature: `feedback_photo:${identity.fileId}`, version: 1 });
      }
    },
    server: {
      kind: 'storage_object_with_table_row',
      table: 'feedback_photos',
      operation: 'post',
      createIfMissing: false,
      identityColumns: ['academy_id', 'id'],
      valueColumns: ['id', 'student_id', 'student_name', 'feedback_job_id', 'image_path', 'thumbnail_path', 'image_url', 'thumbnail_url', 'image_width', 'image_height', 'file_size', 'mime_type', 'month_key', 'image_order', 'is_deleted', 'deleted_at', 'deleted_by', 'delete_reason', 'updated_at'],
      requiredColumns: ['id', 'academy_id', 'image_path', 'thumbnail_path', 'month_key'],
      selectColumns: ['id', 'academy_id', 'student_id', 'image_path', 'thumbnail_path', 'image_url', 'thumbnail_url', 'month_key', 'is_deleted', 'created_at', 'updated_at']
    },
    verification: { mode: 'custom_returned_row', compareFields: ['academy_id', 'id', 'image_path', 'thumbnail_path'] },
    conflict: { policy: 'file_then_metadata', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['teacher', 'manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true, storageRequired: true }
  });


  FeatureRegistry.register({
    feature: 'feedback_photo_student_link',
    label: '수업사진 학생 연결',
    version: 1,
    scope: 'academy',
    identity: { requiresAcademyId: true, requiresFileId: true },
    persistence: 'server_source',
    local: {
      enabled: false,
      defaultValue: null,
      legacyKeys: [],
      migrationPolicy: 'manual'
    },
    server: {
      kind: 'table_row',
      table: 'feedback_photos',
      operation: 'patch',
      createIfMissing: false,
      identityColumns: ['academy_id', 'id'],
      valueColumns: ['student_id', 'updated_at'],
      requiredColumns: ['academy_id', 'id', 'student_id'],
      selectColumns: ['id', 'academy_id', 'student_id', 'image_path', 'thumbnail_path', 'image_url', 'thumbnail_url', 'month_key', 'is_deleted', 'updated_at']
    },
    verification: { mode: 'custom_returned_row', compareFields: ['academy_id', 'id', 'student_id'] },
    conflict: { policy: 'latest_valid_update', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['teacher', 'manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true, storageRequired: true }
  });


  FeatureRegistry.register({
    feature: 'student_note_draft',
    label: '관찰노트 초안',
    version: 1,
    scope: 'student',
    identity: { requiresAcademyId: true, requiresStudentId: true, requiresNoteType: true },
    persistence: 'server_source',
    local: {
      enabled: true,
      defaultValue: null,
      legacyKeys: [],
      migrationPolicy: 'manual',
      key(identity) {
        return makeStorageKey({
          scope: 'student',
          academyId: identity.academyId,
          studentId: identity.studentId,
          feature: `student_note_draft:${identity.noteType || 'note'}`,
          version: 1
        });
      }
    },
    server: {
      kind: 'table_row',
      table: 'student_note_drafts',
      operation: 'patch',
      createIfMissing: true,
      identityColumns: ['academy_id', 'student_id', 'note_type'],
      valueColumns: ['student_name', 'content', 'updated_at'],
      requiredColumns: ['academy_id', 'student_id', 'note_type', 'content', 'updated_at'],
      selectColumns: ['academy_id', 'student_id', 'student_name', 'note_type', 'content', 'updated_at']
    },
    verification: { mode: 'read_after_write', compareFields: ['academy_id', 'student_id', 'note_type', 'content'] },
    conflict: { policy: 'latest_valid_update', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['teacher', 'manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });

  FeatureRegistry.register({
    feature: 'student_note_archive',
    label: '관찰노트 기록 보관',
    version: 1,
    scope: 'record',
    identity: { requiresAcademyId: true, requiresStudentId: true, requiresLocalRecordId: true },
    persistence: 'append_only_server',
    local: {
      enabled: true,
      defaultValue: null,
      legacyKeys: [],
      migrationPolicy: 'manual',
      key(identity) {
        return makeStorageKey({
          scope: 'record',
          academyId: identity.academyId,
          studentId: identity.studentId,
          recordId: identity.localRecordId,
          feature: 'student_note_archive',
          version: 1
        });
      }
    },
    server: {
      kind: 'table_row',
      table: 'student_note_archives',
      operation: 'upsert',
      createIfMissing: false,
      identityColumns: ['academy_id', 'student_id', 'local_record_id'],
      valueColumns: ['student_name', 'note_type', 'content', 'analysis', 'record_label', 'feedback_id', 'year', 'month', 'day', 'created_at'],
      requiredColumns: ['academy_id', 'student_id', 'local_record_id', 'content'],
      selectColumns: ['academy_id', 'student_id', 'student_name', 'note_type', 'content', 'analysis', 'record_label', 'local_record_id', 'feedback_id', 'year', 'month', 'day', 'created_at']
    },
    verification: { mode: 'custom_returned_row', compareFields: ['academy_id', 'student_id', 'local_record_id', 'content'] },
    conflict: { policy: 'append_only', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['teacher', 'manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });


  FeatureRegistry.register({
    feature: 'member_default_start_page',
    label: '멤버 시작 페이지 설정',
    version: 1,
    scope: 'member',
    identity: { requiresAcademyId: true, requiresRecordId: true, requiresMemberId: true },
    persistence: 'server_source',
    local: {
      enabled: true,
      defaultValue: null,
      legacyKeys: [],
      migrationPolicy: 'manual',
      key(identity) {
        return makeStorageKey({
          scope: 'member',
          academyId: identity.academyId,
          memberId: identity.memberId,
          feature: 'member_default_start_page',
          version: 1
        });
      }
    },
    server: {
      kind: 'table_row',
      table: 'academy_members',
      operation: 'patch',
      createIfMissing: false,
      identityColumns: ['academy_id', 'id'],
      valueColumns: ['default_start_page', 'updated_at'],
      requiredColumns: ['academy_id', 'id', 'default_start_page'],
      selectColumns: ['id', 'academy_id', 'default_start_page', 'updated_at']
    },
    verification: { mode: 'custom_returned_row', compareFields: ['academy_id', 'id', 'default_start_page'] },
    conflict: { policy: 'latest_valid_update', protectPendingLocal: true },
    permissions: { read: ['teacher', 'manager', 'owner'], write: ['teacher', 'manager', 'owner'] },
    diagnostics: { serverRequired: true, adminVisible: true }
  });


  const Core = {
    foundationVersion: FOUNDATION_VERSION,
    schemaVersion: STORAGE_SCHEMA_VERSION,
    AcademyContext,
    FeatureRegistry,
    LocalStore,
    FeatureFlags,
    SyncQueue,
    ServerAdapter,
    AppDataService,
    MigrationManager,
    Diagnostics,
    utilities: Object.freeze({ nowIso, cloneValue, createId, valuesEqual, classifyError, resolveIdentity, makeStorageKey })
  };

  global.OlliStorageCore = Object.freeze(Core);

  // 5단계에서 확정한 공개 함수명. 기존 코드와 연결하지 않았으므로 현재 동작에는 영향이 없습니다.
  global.registerOlliDataFeature = FeatureRegistry.register;
  global.getCurrentAcademyContext = AcademyContext.getCurrent;
  global.requireAcademyContext = AcademyContext.requireCurrent;
  global.setCurrentAcademyContext = AcademyContext.setCurrent;
  global.clearCurrentAcademyRuntime = AcademyContext.clearRuntime;
  global.getAccessibleAcademies = AcademyContext.getAccessible;
  global.canCurrentMember = AcademyContext.can;
  global.makeOlliStorageKey = makeStorageKey;
  global.readOlliLocal = LocalStore.read;
  global.writeOlliLocal = LocalStore.write;
  global.removeOlliLocal = LocalStore.remove;
  global.hasOlliLocal = LocalStore.has;
  global.saveOlliData = AppDataService.save;
  global.loadOlliData = AppDataService.load;
  global.deleteOlliData = AppDataService.remove;
})(window);
