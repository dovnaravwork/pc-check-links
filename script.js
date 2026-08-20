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
  const progressBar = document.querySelector("[data-check-progress-bar]");
  const progressCount = document.querySelector("[data-check-progress-count]");
  const progressVerdict = document.querySelector("[data-progress-verdict]");
  const progressStopCount = document.querySelector("[data-progress-stop-count]");
  const progressRoot = document.querySelector("[data-check-progress]");
  const screenOverlay = document.querySelector("[data-screen-overlay]");
  const screenLabel = document.querySelector("[data-screen-label]");
  const screenProgress = document.querySelector("[data-screen-progress]");
  const screenConfirm = document.querySelector("[data-screen-confirm]");
  const screenColors = [
    { color: "#ffffff", label: "Белый фон · ищи пятна и битые пиксели" },
    { color: "#000000", label: "Чёрный фон · ищи засветы и светлые точки" },
    { color: "#e53935", label: "Красный фон · цвет должен быть ровным" },
    { color: "#43a047", label: "Зелёный фон · цвет должен быть ровным" },
    { color: "#1e88e5", label: "Синий фон · цвет должен быть ровным" },
    { color: "#bfbfbf", label: "Светло-серый 75% · ищи пятна и полосы" },
    { color: "#808080", label: "Серый 50% · проверь равномерность подсветки" },
    { color: "#404040", label: "Тёмно-серый 25% · ищи засветы по краям" },
  ];
  const requiredKeyboardCodes = [
    "Escape", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6",
    "Digit7", "Digit8", "Digit9", "Digit0", "Backspace", "Tab", "KeyQ",
    "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO",
    "KeyP", "CapsLock", "KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH",
    "KeyJ", "KeyK", "KeyL", "Enter", "ShiftLeft", "KeyZ", "KeyX", "KeyC",
    "KeyV", "KeyB", "KeyN", "KeyM", "ArrowUp", "ControlLeft", "AltLeft",
    "Space", "ArrowLeft", "ArrowDown", "ArrowRight",
  ];
  let screenColorIndex = 0;
  let keyboardHandler = null;
  let heardSoundChannels = new Set();

  const emptyState = () => ({ claims: {}, checks: {}, browser: {} });
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
        browser: saved.browser && typeof saved.browser === "object" ? saved.browser : {},
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

  function touchSession() {
    if (!state.claims.startedAt) state.claims.startedAt = new Date().toISOString();
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
    updateProgress();
  }

  function updateProgress() {
    const completed = checkElements.filter((element) => {
      return cleanStatus(state.checks[element.dataset.check]?.status);
    }).length;
    const total = checkElements.length;
    const percentage = total ? Math.round((completed / total) * 100) : 0;
    const statuses = normalizedStatuses();
    const verdict = computeVerdict(statuses);
    const stopCount = statuses.filter((status) => status === "stop").length;
    if (progressBar) progressBar.style.width = `${percentage}%`;
    if (progressCount) progressCount.textContent = `${completed} / ${total}`;
    if (progressVerdict) progressVerdict.textContent = statusLabels[verdict];
    if (progressStopCount) progressStopCount.textContent = `СТОП: ${stopCount}`;
    if (progressRoot) progressRoot.dataset.verdict = verdict;
  }

  function renderBrowserState(kind) {
    const card = document.querySelector(`[data-browser-card="${kind}"]`);
    if (!card) return;
    const browserCheck = state.browser?.[kind] || {};
    const status = ["active", "pass", "stop", "caution"].includes(browserCheck.status)
      ? browserCheck.status
      : "idle";
    const labels = {
      idle: "Ожидает",
      active: "Идёт",
      pass: "Пройдено",
      stop: "Проблема",
      caution: "Недоступно",
    };
    card.dataset.state = status;
    const badge = card.querySelector("[data-test-badge]");
    if (badge) badge.textContent = labels[status];
    const result = card.querySelector(`[data-test-result="${kind}"]`);
    if (result) {
      result.dataset.state = status;
      result.textContent = browserCheck.message || "Результата пока нет.";
    }
    if (status === "idle" && kind === "keys") {
      const keyboardMap = card.querySelector("[data-keyboard-map]");
      if (keyboardMap) keyboardMap.hidden = true;
      card.querySelectorAll("[data-key-code]").forEach((key) => key.classList.remove("is-hit"));
      const keyboardCount = card.querySelector("[data-keyboard-count]");
      if (keyboardCount) keyboardCount.textContent = `0 / ${requiredKeyboardCodes.length}`;
    }
    if (status === "idle" && kind === "sound") {
      const controls = card.querySelector("[data-sound-controls]");
      if (controls) controls.hidden = true;
      card.querySelectorAll("[data-sound-channel]").forEach((button) => {
        delete button.dataset.played;
      });
      card.querySelectorAll("[data-sound-answer]").forEach((button) => {
        button.disabled = true;
      });
    }
  }

  function setBrowserState(kind, status, message) {
    state.browser ||= {};
    state.browser[kind] = { status, message };
    saveState();
    renderBrowserState(kind);
  }

  function renderState() {
    for (const input of claimElements) {
      input.value = state.claims[input.dataset.claim] || "";
    }

    for (const element of checkElements) {
      const check = state.checks[element.dataset.check] || {};
      const status = cleanStatus(check.status);
      element.dataset.checkState = effectiveStatus(check);
      for (const button of element.querySelectorAll("[data-status]")) {
        const pressed = button.dataset.status === status;
        button.setAttribute("aria-pressed", String(pressed));
      }
      const note = element.querySelector("[data-note]");
      if (note) note.value = check.note || "";
    }
    for (const kind of ["screen", "keys", "sound"]) renderBrowserState(kind);
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

  function revealCommandPreview(preview) {
    if (!preview) return;
    const details = preview.closest?.(".command-details");
    if (details) details.open = true;
    preview.closest?.(".automation-card")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    window.setTimeout(() => {
      if (typeof preview.focus === "function") preview.focus({ preventScroll: true });
      if (typeof preview.select === "function") preview.select();
    }, 350);
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
      `Профиль: ${formatClaim("profile", "не выбран")}`,
      `Идентификатор ПК: ${formatClaim("machine")}`,
      `Цена: ${formatClaim("price")}`,
      `Дата и место: ${formatClaim("meeting")}`,
      `Начало сессии: ${formatClaim("startedAt")}`,
      `Отчёт создан: ${new Date().toISOString()}`,
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
    revealCommandPreview(autocheckPreview);
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
      revealCommandPreview(usbPreview);
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
    revealCommandPreview(guidedPreview);
  }

  function showScreenColor() {
    if (!screenOverlay) return;
    const current = screenColors[screenColorIndex];
    screenOverlay.style.background = current.color;
    if (screenLabel) screenLabel.textContent = current.label;
    if (screenProgress) screenProgress.textContent = `${screenColorIndex + 1} / ${screenColors.length}`;
    const atLastColor = screenColorIndex === screenColors.length - 1;
    if (screenConfirm) screenConfirm.hidden = !atLastColor;
    const nextButton = document.querySelector('[data-action="screen-next"]');
    if (nextButton) nextButton.hidden = atLastColor;
  }

  async function startScreenTest(result) {
    if (!screenOverlay) return;
    screenColorIndex = 0;
    screenOverlay.hidden = false;
    showScreenColor();
    setBrowserState("screen", "active", "Полноэкранный тест запущен. Пройди все восемь заливок и оцени экран сам.");
    try {
      await screenOverlay.requestFullscreen();
    } catch {
      screenOverlay.classList.add("windowed");
    }
    result.textContent = "Полноэкранный тест запущен. Пройди все восемь заливок и оцени экран сам.";
  }

  function nextScreenColor() {
    screenColorIndex = Math.min(screenColorIndex + 1, screenColors.length - 1);
    showScreenColor();
  }

  async function closeScreenOverlay() {
    if (screenOverlay) {
      screenOverlay.hidden = true;
      screenOverlay.classList.remove("windowed");
    }
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // The overlay is already hidden; fullscreen may have closed itself.
      }
    }
  }

  async function exitScreenTest() {
    await closeScreenOverlay();
    if (state.browser?.screen?.status === "active") {
      setBrowserState("screen", "idle", "Тест закрыт без оценки. Запусти его снова и подтверди результат после восьмой заливки.");
    }
  }

  async function completeScreenTest(status) {
    await closeScreenOverlay();
    const passed = status === "pass";
    setBrowserState(
      "screen",
      passed ? "pass" : "stop",
      passed
        ? "Все восемь заливок просмотрены, видимых дефектов не отмечено."
        : "На заливках замечен дефект экрана — зафиксируй его на фото и считай это проблемой.",
    );
  }

  function startKeyboardTest(result) {
    if (keyboardHandler) window.removeEventListener("keydown", keyboardHandler);
    const pressedKeyboardCodes = new Set();
    const card = document.querySelector('[data-browser-card="keys"]');
    const keyboardMap = card?.querySelector("[data-keyboard-map]");
    const keyboardCount = card?.querySelector("[data-keyboard-count]");
    if (keyboardMap) keyboardMap.hidden = false;
    card?.querySelectorAll("[data-key-code]").forEach((key) => key.classList.remove("is-hit"));
    if (keyboardCount) keyboardCount.textContent = `0 / ${requiredKeyboardCodes.length}`;
    setBrowserState("keys", "active", `Нажми все ${requiredKeyboardCodes.length} показанных клавиш.`);
    result.textContent = `Нажми все ${requiredKeyboardCodes.length} показанных клавиш.`;
    keyboardHandler = (event) => {
      if (!requiredKeyboardCodes.includes(event.code) || event.repeat) return;
      event.preventDefault();
      pressedKeyboardCodes.add(event.code);
      card?.querySelector(`[data-key-code="${event.code}"]`)?.classList.add("is-hit");
      if (keyboardCount) {
        keyboardCount.textContent = `${pressedKeyboardCodes.size} / ${requiredKeyboardCodes.length}`;
      }
      const complete = requiredKeyboardCodes.every((code) => pressedKeyboardCodes.has(code));
      result.textContent = complete
        ? `Получены все ${requiredKeyboardCodes.length} клавиш — показанная часть клавиатуры реагирует.`
        : `Получено ${pressedKeyboardCodes.size} / ${requiredKeyboardCodes.length}. Неподтверждённые клавиши остались светлыми.`;
      if (complete) {
        setBrowserState("keys", "pass", result.textContent);
        window.removeEventListener("keydown", keyboardHandler);
        keyboardHandler = null;
      }
    };
    window.addEventListener("keydown", keyboardHandler);
  }

  function startSoundTest(result) {
    heardSoundChannels = new Set();
    const controls = document.querySelector("[data-sound-controls]");
    if (controls) controls.hidden = false;
    document.querySelectorAll("[data-sound-channel]").forEach((button) => {
      delete button.dataset.played;
    });
    document.querySelectorAll("[data-sound-answer]").forEach((button) => {
      button.disabled = true;
    });
    setBrowserState("sound", "active", "Сначала воспроизведи левый, затем правый канал.");
    result.textContent = "Сначала воспроизведи левый, затем правый канал.";
  }

  async function playSoundChannel(channel) {
    const result = document.querySelector('[data-test-result="sound"]');
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio недоступен");
      const audio = new AudioContextClass();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const panner = audio.createStereoPanner();
      panner.pan.value = channel === "left" ? -1 : 1;
      oscillator.frequency.value = channel === "left" ? 440 : 660;
      gain.gain.setValueAtTime(0.16, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.7);
      oscillator.connect(gain).connect(panner).connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.7);
      oscillator.addEventListener("ended", () => audio.close());
      heardSoundChannels.add(channel);
      const channelButton = document.querySelector(`[data-sound-channel="${channel}"]`);
      if (channelButton) channelButton.dataset.played = "true";
      const ready = heardSoundChannels.size === 2;
      document.querySelectorAll("[data-sound-answer]").forEach((button) => {
        button.disabled = !ready;
      });
      if (result) {
        result.textContent = ready
          ? "Оба канала воспроизведены. Подтверди, что каждый был слышен с правильной стороны."
          : `${channel === "left" ? "Левый" : "Правый"} канал воспроизведён. Теперь проверь второй.`;
      }
    } catch {
      setBrowserState("sound", "caution", "Браузер не дал воспроизвести стереозвук. Проверь разрешения и устройство вывода вручную.");
    }
  }

  function completeSoundTest(status) {
    const passed = status === "pass";
    setBrowserState(
      "sound",
      passed ? "pass" : "stop",
      passed
        ? "Левый и правый каналы слышны с правильных сторон."
        : "Один из каналов не слышен или звучит не с той стороны — проверь вывод и разъёмы.",
    );
  }

  function browserTest(kind) {
    const result = document.querySelector(`[data-test-result="${kind}"]`);
    if (!result) return;
    if (kind === "screen") {
      startScreenTest(result);
    } else if (kind === "keys") {
      startKeyboardTest(result);
    } else {
      startSoundTest(result);
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
      touchSession();
      state.claims[input.dataset.claim] = input.value;
      saveState();
      updateVerdict();
    });
  }

  for (const element of checkElements) {
    const id = element.dataset.check;
    for (const button of element.querySelectorAll("[data-status]")) {
      button.addEventListener("click", () => {
        touchSession();
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
      element.dataset.checkState = effectiveStatus(state.checks[id]);
      saveState();
      updateVerdict();
    });
  }

  document.querySelector('[data-action="copy-report"]')?.addEventListener("click", copyReport);
  document.querySelector('[data-action="copy-autocheck-command"]')?.addEventListener("click", copyAutocheckCommand);
  document.querySelector('[data-action="copy-usb-command"]')?.addEventListener("click", copyUsbCommand);
  document.querySelector('[data-action="copy-guided-command"]')?.addEventListener("click", copyGuidedCommand);
  document.querySelector('[data-hero-action="usb"]')?.addEventListener("click", copyUsbCommand);
  document.querySelector('[data-hero-action="guided"]')?.addEventListener("click", copyGuidedCommand);
  document.querySelectorAll("[data-browser-test]").forEach((button) => button.addEventListener("click", () => browserTest(button.dataset.browserTest)));
  document.querySelector('[data-action="screen-next"]')?.addEventListener("click", (event) => {
    event.stopPropagation();
    nextScreenColor();
  });
  document.querySelector('[data-action="screen-exit"]')?.addEventListener("click", (event) => {
    event.stopPropagation();
    exitScreenTest();
  });
  document.querySelector('[data-action="screen-confirm-pass"]')?.addEventListener("click", (event) => {
    event.stopPropagation();
    completeScreenTest("pass");
  });
  document.querySelector('[data-action="screen-confirm-stop"]')?.addEventListener("click", (event) => {
    event.stopPropagation();
    completeScreenTest("stop");
  });
  screenOverlay?.addEventListener("click", (event) => {
    if (event.target === screenOverlay) nextScreenColor();
  });
  document.addEventListener?.("fullscreenchange", () => {
    if (!document.fullscreenElement && screenOverlay && !screenOverlay.hidden) exitScreenTest();
  });
  document.querySelectorAll("[data-sound-channel]").forEach((button) => {
    button.addEventListener("click", () => playSoundChannel(button.dataset.soundChannel));
  });
  document.querySelectorAll("[data-sound-answer]").forEach((button) => {
    button.addEventListener("click", () => completeSoundTest(button.dataset.soundAnswer));
  });
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
