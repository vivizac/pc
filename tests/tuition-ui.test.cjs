const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const req = createRequire(path.join(__dirname, "tuition/package.json"));
const { JSDOM } = req("jsdom");
const source = fs.readFileSync(
  path.join(__dirname, "../packages/common/olli-tuition-common.js"),
  "utf8",
);
const wait = () => new Promise((resolve) => setTimeout(resolve, 0));
function ui(options = {}) {
  const dom = new JSDOM(
    '<body><div id="profile"><div class="pcStudentInfoActions"></div></div></body>',
    { url: "https://olli.test/", runScripts: "outside-only" },
  );
  const w = dom.window;
  w.getOlliCurrentRole = () => options.role || "owner";
  let academy = "a";
  w.settingsGetAcademyId = () => academy;
  w.getOlliSettingsSessionToken = () => "session";
  const requests = [];
  const c = {
    ok: true,
    revision: 2,
    billing_cycle: "monthly",
    policies: [
      {
        id: "p",
        title: "기본",
        new_from: "1900-01-01",
        prices: { 1: 110000, 2: 150000, 3: null },
        fees: [],
      },
    ],
  };
  const q = {
    student_id: "s",
    name: "학생",
    weekly_sessions: 1,
    amount: 110000,
    basis: "policy",
    needs_review: false,
    policy_title: "기본",
    prices: c.policies[0].prices,
  };
  w.callOlliRpc = async (name, data) => {
    requests.push({ name, data });
    if (options.rpc) return options.rpc(name, data, { catalog: c, student: q });
    if (name === "olli_tuition_catalog") return c;
    if (name === "olli_tuition_student")
      return { ok: true, student: q, catalog: c };
    return {
      ok: true,
      revision: 3,
      preview: [
        {
          name: "학생",
          before: 110000,
          after: 120000,
          apply_from: null,
          individual: false,
        },
      ],
    };
  };
  w.eval(source);
  return {
    w,
    doc: w.document,
    requests,
    c,
    q,
    switchAcademy: () => (academy = "b"),
    close: () => w.close(),
  };
}
test("settings show three defaults, only add four/five, and separate material cadence controls", async () => {
  const t = ui();
  await t.w.OlliTuition.openSettings();
  assert.equal(t.doc.querySelectorAll("[data-rate]").length, 3);
  assert.equal(t.doc.querySelector('[data-cycle]'), null);
  assert.match(t.doc.body.textContent, /교육비는 한 달 기준/);
  const add = t.doc.querySelector("[data-add-rate]");
  add.click();
  add.click();
  add.click();
  assert.equal(t.doc.querySelectorAll("[data-rate]").length, 5);
  t.doc.querySelector("[data-add-fee]").click();
  const row = t.doc.querySelector("[data-fee]");
  row.querySelector("[data-fee-mode]").value = "months";
  row.querySelector("[data-fee-mode]").dispatchEvent(new t.w.Event("change"));
  assert.equal(row.querySelector("[data-months-label]").hidden, false);
  row.querySelector("[data-fee-anchor]").value = "calendar";
  row.querySelector("[data-fee-anchor]").dispatchEvent(new t.w.Event("change"));
  assert.equal(row.querySelector("[data-anchor-date-label]").hidden, false);
  t.close();
});
test("a changed draft invalidates the reviewed save action and no write occurs on preview", async () => {
  const t = ui();
  await t.w.OlliTuition.openSettings();
  t.doc.querySelector("[data-preview]").click();
  await wait();
  assert(t.doc.querySelector("[data-save-policy]"));
  assert.equal(t.requests.find(r=>r.name==='olli_tuition_write').data.p_data.billing_cycle, 'monthly');
  assert.equal(
    t.requests.find((r) => r.name === "olli_tuition_write").data.p_preview,
    true,
  );
  const input = t.doc.querySelector('[data-rate="1"]');
  input.value = "120000";
  input.dispatchEvent(new t.w.Event("input", { bubbles: true }));
  assert.equal(t.doc.querySelector("[data-save-policy]"), null);
  t.close();
});
test("student terms save only after server acknowledgement and preserve entered amount on failure", async () => {
  const t = ui({
    rpc: async (name, data, c) => {
      if (name === "olli_tuition_student")
        return { ok: true, student: c.student, catalog: c.catalog };
      if (name === "olli_tuition_write") throw Error("저장 실패");
      return c.catalog;
    },
  });
  t.w.OlliTuition.mountStudent(t.doc.querySelector("#profile"), { id: "s" });
  await wait();
  t.doc.querySelector("[data-edit-tuition]").click();
  t.doc.querySelector("[data-individual-amount]").value = "98000";
  t.doc.querySelector("[data-save]").click();
  await wait();
  assert.equal(t.doc.querySelector("[data-individual-amount]").value, "98000");
  assert.match(
    t.doc.querySelector("[data-student-error]").textContent,
    /저장 실패/,
  );
  assert.equal(
    t.requests.find((r) => r.name === "olli_tuition_write").data.p_data.amount,
    98000,
  );
  t.close();
});
test("frequency change produces a review popup without mutating schedule or profile", async () => {
  const t = ui({
    rpc: async (name, data, c) => ({
      ok: true,
      catalog: c.catalog,
      student: {
        ...c.student,
        basis: "individual",
        needs_review: true,
        weekly_sessions: 2,
        amount: null,
      },
    }),
  });
  t.w.dispatchEvent(
    new t.w.CustomEvent("olli:schedule-changed", {
      detail: { studentId: "s", effectiveDate: "2091-01-01" },
    }),
  );
  await wait();
  assert.match(
    t.doc.querySelector(".olliTuitionDialog").textContent,
    /시간표 변경은 저장되었습니다/,
  );
  assert.match(t.doc.querySelector(".olliTuitionDialog").textContent, /주 2회/);
  assert.deepEqual(
    t.requests.map((r) => r.name),
    ["olli_tuition_student"],
  );
  t.close();
});
test("teacher accounts do not fetch or mount financial terms", async () => {
  const t = ui({ role: "teacher" });
  t.w.OlliTuition.mountStudent(t.doc.querySelector("#profile"), { id: "s" });
  await t.w.OlliTuition.checkScheduleChange("s");
  assert.equal(t.requests.length, 0);
  assert.equal(t.doc.querySelector("[data-tuition-student]"), null);
  t.close();
});
test("late responses from a different academy are discarded", async () => {
  let resolve;
  const t = ui({ rpc: () => new Promise((r) => (resolve = r)) });
  const pending = t.w.OlliTuition.openSettings();
  t.switchAcademy();
  resolve(t.c);
  await pending;
  assert.match(
    t.doc.querySelector("[data-content]").textContent,
    /학원 또는 로그인 정보가 바뀌었습니다/,
  );
  assert.equal(t.doc.querySelector("[data-rate]"), null);
  t.close();
});
test("a reserved frequency change opens the student editor on its future effective date", async () => {
  const t = ui({
    rpc: async (name, data, c) => ({
      ok: true,
      catalog: c.catalog,
      student: {
        ...c.student,
        basis: "individual",
        needs_review: true,
        weekly_sessions: 2,
        amount: null,
        as_of: data.p_date,
      },
    }),
  });
  await t.w.OlliTuition.checkScheduleChange("s", "2099-01-01");
  t.doc.querySelector(".olliTuitionDialog [data-content] button").click();
  await wait();
  assert.equal(t.requests.at(-1).data.p_date, "2099-01-01");
  t.doc.querySelector("[data-edit-tuition]").click();
  assert.equal(
    t.doc.querySelector("[data-individual-from]").value,
    "2099-01-01",
  );
  t.close();
});
test("saving a student amount does not navigate to the finance screen", async () => {
  const t = ui();
  let navigations = 0;
  t.w.OlliTeacherPayroll = { loadOverview: () => navigations++ };
  t.w.OlliTuition.mountStudent(t.doc.querySelector("#profile"), { id: "s" });
  await wait();
  t.doc.querySelector("[data-edit-tuition]").click();
  t.doc.querySelector("[data-save]").click();
  await wait();
  await wait();
  assert.equal(navigations, 0);
  assert.match(
    t.doc.querySelector("[data-tuition-student]").textContent,
    /適|적용 교육비/,
  );
  t.close();
});
