(() => {
  "use strict";

  const diagnosticPackages = Object.freeze([
    { id: "TechPowerUp.GPU-Z", version: "2.70.0" },
    { id: "CrystalDewWorld.CrystalDiskInfo", version: "9.9.2" },
    { id: "REALiX.HWiNFO", version: "8.50" },
    { id: "OCBase.OCCT.Personal", version: "17.0.16.0" },
    { id: "CPUID.CPU-Z", version: "2.21" },
  ]);

  function normalizeDrive(value) {
    const match = /^([D-Z]):?$/i.exec(String(value || "").trim());
    if (!match) throw new Error("Укажи одну букву флешки от D до Z, например E:");
    return `${match[1].toUpperCase()}:`;
  }

  function buildUsbPrepCommand(value) {
    const drive = normalizeDrive(value);
    const packages = diagnosticPackages
      .map(({ id, version }) => `[pscustomobject]@{Id='${id}';Version='${version}'}`)
      .join(",");
    return [
      "$ErrorActionPreference='Stop'",
      `$Drive='${drive}'`,
      "$Volume=Get-CimInstance Win32_LogicalDisk -Filter (\"DeviceID='\"+$Drive+\"'\")",
      "if(-not $Volume){throw 'Флешка с этой буквой не найдена'}",
      "if([int]$Volume.DriveType -ne 2){throw 'Выбранный диск не помечен Windows как съёмная флешка'}",
      "$WingetCommand=Get-Command winget.exe -ErrorAction SilentlyContinue",
      "if(-not $WingetCommand){throw 'WinGet не найден. Обнови App Installer из Microsoft Store'}",
      "$Winget=[IO.Path]::GetFullPath($WingetCommand.Source)",
      "$ExpectedWingetRoot=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Microsoft\\WindowsApps')+'\\')",
      "if(-not $Winget.StartsWith($ExpectedWingetRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'WinGet найден вне системного App Installer — запуск отменён'}",
      "$SourceRaw=& $Winget source export --name winget --disable-interactivity",
      "if($LASTEXITCODE -ne 0 -or -not $SourceRaw){throw 'Не удалось проверить источник WinGet'}",
      "$Source=$SourceRaw | ConvertFrom-Json",
      "if($Source.Name -ne 'winget' -or $Source.Arg -ne 'https://cdn.winget.microsoft.com/cache' -or $Source.Identifier -ne 'Microsoft.Winget.Source_8wekyb3d8bbwe' -or $Source.Type -ne 'Microsoft.PreIndexed.Package' -or $Source.TrustLevel -notcontains 'Trusted'){throw 'Источник winget изменён или не является доверенным — запуск отменён'}",
      "$Run=Get-Date -Format 'yyyyMMdd-HHmmss'",
      "$Root=Join-Path ($Drive+'\\') 'PC-Check'",
      "$RunRoot=Join-Path $Root $Run",
      "$Tools=Join-Path $RunRoot 'Tools'",
      "$Staging=Join-Path $RunRoot '.staging'",
      "New-Item -ItemType Directory -Force -Path $Tools,$Staging | Out-Null",
      "try{$null=$null",
      "$SourceRaw | Set-Content -Encoding UTF8 -Path (Join-Path $RunRoot 'WINGET-SOURCE.json')",
      `$Packages=@(${packages})`,
      "$Failed=@()",
      "$ManifestRows=@()",
      "$TaskKill=Join-Path $env:SystemRoot 'System32\\taskkill.exe'",
      "foreach($Package in $Packages){$Id=$Package.Id;$Version=$Package.Version;$Stage=Join-Path $Staging $Id;New-Item -ItemType Directory -Force -Path $Stage|Out-Null;Write-Host ('winget download --id '+$Id+' --version '+$Version+' --exact --source winget --download-directory '+$Stage) -ForegroundColor Cyan;$TimeoutMs=if($Id -eq 'CPUID.CPU-Z'){45000}else{180000};$Psi=New-Object System.Diagnostics.ProcessStartInfo;$Psi.FileName=$Winget;$Psi.Arguments=('download --id '+$Id+' --version '+$Version+' --exact --source winget --download-directory '+$Stage+' --accept-source-agreements --accept-package-agreements --disable-interactivity');$Psi.UseShellExecute=$false;$Process=[System.Diagnostics.Process]::Start($Psi);$Completed=$Process.WaitForExit($TimeoutMs);if(-not $Completed){try{$KillPsi=New-Object System.Diagnostics.ProcessStartInfo;$KillPsi.FileName=$TaskKill;$KillPsi.Arguments=('/PID '+$Process.Id+' /T /F');$KillPsi.UseShellExecute=$false;$Killer=[System.Diagnostics.Process]::Start($KillPsi);if(-not $Killer.WaitForExit(5000)){try{$Killer.Kill();$Killer.WaitForExit(1000)|Out-Null}catch{}}}catch{try{$Process.Kill()}catch{}};$StoppedAfterKill=$Process.WaitForExit(5000);$Failed+=($Id+' '+$Version+' (таймаут)');if(-not $StoppedAfterKill){throw 'Процесс загрузки не удалось остановить'};continue};if($Process.ExitCode -ne 0){$Failed+=($Id+' '+$Version+' (exit '+$Process.ExitCode+')');continue};$Payload=@(Get-ChildItem $Stage -Recurse -File -ErrorAction SilentlyContinue);if(-not $Payload.Count){$Failed+=($Id+' '+$Version+' (нет файла)');continue};$PackageDir=Join-Path $Tools $Id;Move-Item -LiteralPath $Stage -Destination $PackageDir;Get-ChildItem $PackageDir -Recurse -File|ForEach-Object{$Hash=Get-FileHash $_.FullName -Algorithm SHA256;$ManifestRows+=[pscustomobject]@{PackageId=$Id;Version=$Version;SourceName=$Source.Name;SourceIdentifier=$Source.Identifier;File=$_.FullName.Substring($Tools.Length).TrimStart('\\');SHA256=$Hash.Hash}}}",
      "$Manifest=Join-Path $RunRoot 'SHA256.csv'",
      "$ManifestRows | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $Manifest",
      "$DefenderOk=$false",
      "try{$ScanStart=Get-Date;Start-MpScan -ScanType CustomScan -ScanPath $Tools -ErrorAction Stop;$Threats=@(Get-MpThreatDetection -ErrorAction SilentlyContinue|Where-Object{$_.InitialDetectionTime -ge $ScanStart});if($Threats.Count){$Failed+='Defender обнаружил угрозу'}else{$DefenderOk=$true}}catch{$Failed+='Проверка Defender недоступна'}",
      "$Explorer=Join-Path $env:SystemRoot 'explorer.exe'",
      "if($Failed.Count -or -not $DefenderOk){throw 'Не все проверки подготовки пройдены'}",
      "$Readme=@('COMPLETE — PC CHECK','Версии и источник зафиксированы в SHA256.csv и WINGET-SOURCE.json.','Файлы скачаны через доверенный WinGet, его проверка хэшей не отключалась.','Defender завершил CustomScan без новых обнаружений.','Ничего не установлено и не запущено. Не запускай OCCT Power.')",
      "$Readme | Set-Content -Encoding UTF8 -Path (Join-Path $RunRoot 'COMPLETE.txt')",
      "& $Explorer $RunRoot",
      "Write-Host ('Флешка подготовлена: '+$RunRoot) -ForegroundColor Green",
      "}catch{$Reasons=if($Failed.Count){$Failed}else{@('Подготовка прервана до завершения')};@('INCOMPLETE — ФЛЕШКА НЕ ГОТОВА','Не устанавливай и не запускай файлы из этого набора.','Причины:')+$Reasons|Set-Content -Encoding UTF8 -Path (Join-Path $RunRoot 'INCOMPLETE.txt');& (Join-Path $env:SystemRoot 'explorer.exe') $RunRoot;throw 'Подготовка не завершена. Смотри INCOMPLETE.txt'}",
    ].join("; ");
  }

  function buildAutocheckCommand() {
    return [
      "$ErrorActionPreference='Stop'",
      "$Stamp=Get-Date -Format 'yyyyMMdd-HHmmss'",
      "$Root=Join-Path ([Environment]::GetFolderPath('Desktop')) ('PC-Check-'+$Stamp)",
      "New-Item -ItemType Directory -Force -Path $Root | Out-Null",
      "$Cpu=@(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed)",
      "$Gpu=@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM,VideoModeDescription)",
      "$Ram=@(Get-CimInstance Win32_PhysicalMemory | Select-Object Manufacturer,PartNumber,Capacity,Speed,ConfiguredClockSpeed)",
      "$Storage=@(Get-PhysicalDisk | ForEach-Object{$Disk=$_;$Reliability=$null;try{$Reliability=$_ | Get-StorageReliabilityCounter -ErrorAction Stop}catch{};[pscustomobject]@{Name=$Disk.FriendlyName;MediaType=$Disk.MediaType;Health=$Disk.HealthStatus;Operational=($Disk.OperationalStatus -join ',');SizeBytes=$Disk.Size;Temperature=$Reliability.Temperature;Wear=$Reliability.Wear;PowerOnHours=$Reliability.PowerOnHours}})",
      "$DeviceProblems=try{@(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object{$_.Status -ne 'OK'} | Select-Object Class,Status,Problem)}catch{@([pscustomobject]@{Class='UNAVAILABLE';Status='UNAVAILABLE';Problem='UNAVAILABLE'})}",
      "$Whea=@(Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Microsoft-Windows-WHEA-Logger';StartTime=(Get-Date).AddDays(-30)} -ErrorAction SilentlyContinue | Select-Object TimeCreated,Id,LevelDisplayName)",
      "$Defender=try{Get-MpComputerStatus -ErrorAction Stop | Select-Object AntivirusEnabled,RealTimeProtectionEnabled,AntivirusSignatureLastUpdated}catch{[pscustomobject]@{Status='UNAVAILABLE'}}",
      "$Report=[ordered]@{CollectedAt=(Get-Date).ToString('o');CPU=$Cpu;GPU=$Gpu;RAM=$Ram;Storage=$Storage;DeviceProblems=$DeviceProblems;WheaLast30Days=$Whea;Defender=$Defender;Limits=@('GPU AdapterRAM из WMI может быть неточным — сверь в GPU-Z','Блок питания и физическое состояние программно не проверяются','Нагрузочные тесты этим этапом не запускаются')} ",
      "$Json=Join-Path $Root 'report.json'",
      "$Report | ConvertTo-Json -Depth 7 | Set-Content -Encoding UTF8 -Path $Json",
      "$CpuNames=($Cpu | ForEach-Object{$_.Name}) -join ', ' ",
      "$GpuNames=($Gpu | ForEach-Object{$_.Name}) -join ', ' ",
      "$RamGb=[math]::Round((($Ram | Measure-Object Capacity -Sum).Sum/1GB),1)",
      "$DiskLines=($Storage | ForEach-Object{$_.Name+' / '+$_.Health}) -join '; ' ",
      "$Lines=@('АВТОЭТАП ЗАВЕРШЁН',('CPU: '+$CpuNames),('GPU: '+$GpuNames),('RAM: '+$RamGb+' ГБ'),('Диски: '+$DiskLines),('Проблемные устройства: '+$DeviceProblems.Count),('WHEA за 30 дней: '+$Whea.Count),'','НЕ ПРОВЕРЕНО: БП, корпус, порты, точная VRAM и стабильность под нагрузкой.','Не оплачивай ПК до ручного осмотра и контролируемого теста.')",
      "$Text=Join-Path $Root 'СНАЧАЛА-ПРОЧТИ.txt'",
      "$Lines | Set-Content -Encoding UTF8 -Path $Text",
      "& (Join-Path $env:SystemRoot 'System32\\notepad.exe') $Text",
      "Write-Host ('Отчёт сохранён: '+$Root) -ForegroundColor Green",
    ].join("; ");
  }

  window.PcCheckCommands = Object.freeze({
    buildUsbPrepCommand,
    buildAutocheckCommand,
  });
})();
