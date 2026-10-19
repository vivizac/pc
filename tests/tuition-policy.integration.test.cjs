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
  assert.equal((await revenue("2090-02-01", B)).configured, false);
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
test("four-week billing counts real 28-day cycles and calendar billing clamps month ends", async () => {
  await db.exec(
    `insert into private.olli_tuition_settings(academy_id,billing_cycle) values('${B}','four_weeks');insert into private.olli_tuition_policies(academy_id,title,new_from,prices) values('${B}','4주','1900-01-01','{"1":100000,"2":150000,"3":190000}');insert into students(id,academy_id,name,enrolled_at) values('00000000-0000-0000-0000-000000000021','${B}','4주 학생','2095-01-01');insert into olli_schedule_enrollments(academy_id,student_id,weekday,time_slot,effective_from) values('${B}','00000000-0000-0000-0000-000000000021',1,4,'2095-01-01')`,
  );
  const r = await revenue("2095-01-01", B);
  assert.equal(r.tuition_total_amount, 200000);
  assert.deepEqual(
    r.students[0].billing.map((x) => x.date),
    ["2095-01-01", "2095-01-29"],
  );
  const dates = await db.query(
    "select private.olli_tuition_month_day('2095-01-31','2095-02-01')::text normal,private.olli_tuition_month_day('2096-01-31','2096-02-01')::text leap",
  );
  assert.deepEqual(dates.rows[0], { normal: "2095-02-28", leap: "2096-02-29" });
  await assert.rejects(
    () =>
      write("policy", {
        ...basic,
        new_from: "2095-01-01",
        billing_cycle: "four_weeks",
      }),
    /BILLING_CYCLE_LOCKED/,
  );
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
