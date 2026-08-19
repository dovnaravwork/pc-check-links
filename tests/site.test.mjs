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

test("offers one-click copy actions for USB preparation and native autocheck", () => {
  assert.ok(commandsScript, "commands.js must contain auditable local commands");
  assertPattern(
    html,
    /<script\b(?=[^>]*\bsrc=["']commands\.js["'])[^>]*><\/script>/i,
    "index.html must load commands.js locally",
  );
  assertPattern(html, /\bdata-action=["']copy-usb-command["']/i);
  assertPattern(html, /\bdata-action=["']copy-autocheck-command["']/i);
  assertPattern(html, /\bdata-usb-drive\b/i);
  assertPattern(script, /PcCheckCommands\.buildUsbPrepCommand\s*\(/);
  assertPattern(script, /PcCheckCommands\.buildAutocheckCommand\s*\(/);
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
  assert.match(command, /WaitForExit\s*\(\s*\$TimeoutMs\s*\)/i);
  assert.match(command, /\.Kill\s*\(\s*\)/i);
  assert.ok(
    command.indexOf("CPUID.CPU-Z") > command.indexOf("OCBase.OCCT.Personal"),
    "the known-slow CPU-Z download must run last",
  );
  assert.doesNotMatch(command, /winget\s+(?:install|import)/i);
  assert.doesNotMatch(command, /ignore-security-hash/i);
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

test("uses an adaptive purchase load that reaches 100 percent without Power test", () => {
  const load = sliceBetween(html, 'data-check="load"', 'data-check="ports"');
  assertPattern(load, /3D\s+Adaptive/i);
  assertPattern(load, /Variable/i);
  assertPattern(load, /15\s*%[^<]{0,100}100\s*%/i);
  assertPattern(load, /\+?5\s*%[^<]{0,80}20\s*сек/i);
  assertPattern(load, /3D[\s\S]{0,300}7\s*минут/i);
  assertPattern(load, /CPU[^<]{0,100}5\s*минут/i);
  assertPattern(load, /Memory[^<]{0,100}5\s*минут/i);
  assertPattern(load, /не\s+запускай[^<]{0,80}\bPower\b/i);
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

  const dust = indexOfAny(html, [/пыл/i, /dust/i]);
  const sameRetest = indexOfAny(html, [
    /повтор(?:и|ить|яем|ить снова)?\s+(?:тот же|такой же)\s+тест/i,
    /repeat\s+the\s+same\s+test/i,
  ]);
  const airflow = indexOfAny(html, [/airflow/i, /обдув/i, /воздуш\w* поток/i]);
  const service = indexOfAny(html, [/сервис/i, /обслужив/i, /service/i]);
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
