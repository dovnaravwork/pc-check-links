import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(resolve(root, name), "utf8");
const readOptional = (name) =>
  existsSync(resolve(root, name)) ? read(name) : "";

const html = read("index.html");
const css = read("style.css");
const script = readOptional("script.js");
const commandsScript = readOptional("commands.js");
const readme = readOptional("README.md");

function tags(name, source = html) {
  return [...source.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map(
    ([tag]) => tag,
  );
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1];
}

function toolCard(name) {
  const cards = [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/gi)].map(
    ([card]) => card,
  );
  return cards.find((card) =>
    new RegExp(`<h3[^>]*>\\s*${name}\\s*</h3>`, "i").test(card),
  );
}

function indexOfAny(source, patterns) {
  const indexes = patterns
    .map((pattern) => source.search(pattern))
    .filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

function assertPattern(source, pattern, message) {
  assert.ok(
    pattern.test(source),
    message ?? `missing required pattern: ${pattern}`,
  );
}

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  return startIndex >= 0 && endIndex > startIndex
    ? source.slice(startIndex, endIndex)
    : "";
}

test("loads all runtime code locally, including script.js", () => {
  assert.ok(
    existsSync(resolve(root, "script.js")),
    "script.js must exist beside index.html",
  );
  assertPattern(
    html,
    /<script\b(?=[^>]*\bsrc=["']script\.js["'])[^>]*><\/script>/i,
    "index.html must load the local script.js",
  );
});

test("offers copy actions for guided diagnostics, USB preparation, and native autocheck", () => {
  assert.ok(commandsScript, "commands.js must contain auditable local commands");
  assertPattern(
    html,
    /<script\b(?=[^>]*\bsrc=["']commands\.js["'])[^>]*><\/script>/i,
    "index.html must load commands.js locally",
  );
  assertPattern(html, /\bdata-action=["']copy-usb-command["']/i);
  assertPattern(html, /\bdata-action=["']copy-autocheck-command["']/i);
  assertPattern(html, /\bdata-action=["']copy-guided-command["']/i);
  assertPattern(html, /\bdata-usb-drive\b/i);
  assertPattern(html, /\bdata-usb-command-preview\b/i);
  assertPattern(html, /\bdata-autocheck-command-preview\b/i);
  assertPattern(html, /\bdata-guided-command-preview\b/i);
  assert.ok(
    tags("textarea").filter((tag) => /command-preview/i.test(tag)).every((tag) => /\breadonly\b/i.test(tag)),
    "terminal command previews must be read-only",
  );
  assertPattern(script, /PcCheckCommands\.buildUsbPrepCommand\s*\(/);
  assertPattern(script, /PcCheckCommands\.buildAutocheckCommand\s*\(/);
  assertPattern(script, /PcCheckCommands\.buildGuidedSessionCommand\s*\(/);
});

test("builds a fail-closed guided session that installs and opens official tools", () => {
  const context = { window: {} };
  vm.runInNewContext(commandsScript, context);
  const command = context.window.PcCheckCommands.buildGuidedSessionCommand();

  for (const id of [
    "CPUID.CPU-Z",
    "TechPowerUp.GPU-Z",
    "CrystalDewWorld.CrystalDiskInfo",
    "REALiX.HWiNFO",
    "OCBase.OCCT.Personal",
  ]) {
    assert.match(command, new RegExp(id.replaceAll(".", "\\.")));
  }
  assert.match(command, /winget\s+install/i);
  assert.match(command, /winget\s+export[\s\S]{0,180}--include-versions/i);
  assert.match(command, /Existing\.Version\s+-ceq\s+\$Version/i);
  assert.match(command, /install\s+--id[^;]*--version/i);
  assert.match(command, /VerifiedPackage\.Version\s+-cne\s+\$Package\.Version/i);
  assert.match(command, /--exact/i);
  assert.match(command, /--source\s+winget/i);
  assert.match(command, /--silent/i);
  assert.match(command, /source\s+export/i);
  assert.match(command, /Microsoft\.Winget\.Source_8wekyb3d8bbwe/i);
  assert.match(command, /Get-AppxPackage\s+-Name\s+Microsoft\.DesktopAppInstaller/i);
  assert.match(command, /PublisherId\s+-ne\s+'8wekyb3d8bbwe'/i);
  assert.match(command, /SignatureKind\s+-ne\s+'Store'/i);
  assert.match(command, /Status\s+-ne\s+'Ok'/i);
  assert.match(command, /\[string\]::Equals\(\$Winget,\$ExpectedWinget/i);
  assert.match(command, /Get-AuthenticodeSignature/i);
  assert.match(command, /Start-Process/i);
  assert.match(command, /Microsoft-Windows-WHEA-Logger/i);
  assert.match(command, /Kernel-Power|BugCheck/i);
  assert.match(command, /Display/i);
  assert.match(command, /Disk|stornvme|storahci/i);
  assert.match(command, /BASELINE|baseline/i);
  assert.match(command, /INCOMPLETE/i);
  assert.match(command, /CPU-Z-report/i);
  assert.match(command, /ArgumentList\s*\(\s*'-txt='/i);
  assert.match(command, /ArgumentList\s*'\/CopyExit'/i);
  assert.match(command, /\$OcctProcess=Start-Process -FilePath \$Occt/i);
  assert.match(command, /PC_CHECK_SAFE_MODE/i);
  assert.match(command, /SAFE MODE: интерфейсы и нагрузка не запускались/i);
  assert.match(command, /CPU-Z не создал свежий отчёт/i);
  assert.match(command, /CPU-Z завис и не был остановлен/i);
  assert.match(command, /CrystalDiskInfo не создал свежий DiskInfo\.txt/i);
  assert.match(command, /CrystalDiskInfo завис и не был остановлен/i);
  assert.match(command, /CrystalDiskInfo post-check завис и не был остановлен/i);
  assert.match(command, /\$Unavailable=@\(\)/i);
  assert.match(
    command,
    /CPUID\.CPU-Z[\s\S]{0,320}\$Unavailable\+=[\s\S]{0,220}continue/i,
    "an unreachable CPU-Z publisher must degrade to a visible fallback",
  );
  assert.match(command, /CPU-Z недоступен[\s\S]{0,220}HWiNFO Summary/i);
  assert.match(command, /CPUID\.CPU-Z'\)\{30000\}else\{300000\}/i);
  assert.doesNotMatch(command, /CurrentVersion\\Uninstall|Get-Command\s+\$Name/i);
  assert.match(command, /Microsoft\\WinGet\\Packages/i);
  assert.match(command, /GetNameInfo\([^;]*SimpleName/i);
  assert.match(command, /-cne\s+\$ExpectedPublisher/i);
  assert.match(command, /FileVersion[\s\S]{0,160}StartsWith/i);
  assert.match(command, /Killer\.ExitCode[\s\S]*Process\.HasExited[\s\S]*Process\.Kill\s*\(/i);
  assert.match(command, /Get-WinEvent[\s\S]{0,220}-ErrorAction\s+Stop/i);
  assert.match(command, /NoMatchingEventsFound[\s\S]{0,120}return\s+@\(\)[\s\S]{0,120}throw/i);
  assert.match(command, /ConvertTo-Json\s+-InputObject\s+\$Baseline/i);
  assert.match(command, /ConvertTo-Json\s+-InputObject\s+\$Post/i);
  assert.ok((command.match(/ArgumentList\s*'\/CopyExit'/gi) || []).length >= 2);
  assert.match(command, /CrystalDiskInfo-post\.txt/i);
  assert.match(command, /Get-StorageReliabilityCounter/i);
  assert.match(command, /storage-baseline\.json/i);
  assert.match(command, /storage-post\.json/i);
  assert.match(command, /Kernel-Power'[\s\S]{0,100}41/i);
  assert.match(command, /Display'[\s\S]{0,100}4101/i);
  assert.match(command, /STOP-SYSTEM-EVENTS\.txt/i);
  assert.match(command, /STOP-STORAGE\.txt/i);
  assert.match(command, /\$MissingDisks=@\([\s\S]{0,220}StorageAfter\.DeviceId\s+-notcontains/i);
  assert.match(command, /catch[\s\S]*INCOMPLETE[\s\S]*ERROR\.txt/i);
  assert.doesNotMatch(command, /ignore-security-hash|--force|ExecutionPolicy\s+Bypass/i);
  assert.doesNotMatch(command, /SendKeys|AutoHotkey|pywinauto|UIAutomation/i);
  assert.doesNotMatch(command, /(?:OCCT|occt)[^;]{0,200}(?:Power|3D\s+Adaptive|VRAM)[^;]{0,100}(?:--|\/run|Start)/i);
});

test("builds a WinGet-only USB command for all five diagnostics", () => {
  const context = { window: {} };
  vm.runInNewContext(commandsScript, context);
  const api = context.window.PcCheckCommands;
  assert.ok(api, "commands.js must expose PcCheckCommands");

  const command = api.buildUsbPrepCommand("f:");
  assert.match(command, /\$Drive='F:';/);
  for (const id of [
    "CPUID.CPU-Z",
    "TechPowerUp.GPU-Z",
    "CrystalDewWorld.CrystalDiskInfo",
    "REALiX.HWiNFO",
    "OCBase.OCCT.Personal",
  ]) {
    assert.match(command, new RegExp(id.replaceAll(".", "\\.")));
  }
  assert.match(command, /winget\s+download/i);
  assert.match(command, /--exact/i);
  assert.match(command, /--source\s+winget/i);
  assert.match(command, /--download-directory/i);
  assert.match(command, /Get-FileHash[^;]*SHA256/i);
  assert.match(command, /\.FullName\.Substring\s*\(\s*\$Tools\.Length\s*\)/i);
  assert.match(command, /File\s*=.*SHA256\s*=/i);
  assert.match(command, /WaitForExit\s*\(\s*\$TimeoutMs\s*\)/i);
  assert.match(command, /\.Kill\s*\(\s*\)/i);
  assert.match(command, /\.ExitCode/i);
  assert.match(command, /\.WaitForExit\s*\(\s*5000\s*\)/i);
  assert.match(command, /taskkill\.exe/i);
  assert.match(
    command,
    /Get-MpThreatDetection\s+-ErrorAction\s+Stop/i,
    "Defender threat enumeration must fail closed",
  );
  assert.match(
    command,
    /Test-Path[\s\S]*Get-FileHash[\s\S]*SHA256/i,
    "downloaded files must be revalidated after Defender scans them",
  );
  assert.match(
    command,
    /Killer\.ExitCode[\s\S]*Process\.HasExited[\s\S]*Process\.Kill\s*\(/i,
    "a failed taskkill must fall back to bounded direct process termination",
  );
  assert.match(command, /INCOMPLETE/i);
  assert.match(command, /throw/i);
  assert.match(command, /\.staging/i);
  assert.match(command, /source\s+export/i);
  assert.match(command, /https:\/\/cdn\.winget\.microsoft\.com\/cache/i);
  assert.match(command, /Microsoft\.Winget\.Source_8wekyb3d8bbwe/i);
  assert.match(command, /TrustLevel/i);
  assert.match(command, /DriveType[^;]{0,100}(?:-ne|!=)\s*2/i);
  for (const version of ["2.21", "2.70.0", "9.9.2", "8.50", "17.0.16.0"]) {
    assert.match(command, new RegExp(version.replaceAll(".", "\\.")));
  }
  assert.ok(
    command.indexOf("CPUID.CPU-Z") > command.indexOf("OCBase.OCCT.Personal"),
    "the known-slow CPU-Z download must run last",
  );
  assert.doesNotMatch(command, /winget\s+(?:install|import)/i);
  assert.doesNotMatch(command, /ignore-security-hash/i);
  assert.doesNotMatch(command, /--architecture/i);
  assert.throws(() => api.buildUsbPrepCommand("C:"), /D.*Z/i);
  assert.throws(() => api.buildUsbPrepCommand("F:\\PC"), /D.*Z/i);
});

test("builds a local-only autocheck command without stress or security bypasses", () => {
  const context = { window: {} };
  vm.runInNewContext(commandsScript, context);
  const command = context.window.PcCheckCommands.buildAutocheckCommand();

  assert.match(command, /Get-CimInstance\s+Win32_Processor/i);
  assert.match(command, /Get-CimInstance\s+Win32_VideoController/i);
  assert.match(command, /Get-PhysicalDisk/i);
  assert.match(command, /Get-PnpDevice/i);
  assert.match(command, /Microsoft-Windows-WHEA-Logger/i);
  assert.match(command, /ConvertTo-Json/i);
  assert.match(command, /НЕ ПРОВЕРЕНО/i);
  assert.doesNotMatch(command, /(?:Invoke-WebRequest|curl|wget|Start-BitsTransfer|https?:\/\/)/i);
  assert.doesNotMatch(command, /(?:Invoke-Expression|\biex\b|ExecutionPolicy|Add-MpPreference|Set-MpPreference)/i);
  assert.doesNotMatch(command, /(?:OCCT|3D\s+Adaptive|Power\s+test)/i);
  assert.doesNotMatch(command, /InstanceId|Exception\.Message/i);
  assert.match(command, /System32\\notepad\.exe/i);
});

test("copies all generated commands through the visible buttons", async () => {
  const handlers = {};
  const copied = [];
  const automationFeedback = { textContent: "" };
  const driveInput = { value: "G:" };
  const autoPreview = { value: "" };
  const usbPreview = { value: "" };
  const guidedPreview = { value: "" };
  const button = (name) => ({
    addEventListener(type, handler) {
      if (type === "click") handlers[name] = handler;
    },
  });
  const elements = new Map([
    ['[data-action="copy-autocheck-command"]', button("autocheck")],
    ['[data-action="copy-usb-command"]', button("usb")],
    ['[data-action="copy-guided-command"]', button("guided")],
    ["[data-usb-drive]", driveInput],
    ["[data-autocheck-command-preview]", autoPreview],
    ["[data-usb-command-preview]", usbPreview],
    ["[data-guided-command-preview]", guidedPreview],
    ["[data-automation-feedback]", automationFeedback],
  ]);
  const context = {
    window: { setTimeout() {}, print() {} },
    navigator: { clipboard: { async writeText(value) { copied.push(value); } } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      querySelector(selector) { return elements.get(selector) ?? null; },
      querySelectorAll() { return []; },
      createElement() { throw new Error("clipboard fallback should not run"); },
      execCommand() { return false; },
      body: { append() {} },
    },
  };
  vm.runInNewContext(commandsScript, context);
  vm.runInNewContext(script, context);

  await handlers.autocheck();
  await handlers.usb();
  await handlers.guided();

  assert.equal(copied[0], context.window.PcCheckCommands.buildAutocheckCommand());
  assert.equal(copied[1], context.window.PcCheckCommands.buildUsbPrepCommand("G:"));
  assert.equal(autoPreview.value, copied[0]);
  assert.equal(usbPreview.value, copied[1]);
  assert.equal(copied[2], context.window.PcCheckCommands.buildGuidedSessionCommand());
  assert.equal(guidedPreview.value, copied[2]);
  assert.match(automationFeedback.textContent, /Скопировано/i);
});

test("offers pass, caution, stop, and unverified for every interactive check", () => {
  const statuses = ["pass", "caution", "stop", "unverified"];
  const counts = Object.fromEntries(
    statuses.map((status) => [
      status,
      tags("button").filter((tag) => attribute(tag, "data-status") === status)
        .length,
    ]),
  );

  for (const status of statuses) {
    assert.ok(
      counts[status] >= 5,
      `expected at least five ${status} controls, got ${counts[status]}`,
    );
  }
  assert.equal(
    new Set(Object.values(counts)).size,
    1,
    `each check must expose the same four statuses: ${JSON.stringify(counts)}`,
  );

  const statusButtons = tags("button").filter((item) =>
    attribute(item, "data-status"),
  );
  for (const tag of statusButtons) {
    assert.equal(
      attribute(tag, "type"),
      "button",
      "status controls must not submit",
    );
    assert.equal(
      attribute(tag, "aria-pressed"),
      "false",
      "status controls need an initial accessible pressed state",
    );
  }
});

test("persists progress in localStorage and provides a complete reset", () => {
  assertPattern(script, /localStorage\.getItem\s*\(/, "restore saved progress");
  assertPattern(script, /localStorage\.setItem\s*\(/, "save every status change");
  assertPattern(
    script,
    /localStorage\.removeItem\s*\(/,
    "reset must remove saved progress",
  );
  assertPattern(
    html,
    /<button\b(?=[^>]*\bdata-action=["']reset["'])[^>]*>/i,
    "the reset action must be visible in the page",
  );
});

test("computes a live verdict with stop as the highest-risk state", () => {
  assertPattern(
    html,
    /<[^>]+(?=[^>]*\bdata-verdict(?:-output)?=["'][^"']+["'])(?=[^>]*\baria-live=["']polite["'])[^>]*>/i,
    "the computed verdict needs an aria-live output",
  );
  assertPattern(
    script,
    /(?:function\s+computeVerdict|(?:const|let)\s+computeVerdict\s*=)/,
    "keep verdict logic in a named, reviewable function",
  );
  assertPattern(
    script,
    /stop[\s\S]*unverified[\s\S]*caution[\s\S]*pass/i,
    "verdict priority must be stop > unverified > caution > pass",
  );

  const functionSource = script.match(
    /function computeVerdict\(statuses = normalizedStatuses\(\)\) \{([\s\S]*?)\n  \}/,
  );
  assert.ok(functionSource, "computeVerdict must remain extractable for unit tests");
  const computeVerdict = vm.runInNewContext(
    `(function computeVerdict(statuses) {${functionSource[1]}\n})`,
  );
  assert.equal(computeVerdict(["pass", "pass"]), "pass");
  assert.equal(computeVerdict(["pass", "caution"]), "caution");
  assert.equal(computeVerdict(["caution", "unverified"]), "unverified");
  assert.equal(computeVerdict(["stop", "unverified", "caution"]), "stop");
});

test("keeps pass and caution unverified until evidence is described", () => {
  const functionSource = script.match(
    /function effectiveStatus\(check = \{\}\) \{([\s\S]*?)\n  \}/,
  );
  assert.ok(functionSource, "effectiveStatus must remain extractable");
  const effectiveStatus = vm.runInNewContext(
    `(function effectiveStatus(check = {}) { const supportedStatuses = ["stop", "unverified", "caution", "pass"]; function cleanStatus(value) { return supportedStatuses.includes(value) ? value : null; }${functionSource[1]}\n})`,
  );
  assert.equal(effectiveStatus({ status: "pass", note: "" }), "unverified");
  assert.equal(effectiveStatus({ status: "caution", note: "   " }), "unverified");
  assert.equal(effectiveStatus({ status: "pass", note: "OCCT 0 errors" }), "pass");
  assert.equal(effectiveStatus({ status: "stop", note: "" }), "stop");
  assertPattern(html, /Пустая заметка[^.<]{0,100}(?:Не проверено|«Не проверено»)/i);
});

test("can copy and print a report containing statuses and the verdict", () => {
  assertPattern(html, /\bdata-action=["']copy-report["']/i);
  assertPattern(html, /\bdata-action=["']print-report["']/i);
  assertPattern(script, /navigator\.clipboard\.writeText\s*\(/);
  assertPattern(script, /window\.print\s*\(/);
  assertPattern(
    script,
    /(?:build|create|format)Report/i,
    "report generation should be a named function",
  );
  assertPattern(script, /verdict/i, "the report must include the computed verdict");
  assertPattern(script, /status/i, "the report must include individual statuses");
  assertPattern(script, /caution:\s*["']Есть оценимый недостаток/i);
  assertPattern(script, /stop:\s*["']Обнаружен стоп-фактор/i);
  assertPattern(script, /unverified:\s*["']Положительный результат не сформирован/i);
});

test("labels and links portable packages without disguising installers", () => {
  const crystalDiskInfo = toolCard("CrystalDiskInfo");
  const hwinfo = toolCard("HWiNFO");
  const gpuZ = toolCard("GPU-Z");
  const occt = toolCard("OCCT");

  assert.ok(crystalDiskInfo, "CrystalDiskInfo card is required");
  assert.match(crystalDiskInfo, /portable\s+ZIP|ZIP\s+portable/i);
  assert.doesNotMatch(crystalDiskInfo, /CrystalDiskInfo[^"']*\.exe\/download/i);

  assert.ok(hwinfo, "HWiNFO card is required");
  assert.match(hwinfo, /portable\s+ZIP|ZIP\s+portable/i);
  assert.doesNotMatch(hwinfo, /hwi_\d+x\.exe/i);

  assert.ok(gpuZ, "GPU-Z card is required");
  assert.match(gpuZ, /portable\s+EXE|EXE\s+portable/i);
  assert.ok(occt, "OCCT card is required");
  assert.match(occt, /portable\s+EXE|EXE\s+portable/i);
});

test("states a practical USB drive capacity for the field kit", () => {
  assertPattern(html, /флешк(?:а|у|е|и|ой)?[^.]{0,160}8\s*(?:ГБ|GB)/i,
    "the preparation step must tell a novice what USB-drive size to bring");
});

test("gives exact UAC publisher guidance before elevation", () => {
  assertPattern(html, /Verified publisher|Проверенный издатель/i);
  assertPattern(html, /REALiX\s*,?\s*s\.r\.o\./i);
  assertPattern(html, /\bCPUID\b/);
  assertPattern(
    html,
    /(?:Unknown publisher|Неизвестный издатель)[\s\S]{0,180}(?:СТОП|отмен|Нет)/i,
    "an unknown UAC publisher must lead to an explicit cancellation",
  );
});

test("walks a novice through the OCCT support countdown and emergency Stop", () => {
  assertPattern(html, /OCCT[\s\S]{0,800}(?:countdown|обратн\w* отсч)/i);
  assertPattern(html, /OCCT[\s\S]{0,1000}(?:support|поддержк)/i);
  assertPattern(
    html,
    /(?:найди|locate)[\s\S]{0,100}\bStop\b[\s\S]{0,160}\bStart\b/i,
  );
  assertPattern(
    html,
    /(?:Stop|останов)[\s\S]{0,180}(?:артефакт|ошибк|запах|BSOD|ребут)/i,
    "the guide must say when and how to stop the running test",
  );
});

test("defines a 25-to-30-minute on-site screen with separate quick checks", () => {
  const load = sliceBetween(html, 'id="route"', 'id="decision"');
  assertPattern(load, /(?:25[–-]30|25\s*[-–]\s*30)[^\n]{0,80}(?:минут|мин)/i);
  assertPattern(load, /CPU-only|CPU отдельно/i);
  assertPattern(load, /CPU\+RAM|CPU и RAM/i);
  assertPattern(load, /Memory|памят/i);
  assertPattern(load, /3D\s+Adaptive/i);
  assertPattern(load, /Variable/i);
  assertPattern(load, /15\s*%[^<]{0,100}100\s*%/i);
  assertPattern(load, /(?:5\s*мин|5\s*минут)/i);
  assertPattern(load, /VRAM/i);
  assertPattern(html, /HOME\s+SCREEN[^<]{0,80}90[–-]120\s*МИН/i);
});

test("defines a maximum 8-to-12-plus-hour profile without claiming one-click automation", () => {
  const profiles = sliceBetween(html, 'id="test-profiles"', 'id="route"');
  assertPattern(profiles, /8[–-]12\+?\s*час/i);
  assertPattern(profiles, /MemTest86[^<]{0,180}4[^<]{0,80}(?:проход|pass)/i);
  assertPattern(profiles, /3D\s+Standard[^<]{0,180}3\s*[×x]\s*10\s*мин/i);
  assertPattern(profiles, /Adaptive[^<]{0,180}90\s*мин/i);
  assertPattern(profiles, /Switch[^<]{0,180}20\s*%[^<]{0,80}90\s*%[^<]{0,80}330\s*мс/i);
  assertPattern(profiles, /VRAM[^<]{0,180}80\s*%[^<]{0,80}30\s*мин/i);
  assertPattern(profiles, /Personal\s+Free/i);
  assertPattern(profiles, /Supporter/i);
  assertPattern(profiles, /Enterprise/i);
  assertPattern(profiles, /(?:не\s+одн|не является одн|нельзя[^.]{0,80}одн)[^.]{0,80}(?:клик|кнопк)/i);
});

test("keeps Power optional, staged, supervised, and unable to certify the PSU", () => {
  assertPattern(html, /Power[^<]{0,180}(?:опциональ|необязател)/i);
  assertPattern(html, /Power[\s\S]{0,400}2\s*мин[\s\S]{0,220}10\s*мин[\s\S]{0,220}20[–-]30\s*мин/i);
  assertPattern(html, /Power[\s\S]{0,500}(?:под наблюдением|supervised|не оставляй)/i);
  assertPattern(html, /Power[\s\S]{0,500}(?:не доказывает|не подтверждает)[^.<]{0,100}(?:исправность|здоровье)[^.<]{0,60}БП/i);
});

test("separates GPU core, hotspot, and memory and orders thermal remediation", () => {
  assertPattern(html, /GPU\s*(?:Core|ядр)/i);
  assertPattern(html, /(?:GPU\s*)?(?:Hot\s*Spot|Hotspot|горяч\w* точк)/i);
  assertPattern(html, /(?:GPU\s*)?(?:Memory|VRAM|памят)/i);
  assertPattern(
    html,
    /(?:не существует|нет)[^.!?]{0,100}(?:универсаль\w*|един\w*)[^.!?]{0,60}(?:температур|порог)/i,
    "temperature verdicts must be model-specific",
  );

  const thermalNote = sliceBetween(html, '<p class="thermal-note"', '</p>');
  const dust = indexOfAny(thermalNote, [/пыл/i, /dust/i]);
  const sameRetest = indexOfAny(thermalNote, [
    /повтор(?:и|ить|яем|ить снова)?\s+(?:тот же|такой же)\s+тест/i,
    /repeat\s+the\s+same\s+test/i,
  ]);
  const airflow = indexOfAny(thermalNote, [/airflow/i, /обдув/i, /воздуш\w* поток/i]);
  const service = indexOfAny(thermalNote, [/сервис/i, /обслужив/i, /service/i]);
  assert.ok(
    dust >= 0 && dust < sameRetest && sameRetest < airflow && airflow < service,
    `expected dust -> same retest -> airflow -> service, got ${[
      dust,
      sameRetest,
      airflow,
      service,
    ].join(" -> ")}`,
  );
  assertPattern(html, /\bBIOS\b/i, "fan-curve warning must mention BIOS");
  assertPattern(html, /\bGCC\b/i, "fan-curve warning must mention GCC");
  assertPattern(
    html,
    /(?:не\s+(?:меняй|изменяй)|запрещено\s+менять)[\s\S]{0,180}(?:крив\w* вентил|fan curve)|(?:крив\w* вентил|fan curve)[\s\S]{0,180}(?:не\s+(?:меняй|изменяй)|запрещено\s+менять)/i,
    "do not tune fan curves to manufacture a passing result",
  );
});

test("turns the observed CPU-Z download failure into a fail-closed fallback", () => {
  const alert = sliceBetween(
    html,
    '<div class="download-alert"',
    '<div class="tool-list"',
  );

  assertPattern(alert, /Windows-ПК без VPN/i);
  assertPattern(alert, /30 секунд/i);
  assertPattern(alert, /не ищи[^.]{0,100}зеркал/i);
  assertPattern(alert, /проверенн\w*[^.]{0,100}флешк/i);
  assertPattern(alert, /HWiNFO\s+Summary/i);
  assertPattern(
    alert,
    /(?:CPU\/RAM|CPU и RAM)[\s\S]{0,180}(?:СТОП|повторн\w* встреч|не покуп)/i,
    "unverified CPU/RAM cannot silently degrade to a small discount",
  );
});

test("keeps configuration mismatches and load evidence fail-closed", () => {
  assertPattern(html, /холодн(?:ый|ого|ому|ым)? запуск/i, "the route must include a cold boot");
  assertPattern(html, /Диспетчер устройств/i, "the route must inspect Device Manager");
  const components = sliceBetween(html, 'data-check="components"', 'data-check="storage"');
  assertPattern(components, /<b>Стоп:<\/b>/i);
  assertPattern(components, /(?:CPU|GPU|VRAM|объём RAM)[\s\S]{0,220}не совпад/i,
    "advertised component mismatches must not silently become a bargain");
  assertPattern(
    html,
    /до Start[\s\S]{0,220}(?:WHEA-Logger|WHEA)[\s\S]{0,120}(?:не очищай|журнал не очищай)/i,
    "record a WHEA baseline before load without clearing seller history",
  );
  const inspection = sliceBetween(html, 'data-check="inspection"', 'data-check="components"');
  assertPattern(inspection, /<b>Стоп:<\/b>/i);
  assertPattern(inspection, /(?:нечитаемая\/отсутствующая|отсутствующая\/нечитаемая)[^<]{0,100}наклейка БП/i,
    "an unidentified gaming-PC PSU must not pass");
});

test("documents github-pages as the deployable source of truth", () => {
  assert.ok(readme, "github-pages/README.md must exist");
  assertPattern(readme, /source of truth|источник(?:ом)? истины/i);
  assertPattern(readme, /index\.html/);
  assertPattern(readme, /style\.css/);
  assertPattern(readme, /script\.js/);
  assertPattern(readme, /node\s+--test\s+tests\/site\.test\.mjs/);
});

test("keeps every fragment link backed by an element id", () => {
  const ids = new Set(
    [...html.matchAll(/\bid=["']([^"']+)["']/gi)].map(([, id]) => id),
  );
  const fragments = [...html.matchAll(/\bhref=["']#([^"']+)["']/gi)].map(
    ([, fragment]) => fragment,
  );

  assert.ok(fragments.length > 0, "the page should expose in-page navigation");
  assert.deepEqual(
    fragments.filter((fragment) => !ids.has(fragment)),
    [],
    "every fragment link must resolve",
  );
});

test("protects every target=_blank link with noopener and noreferrer", () => {
  const externalTabs = tags("a").filter(
    (tag) => attribute(tag, "target") === "_blank",
  );
  assert.ok(externalTabs.length > 0, "expected vendor links that open a new tab");

  for (const tag of externalTabs) {
    const rel = new Set((attribute(tag, "rel") ?? "").toLowerCase().split(/\s+/));
    assert.ok(rel.has("noopener"), `missing noopener: ${tag}`);
    assert.ok(rel.has("noreferrer"), `missing noreferrer: ${tag}`);
  }
});

test("has no external runtime assets or embeds", () => {
  const runtimeUrls = [
    ...tags("script").map((tag) => attribute(tag, "src")),
    ...tags("img").map((tag) => attribute(tag, "src")),
    ...tags("source").map((tag) => attribute(tag, "src")),
    ...tags("link")
      .filter((tag) => attribute(tag, "rel")?.toLowerCase() === "stylesheet")
      .map((tag) => attribute(tag, "href")),
  ].filter(Boolean);

  assert.deepEqual(
    runtimeUrls.filter((url) => /^(?:https?:)?\/\//i.test(url)),
    [],
    "runtime assets must remain local",
  );
  assert.doesNotMatch(css, /@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//i);
  assert.doesNotMatch(css, /url\(\s*["']?(?:https?:)?\/\//i);
  assert.doesNotMatch(html, /<(?:iframe|embed|object)\b/i);
  assert.doesNotMatch(
    script,
    /\b(?:fetch|importScripts|import)\s*\(\s*["'](?:https?:)?\/\//i,
  );
});

test("runs this dependency-free suite in GitHub Actions", () => {
  const workflow = readOptional(".github/workflows/verify.yml");
  assert.ok(workflow, "verify.yml must exist");
  assertPattern(workflow, /(?:push|pull_request):/);
  assertPattern(workflow, /node-version:\s*["']?22["']?/);
  assertPattern(workflow, /node --test tests\/site\.test\.mjs/);
});
