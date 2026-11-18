# supply Print Agent — один EXE

Клиенту: скачайте `supply-print-agent.exe`, откройте его и выберите принтер в настройках supply. Распаковывать архив, устанавливать дополнительное ПО и открывать PowerShell не нужно. Агент работает в трее. Сайт сам обнаруживает подключение.

Это переносимая программа для Windows 10/11 (.NET Framework Windows). Автозапуск/реестр/службы Windows она не меняет: после перезагрузки компьютера файл нужно открыть снова. У EXE пока нет цифровой подписи издателя; проверка Windows может показать неизвестного издателя. Подписанный установщик с управляемым автозапуском остаётся отдельным этапом.

Настройки и журнал защиты от дублей сохраняются в прежнем `%LOCALAPPDATA%/ZakypitPrintAgent`: `config.json`, `jobs/*.json`, `agent.log`. Переносить или удалять их не нужно. Уже запущенный старый агент может занимать порт; программу не следует запускать второй раз. Она не завершает чужие процессы и не очищает историю.

Агент слушает только `127.0.0.1:17891`. Статус и список принтеров доступны сайту; печать разрешена с доверенных origin и заголовком X-WMS-Print-Agent. Ключи WB агенту не передаются. Поддержаны одиночная и пакетная печать до 1000 этикеток, 58×40 мм. Все изображения декодируются до отправки в Windows; весь пакет — одно задание PrintDocument. Повтор с тем же ID и теми же данными использует прежний результат. Изменённые/неопределённые задания блокируются. Ответ агента подтверждает принятие в очередь, а не физический выход бумаги.

В меню трея: открыть supply, открыть журнал, выход. Выход дожидается уже принятых заданий и не прерывает их принудительно. Настройки принтера выбираются на сайте и сохраняются для рабочего браузера.

## Сборка

`print-agent/windows/SupplyPrintAgent.cs` — исходный код нативного .NET-агента, без PowerShell-обёртки и извлекаемых сценариев.

Из корня репозитория:

```powershell
./print-agent/windows/build.ps1
```

Используется штатный csc.exe из .NET Framework Windows. Результат: `public/downloads/supply-print-agent.exe`. Иконка supply включена в файл.

Для изолированных проверок поддержаны `--port`, `--state-dir`, `--no-tray`, `--stop-file`; рабочие значения по умолчанию и старые данные ими не меняются.

Проверено запуском с отдельными портом и каталогом: health/printers, чтение старого формата конфигурации и completed job, защита изменённого/started job, origin/header, корректное завершение. Реальная печать в автоматическом тесте не выполнялась. Требуется приёмка печати на клиентском принтере.

Ozon label support (2026-11-12): version 2026.11.12-ozon-media reports mediaSizes/deviceId, stores a stable device-id.txt in the existing state directory, accepts optional width_mm/height_mm on each sticker and uses that size for each page. Legacy WB requests keep 58x40 mm. Print-batch digest/job deduplication still includes the exact body; device_id, when supplied, must match this agent. No PDF reader, separate unpacking or new printer installation is needed; the server rasterizes the protected Ozon PDF at 300 dpi. Replace the running old portable executable once to use this capability. Native receipt means spool acceptance, not a hardware paper-output guarantee.
