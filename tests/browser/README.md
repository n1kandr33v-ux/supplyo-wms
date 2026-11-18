# Изолированные регрессии

Скопированы из локальных .deploy helpers перед переустановкой. API и print agent подменены; для этих сценариев реальный WB/Ozon/бумажный принтер не нужен. Запускать из корня после npm run build:live. Puppeteer не runtime-зависимость: npm install --no-save --package-lock=false puppeteer (не изменять lockfile), создать tests/browser/artifacts. Затем node tests/browser/scanner-next-item-browser.cjs и другие нужные fixtures.

Часть исторических проверок ожидает прежние подписи/даты UI; при несовпадении разбирать причину, не переписывать продукт ради старого теста. Native Python fixtures требуют Windows, собранный print-agent/windows/build/supply-print-agent.exe и используют отдельный state-dir/порт 17991 без настоящей печати. Не запускать на production-агенте. Полный исходный .deploy и приватные диагностические данные находятся только в личном архиве.
