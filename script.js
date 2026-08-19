(() => {
  "use strict";

  const storageKey = "pc-check-field-guide-v1";
  const supportedStatuses = ["stop", "unverified", "caution", "pass"];
  const statusLabels = {
    pass: "ПРОЙДЕНО",
    caution: "ТОРГ / ОГОВОРКИ",
    stop: "СТОП",
    unverified: "НЕ ПРОВЕРЕНО",
  };
  const verdictReasons = {
    pass: "Все пять шагов отмечены как пройденные. Это снижает риск, но не даёт гарантии.",
    caution: "Есть оценимый недостаток. Зафиксируй стоимость устранения до оплаты.",
    stop: "Есть стоп-фактор. Не продолжай сделку, пока причина не устранена и не проверена повторно.",
    unverified: "Хотя бы один обязательный шаг не проверен. Такой пункт нельзя считать успешным.",
  };

  const checkElements = [...document.querySelectorAll("[data-check]")];
  const claimElements = [...document.querySelectorAll("[data-claim]")];
  const verdictOutput = document.querySelector("[data-verdict-output]");
  const verdictLabel = document.querySelector("[data-verdict-label]");
  const verdictReason = document.querySelector("[data-verdict-reason]");
  const reportPreview = document.querySelector("[data-report-preview]");
  const feedback = document.querySelector("[data-action-feedback]");

  const emptyState = () => ({ claims: {}, checks: {} });
  let state = emptyState();

  function cleanStatus(value) {
    return supportedStatuses.includes(value) ? value : null;
  }

  function readState() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (!saved || typeof saved !== "object") return emptyState();
      return {
        claims: saved.claims && typeof saved.claims === "object" ? saved.claims : {},
        checks: saved.checks && typeof saved.checks === "object" ? saved.checks : {},
      };
    } catch {
      return emptyState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      setFeedback("Браузер запретил локальное сохранение. Не закрывай вкладку до конца проверки.");
    }
  }

  function normalizedStatuses() {
    return checkElements.map((element) => {
      const saved = state.checks[element.dataset.check];
      return cleanStatus(saved?.status) || "unverified";
    });
  }

  function computeVerdict(statuses = normalizedStatuses()) {
    if (statuses.includes("stop")) return "stop";
    if (statuses.includes("unverified")) return "unverified";
    if (statuses.includes("caution")) return "caution";
    return "pass";
  }

  function updateVerdict() {
    const verdict = computeVerdict();
    if (verdictOutput) verdictOutput.dataset.verdictOutput = verdict;
    if (verdictLabel) verdictLabel.textContent = statusLabels[verdict];
    if (verdictReason) verdictReason.textContent = verdictReasons[verdict];
    if (reportPreview) reportPreview.textContent = buildReport();
  }

  function renderState() {
    for (const input of claimElements) {
      input.value = state.claims[input.dataset.claim] || "";
    }

    for (const element of checkElements) {
      const check = state.checks[element.dataset.check] || {};
      const status = cleanStatus(check.status);
      for (const button of element.querySelectorAll("[data-status]")) {
        const pressed = button.dataset.status === status;
        button.setAttribute("aria-pressed", String(pressed));
      }
      const note = element.querySelector("[data-note]");
      if (note) note.value = check.note || "";
    }
    updateVerdict();
  }

  function setFeedback(message) {
    if (!feedback) return;
    feedback.textContent = message;
    window.setTimeout(() => {
      if (feedback.textContent === message) feedback.textContent = "";
    }, 3500);
  }

  function formatClaim(key, fallback = "не заполнено") {
    const value = String(state.claims[key] || "").trim();
    return value || fallback;
  }

  function buildReport() {
    const lines = [
      "ПРОВЕРКА Б/У WINDOWS-ПК",
      `Модель / объявление: ${formatClaim("claim")}`,
      `Цена: ${formatClaim("price")}`,
      `Дата и место: ${formatClaim("meeting")}`,
      `Manifest флешки: ${formatClaim("manifest")}`,
      "",
      "РЕЗУЛЬТАТЫ",
    ];

    for (const element of checkElements) {
      const check = state.checks[element.dataset.check] || {};
      const status = cleanStatus(check.status) || "unverified";
      const title = element.dataset.checkTitle || element.dataset.check;
      lines.push(`- ${title}: ${statusLabels[status]}`);
      if (String(check.note || "").trim()) lines.push(`  Заметка: ${String(check.note).trim()}`);
    }

    const verdict = computeVerdict();
    lines.push("", `ИТОГ: ${statusLabels[verdict]}`, verdictReasons[verdict]);
    lines.push("", "Короткая проверка не является гарантией. Физические проверки выполняет покупатель.");
    return lines.join("\n");
  }

  async function copyReport() {
    const report = buildReport();
    try {
      await navigator.clipboard.writeText(report);
      setFeedback("Отчёт скопирован.");
      return;
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = report;
      fallback.setAttribute("readonly", "");
      fallback.className = "clipboard-fallback";
      document.body.append(fallback);
      fallback.select();
      const copied = document.execCommand("copy");
      fallback.remove();
      setFeedback(copied ? "Отчёт скопирован." : "Не удалось скопировать — выдели текст отчёта вручную.");
    }
  }

  function resetProgress() {
    const confirmed = window.confirm("Удалить все поля, заметки и статусы этой проверки?");
    if (!confirmed) return;
    let storageWasCleared = true;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      storageWasCleared = false;
    }
    state = emptyState();
    renderState();
    setFeedback(
      storageWasCleared
        ? "Локальные данные удалены."
        : "Поля очищены, но браузер не дал удалить сохранённую копию. Очисти данные сайта вручную.",
    );
  }

  for (const input of claimElements) {
    input.addEventListener("input", () => {
      state.claims[input.dataset.claim] = input.value;
      saveState();
      updateVerdict();
    });
  }

  for (const element of checkElements) {
    const id = element.dataset.check;
    for (const button of element.querySelectorAll("[data-status]")) {
      button.addEventListener("click", () => {
        state.checks[id] ||= {};
        state.checks[id].status = button.dataset.status;
        saveState();
        renderState();
      });
    }
    const note = element.querySelector("[data-note]");
    note?.addEventListener("input", () => {
      state.checks[id] ||= {};
      state.checks[id].note = note.value;
      saveState();
      updateVerdict();
    });
  }

  document.querySelector('[data-action="copy-report"]')?.addEventListener("click", copyReport);
  document.querySelector('[data-action="print-report"]')?.addEventListener("click", () => {
    if (reportPreview) reportPreview.textContent = buildReport();
    window.print();
  });
  document.querySelector('[data-action="reset"]')?.addEventListener("click", resetProgress);

  state = readState();
  renderState();
})();
