const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const req = createRequire(path.join(__dirname, "tuition/package.json"));
const { PGlite } = req("@electric-sql/pglite");
const { randomUUID } = require("node:crypto");
const A = "00000000-0000-0000-0000-000000000001",
  B = "00000000-0000-0000-0000-000000000002",
  OLD = "00000000-0000-0000-0000-000000000011",
  NEW = "00000000-0000-0000-0000-000000000012";
let db,
  revision = 0;
const basic = {
  title: "기본",
  billing_cycle: "monthly",
  prices: { 1: 110000, 2: 150000, 3: 190000 },
  fees: [
    {
      id: "material",
      name: "재료비",
      amount: 70000,
      mode: "once",
      months: 1,
      anchor: "enrollment",
    },
  ],
};
async function write(action, data, options = {}) {
  const id = options.id || randomUUID();
  const out = await db.query(
    "select public.olli_tuition_write($1,$2,$3,$4,$5,$6,$7) result",
    [
      options.token || "owner",
      options.academy || A,
      options.revision ?? revision,
      id,
      action,
      data,
      !!options.preview,
    ],
  );
  const r = out.rows[0].result;
  if (!options.preview) revision = r.revision;
  return r;
}
async function quote(id, date) {
  return (
    await db.query("select private.olli_tuition_quote($1,$2,$3) q", [
      A,
      id,
      date,
    ])
  ).rows[0].q;
}
async function revenue(date, academy = A) {
  return (
    await db.query("select private.olli_academy_revenue_estimate($1,$2) q", [
      academy,
      date,
    ])
  ).rows[0].q;
}
before(async () => {
  db = new PGlite();
  await db.exec(`create schema private;create role anon;create role authenticated;
create table academies(id uuid primary key,academy_code text);create table academy_members(id uuid primary key);
create table students(id uuid primary key,academy_id uuid,name text,enrolled_at date,status text default 'active',paused_at timestamptz,withdrawn_at timestamptz,deleted_at timestamptz,is_deleted boolean default false);
create table olli_schedule_enrollments(id uuid default gen_random_uuid(),academy_id uuid,student_id uuid,weekday int,time_slot int,status text default 'active',effective_from date,effective_to date);
insert into academies values('${A}','TEST'),('${B}','OTHER');insert into academy_members values('${A}');
insert into students(id,academy_id,name,enrolled_at) values('${OLD}','${A}','기존','2090-01-10'),('${NEW}','${A}','신규','2091-01-10');
insert into olli_schedule_enrollments(academy_id,student_id,weekday,time_slot,effective_from) values('${A}','${OLD}',1,4,'2090-01-10'),('${A}','${NEW}',1,4,'2091-01-10');
create function private.olli_academy_finance_owner_member(token text,academy uuid) returns uuid language plpgsql as $$begin if token<>'owner' or academy<>'${A}' then raise exception 'FORBIDDEN';end if;return '${A}'::uuid;end $$;`);
  await db.exec(
    fs.readFileSync(
      path.join(
        __dirname,
        "../supabase/migrations/20261019075624_academy_tuition_policies.sql",
      ),
      "utf8",
    ),
  );
  // Simulate an existing 4-week academy, then upgrade its settings in place.
  await db.exec(`insert into private.olli_tuition_settings(academy_id,billing_cycle) values('${B}','four_weeks')`);
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261019082137_tuition_monthly_deleted_filter.sql'), 'utf8'));
  await write("policy", basic);
});
after(async () => db?.close());
test("catalog is owner and academy gated and starts with 1/2/3 prices", async () => {
  await assert.rejects(
    () => db.query("select public.olli_tuition_catalog($1,$2)", ["teacher", A]),
    /FORBIDDEN/,
  );
  await assert.rejects(
    () => db.query("select public.olli_tuition_catalog($1,$2)", ["owner", B]),
    /FORBIDDEN/,
  );
  assert.equal((await quote(OLD, "2090-02-10")).amount, 110000);
  assert.equal((await revenue("2090-02-01", '00000000-0000-0000-0000-000000000003')).configured, false);
});
test("preview does not write and old/new cohorts split until scheduled existing date", async () => {
  const policy = {
    ...basic,
    title: "인상",
    prices: { 1: 120000, 2: 170000, 3: 200000, 4: 240000, 5: 280000 },
    new_from: "2091-01-01",
    existing_from: "2091-04-01",
  };
  const prev = await write("policy", policy, { preview: true });
  assert.equal(prev.revision, revision);
  assert.equal((await quote(NEW, "2091-01-10")).amount, 110000);
  await write("policy", policy);
  assert.equal((await quote(OLD, "2091-03-10")).amount, 110000);
  assert.equal((await quote(NEW, "2091-01-10")).amount, 120000);
  assert.equal((await quote(OLD, "2091-04-10")).amount, 120000);
});
test("individual pricing takes precedence and frequency changes are unpriced until confirmed", async () => {
  await write("individual", {
    student_id: OLD,
    amount: 90000,
    effective_from: "2091-02-01",
  });
  assert.equal((await quote(OLD, "2091-04-10")).amount, 90000);
  await db.exec(
    `insert into olli_schedule_enrollments(academy_id,student_id,weekday,time_slot,effective_from) values('${A}','${OLD}',2,4,'2091-05-01')`,
  );
  const q = await quote(OLD, "2091-05-10");
  assert.equal(q.needs_review, true);
  assert.equal(q.amount, null);
  const r = await revenue("2091-05-01");
  assert.equal(r.review_students, 1);
  assert.equal(r.students.find((s) => s.student_id === OLD).tuition_amount, 0);
  await write("individual", {
    student_id: OLD,
    amount: 140000,
    effective_from: "2091-05-01",
  });
  assert.equal((await quote(OLD, "2091-05-10")).amount, 140000);
});
test("expired override returns to policy and never revives an older individual price", async () => {
  await write("individual", {
    student_id: OLD,
    amount: 130000,
    effective_from: "2091-06-01",
    effective_to: "2091-06-30",
  });
  assert.equal((await quote(OLD, "2091-06-10")).amount, 130000);
  assert.equal((await quote(OLD, "2091-07-10")).amount, 170000);
});
test("stale writes reject and retrying the same receipt is idempotent", async () => {
  await assert.rejects(
    () =>
      db.query("select public.olli_tuition_write($1,$2,$3,$4,$5,$6,$7)", [
        "owner",
        A,
        null,
        randomUUID(),
        "individual",
        { student_id: OLD, amount: 1, effective_from: "2091-08-01" },
        false,
      ]),
    /INVALID_REQUEST/,
  );
  const id = randomUUID(),
    data = { student_id: OLD, amount: 125000, effective_from: "2091-08-01" };
  const before = revision;
  const r = await write("individual", data, { id });
  const retry = await write("individual", data, { id, revision: before });
  assert.deepEqual(retry, r);
  await assert.rejects(
    () => write("individual", { ...data, amount: 1 }, { revision: before }),
    /TUITION_CONFLICT/,
  );
  await assert.rejects(
    () => write("individual", { ...data, amount: 1 }, { id }),
    /REQUEST_ID_REUSED/,
  );
});
test("material once fee survives re-enrollment and monthly fee follows student anchor", async () => {
  const january = await revenue("2091-01-01");
  assert.equal(january.additional_fee_amount, 70000);
  await db.exec(
    `update students set enrolled_at='2091-09-10' where id='${NEW}'`,
  );
  assert.equal((await revenue("2091-09-01")).additional_fee_amount, 0);
  await write("policy", {
    ...basic,
    title: "3개월 재료비",
    new_from: "2092-01-01",
    existing_from: "2092-01-01",
    fees: [
      {
        id: "material",
        name: "재료비",
        amount: 10000,
        mode: "months",
        months: 3,
        anchor: "enrollment",
      },
    ],
  });
  assert.equal((await revenue("2092-01-01")).additional_fee_amount, 20000);
  assert.equal((await revenue("2092-02-01")).additional_fee_amount, 0);
  assert.equal((await revenue("2092-04-01")).additional_fee_amount, 20000);
});
test("invalid fee intervals, foreign students and past effective changes are rejected", async () => {
  await assert.rejects(
    () =>
      write("policy", {
        ...basic,
        new_from: "2093-01-01",
        fees: [
          {
            id: "x",
            name: "x",
            amount: 10,
            mode: "months",
            months: 0,
            anchor: "enrollment",
          },
        ],
      }),
    /INVALID_FEE_INTERVAL/,
  );
  await assert.rejects(
    () =>
      write("individual", {
        student_id: B,
        amount: 1,
        effective_from: "2093-01-01",
      }),
    /STUDENT_NOT_FOUND/,
  );
  await assert.rejects(
    () =>
      write("individual", {
        student_id: OLD,
        amount: 1,
        effective_from: "1900-01-01",
      }),
    /INVALID_EFFECTIVE_DATE/,
  );
});
test("private tables and helper functions cannot be called as authenticated", async () => {
  await db.exec("set role authenticated");
  try {
    await assert.rejects(
      () => db.query("select * from private.olli_tuition_student_terms"),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        db.query("select private.olli_tuition_quote($1,$2,$3)", [
          A,
          OLD,
          "2093-01-01",
        ]),
      /permission denied/,
    );
  } finally {
    await db.exec("reset role");
  }
});
test("existing four-week settings become monthly and each month has one tuition date", async () => {
  await db.exec(
    `insert into private.olli_tuition_policies(academy_id,title,new_from,prices) values('${B}','4주','1900-01-01','{"1":100000,"2":150000,"3":190000}');insert into students(id,academy_id,name,enrolled_at) values('00000000-0000-0000-0000-000000000021','${B}','4주 학생','2095-01-01');insert into olli_schedule_enrollments(academy_id,student_id,weekday,time_slot,effective_from) values('${B}','00000000-0000-0000-0000-000000000021',1,4,'2095-01-01')`,
  );
  const r = await revenue("2095-01-01", B);
  assert.equal(r.billing_cycle, "monthly");
  assert.equal(r.tuition_total_amount, 100000);
  assert.deepEqual(
    r.students[0].billing.map((x) => x.date),
    ["2095-01-01"],
  );
  const dates = await db.query(
    "select private.olli_tuition_month_day('2095-01-31','2095-02-01')::text normal,private.olli_tuition_month_day('2096-01-31','2096-02-01')::text leap",
  );
  assert.deepEqual(dates.rows[0], { normal: "2095-02-28", leap: "2096-02-29" });
  await write("policy", {
    ...basic, new_from: "2095-01-01", billing_cycle: "four_weeks",
  });
  assert.equal((await db.query("select billing_cycle from private.olli_tuition_settings where academy_id=$1", [A])).rows[0].billing_cycle, "monthly");
});
test("calendar material schedule charges only the configured month and registration date is retained", async () => {
  await write("policy", {
    ...basic,
    title: "공통 분기 재료비",
    new_from: "2094-01-01",
    existing_from: "2094-01-01",
    fees: [
      {
        id: "quarter",
        name: "분기 재료비",
        amount: 15000,
        mode: "months",
        months: 3,
        anchor: "calendar",
        anchor_date: "2094-02-20",
      },
    ],
  });
  assert.equal((await revenue("2094-01-01")).additional_fee_amount, 0);
  assert.equal((await revenue("2094-02-01")).additional_fee_amount, 30000);
  assert.equal((await revenue("2094-03-01")).additional_fee_amount, 0);
  assert.equal(
    (await quote(NEW, "2094-02-20")).first_registered_on,
    "2091-01-10",
  );
});


test("deleted students are excluded from current and future missing tuition, totals and review counts", async () => {
  const baseline = await revenue('2095-03-01');
  const ids = ['00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000033'];
  for (const [i,id] of ids.entries()) {
    await db.query("insert into students(id,academy_id,name,enrolled_at,is_deleted,deleted_at) values($1,$2,'삭제 학생','2095-01-01',$3,$4)", [id,A,i!==1,i!==0?'2095-03-20':null]);
  }
  const result = await revenue('2095-03-01');
  assert.deepEqual(result, baseline);
  for (const month of ['2020-01-01','2095-01-01','2095-03-01','2096-01-01']) {
    const r=await revenue(month);
    assert(!r.students.some(s=>ids.includes(s.student_id)));
    assert(!r.fee_items.some(s=>ids.includes(s.student_id)));
  }
  const preview=await write('policy',{...basic,new_from:'2096-01-01'},{preview:true});
  assert(!preview.preview.some(s=>ids.includes(s.student_id)));
});

test("current estimates and review lists use active roster; past months retain dated enrollment periods", async () => {
  const cases = [
    ['active', false, null, null, null, true],
    ['active', false, null, null, null, false],
    ['paused', false, '2020-06-20', null, null, true],
    ['paused', false, null, null, null, true],
    ['withdrawn', false, null, '2020-06-20', null, true],
    ['withdrawn', false, null, null, null, true],
    ['active', true, null, null, '2020-06-20', true],
    ['active', true, null, null, null, true],
    ['active', false, null, null, '2020-06-20', true],
  ];
  const ids = [];
  for (const [i, [status, deleted, pausedAt, withdrawnAt, deletedAt, scheduled]] of cases.entries()) {
    const id = `00000000-0000-0000-0000-${String(41+i).padStart(12,'0')}`;
    ids.push(id);
    await db.query("insert into students(id,academy_id,name,enrolled_at,status,is_deleted,paused_at,withdrawn_at,deleted_at) values($1,$2,$3,'2019-01-10',$4,$5,$6,$7,$8)", [id,A,`상태 ${i}`,status,deleted,pausedAt,withdrawnAt,deletedAt]);
    if (scheduled) await db.query("insert into olli_schedule_enrollments(academy_id,student_id,weekday,time_slot,effective_from) values($1,$2,1,4,'2019-01-10')", [A,id]);
  }
  const currentMonth = (await db.query("select date_trunc('month',now() at time zone 'Asia/Seoul')::date::text as report_month")).rows[0].report_month;
  await db.query("insert into private.olli_tuition_student_terms(academy_id,student_id,amount,weekly_sessions,effective_from) values($1,$2,90000,2,$3)", [A,ids[2],currentMonth]);
  for (const month of [currentMonth, '2099-01-01']) {
    const result = await revenue(month);
    const rows = result.students.filter(s=>ids.includes(s.student_id));
    assert.deepEqual(rows.map(s=>s.student_id).sort(), ids.slice(0,2).sort());
    assert.deepEqual(rows.filter(s=>s.needs_review).map(s=>s.student_id), [ids[1]]);
    assert.equal(result.students.some(s=>ids.slice(2).includes(s.student_id)), false);
    assert.equal(result.fee_items.some(s=>ids.slice(2).includes(s.student_id)), false);
    if (month===currentMonth) {
      assert.equal(result.unpriced_students, 1);
      assert.equal(result.review_students, 0);
      assert.equal(result.individual_students, 0);
      assert.equal(result.tuition_total_amount, 110000);
    }
  }
  const before = await revenue('2020-05-01');
  assert.deepEqual(before.students.filter(s=>ids.includes(s.student_id)).map(s=>s.student_id).sort(), [0,1,2,4,6,8].map(i=>ids[i]).sort());
  const after = await revenue('2020-07-01');
  assert.deepEqual(after.students.filter(s=>ids.includes(s.student_id)).map(s=>s.student_id).sort(), ids.slice(0,2).sort());
  assert.equal(before.tuition_total_amount-after.tuition_total_amount, 440000);
  const preview=await write('policy',{...basic,new_from:'2099-01-01'},{preview:true});
  assert(!preview.preview.some(s=>ids.slice(2).includes(s.student_id)));
});
