(function (global) {
  "use strict";
  const state = { catalog: null, academy: "", dialog: null, busy: false };
  const money = (value) =>
    value == null ? "미설정" : Number(value).toLocaleString("ko-KR") + "원";
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  function today() {
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    return ["year", "month", "day"]
      .map((t) => p.find((x) => x.type === t).value)
      .join("-");
  }
  function context() {
    return {
      academy: String(
        global.settingsGetAcademyId?.() ||
          localStorage.getItem("olli_current_academy_id") ||
          "",
      ),
      token: String(
        global.getOlliSettingsSessionToken?.() ||
          localStorage.getItem("olli_account_session_token_v1") ||
          "",
      ),
    };
  }
  function owner() {
    return ["owner", "super_admin"].includes(
      String(
        global.getOlliCurrentRole?.() ||
          localStorage.getItem("olli_current_member_role") ||
          "",
      ),
    );
  }
  async function rpc(name, args = {}) {
    const c = context();
    if (!owner() || !c.academy || !c.token)
      throw Error("원장 계정으로 교육비를 확인해 주세요.");
    if (typeof global.callOlliRpc !== "function")
      throw Error("서버 연결을 확인해 주세요.");
    const result = await global.callOlliRpc(name, {
      p_session_token: c.token,
      p_academy_id: c.academy,
      ...args,
    });
    const next = context();
    if (next.academy !== c.academy || next.token !== c.token)
      throw Error("학원 또는 로그인 정보가 바뀌었습니다. 다시 열어 주세요.");
    if (result?.ok !== true)
      throw Error(result?.message || "교육비 정보를 처리하지 못했습니다.");
    return result;
  }
  function requestId() {
    return global.crypto.randomUUID();
  }
  async function catalog() {
    const result = await rpc("olli_tuition_catalog");
    state.catalog = result;
    state.academy = context().academy;
    return result;
  }
  function refreshFinanceIfVisible() {
    const screen = document.getElementById("settingsDetailScreen");
    if (
      screen &&
      global.getComputedStyle(screen).display !== "none" &&
      screen.querySelector(".olliPayrollPage")
    )
      global.OlliTeacherPayroll?.loadOverview?.();
  }
  function close() {
    state.dialog?.remove();
    state.dialog = null;
    state.busy = false;
  }
  function dialog(title) {
    close();
    const overlay = document.createElement("div");
    overlay.className = "olliTuitionOverlay";
    overlay.innerHTML =
      '<section class="olliTuitionDialog" role="dialog" aria-modal="true" aria-label="' +
      esc(title) +
      '"><div class="olliTuitionHead"><h2>' +
      esc(title) +
      '</h2><button type="button" data-close aria-label="닫기">닫기</button></div><div data-content></div></section>';
    overlay.querySelector("[data-close]").onclick = () => {
      if (!state.busy) close();
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay && !state.busy) close();
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !state.busy) close();
    });
    document.body.appendChild(overlay);
    state.dialog = overlay;
    return overlay.querySelector("[data-content]");
  }
  function amountInput(value, attrs = "") {
    return (
      '<input type="number" min="0" max="1000000000" step="1" value="' +
      (value == null ? "" : esc(value)) +
      '" ' +
      attrs +
      ">"
    );
  }
  function rateCard(n, value) {
    return (
      '<label class="olliTuitionRate"><strong>주 ' +
      n +
      "회</strong>" +
      amountInput(value, 'data-rate="' + n + '" placeholder="미설정"') +
      "</label>"
    );
  }
  function feeHtml(f = {}) {
    const mode = f.mode || "once";
    return (
      '<div class="olliTuitionFee" data-fee="' +
      esc(f.id || requestId()) +
      '"><div class="olliTuitionGrid"><label>항목 이름<input data-fee-name maxlength="60" value="' +
      esc(f.name || "") +
      '" placeholder="재료비 / 워크북비"></label><label>금액' +
      amountInput(f.amount, "data-fee-amount") +
      '</label><label>부과 방식<select data-fee-mode><option value="once" ' +
      (mode === "once" ? "selected" : "") +
      '>최초 등록 시 1회</option><option value="months" ' +
      (mode === "months" ? "selected" : "") +
      '>몇 개월마다</option><option value="cycle" ' +
      (mode === "cycle" ? "selected" : "") +
      ">매월</option></select></label><label data-months-label " +
      (mode === "months" ? "" : "hidden") +
      '>부과 간격 (매월은 1)<input data-fee-months type="number" min="1" max="60" value="' +
      esc(f.months || 1) +
      '"></label><label data-anchor-label ' +
      (mode === "months" ? "" : "hidden") +
      '>기준<select data-fee-anchor><option value="enrollment" ' +
      (f.anchor !== "calendar" ? "selected" : "") +
      '>학생 최초 등록일</option><option value="calendar" ' +
      (f.anchor === "calendar" ? "selected" : "") +
      ">학원 공통 날짜</option></select></label><label data-anchor-date-label " +
      (mode === "months" && f.anchor === "calendar" ? "" : "hidden") +
      '>공통 기준일<input type="date" data-fee-anchor-date value="' +
      esc(f.anchor_date || today()) +
      '"></label></div><button type="button" data-remove-fee>항목 제외</button></div>'
    );
  }
  function bindFee(row) {
    const update = () => {
      const monthly = row.querySelector("[data-fee-mode]").value === "months";
      row.querySelector("[data-months-label]").hidden = !monthly;
      row.querySelector("[data-anchor-label]").hidden = !monthly;
      row.querySelector("[data-anchor-date-label]").hidden =
        !monthly || row.querySelector("[data-fee-anchor]").value !== "calendar";
    };
    row.querySelector("[data-fee-mode]").onchange = update;
    row.querySelector("[data-fee-anchor]").onchange = update;
    row.querySelector("[data-remove-fee]").onclick = () => row.remove();
  }
  function readAmount(input, nullable = false) {
    if (input.value.trim() === "" && nullable) return null;
    const n = Number(input.value);
    if (
      input.value.trim() === "" ||
      !Number.isSafeInteger(n) ||
      n < 0 ||
      n > 1000000000
    )
      throw Error("금액은 0 이상의 정수로 입력해 주세요.");
    return n;
  }
  function draft(body, c) {
    const prices = {};
    body
      .querySelectorAll("[data-rate]")
      .forEach((el) => (prices[el.dataset.rate] = readAmount(el, true)));
    const fees = Array.from(body.querySelectorAll("[data-fee]")).map((row) => {
      const name = row.querySelector("[data-fee-name]").value.trim();
      if (!name) throw Error("별도 비용의 항목 이름을 입력해 주세요.");
      return {
        id: row.dataset.fee,
        name,
        amount: readAmount(row.querySelector("[data-fee-amount]")),
        mode: row.querySelector("[data-fee-mode]").value,
        months: Number(row.querySelector("[data-fee-months]").value),
        anchor: row.querySelector("[data-fee-anchor]").value,
        anchor_date: row.querySelector("[data-fee-anchor-date]").value,
      };
    });
    const initial = !c.policies.length;
    const data = {
      title: body.querySelector("[data-policy-title]").value.trim(),
      billing_cycle: "monthly",
      prices,
      fees,
      new_from: initial
        ? "1900-01-01"
        : body.querySelector("[data-new-from]").value,
      existing_from: initial
        ? null
        : body.querySelector("[data-existing-mode]").value === "date"
          ? body.querySelector("[data-existing-from]").value
          : null,
    };
    if (!data.title) throw Error("교육비표 이름을 입력해 주세요.");
    if (!initial && (!data.new_from || data.new_from < today()))
      throw Error("신규생 적용일은 오늘 이후로 선택해 주세요.");
    if (
      !initial &&
      body.querySelector("[data-existing-mode]").value === "date" &&
      !data.existing_from
    )
      throw Error("재원생 변경일을 선택해 주세요.");
    if (data.existing_from && data.existing_from < data.new_from)
      throw Error("재원생 적용일은 신규생 적용일 이후로 선택해 주세요.");
    return data;
  }
  async function openSettings() {
    const body = dialog("교육비 설정");
    body.textContent = "교육비표를 불러오는 중입니다.";
    try {
      const c = await catalog();
      if (!body.isConnected) return;
      renderSettings(body, c);
    } catch (e) {
      if (body.isConnected)
        body.innerHTML =
          '<p class="olliTuitionError">' +
          esc(e.message) +
          "<br>교육비 DB 기능이 아직 적용되지 않은 경우 배포 시 migration 적용이 필요합니다.</p>";
    }
  }
  function renderSettings(body, c) {
    const base = c.policies[0] || {
      prices: { 1: null, 2: null, 3: null },
      fees: [],
    };
    const initial = !c.policies.length;
    body.innerHTML =
      '<p class="olliTuitionHelp">교육비표는 이력으로 보존됩니다. 새 금액을 만들 때 신규생 적용일과 기존 재원생 적용 여부를 함께 정하세요. 개별 교육비 학생은 별도 설정을 유지합니다.</p><div class="olliTuitionGrid"><label>교육비표 이름<input maxlength="80" data-policy-title value="' +
      (initial ? "기본 교육비" : "새 교육비") +
      '"></label></div><p class="olliTuitionHelp">교육비는 한 달 기준입니다. 예상 납부일은 매월 등록일을 기준으로 계산합니다.</p><div class="olliTuitionGrid" data-rates>' +
      Object.entries(base.prices)
        .map(([n, v]) => rateCard(n, v))
        .join("") +
      '</div><button type="button" data-add-rate>+ 횟수 추가 (주 4·5회)</button><div class="olliTuitionBlock"><strong>재료비·교재비 등 별도 비용</strong><p class="olliTuitionHelp">항목이 없으면 별도 비용을 받지 않습니다. 재등록 시 최초 등록 비용은 다시 부과하지 않습니다.</p><div data-fees>' +
      base.fees.map(feeHtml).join("") +
      '</div><button type="button" data-add-fee>+ 별도 비용 추가</button></div>' +
      (initial
        ? ""
        : '<div class="olliTuitionBlock olliTuitionGrid"><label>이 날짜 이후 신규 등록생부터<input type="date" data-new-from min="' +
          today() +
          '" value="' +
          today() +
          '"></label><label>기존 재원생<select data-existing-mode><option value="keep">기존 금액 계속 유지</option><option value="date">지정일부터 새 교육비 적용</option></select></label><label hidden data-existing-label>재원생 변경일<input type="date" data-existing-from min="' +
          today() +
          '"></label></div>') +
      '<p class="olliTuitionError" data-error></p><div class="olliTuitionActions"><button type="button" class="primary" data-preview>적용 대상 확인</button></div><div data-preview-result></div><div class="olliTuitionBlock"><strong>교육비 변경 이력</strong>' +
      c.policies
        .map(
          (p) =>
            '<div class="olliTuitionHistory"><strong>' +
            esc(p.title) +
            "</strong> · " +
            (p.new_from === "1900-01-01"
              ? "기본 교육비"
              : esc(p.new_from) + " 이후 신규생") +
            "<br>" +
            Object.entries(p.prices)
              .map(([n, v]) => "주 " + n + "회 " + money(v))
              .join(" · ") +
            "<br>재원생: " +
            (p.existing_from
              ? esc(p.existing_from) + " 이후 다음 납부 주기부터"
              : "기존 금액 유지") +
            (p.new_until ? "<br>신규 적용 종료: " + esc(p.new_until) : "") +
            (p.new_from !== "1900-01-01" && !p.new_until
              ? '<br><button type="button" data-retire="' +
                esc(p.id) +
                '">신규 적용 종료 예약</button>'
              : "") +
            "</div>",
        )
        .join("") +
      "</div>";
    const invalidate = (event) => {
      if (!event.target.closest("[data-preview-result]"))
        body.querySelector("[data-preview-result]").innerHTML = "";
    };
    body.addEventListener("input", invalidate);
    body.addEventListener("change", invalidate);
    body.addEventListener("click", (event) => {
      if (
        event.target.closest("[data-remove-fee],[data-add-fee],[data-add-rate]")
      ) {
        body.querySelector("[data-preview-result]").innerHTML = "";
      }
    });
    body.querySelectorAll("[data-fee]").forEach(bindFee);
    body.querySelector("[data-add-rate]").onclick = () => {
      const n = [4, 5].find(
        (n) => !body.querySelector('[data-rate="' + n + '"]'),
      );
      if (n)
        body
          .querySelector("[data-rates]")
          .insertAdjacentHTML("beforeend", rateCard(n, null));
    };
    body.querySelector("[data-add-fee]").onclick = () => {
      const root = body.querySelector("[data-fees]");
      if (root.children.length >= 10) return;
      root.insertAdjacentHTML("beforeend", feeHtml());
      bindFee(root.lastElementChild);
    };
    const mode = body.querySelector("[data-existing-mode]");
    if (mode)
      mode.onchange = () =>
        (body.querySelector("[data-existing-label]").hidden =
          mode.value !== "date");
    body.querySelector("[data-preview]").onclick = async () => {
      const error = body.querySelector("[data-error]");
      error.textContent = "";
      try {
        const data = draft(body, c);
        const signature = JSON.stringify(data);
        const id = requestId();
        const result = await rpc("olli_tuition_write", {
          p_expected_revision: c.revision,
          p_request_id: id,
          p_action: "policy",
          p_data: data,
          p_preview: true,
        });
        if (!body.isConnected || JSON.stringify(draft(body, c)) !== signature)
          return;
        const target = body.querySelector("[data-preview-result]");
        target.innerHTML =
          '<div class="olliTuitionNotice">신규생: ' +
          (initial
            ? "기본 교육비 적용"
            : esc(data.new_from) + " 이후 신규 등록부터 적용") +
          "<br>기존생: " +
          (data.existing_from
            ? esc(data.existing_from) + " 이후 다음 납부 주기부터"
            : "기존 금액 유지") +
          "<br>개별 교육비는 유지됩니다. 빈 금액은 미설정으로 남고 예상 수입에서 제외됩니다.</div>" +
          previewTable(result.preview) +
          '<div class="olliTuitionActions"><button type="button" class="primary" data-save-policy>이 내용으로 저장</button></div>';
        target.querySelector("[data-save-policy]").onclick = () =>
          savePolicy(body, c, data, id);
        target.scrollIntoView?.({ block: "nearest" });
      } catch (e) {
        error.textContent = e.message;
      }
    };
    body.querySelectorAll("[data-retire]").forEach(
      (button) =>
        (button.onclick = () => {
          const box = dialog("신규 적용 종료 예약");
          box.innerHTML =
            '<p class="olliTuitionHelp">이미 적용받는 학생과 과거 내역은 유지합니다. 종료일 이후 등록하는 학생은 다른 적용 가능한 교육비표를 따릅니다.</p><label>신규 적용 종료일<input type="date" data-end min="' +
            today() +
            '" value="' +
            today() +
            '"></label><p class="olliTuitionError"></p><button type="button" class="primary">종료 예약 저장</button>';
          box.querySelector("button").onclick = async () => {
            try {
              await rpc("olli_tuition_write", {
                p_expected_revision: c.revision,
                p_request_id: requestId(),
                p_action: "retire",
                p_data: {
                  id: button.dataset.retire,
                  new_until: box.querySelector("input").value,
                },
              });
              await openSettings();
            } catch (e) {
              box.querySelector(".olliTuitionError").textContent = e.message;
            }
          };
        }),
    );
  }
  function previewTable(rows) {
    return (
      '<table class="olliTuitionTable"><thead><tr><th>학생</th><th>현재</th><th>변경</th><th>적용</th></tr></thead><tbody>' +
      rows
        .map(
          (r) =>
            "<tr><td>" +
            esc(r.name) +
            "</td><td>" +
            money(r.before) +
            "</td><td>" +
            money(r.individual || !r.apply_from ? r.before : r.after) +
            "</td><td>" +
            (r.individual
              ? "개별 금액 유지"
              : r.apply_from
                ? esc(r.apply_from) + " 이후 납부 주기"
                : "기존 금액 유지") +
            "</td></tr>",
        )
        .join("") +
      "</tbody></table>"
    );
  }
  async function savePolicy(body, c, data, id) {
    const button = body.querySelector("[data-save-policy]");
    if (button) button.disabled = true;
    state.busy = true;
    try {
      await rpc("olli_tuition_write", {
        p_expected_revision: c.revision,
        p_request_id: id,
        p_action: "policy",
        p_data: data,
      });
      state.busy = false;
      await openSettings();
      refreshFinanceIfVisible();
    } catch (e) {
      state.busy = false;
      if (button) button.disabled = false;
      if (body.isConnected)
        body.querySelector("[data-error]").textContent = e.message;
    }
  }
  function studentMarkup(result) {
    const q = result.student;
    const next = result.next_change;
    return (
      '<div class="olliTuitionStudentTitle"><strong>적용 교육비 · 주 ' +
      q.weekly_sessions +
      '회</strong><button type="button" data-edit-tuition>개별 교육비 설정</button></div><p>' +
      money(q.amount) +
      " / " +
      "매월" +
      " · " +
      esc(
        q.basis === "individual"
          ? "개별 교육비"
          : q.policy_title || "기본 교육비 미설정",
      ) +
      "</p>" +
      (q.needs_review
        ? '<div class="olliTuitionNotice">' +
          (q.basis === "individual"
            ? "수업 횟수가 변경된 개별 교육비 학생입니다. 새 금액을 직접 확인해 주세요."
            : "해당 수업 횟수의 교육비를 설정해 주세요.") +
          "</div>"
        : "") +
      (next
        ? "<p>변경 예정: " +
          esc(next.date) +
          " 이후 다음 납부 주기부터 " +
          money(next.amount) +
          "</p>"
        : "") +
      '<div class="olliTuitionPriceList">' +
      Object.entries(q.prices)
        .map(([n, v]) => "<span>주 " + n + "회 " + money(v) + "</span>")
        .join("") +
      "</div><div data-student-tuition-form></div>"
    );
  }
  function studentEditor(host, result) {
    host.dataset.editing = "1";
    const q = result.student,
      form = host.querySelector("[data-student-tuition-form]");
    form.innerHTML =
      '<div class="olliTuitionStudentForm"><p class="olliTuitionHelp">현재 주 ' +
      q.weekly_sessions +
      '회에 적용할 금액입니다. 횟수가 달라지면 다시 확인해야 합니다. 학생정보 저장과 별도로 저장됩니다.</p><div class="olliTuitionGrid"><label>개별 교육비' +
      amountInput(q.amount, "data-individual-amount") +
      '</label><label>적용 시작일<input type="date" min="' +
      today() +
      '" value="' +
      esc(q.as_of && q.as_of >= today() ? q.as_of : today()) +
      '" data-individual-from></label><label>종료일 (비우면 계속 유지)<input type="date" data-individual-to></label><label>메모<input maxlength="500" data-individual-note value="' +
      esc(q.note || "") +
      '"></label></div><p class="olliTuitionError" data-student-error></p><div class="olliTuitionActions"><button type="button" data-reset>기본 교육비로 되돌리기</button><button type="button" data-cancel>취소</button><button type="button" class="primary" data-save>교육비 저장</button></div></div>';
    form.querySelector("[data-cancel]").onclick = () => {
      host.dataset.editing = "";
      form.innerHTML = "";
    };
    let receipt = null;
    const save = async (reset) => {
      const button = form.querySelector(reset ? "[data-reset]" : "[data-save]");
      try {
        const amount = reset
          ? null
          : readAmount(form.querySelector("[data-individual-amount]"));
        const data = {
          student_id: q.student_id,
          amount,
          effective_from: form.querySelector("[data-individual-from]").value,
          effective_to:
            form.querySelector("[data-individual-to]").value || null,
          note: form.querySelector("[data-individual-note]").value,
        };
        const key = JSON.stringify(data);
        if (!receipt || receipt.key !== key) receipt = { key, id: requestId() };
        button.disabled = true;
        await rpc("olli_tuition_write", {
          p_expected_revision: result.catalog.revision,
          p_request_id: receipt.id,
          p_action: "individual",
          p_data: data,
        });
        host.dataset.editing = "";
        await fillStudent(
          host,
          q.student_id,
          host.dataset.quoteDate || today(),
        );
        refreshFinanceIfVisible();
      } catch (e) {
        if (form.isConnected)
          form.querySelector("[data-student-error]").textContent = e.message;
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    };
    form.querySelector("[data-save]").onclick = () => save(false);
    form.querySelector("[data-reset]").onclick = () => save(true);
  }
  async function fillStudent(host, id, date = today()) {
    const sequence = (host.__tuitionSequence || 0) + 1;
    host.__tuitionSequence = sequence;
    const academy = context().academy;
    host.dataset.studentId = id;
    host.dataset.academy = academy;
    host.dataset.quoteDate = date;
    host.textContent = "교육비 확인 중…";
    try {
      const result = await rpc("olli_tuition_student", {
        p_student_id: id,
        p_date: date,
      });
      if (
        !host.isConnected ||
        host.__tuitionSequence !== sequence ||
        host.dataset.studentId !== id ||
        context().academy !== academy
      )
        return;
      host.innerHTML = studentMarkup(result);
      host.querySelector("[data-edit-tuition]").onclick = () =>
        studentEditor(host, result);
    } catch (e) {
      if (
        host.isConnected &&
        host.__tuitionSequence === sequence &&
        host.dataset.studentId === id
      )
        host.textContent = "교육비를 불러오지 못했습니다. " + e.message;
    }
  }
  function mountStudent(root, student) {
    if (!root || !student?.id || !owner()) return;
    let host = root.querySelector("[data-tuition-student]");
    if (
      host?.dataset.studentId === String(student.id) &&
      host.dataset.editing === "1"
    )
      return;
    if (!host) {
      host = document.createElement("section");
      host.className = "olliTuitionStudent";
      host.dataset.tuitionStudent = "1";
      const actions = root.querySelector(".pcStudentInfoActions");
      if (actions) actions.before(host);
      else root.appendChild(host);
    }
    fillStudent(host, String(student.id));
  }
  async function showStudent(id, date = today()) {
    const body = dialog("학생 교육비");
    body.classList.add("olliTuitionStudent");
    await fillStudent(body, id, date);
  }
  async function checkScheduleChange(id, date) {
    if (!owner() || !id) return;
    try {
      const result = await rpc("olli_tuition_student", {
        p_student_id: id,
        p_date: date || today(),
      });
      if (result.student.basis !== "individual" || !result.student.needs_review)
        return;
      const body = dialog("개별 교육비 확인 필요");
      body.innerHTML =
        '<div class="olliTuitionNotice">' +
        esc(result.student.name) +
        " 학생은 개별 교육비를 적용하고 있습니다. 수업 횟수가 주 " +
        result.student.weekly_sessions +
        '회로 변경되어 교육비를 직접 확인해 주세요. 시간표 변경은 저장되었습니다.</div><p class="olliTuitionHelp">미확정 금액은 예상 수입에서 제외됩니다.</p><button type="button" class="primary">학생 교육비 수정</button>';
      body.querySelector("button").onclick = () =>
        showStudent(id, date || today());
    } catch (e) {
      console.warn("교육비 확인 안내:", e.message);
    }
  }
  function openStudentList(rows, filter) {
    const body = dialog(
      filter === "individual"
        ? "개별 교육비 적용 학생"
        : "교육비 확인 필요 학생",
    );
    const list = (rows || []).filter((q) =>
      filter === "individual" ? q.basis === "individual" : q.needs_review,
    );
    body.innerHTML = list.length
      ? '<table class="olliTuitionTable"><thead><tr><th>학생</th><th>횟수</th><th>교육비</th><th></th></tr></thead><tbody>' +
        list
          .map(
            (q) =>
              "<tr><td>" +
              esc(q.name) +
              "</td><td>주 " +
              q.weekly_sessions +
              "회</td><td>" +
              money(q.amount) +
              '</td><td><button type="button" data-student="' +
              esc(q.student_id) +
              '">확인</button></td></tr>',
          )
          .join("") +
        "</tbody></table>"
      : "<p>해당 학생이 없습니다.</p>";
    body
      .querySelectorAll("[data-student]")
      .forEach((b) => (b.onclick = () => showStudent(b.dataset.student)));
  }
  global.addEventListener("olli:schedule-changed", (event) => {
    const d = event.detail || {};
    checkScheduleChange(d.studentId, d.effectiveDate);
  });
  global.OlliTuition = {
    openSettings,
    mountStudent,
    checkScheduleChange,
    openStudentList,
    today,
  };
})(window);
