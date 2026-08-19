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
      pass: "Все обязательные этапы On-site Screen отмечены как пройденные. Явных проблем в коротком протоколе не обнаружено; это не гарантия будущей исправности.",
    caution: "Есть оценимый недостаток. Зафиксируй стоимость устранения до оплаты.",
    stop: "Есть стоп-фактор. Не продолжай сделку, пока причина не устранена и не проверена повторно.",
    unverified: "Хотя бы один обязательный шаг не проверен или для «Пройдено / Торг» не записано доказательство. Такой пункт нельзя считать успешным.",
  };

  const checkElements = [...document.querySelectorAll("[data-check]")];
  const claimElements = [...document.querySelectorAll("[data-claim]")];
  const verdictOutput = document.querySelector("[data-verdict-output]");
  const verdictLabel = document.querySelector("[data-verdict-label]");
  const verdictReason = document.querySelector("[data-verdict-reason]");
  const reportPreview = document.querySelector("[data-report-preview]");
  const feedback = document.querySelector("[data-action-feedback]");
  const automationFeedback = document.querySelector("[data-automation-feedback]");
  const driveInput = document.querySelector("[data-usb-drive]");
  const autocheckPreview = document.querySelector("[data-autocheck-command-preview]");
  const usbPreview = document.querySelector("[data-usb-command-preview]");
  const guidedPreview = document.querySelector("[data-guided-command-preview]");

  const emptyState = () => ({ claims: {}, checks: {} });
  let state = emptyState();

  function cleanStatus(value) {
    return supportedStatuses.includes(value) ? value : null;
  }

  function effectiveStatus(check = {}) {
    const status = cleanStatus(check.status) || "unverified";
    if ((status === "pass" || status === "caution") && !String(check.note || "").trim()) {
      return "unverified";
    }
    return status;
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
      return effectiveStatus(state.checks[element.dataset.check]);
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

  function setAutomationFeedback(message) {
    if (!automationFeedback) return;
    automationFeedback.textContent = message;
  }

  async function copyText(text, successMessage, failureMessage, output = feedback) {
    try {
      await navigator.clipboard.writeText(text);
      if (output === automationFeedback) setAutomationFeedback(successMessage);
      else setFeedback(successMessage);
      return true;
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = text;
      fallback.setAttribute("readonly", "");
      fallback.className = "clipboard-fallback";
      document.body.append(fallback);
      fallback.select();
      const copied = document.execCommand("copy");
      fallback.remove();
      const message = copied ? successMessage : failureMessage;
      if (output === automationFeedback) setAutomationFeedback(message);
      else setFeedback(message);
      return copied;
    }
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
      const status = effectiveStatus(check);
      const title = element.dataset.checkTitle || element.dataset.check;
      lines.push(`- ${title}: ${statusLabels[status]}`);
      if (String(check.note || "").trim()) lines.push(`  Заметка: ${String(check.note).trim()}`);
    }

    const verdict = computeVerdict();
    lines.push("", `ИТОГ: ${statusLabels[verdict]}`, verdictReasons[verdict]);
    const reportConclusion = {
      pass: "В On-site Screen явных проблем не обнаружено — это не гарантия будущей исправности.",
      caution: "Есть оценимый недостаток: зафиксируй его и стоимость устранения до оплаты.",
      stop: "Обнаружен стоп-фактор: не продолжай сделку до устранения причины и повторной проверки.",
      unverified: "Положительный результат не сформирован: заверши недостающие проверки и доказательства.",
    }[verdict];
    lines.push("", reportConclusion, "Физические проверки выполняет покупатель.");
    return lines.join("\n");
  }

  async function copyReport() {
    const report = buildReport();
    await copyText(
      report,
      "Отчёт скопирован.",
      "Не удалось скопировать — выдели текст отчёта вручную.",
    );
  }

  async function copyAutocheckCommand() {
    if (!window.PcCheckCommands) {
      setAutomationFeedback("Команда не загрузилась. Обнови страницу и попробуй снова.");
      return;
    }
    const command = window.PcCheckCommands.buildAutocheckCommand();
    await copyText(
      command,
      "Скопировано. Теперь Win+X → Терминал → вставь → Enter.",
      "Не удалось скопировать. Разреши доступ к буферу обмена и повтори.",
      automationFeedback,
    );
  }

  function renderCommandPreviews() {
    if (!window.PcCheckCommands) return;
    if (autocheckPreview) autocheckPreview.value = window.PcCheckCommands.buildAutocheckCommand();
    if (guidedPreview) guidedPreview.value = window.PcCheckCommands.buildGuidedSessionCommand();
    if (usbPreview) {
      try {
        usbPreview.value = window.PcCheckCommands.buildUsbPrepCommand(driveInput?.value);
      } catch {
        usbPreview.value = "Проверь букву флешки: нужна одна буква от D до Z.";
      }
    }
  }

  async function copyUsbCommand() {
    const drive = driveInput?.value;
    try {
      if (!window.PcCheckCommands) throw new Error("Команда не загрузилась. Обнови страницу.");
      const command = window.PcCheckCommands.buildUsbPrepCommand(drive);
      await copyText(
        command,
        "Скопировано. На домашнем ПК: Win+X → Терминал → вставь → Enter.",
        "Не удалось скопировать. Разреши доступ к буферу обмена и повтори.",
        automationFeedback,
      );
    } catch (error) {
      setAutomationFeedback(error instanceof Error ? error.message : "Проверь букву флешки.");
    }
  }

  async function copyGuidedCommand() {
    if (!window.PcCheckCommands) {
      setAutomationFeedback("Команда не загрузилась. Обнови страницу и попробуй снова.");
      return;
    }
    const command = window.PcCheckCommands.buildGuidedSessionCommand();
    await copyText(
      command,
      "Скопировано. Win+X → Терминал → вставь → Enter. Подтверди UAC только для проверенного издателя.",
      "Не удалось скопировать. Разреши доступ к буферу обмена и повтори.",
      automationFeedback,
    );
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
  document.querySelector('[data-action="copy-autocheck-command"]')?.addEventListener("click", copyAutocheckCommand);
  document.querySelector('[data-action="copy-usb-command"]')?.addEventListener("click", copyUsbCommand);
  document.querySelector('[data-action="copy-guided-command"]')?.addEventListener("click", copyGuidedCommand);
  driveInput?.addEventListener?.("input", renderCommandPreviews);
  document.querySelector('[data-action="print-report"]')?.addEventListener("click", () => {
    if (reportPreview) reportPreview.textContent = buildReport();
    window.print();
  });
  document.querySelector('[data-action="reset"]')?.addEventListener("click", resetProgress);

  state = readState();
  renderCommandPreviews();
  renderState();
})();
