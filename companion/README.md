# PC Check Companion

Локальный Windows-помощник для предварительной проверки б/у ПК. Он собирает только штатные сведения Windows, формирует обезличенные `report.html` и `report.json` и не отправляет их в интернет.

## Что проверяет первая версия

- модель CPU, GPU, объём и число модулей RAM;
- состояние физических накопителей, доступное через Windows Storage API;
- проблемные устройства Plug and Play;
- 30-дневный baseline событий `Microsoft-Windows-WHEA-Logger`;
- совпадение CPU, GPU и RAM с параметрами объявления, если они переданы при запуске.

Итог первой версии обычно остаётся `НЕ ПРОВЕРЕНО`, пока человек не осмотрит блок питания и внутренности и не завершит безопасный нагрузочный тест по инструкции сайта. Это намеренное ограничение: одна программа не может подтвердить состояние БП или будущую надёжность компьютера.

## Границы безопасности и приватности

- не требует администратора и не показывает UAC;
- не меняет Defender, Execution Policy, драйверы, BIOS, вентиляторы или VPN;
- не выполняет сетевых запросов и не скачивает сторонние программы;
- не собирает имя пользователя, имя ПК и серийные номера;
- не запускает OCCT Power и не создаёт дисковую запись для стресс-теста;
- HTML-отчёт автономный: в нём нет скриптов, CDN, аналитики и внешних ресурсов.

Сведения Windows о видеопамяти и SMART могут быть неполными. В таком случае результат остаётся `НЕ ПРОВЕРЕНО`, а сайт направляет к GPU-Z и CrystalDiskInfo из официальных источников.

## Локальная разработка

Нужен .NET SDK 10.

```sh
dotnet build tests/PcCheck.Core.Tests/PcCheck.Core.Tests.csproj -m:1
dotnet tests/PcCheck.Core.Tests/bin/Debug/net10.0/PcCheck.Core.Tests.dll
dotnet build tests/PcCheck.App.Tests/PcCheck.App.Tests.csproj -m:1
dotnet tests/PcCheck.App.Tests/bin/Debug/net10.0/PcCheck.App.Tests.dll
```

Сборка автономного Windows x64-файла:

```sh
dotnet publish src/PcCheck.App/PcCheck.App.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=None -p:DebugSymbols=false -o artifacts/win-x64
```

Пример запуска из консоли:

```powershell
.\PC-Check.exe --cpu "Ryzen 7 5700X" --gpu "RTX 4070" --ram 32
```

Без параметров программа просто зафиксирует фактический состав. Отчёт появится рядом с программой в `Reports\PC-Check-<дата-время>`. Если каталог защищён от записи, используется папка «Документы».

## Выпуск

CI компилирует неподписанную тестовую сборку на Windows runner, но не загружает её как artifact и не публикует на сайт. Beta передаётся владельцу только через отдельный закрытый канал. Перед публичной кнопкой загрузки обязательны:

1. реальный E2E на Windows 10/11 без VPN;
2. просмотр отчёта и сверка с CPU-Z, GPU-Z и CrystalDiskInfo;
3. проверка Defender и SmartScreen без исключений и обходов;
4. решение о доверенной подписи/MSIX Store;
5. SHA-256 финального неизменённого файла.

Неподписанный локальный файл — только beta для владельца, не публичный релиз.
