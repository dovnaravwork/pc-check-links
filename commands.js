(() => {
  "use strict";

  const packageIds = Object.freeze([
    "TechPowerUp.GPU-Z",
    "CrystalDewWorld.CrystalDiskInfo",
    "REALiX.HWiNFO",
    "OCBase.OCCT.Personal",
    "CPUID.CPU-Z",
  ]);

  function normalizeDrive(value) {
    const match = /^([D-Z]):?$/i.exec(String(value || "").trim());
    if (!match) throw new Error("Укажи одну букву флешки от D до Z, например E:");
    return `${match[1].toUpperCase()}:`;
  }

  function buildUsbPrepCommand(value) {
    const drive = normalizeDrive(value);
    const packages = packageIds.map((id) => `'${id}'`).join(",");
    return [
      "$ErrorActionPreference='Stop'",
      `$Drive='${drive}'`,
      "if(-not (Test-Path ($Drive+'\\'))){throw 'Флешка с этой буквой не найдена'}",
      "if(-not (Get-Command winget.exe -ErrorAction SilentlyContinue)){throw 'WinGet не найден. Обнови App Installer из Microsoft Store'}",
      "$Root=Join-Path ($Drive+'\\') 'PC-Check'",
      "$Tools=Join-Path $Root 'Tools'",
      "$Reports=Join-Path $Root 'Reports'",
      "New-Item -ItemType Directory -Force -Path $Tools,$Reports | Out-Null",
      `$Packages=@(${packages})`,
      "$Failed=@()",
      "$WingetBaseArgs=@('download','--exact','--source','winget','--download-directory',$Tools,'--accept-source-agreements','--accept-package-agreements','--disable-interactivity')",
      "foreach($Id in $Packages){Write-Host ('winget download --id '+$Id+' --exact --source winget --download-directory '+$Tools) -ForegroundColor Cyan;$TimeoutMs=if($Id -eq 'CPUID.CPU-Z'){45000}else{180000};$BeforeCount=@(Get-ChildItem $Tools -Recurse -File -ErrorAction SilentlyContinue).Count;$WingetArgs=@('download','--id',$Id)+$WingetBaseArgs[1..($WingetBaseArgs.Count-1)];$Process=Start-Process winget.exe -ArgumentList $WingetArgs -PassThru -NoNewWindow;$Completed=$Process.WaitForExit($TimeoutMs);if(-not $Completed){try{$Process.Kill()}catch{};$Process.WaitForExit();$Failed+=($Id+' (таймаут)')}else{$AfterCount=@(Get-ChildItem $Tools -Recurse -File -ErrorAction SilentlyContinue).Count;if($AfterCount -le $BeforeCount){$Failed+=$Id}}}",
      "$Manifest=Join-Path $Root 'SHA256.csv'",
      "Get-ChildItem $Tools -Recurse -File | ForEach-Object{$Hash=Get-FileHash $_.FullName -Algorithm SHA256;[pscustomobject]@{File=$_.FullName.Substring($Tools.Length).TrimStart('\\');SHA256=$Hash.Hash}} | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $Manifest",
      "$Readme=@('PC CHECK — набор для проверки','Файлы скачаны через WinGet без установки и запуска.','SHA-256 каждого файла: SHA256.csv','Не отключай Defender и не используй случайные зеркала.','Не запускай OCCT Power. Нагрузку начинай только с согласия продавца.')",
      "$Readme | Set-Content -Encoding UTF8 -Path (Join-Path $Root 'README.txt')",
      "try{Start-MpScan -ScanType CustomScan -ScanPath $Tools -ErrorAction Stop}catch{Write-Warning 'Автоскан Defender недоступен — проверь папку вручную'}",
      "Start-Process explorer.exe -ArgumentList $Root",
      "if($Failed.Count){Write-Warning ('Не скачались: '+($Failed -join ', ')+'. Не ищи зеркала — повтори дома.')}else{Write-Host 'Флешка подготовлена. Ничего не установлено.' -ForegroundColor Green}",
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
      "$DeviceProblems=try{@(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object{$_.Status -ne 'OK'} | Select-Object Class,Status,InstanceId)}catch{@([pscustomobject]@{Class='UNAVAILABLE';Status=$_.Exception.Message;InstanceId=''})}",
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
      "Start-Process notepad.exe -ArgumentList $Text",
      "Write-Host ('Отчёт сохранён: '+$Root) -ForegroundColor Green",
    ].join("; ");
  }

  window.PcCheckCommands = Object.freeze({
    buildUsbPrepCommand,
    buildAutocheckCommand,
  });
})();
