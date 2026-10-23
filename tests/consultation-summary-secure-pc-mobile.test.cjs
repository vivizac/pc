const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const files = {
  pc: fs.readFileSync(path.join(root, 'apps/pc/olli-data-consultation-summary.js'), 'utf8'),
  mobile: fs.readFileSync(path.join(root, 'apps/mobile/olli-student-core.js'), 'utf8'),
  mobileSheet: fs.readFileSync(path.join(root, 'apps/mobile/olli-data-attendance-feedback.js'), 'utf8'),
  archive: fs.readFileSync(path.join(root, 'apps/mobile/elementary-analysis-phone-adapter.js'), 'utf8'),
  picker: fs.readFileSync(path.join(root, 'apps/mobile/olli-record-student-picker-phone-adapter.js'), 'utf8'),
  mobileCss: fs.readFileSync(path.join(root, 'apps/mobile/olli-phone-base.css'), 'utf8'),
  pcUi: fs.readFileSync(path.join(root, 'apps/pc/pc-student-management.js'), 'utf8'),
};

function section(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, 'could not extract ' + from);
  return src.slice(a, b);
}
function evaluate(src, functionName, scope = {}) {
  return vm.runInNewContext(src + '\n' + functionName, { Date, Set, Map, Promise, console, ...scope });
}

for (const app of ['pc', 'mobile']) {
  test(app + ': consultation material uses available growth records, not every scheduled-month slot', async () => {
    const code = section(files[app], 'async function prepareConsultationFeedbackMaterial(', 'function normalizeConsultationSummaryFeedbackRows(');
    let rows = [], slotCount = 0;
    const scope = {
      getConsultationSummaryMonthsFromLabels: () => 12,
      getConsultationFeedbackMaterialMode: () => 'elementary_summary_slots',
      getConsultationMaterialContext: () => ({ start: new Date('2025-10-01'), end: new Date('2026-10-23') }),
      loadConsultationSummaryFeedbackRows: async (_student, _months, options) => {
        assert.equal(options.sourceTables[0], 'feedbacks');
        return rows;
      },
      pickElementaryFeedbackRowsBySlots: () => ({
        slots: Array.from({ length: slotCount }, () => ({})),
        slotStates: Array.from({ length: slotCount }, () => ({ fulfilled: false }))
      }),
      formatConsultationRecordRowsForPreview: () => 'records',
    };
    const prepare = evaluate(code, 'prepareConsultationFeedbackMaterial', scope);
    rows = [{ source_table: 'feedbacks', content: 'June growth' }, { source_table: 'feedbacks', content: 'July growth' }];
    slotCount = 4;
    assert.equal((await prepare({ type: 'elementary', id: 'student-1' }, 12)).status, 'ready');
    slotCount = 0;
    assert.equal((await prepare({ type: 'elementary', id: 'student-1' }, 12)).status, 'ready');
    slotCount = 1;
    rows = rows.slice(0, 1);
    assert.equal((await prepare({ type: 'elementary', id: 'student-1' }, 12)).status, 'ready');
    slotCount = 4;
    const result = await prepare({ type: 'elementary', id: 'student-1' }, 12);
    assert.equal(result.status, 'insufficient');
    assert.match(result.reason, /최소 2개/);
  });

  test(app + ': protected consultation reading propagates a failed server read', async () => {
    const src = files[app];
    const begin = app === 'pc' ? 'async function loadConsultationSummaryFeedbackRows(' : 'function getConsultationSecureFeedbackReadFeature(';
    const code = section(src, begin, 'function getConsultationFeedbackPromptType(');
    const calls = [];
    let shouldFail = false;
    const scope = {
      requireOlliAcademyId: () => 'academy-1',
      getConsultationSecureFeedbackReadFeature: table => table === 'feedbacks' ? 'general_feedback_records_read' : 'growth_feedback_records_read',
      normalizeConsultationSummaryFeedbackRows: rows => rows,
      dedupeConsultationSummaryFeedbackRows: rows => rows,
      window: {
        OlliStorageCore: {
          FeatureRegistry: { require: feature => ({ feature }) },
          ServerAdapter: {
            read: async (spec, identity, options) => {
              calls.push({ feature: spec.feature, student: identity.studentId, limit: options.limit });
              if (shouldFail) throw new Error('401 unauthorized');
              return [{ source_table: 'feedbacks', content: 'historical growth', _summaryDate: new Date('2025-05-01') }];
            }
          }
        }
      }
    };
    const load = evaluate(code, 'loadConsultationSummaryFeedbackRows', scope);
    const rows = await load({ id: 'student-1', name: 'Student A' }, 12, { sourceTables: ['feedbacks'] });
    assert.equal(rows.length, 1);
    assert.equal(calls[0].feature, 'general_feedback_records_read');
    assert.equal(calls[0].student, 'student-1');
    assert.equal(calls[0].limit, 300);
    shouldFail = true;
    await assert.rejects(load({ id: 'student-1' }, 12, { sourceTables: ['feedbacks'] }), /서버 조회 실패.*401/);
  });
}

test('mobile: saved consultation summary uses protected RPC instead of forbidden REST GET', () => {
  const src = section(files.mobile, 'async function loadConsultationSummaryFeedbackRowsSecure(', 'async function saveConsultationSummaryFeedbackAuto(');
  assert.match(src, /FeatureRegistry\.require\('summary_feedback_records_read'\)/);
  assert.match(src, /ServerAdapter\.read/);
  assert.doesNotMatch(src, /supabase\('GET'/);
  assert.match(src, /Number\(row\.summary_months \|\| 0\) === safeMonths/);
  assert.match(src, /Number\(row\.year \|\| 0\) === year/);
});

test('both apps keep server errors distinct from genuine insufficient feedback', () => {
  for (const app of ['pc', 'mobile']) {
    assert.match(files[app], /if \(status === 'error'\) return '확인오류';/);
    assert.match(files[app], /return status === 'ready' \|\| status === 'error' \? status : 'insufficient';/);
    assert.match(files[app], /status: 'error',\s+(?:reason|error): err\.message/);
  }
  assert.match(files.mobile, /status !== 'insufficient' && status !== 'error'/);
  assert.match(files.pcUi, /cached\?\.status === 'error'/);
});

test('PC and mobile do not mistake missing Supabase configuration for an empty archive', () => {
  const pc = fs.readFileSync(path.join(root, 'apps/pc/olli-data-attendance-feedback.js'), 'utf8');
  assert.match(pc, /if \(!isSupabaseConfigured\(\)\) throw new Error\('Supabase 연결을 확인해 주세요.'\)/);
  assert.match(files.mobileSheet, /if \(!isSupabaseConfigured\(\)\) throw new Error\('Supabase 연결을 확인해 주세요.'\)/);
  assert.match(files.archive, /if \(!isSupabaseConfigured\(\)\) throw new Error\('Supabase 연결을 확인해 주세요.'\)/);
});

test('mobile feedback sheet normalizes legacy dates and refuses incomplete cache writes', async () => {
  const src = files.mobileSheet;
  const dates = section(src, 'function normalizeAttendanceFeedbackDate(', 'function formatAttendanceFeedbackSheetDate(');
  const getDate = evaluate(dates, 'getAttendanceFeedbackRowDate');
  assert.equal(getDate({ date: '2025-05-01', created_at: '2026-10-02T00:00:00Z' }), '2025-05-01');
  assert.equal(getDate({ date: '2026. 9. 22.' }), '2026-09-22');
  assert.match(src, /failedRequests\.push\(request\.table\)/);
  assert.match(src, /error\.code = 'PARTIAL_FEEDBACK_READ_FAILED'|err\.code = 'PARTIAL_FEEDBACK_READ_FAILED'/);
  const inFunction = section(src, 'async function loadAttendanceStudentFeedbackSheetItems(', '\nconst attendanceStudentFeedbackSheetState');
  assert.ok(inFunction.indexOf('throw err;') < inFunction.indexOf('writeAttendanceFeedbackLocalFirstCache('));
});

test('mobile memo archive preserves existing cache on partial RPC errors', async () => {
  const src = section(files.archive, 'async function loadMemoFeedbackArchiveItemsFromSupabase(', 'function formatElementaryRecordLabel(');
  let saved = 0;
  let failSecond = true;
  const context = {
    window: {
      loadOlliFeedbackRowsSecure: async table => {
        if (table === 'fail_feedbacks' && failSecond) throw new Error('401');
        return [{ id: table, content: 'growth' }];
      }
    },
    isSupabaseConfigured: () => true,
    getMemoFeedbackArchiveItems: () => [{ id: 'cached', sourceTable: 'feedbacks', content: 'previous' }],
    normalizeMemoFeedbackArchiveRows: (rows, table) => rows.map(row => ({ ...row, sourceTable: table })),
    setMemoFeedbackArchiveItems: () => { saved += 1; }
  };
  const load = evaluate(src, 'loadMemoFeedbackArchiveItemsFromSupabase', context);
  await assert.rejects(load({ id: 'student-1' }), /서버 조회 실패/);
  assert.equal(saved, 0);
  failSecond = false;
  const loaded = await load({ id: 'student-1' });
  assert.equal(loaded.length, 2);
  assert.equal(saved, 1);
});

test('mobile month capsules use actual lesson date and show a separate small year', () => {
  const dateParts = section(files.picker, 'function normalizeMemoFeedbackArchiveDate(', 'function getMemoFeedbackArchiveMonthGroups(');
  const functions = evaluate(dateParts, '({ getMemoFeedbackArchiveSavedAt, getMemoFeedbackArchiveMonthInfo })', {
    formatMemoFeedbackArchiveDate: input => !Number.isNaN(new Date(input).getTime()) ? 'valid' : ''
  });
  const oldRecord = { row: { date: '2025-05-01', created_at: '2026-10-02T00:00:00Z' } };
  assert.equal(functions.getMemoFeedbackArchiveSavedAt(oldRecord), '2025-05-01');
  assert.equal(functions.getMemoFeedbackArchiveMonthInfo(oldRecord).key, '2025-05');
  const currentRecord = { row: { date: '2026. 5. 8.', created_at: '2026-10-02T00:00:00Z' } };
  assert.equal(functions.getMemoFeedbackArchiveSavedAt(currentRecord), '2026-05-08');
  assert.equal(functions.getMemoFeedbackArchiveMonthInfo(currentRecord).key, '2026-05');
  assert.match(files.picker, /class="memoFeedbackArchiveMonthText"/);
  assert.match(files.picker, /class="memoFeedbackArchiveYearText"/);
  assert.match(files.mobileCss, /\.memoFeedbackArchiveYearText \{ font-size: calc\(10px/);
});
